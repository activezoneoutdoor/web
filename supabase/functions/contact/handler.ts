// Contact-form request handling, kept free of Supabase/Gmail specifics so it
// can be unit tested. index.ts wires in the real dependencies.

export const TOPICS = [
  "Joining an activity",
  "Volunteering",
  "Erasmus+ youth exchange",
  "Partnership",
  "Something else",
] as const;

export const RATE_LIMIT = { max: 5, windowMinutes: 10 };

export interface ContactMessage {
  name: string;
  email: string;
  topic: string;
  message: string;
}

export interface StoredMessage extends ContactMessage {
  ip_hash: string | null;
  user_agent: string | null;
}

export interface Deps {
  /** Origins allowed to call the function. Empty list allows any origin. */
  allowedOrigins: string[];
  /** Number of messages from this IP hash since `since`. */
  countRecent(ipHash: string, since: Date): Promise<number>;
  /** Saves the message and returns its id. */
  save(msg: StoredMessage): Promise<string>;
  /** Records the outcome of the notification email for a saved message. */
  markEmail(id: string, sent: boolean, error: string | null): Promise<void>;
  /** Sends the notification email to the organisation. */
  sendEmail(msg: ContactMessage): Promise<void>;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validate(
  body: unknown,
): { ok: true; msg: ContactMessage } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request." };
  }
  const b = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const msg = {
    name: str(b.name),
    email: str(b.email),
    topic: str(b.topic),
    message: str(b.message),
  };

  if (!msg.name || msg.name.length > 100) {
    return { ok: false, error: "Please enter your name." };
  }
  if (msg.email.length > 254 || !EMAIL_RE.test(msg.email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (!(TOPICS as readonly string[]).includes(msg.topic)) {
    msg.topic = "Something else";
  }
  if (!msg.message || msg.message.length > 5000) {
    return {
      ok: false,
      error: "Please enter a message (up to 5000 characters).",
    };
  }
  return { ok: true, msg };
}

export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(ip),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function corsHeaders(
  origin: string | null,
  allowed: string[],
): Record<string, string> {
  const allowOrigin = allowed.length === 0 ? "*" : origin && allowed.includes(origin) ? origin : "";
  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Vary": "Origin",
  };
}

export function createHandler(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? console.error;

  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    const cors = corsHeaders(origin, deps.allowedOrigins);
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== "POST") {
      return json(405, { ok: false, error: "Method not allowed." });
    }
    if (
      deps.allowedOrigins.length > 0 &&
      (!origin || !deps.allowedOrigins.includes(origin))
    ) {
      return json(403, { ok: false, error: "Origin not allowed." });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(400, { ok: false, error: "Invalid request." });
    }

    // Honeypot: real visitors never see this field. Pretend success for bots.
    const website = (body as Record<string, unknown> | null)?.website;
    if (typeof website === "string" && website.trim() !== "") {
      return json(200, { ok: true });
    }

    const result = validate(body);
    if (!result.ok) return json(422, { ok: false, error: result.error });
    const msg = result.msg;

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
    const ipHash = ip ? await hashIp(ip) : null;

    if (ipHash) {
      try {
        const since = new Date(
          now().getTime() - RATE_LIMIT.windowMinutes * 60_000,
        );
        if ((await deps.countRecent(ipHash, since)) >= RATE_LIMIT.max) {
          return json(429, {
            ok: false,
            error: "Too many messages. Please try again in a few minutes.",
          });
        }
      } catch (err) {
        log("rate-limit check failed", err); // don't block real visitors on a DB hiccup
      }
    }

    // Save first so the message survives an email failure, then notify.
    // The visitor sees success if at least one of the two worked.
    let id: string | null = null;
    try {
      id = await deps.save({
        ...msg,
        ip_hash: ipHash,
        user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      });
    } catch (err) {
      log("saving message failed", err);
    }

    let emailError: string | null = null;
    try {
      await deps.sendEmail(msg);
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
      log("sending email failed", err);
    }

    if (id) {
      try {
        await deps.markEmail(id, emailError === null, emailError);
      } catch (err) {
        log("recording email status failed", err);
      }
    }

    if (!id && emailError !== null) {
      return json(500, {
        ok: false,
        error: "Sorry, your message could not be sent. Please call us instead.",
      });
    }
    return json(200, { ok: true });
  };
}

/**
 * The From header. Gmail only sends as the authorised account (or its aliases), so by default this reuses
 * EMAIL_FROM's address with a website-specific display name.
 */
export function contactFrom(override: string, emailFrom: string): string {
  if (override) return override;
  const address = emailFrom.match(/<([^>]+)>/)?.[1] ?? emailFrom;
  if (!address) throw new Error("EMAIL_FROM or CONTACT_EMAIL_FROM must be set");
  return `Active Zone Outdoor website <${address}>`;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** Builds the notification email sent to the organisation. */
export function renderEmail(msg: ContactMessage) {
  return {
    subject: `Website enquiry: ${msg.topic} (from ${msg.name})`,
    text: `Name: ${msg.name}\nEmail: ${msg.email}\nTopic: ${msg.topic}\n\n${msg.message}\n`,
    html: `<p><strong>Name:</strong> ${escapeHtml(msg.name)}<br>
<strong>Email:</strong> <a href="mailto:${escapeHtml(msg.email)}">${escapeHtml(msg.email)}</a><br>
<strong>Topic:</strong> ${escapeHtml(msg.topic)}</p>
<p style="white-space:pre-wrap">${escapeHtml(msg.message)}</p>
<p style="color:#888;font-size:12px">Sent from the contact form on activezoneoutdoor.cy. Reply to this email to answer ${
      escapeHtml(msg.name)
    } directly.</p>`,
  };
}
