// Row level security tests for the members migration, on a real Postgres (PGlite) with Supabase's auth helpers and
// Moments' is_staff() recreated as they behave in production. Run: cd supabase/functions && deno task test
import { assert, assertEquals, assertRejects } from "@std/assert";
import { PGlite } from "npm:@electric-sql/pglite@0.5.8";

const MIGRATION = new URL(
  "../migrations/20261001000000_members.sql",
  import.meta.url,
);

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt()->>'sub', '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  -- From Moments: 20260928000000_events_albums.sql
  create function public.is_staff() returns boolean language sql stable set search_path = '' as $$
    select coalesce(lower(auth.jwt()->>'email') ~ '@activezoneoutdoor\\.cy$', false) $$;
`;

type User = { id: string; email: string; name?: string };
const maria: User = {
  id: "00000000-0000-0000-0000-00000000000a",
  email: "maria@gmail.com",
  name: "Maria K",
};
const nikos: User = {
  id: "00000000-0000-0000-0000-00000000000b",
  email: "Nikos@Example.com",
  name: "Nikos P",
};
const staff: User = {
  id: "00000000-0000-0000-0000-00000000000c",
  email: "info@activezoneoutdoor.cy",
};

async function setup() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(await Deno.readTextFile(MIGRATION));
  for (const u of [maria, nikos, staff]) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [
      u.id,
      u.email,
    ]);
  }

  /** Runs SQL as a signed-in user (or anon), like PostgREST does, in its own transaction. */
  async function as<T = Record<string, unknown>>(
    user: User | null,
    sql: string,
    params: unknown[] = [],
  ) {
    return await db.transaction(async (tx) => {
      const claims = user
        ? JSON.stringify({
          sub: user.id,
          email: user.email,
          user_metadata: { full_name: user.name },
        })
        : "";
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        claims,
      ]);
      await tx.exec(`set local role ${user ? "authenticated" : "anon"}`);
      return (await tx.query<T>(sql, params)).rows;
    });
  }
  return { db, as };
}

const year = new Date().getFullYear();

Deno.test("first sign-in creates an online member from the Google profile, and is idempotent", async () => {
  const { as } = await setup();
  const [first] = await as<
    { id: string; status: string; email: string; full_name: string }
  >(
    nikos,
    "select * from claim_membership()",
  );
  assertEquals(first.status, "online");
  assertEquals(first.email, "nikos@example.com");
  assertEquals(first.full_name, "Nikos P");
  const [again] = await as<{ id: string }>(
    nikos,
    "select * from claim_membership()",
  );
  assertEquals(again.id, first.id);
});

Deno.test("sign-in links a member staff registered beforehand with the same email", async () => {
  const { as } = await setup();
  await as(
    staff,
    `insert into members (email, full_name, status, member_number, registered_on)
                   values ('MARIA@gmail.com', 'Maria Kyriakou', 'registered', 'AZO-001', '2024-03-01')`,
  );
  const [row] = await as<
    {
      status: string;
      member_number: string;
      full_name: string;
      user_id: string;
    }
  >(
    maria,
    "select * from claim_membership()",
  );
  assertEquals(row.status, "registered");
  assertEquals(row.member_number, "AZO-001");
  assertEquals(row.full_name, "Maria Kyriakou"); // staff's name is kept
  assertEquals(row.user_id, maria.id);
});

Deno.test("staff accounts are not members", async () => {
  const { as } = await setup();
  const [row] = await as<{ id: string | null }>(
    staff,
    "select (claim_membership()).id",
  );
  assertEquals(row.id, null);
});

Deno.test("anonymous visitors can't read or claim anything", async () => {
  const { as } = await setup();
  await assertRejects(() => as(null, "select * from claim_membership()"));
  await assertRejects(() => as(null, "select * from members"));
  await assertRejects(() => as(null, "select * from membership_payments"));
});

Deno.test("members only see their own row and payments", async () => {
  const { as } = await setup();
  await as(maria, "select claim_membership()");
  const [n] = await as<{ id: string }>(
    nikos,
    "select (claim_membership()).id as id",
  );
  await as(
    staff,
    "insert into membership_payments (member_id, year, amount) values ($1, $2, 20)",
    [n.id, year],
  );

  assertEquals((await as(maria, "select * from members")).length, 1);
  assertEquals(
    (await as(maria, "select * from membership_payments")).length,
    0,
  );
  assertEquals(
    (await as(nikos, "select * from membership_payments")).length,
    1,
  );
  assertEquals((await as(staff, "select * from members")).length, 2);
});

Deno.test("members can edit name and phone but not membership details", async () => {
  const { as } = await setup();
  await as(maria, "select claim_membership()");
  const [row] = await as<{ full_name: string; phone: string }>(
    maria,
    "update members set full_name = ' Maria K. ', phone = '+357 99 000000' where user_id = auth.uid() returning *",
  );
  assertEquals(row.full_name, "Maria K.");
  assertEquals(row.phone, "+357 99 000000");

  for (
    const change of [
      "status = 'registered'",
      "member_number = 'X1'",
      "registered_on = '2020-01-01'",
      "email = 'other@gmail.com'",
      "user_id = null",
    ]
  ) {
    await assertRejects(
      () =>
        as(maria, `update members set ${change} where user_id = auth.uid()`),
      Error,
      "Only staff",
      change,
    );
  }
});

Deno.test("members can't touch other members, fees or payments", async () => {
  const { as } = await setup();
  await as(maria, "select claim_membership()");
  const [n] = await as<{ id: string }>(
    nikos,
    "select (claim_membership()).id as id",
  );

  assertEquals(
    (await as(
      maria,
      "update members set full_name = 'x' where id = $1 returning id",
      [n.id],
    )).length,
    0,
  );
  assertEquals(
    (await as(
      maria,
      "delete from members where user_id = auth.uid() returning id",
    )).length,
    0,
  );
  await assertRejects(() =>
    as(maria, "insert into members (email) values ('x@gmail.com')")
  );
  await assertRejects(() =>
    as(maria, "insert into membership_fees (year, amount) values (2026, 1)")
  );
  await assertRejects(() =>
    as(
      maria,
      "insert into membership_payments (member_id, year, amount) values ($1, 2026, 20)",
      [n.id],
    )
  );
});

Deno.test("yearly summary covers every year since registration with fee and amount paid", async () => {
  const { as } = await setup();
  await as(
    staff,
    `insert into members (email, status, registered_on) values ('maria@gmail.com', 'registered', $1)`,
    [
      `${year - 2}-05-01`,
    ],
  );
  const [m] = await as<{ id: string }>(
    maria,
    "select (claim_membership()).id as id",
  );
  await as(
    staff,
    "insert into membership_fees (year, amount) values ($1, 20), ($2, 25)",
    [year - 2, year],
  );
  await as(
    staff,
    "insert into membership_payments (member_id, year, amount, method) values ($1, $2, 20, 'cash'), ($1, $3, 10, 'bank_transfer'), ($1, $3, 5, 'cash')",
    [m.id, year - 2, year],
  );

  const rows = await as<{ year: number; fee: string | null; paid: string }>(
    maria,
    "select year, fee, paid from membership_years order by year",
  );
  assertEquals(rows, [
    { year: year - 2, fee: "20.00", paid: "20.00" },
    { year: year - 1, fee: null, paid: "0.00" },
    { year, fee: "25.00", paid: "15.00" },
  ]);
  assertEquals((await as(nikos, "select * from membership_years")).length, 0);
});

Deno.test("recorded_by is the staff member who recorded the payment", async () => {
  const { as } = await setup();
  const [m] = await as<{ id: string }>(
    maria,
    "select (claim_membership()).id as id",
  );
  const [p] = await as<{ recorded_by: string }>(
    staff,
    "insert into membership_payments (member_id, year, amount) values ($1, 2026, 20) returning recorded_by",
    [m.id],
  );
  assertEquals(p.recorded_by, staff.id);
  assert(true);
});
