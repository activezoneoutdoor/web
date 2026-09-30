-- Members area: member profiles, membership status and yearly fees/payments.
--
-- Everyone signs in with Google. Accounts on @activezoneoutdoor.cy are staff (public.is_staff(), defined in the
-- Moments migrations of this shared Supabase project); every other account is a member.
--
-- Members see and edit their own profile (name, phone) and see their own payments. Staff see everything, register
-- members, set their status and record payments from admin.html.

create table public.members (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users (id) on delete set null,
  email         text check (email = lower(email) and char_length(email) <= 254),
  full_name     text not null default '' check (char_length(full_name) <= 120),
  phone         text check (char_length(phone) <= 30),
  -- online: signed up on the website. registered: registered member of the NGO. former: no longer a member.
  status        text not null default 'online' check (status in ('online', 'registered', 'former')),
  member_number text unique check (char_length(member_number) between 1 and 30),
  registered_on date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index members_email_key on public.members (email);

-- The yearly membership fee. Years without a row have no fee set yet.
create table public.membership_fees (
  year   integer primary key check (year between 2019 and 2100),
  amount numeric(10, 2) not null check (amount >= 0)
);

create table public.membership_payments (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members (id) on delete cascade,
  year        integer not null check (year between 2019 and 2100),
  amount      numeric(10, 2) not null check (amount > 0),
  paid_on     date not null default current_date,
  method      text not null default 'cash' check (method in ('cash', 'bank_transfer', 'card', 'other')),
  reference   text check (char_length(reference) <= 100),
  recorded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index membership_payments_member_year_idx on public.membership_payments (member_id, year);

-- One row per member and year: every year since registration for registered members, plus any year with a payment.
-- security_invoker applies the callers' row level security, so members only get their own rows.
create view public.membership_years with (security_invoker = true) as
with years as (
  select m.id as member_id, gs.year::integer as year
  from public.members m
  cross join lateral generate_series(
    extract(year from m.registered_on)::integer,
    extract(year from current_date)::integer
  ) as gs(year)
  where m.status = 'registered' and m.registered_on is not null
  union
  select p.member_id, p.year from public.membership_payments p
)
select
  y.member_id,
  y.year,
  f.amount as fee,
  coalesce(sum(p.amount), 0)::numeric(10, 2) as paid
from years y
left join public.membership_fees f on f.year = y.year
left join public.membership_payments p on p.member_id = y.member_id and p.year = y.year
group by y.member_id, y.year, f.amount;

-- Members may edit their name and phone only. Staff (and the privileged claim_membership function) may change
-- everything. Also keeps email lower-case and updated_at current.
create or replace function public.guard_member_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(nullif(trim(new.email), ''));
  new.full_name := trim(new.full_name);
  new.phone := nullif(trim(new.phone), '');
  new.member_number := nullif(trim(new.member_number), '');

  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if current_user in ('anon', 'authenticated') and not public.is_staff() and (
      new.id is distinct from old.id
      or new.user_id is distinct from old.user_id
      or new.email is distinct from old.email
      or new.status is distinct from old.status
      or new.member_number is distinct from old.member_number
      or new.registered_on is distinct from old.registered_on
      or new.created_at is distinct from old.created_at
    ) then
      raise exception 'Only staff can change membership details.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger members_guard
  before insert or update on public.members
  for each row execute function public.guard_member_changes();

-- Called by the website after every member sign-in. Returns the member's row, creating it on first sign-in.
-- If staff registered the member beforehand with the same email, that row is linked to the account instead.
-- Returns null for staff accounts, which are not members.
create or replace function public.claim_membership()
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  mail text := lower(nullif(trim(auth.jwt()->>'email'), ''));
  name text := coalesce(auth.jwt()->'user_metadata'->>'full_name', auth.jwt()->'user_metadata'->>'name', '');
  result public.members;
begin
  if uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;
  if public.is_staff() then
    return null;
  end if;

  select * into result from public.members where user_id = uid;
  if found then
    return result;
  end if;

  if mail is not null then
    update public.members
      set user_id = uid, full_name = case when full_name = '' then left(name, 120) else full_name end
      where email = mail and user_id is null
      returning * into result;
    if found then
      return result;
    end if;
  end if;

  insert into public.members (user_id, email, full_name)
    values (uid, mail, left(name, 120))
    on conflict do nothing
    returning * into result;
  if not found then
    select * into result from public.members where user_id = uid;
  end if;
  return result;
end;
$$;

revoke execute on function public.claim_membership() from public, anon;
grant execute on function public.claim_membership() to authenticated;
revoke execute on function public.guard_member_changes() from public, anon, authenticated;

alter table public.members enable row level security;
alter table public.membership_fees enable row level security;
alter table public.membership_payments enable row level security;

create policy "members read own, staff read all" on public.members
  for select to authenticated using (user_id = auth.uid() or public.is_staff());
create policy "members update own, staff update all" on public.members
  for update to authenticated
  using (user_id = auth.uid() or public.is_staff())
  with check (user_id = auth.uid() or public.is_staff());
create policy "staff add members" on public.members
  for insert to authenticated with check (public.is_staff());
create policy "staff delete members" on public.members
  for delete to authenticated using (public.is_staff());

create policy "signed-in users read fees" on public.membership_fees
  for select to authenticated using (true);
create policy "staff manage fees" on public.membership_fees
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "members read own payments, staff read all" on public.membership_payments
  for select to authenticated using (
    public.is_staff()
    or exists (select 1 from public.members m where m.id = member_id and m.user_id = auth.uid())
  );
create policy "staff add payments" on public.membership_payments
  for insert to authenticated with check (public.is_staff());
create policy "staff update payments" on public.membership_payments
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff delete payments" on public.membership_payments
  for delete to authenticated using (public.is_staff());

revoke all on public.members, public.membership_fees, public.membership_payments, public.membership_years from anon;
grant select, insert, update, delete on public.members, public.membership_fees, public.membership_payments
  to authenticated;
grant select on public.membership_years to authenticated;
