// Public Supabase settings for the members area (the Moments project). Both values are public by design:
// the publishable/anon key only allows what the database's row level security permits.
// Find them in Supabase: Project Settings → API (or Connect).
export const SUPABASE_URL = "https://drqdwpyhdprggaazaeuo.supabase.co";
export const SUPABASE_ANON_KEY = ""; // TODO: paste the project's publishable (or legacy anon) key

// Google accounts on this domain are staff; every other Google account is a member.
export const STAFF_DOMAIN = "activezoneoutdoor.cy";
