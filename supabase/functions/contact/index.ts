// Supabase Edge Function: receives the website contact form, stores the message in `contact_messages` and
// emails it to the team through Gmail as the organisation's Google Workspace sender (same setup as Moments).
//
// Secrets (supabase secrets set NAME=value). Deployed to the Moments project, the Google ones already exist:
//   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET   OAuth client
//   GMAIL_REFRESH_TOKEN (or GOOGLE_OAUTH_REFRESH_TOKEN)  sender's token with the gmail.send scope
//   EMAIL_FROM              sender, e.g. "AZO Moments <moments@activezoneoutdoor.cy>"
// Contact-form specific:
//   CONTACT_TO_EMAIL        inbox(es) that receive messages, comma-separated
//   CONTACT_ALLOWED_ORIGINS website origins, e.g. "https://www.activezoneoutdoor.cy,https://activezoneoutdoor.cy"
//   CONTACT_EMAIL_FROM      optional sender override; by default EMAIL_FROM's address as "Active Zone Outdoor website"
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../_shared/gmail.ts";
import { contactFrom, createHandler, renderEmail } from "./handler.ts";

const env = (name: string) => Deno.env.get(name)?.trim() ?? "";
const list = (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean);

const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const handler = createHandler({
  allowedOrigins: list(env("CONTACT_ALLOWED_ORIGINS")),

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
    const { data, error } = await supabase.from("contact_messages").insert(msg).select("id").single();
    if (error) throw error;
    return data.id as string;
  },

  async markEmail(id, sent, emailError) {
    const { error } = await supabase
      .from("contact_messages")
      .update({ email_sent: sent, email_error: emailError?.slice(0, 1000) ?? null })
      .eq("id", id);
    if (error) throw error;
  },

  async sendEmail(msg) {
    const to = list(env("CONTACT_TO_EMAIL"));
    if (to.length === 0) throw new Error("CONTACT_TO_EMAIL is not set");
    const from = contactFrom(env("CONTACT_EMAIL_FROM"), env("EMAIL_FROM"));
    await sendEmail({ to: to.join(", "), replyTo: msg.email, ...renderEmail(msg) }, from);
  },
});

Deno.serve(handler);
