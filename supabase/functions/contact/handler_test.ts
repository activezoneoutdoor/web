import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { contactFrom, createHandler, type Deps, renderEmail, type StoredMessage } from "./handler.ts";

const ORIGIN = "https://www.activezoneoutdoor.cy";
const valid = {
  name: "Maria",
  email: "maria@example.com",
  topic: "Volunteering",
  message: "Hi!",
  website: "",
};

function setup(overrides: Partial<Deps> = {}) {
  const saved: StoredMessage[] = [];
  const emails: unknown[] = [];
  const marks: [string, boolean, string | null][] = [];
  const deps: Deps = {
    allowedOrigins: [ORIGIN],
    countRecent: () => Promise.resolve(0),
    save: (m) => {
      saved.push(m);
      return Promise.resolve("id-1");
    },
    markEmail: (id, sent, err) => {
      marks.push([id, sent, err]);
      return Promise.resolve();
    },
    sendEmail: (m) => {
      emails.push(m);
      return Promise.resolve();
    },
    log: () => {},
    ...overrides,
  };
  return { handler: createHandler(deps), saved, emails, marks };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/contact", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "x-forwarded-for": "1.2.3.4, 10.0.0.1",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

Deno.test("valid message is saved, emailed and marked sent", async () => {
  const { handler, saved, emails, marks } = setup();
  const res = await handler(post(valid));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGIN);
  assertEquals(saved.length, 1);
  assertEquals(saved[0].name, "Maria");
  assertEquals(saved[0].ip_hash?.length, 64);
  assertEquals(emails.length, 1);
  assertEquals(marks, [["id-1", true, null]]);
});

Deno.test("CORS preflight is answered", async () => {
  const { handler } = setup();
  const res = await handler(
    new Request("http://localhost/contact", {
      method: "OPTIONS",
      headers: { origin: ORIGIN },
    }),
  );
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGIN);
});

Deno.test("unknown origin is rejected", async () => {
  const { handler, saved } = setup();
  const res = await handler(post(valid, { origin: "https://evil.example" }));
  assertEquals(res.status, 403);
  assertEquals(saved.length, 0);
});

Deno.test("any origin allowed when list is empty", async () => {
  const { handler } = setup({ allowedOrigins: [] });
  const res = await handler(post(valid, { origin: "http://localhost:8000" }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});

Deno.test("honeypot submissions get fake success and are dropped", async () => {
  const { handler, saved, emails } = setup();
  const res = await handler(post({ ...valid, website: "http://spam" }));
  assertEquals(res.status, 200);
  assertEquals(saved.length + emails.length, 0);
});

Deno.test("invalid input is rejected", async () => {
  const { handler } = setup();
  for (
    const body of [
      { ...valid, email: "nope" },
      { ...valid, name: "  " },
      { ...valid, message: "x".repeat(5001) },
      "not json",
      null,
    ]
  ) {
    const res = await handler(post(body));
    assert(
      [400, 422].includes(res.status),
      `expected 400/422 for ${JSON.stringify(body)}, got ${res.status}`,
    );
  }
});

Deno.test("unknown topic falls back to 'Something else'", async () => {
  const { handler, saved } = setup();
  await handler(post({ ...valid, topic: "<script>" }));
  assertEquals(saved[0].topic, "Something else");
});

Deno.test("rate limit returns 429", async () => {
  const { handler, saved } = setup({ countRecent: () => Promise.resolve(5) });
  const res = await handler(post(valid));
  assertEquals(res.status, 429);
  assertEquals(saved.length, 0);
});

Deno.test("email failure still succeeds when message was saved", async () => {
  const { handler, marks } = setup({
    sendEmail: () => Promise.reject(new Error("gmail down")),
  });
  const res = await handler(post(valid));
  assertEquals(res.status, 200);
  assertEquals(marks, [["id-1", false, "gmail down"]]);
});

Deno.test("save failure still succeeds when email was sent", async () => {
  const { handler, emails } = setup({
    save: () => Promise.reject(new Error("db down")),
  });
  const res = await handler(post(valid));
  assertEquals(res.status, 200);
  assertEquals(emails.length, 1);
});

Deno.test("both failing returns 500", async () => {
  const { handler } = setup({
    save: () => Promise.reject(new Error("db down")),
    sendEmail: () => Promise.reject(new Error("gmail down")),
  });
  assertEquals((await handler(post(valid))).status, 500);
});

Deno.test("email HTML escapes visitor input", () => {
  const { html, subject } = renderEmail({
    name: "<b>x</b>",
    email: "a@b.co",
    topic: "Volunteering",
    message: "<img onerror=1>",
  });
  assertStringIncludes(html, "&lt;b&gt;x&lt;/b&gt;");
  assertStringIncludes(html, "&lt;img onerror=1&gt;");
  assert(!html.includes("<img"));
  assertStringIncludes(subject, "Volunteering");
});

Deno.test("sender reuses EMAIL_FROM's address unless overridden", () => {
  assertEquals(
    contactFrom("", "AZO Moments <moments@activezoneoutdoor.cy>"),
    "Active Zone Outdoor website <moments@activezoneoutdoor.cy>",
  );
  assertEquals(
    contactFrom("", "moments@activezoneoutdoor.cy"),
    "Active Zone Outdoor website <moments@activezoneoutdoor.cy>",
  );
  assertEquals(contactFrom("Web <web@activezoneoutdoor.cy>", "x"), "Web <web@activezoneoutdoor.cy>");
  assertThrows(() => contactFrom("", ""));
});
