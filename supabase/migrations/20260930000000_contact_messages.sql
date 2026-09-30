-- Every contact-form submission is stored here, so nothing is lost even if
-- the notification email fails. View them in Supabase: Table Editor.
create table public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 1 and 100),
  email       text not null check (char_length(email) between 3 and 254),
  topic       text not null check (char_length(topic) <= 60),
  message     text not null check (char_length(message) between 1 and 5000),
  ip_hash     text,
  user_agent  text,
  email_sent  boolean not null default false,
  email_error text
);

-- Used by the per-IP rate limit.
create index contact_messages_ip_hash_created_at_idx
  on public.contact_messages (ip_hash, created_at desc);

-- Only the edge function (service role) may read or write. RLS on with no
-- policies means the public anon key gets no access at all.
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;
