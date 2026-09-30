// Sends email through the Gmail API as a Google Workspace account, authorised once via OAuth with the
// gmail.send scope. Supabase Edge Functions can't use SMTP ports, so HTTPS it is.
//
// Same approach and secret names as activezoneoutdoor/moments (supabase/functions/_shared/gmail.ts), so the
// contact function can be deployed to the Moments Supabase project and reuse its Google credentials.

export type Email = {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string | null;
};

const encoder = new TextEncoder();

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** RFC 2047 encoding so names and subjects in any language survive email headers. */
function header(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64(encoder.encode(value))}?=`;
}

function address(email: string, name?: string): string {
  return name ? `${header(name.replace(/["\r\n]/g, ""))} <${email}>` : email;
}

function part(type: string, content: string): string {
  const body = base64(encoder.encode(content)).replace(/.{76}/g, "$&\r\n");
  return `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}\r\n`;
}

/** Builds the raw MIME message (plain text and HTML alternatives). */
export function buildMessage(email: Email, from: string): string {
  const boundary = `azo-${crypto.randomUUID()}`;
  const headers = [
    `From: ${from}`,
    `To: ${address(email.to, email.toName)}`,
    ...(email.replyTo ? [`Reply-To: ${email.replyTo.replace(/[\r\n]/g, "")}`] : []),
    `Subject: ${header(email.subject.replace(/[\r\n]/g, " "))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  return `${headers.join("\r\n")}\r\n\r\n--${boundary}\r\n${part("text/plain", email.text)}--${boundary}\r\n${
    part("text/html", email.html)
  }--${boundary}--\r\n`;
}

let cachedToken: { secret: string; value: string; expiresAt: number } | null = null;

/** Exchanges the stored OAuth refresh token for a short-lived access token. */
export async function accessToken(secret: string): Promise<string> {
  if (cachedToken && cachedToken.secret === secret && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = Deno.env.get(secret);
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(`GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and ${secret} must be set.`);
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body.error === "invalid_grant") {
      throw new Error(`Google authorisation expired or was revoked. Redo the OAuth consent step and update ${secret}.`);
    }
    throw new Error(`Google token request failed: ${res.status} ${JSON.stringify(body)}`);
  }

  cachedToken = { secret, value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

export async function sendEmail(email: Email, from: string): Promise<void> {
  // A dedicated sender account has its own token; otherwise the Drive account's token must include gmail.send.
  const secret = Deno.env.get("GMAIL_REFRESH_TOKEN") ? "GMAIL_REFRESH_TOKEN" : "GOOGLE_OAUTH_REFRESH_TOKEN";
  const raw = base64(encoder.encode(buildMessage(email, from))).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(secret)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
}
