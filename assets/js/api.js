// All Supabase access for the members area. Row level security in the database decides what each user may
// read or change (supabase/migrations/20261001000000_members.sql); nothing here is trusted for access control.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";
import { STAFF_DOMAIN, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/** @param {{ data: any, error: any }} result */
function unwrap({ data, error }) {
  if (error) throw new Error(error.message || "Something went wrong.");
  return data;
}

export const isStaffEmail = (email) => (email ?? "").trim().toLowerCase().endsWith(`@${STAFF_DOMAIN}`);

// ---------- Auth ----------

export async function currentUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Could not check your sign-in. Please try again.");
  return data.session?.user ?? null;
}

export function onSignInChange(callback) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") callback(session?.user ?? null);
  });
}

export async function signInWithGoogle() {
  unwrap(
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
        queryParams: { prompt: "select_account" },
      },
    }),
  );
}

/** Signs out of this browser. If the request fails or hangs, the stored session is cleared directly. */
export async function signOut() {
  const timeout = new Promise((resolve) =>
    window.setTimeout(() => resolve({ error: new Error("Sign-out timed out") }), 4000)
  );
  const result = await Promise.race([supabase.auth.signOut({ scope: "local" }), timeout]).catch((error) => ({
    error,
  }));
  if (result.error) {
    try {
      for (const key of Object.keys(localStorage)) if (/^sb-.+-auth-token/.test(key)) localStorage.removeItem(key);
    } catch { /* storage unavailable */ }
  }
}

// ---------- Member ----------

/** The signed-in member's row, created on first sign-in. Null for staff accounts. */
export async function claimMembership() {
  const row = unwrap(await supabase.rpc("claim_membership"));
  return row?.id ? row : null;
}

export async function updateProfile(id, { full_name, phone }) {
  return unwrap(
    await supabase.from("members").update({ full_name, phone }).eq("id", id).select().single(),
  );
}

/** Yearly summary (fee and amount paid) for one member, newest year first. */
export async function membershipYears(memberId) {
  return unwrap(
    await supabase.from("membership_years").select("year, fee, paid").eq("member_id", memberId)
      .order("year", { ascending: false }),
  );
}

export async function payments(memberId) {
  return unwrap(
    await supabase.from("membership_payments").select("id, year, amount, paid_on, method, reference")
      .eq("member_id", memberId).order("paid_on", { ascending: false }).order("created_at", { ascending: false }),
  );
}

// ---------- Staff ----------

export async function listMembers() {
  return unwrap(await supabase.from("members").select("*").order("full_name").order("email"));
}

/** Inserts a new member (no id) or updates an existing one. */
export async function saveMember({ id, ...fields }) {
  const query = id ? supabase.from("members").update(fields).eq("id", id) : supabase.from("members").insert(fields);
  return unwrap(await query.select().single());
}

export async function deleteMember(id) {
  unwrap(await supabase.from("members").delete().eq("id", id));
}

/** Every member's fee and amount paid for one year. */
export async function yearSummary(year) {
  return unwrap(await supabase.from("membership_years").select("member_id, fee, paid").eq("year", year));
}

export async function addPayment(payment) {
  return unwrap(await supabase.from("membership_payments").insert(payment).select().single());
}

export async function deletePayment(id) {
  unwrap(await supabase.from("membership_payments").delete().eq("id", id));
}

export async function listFees() {
  return unwrap(await supabase.from("membership_fees").select("year, amount").order("year", { ascending: false }));
}

export async function saveFee(year, amount) {
  unwrap(await supabase.from("membership_fees").upsert({ year, amount }));
}

export async function deleteFee(year) {
  unwrap(await supabase.from("membership_fees").delete().eq("year", year));
}
