// Supabase Edge Function: receives the website contact form, stores the
// message in `contact_messages` and emails it to the organisation via Resend.
//
// Secrets (supabase secrets set NAME=value):
//   RESEND_API_KEY      API key from https://resend.com
//   CONTACT_TO_EMAIL    inbox that receives messages (comma-separate several)
//   CONTACT_FROM_EMAIL  sender on a domain verified in Resend,
//                       e.g. "Active Zone Outdoor <website@activezoneoutdoor.cy>"
//   ALLOWED_ORIGINS     comma-separated site origins,
//                       e.g. "https://www.activezoneoutdoor.cy,https://activezoneoutdoor.cy"
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";
import { createHandler, renderEmail } from "./handler.ts";

const env = (name: string) => Deno.env.get(name)?.trim() ?? "";
const list = (value: string) =>
  value.split(",").map((s) => s.trim()).filter(Boolean);

const supabase = createClient(
  env("SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: { persistSession: false },
  },
);

const handler = createHandler({
  allowedOrigins: list(env("ALLOWED_ORIGINS")),

  async countRecent(ipHash, since) {
    const { count, error } = await supabase
      .from("contact_messages")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since.toISOString());
    if (error) throw error;
    return count ?? 0;
  },

  async save(msg) {
    const { data, error } = await supabase.from("contact_messages").insert(msg)
      .select("id").single();
    if (error) throw error;
    return data.id as string;
  },

  async markEmail(id, sent, emailError) {
    const { error } = await supabase
      .from("contact_messages")
      .update({ email_sent: sent, email_error: emailError })
      .eq("id", id);
    if (error) throw error;
  },

  async sendEmail(msg) {
    const apiKey = env("RESEND_API_KEY");
    const to = list(env("CONTACT_TO_EMAIL"));
    if (!apiKey || to.length === 0) {
      throw new Error("RESEND_API_KEY or CONTACT_TO_EMAIL is not set");
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env("CONTACT_FROM_EMAIL") ||
          "Active Zone Outdoor <onboarding@resend.dev>",
        to,
        reply_to: msg.email,
        ...renderEmail(msg),
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
  },
});

Deno.serve(handler);
