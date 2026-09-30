import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { buildMessage, sendEmail } from "./gmail.ts";

const FROM = "Active Zone Outdoor website <moments@activezoneoutdoor.cy>";

function decodePart(message: string, type: string): string {
  const match = message.match(
    new RegExp(
      `Content-Type: ${type}; charset=UTF-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+)`,
    ),
  );
  const bytes = Uint8Array.from(atob(match![1].replace(/\r\n/g, "")), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

Deno.test("messages carry UTF-8 subjects and bodies", () => {
  const message = buildMessage({
    to: "team@activezoneoutdoor.cy",
    subject: "Website enquiry: Volunteering (from Ελένη)",
    text: "Γεια σου!",
    html: "<p>Γεια σου!</p>",
    replyTo: "eleni@example.com",
  }, FROM);
  assertStringIncludes(message, `From: ${FROM}\r\n`);
  assertStringIncludes(message, "To: team@activezoneoutdoor.cy\r\n");
  assertStringIncludes(message, "Reply-To: eleni@example.com\r\n");
  const subject = message.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)![1];
  assertEquals(
    new TextDecoder().decode(Uint8Array.from(atob(subject), (c) => c.charCodeAt(0))),
    "Website enquiry: Volunteering (from Ελένη)",
  );
  assertEquals(decodePart(message, "text/plain"), "Γεια σου!");
  assertEquals(decodePart(message, "text/html"), "<p>Γεια σου!</p>");
});

Deno.test("visitor input cannot inject extra headers", () => {
  const message = buildMessage({
    to: "team@activezoneoutdoor.cy",
    subject: "Hi\r\nBcc: victim@example.com",
    text: "x",
    html: "x",
    replyTo: "a@b.co\r\nBcc: victim@example.com",
  }, FROM);
  const headers = message.split("\r\n\r\n")[0];
  assert(!/^Bcc:/m.test(headers), headers);
});

Deno.test("sends through Gmail with the sender account's token", async () => {
  Deno.env.set("GOOGLE_OAUTH_CLIENT_ID", "client-id");
  Deno.env.set("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret");
  Deno.env.set("GMAIL_REFRESH_TOKEN", "gmail-refresh");

  const realFetch = globalThis.fetch;
  const calls: { url: string; body: string; auth: string | null }[] = [];
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body), auth: new Headers(init?.headers).get("authorization") });
    return Promise.resolve(
      url.includes("oauth2")
        ? Response.json({ access_token: "access-1", expires_in: 3600 })
        : Response.json({ id: "msg-1" }),
    );
  };
  try {
    await sendEmail({ to: "team@activezoneoutdoor.cy", subject: "Hi", text: "t", html: "h" }, FROM);
  } finally {
    globalThis.fetch = realFetch;
  }

  assertEquals(calls.length, 2);
  assertStringIncludes(calls[0].body, "refresh_token=gmail-refresh");
  assertEquals(calls[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  assertEquals(calls[1].auth, "Bearer access-1");
  const raw = JSON.parse(calls[1].body).raw.replace(/-/g, "+").replace(/_/g, "/");
  assertStringIncludes(atob(raw), `From: ${FROM}`);
});
