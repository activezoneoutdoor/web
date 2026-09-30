// Members area: sign in with Google, see membership status, edit details, follow yearly payments.
import * as api from "./api.js";
import { badge, busy, formatDate, h, METHODS, money, STATUS, thisYear, toast, YEAR_STATUS, yearStatus } from "./ui.js";

const views = document.querySelectorAll("[data-view]");
const show = (name) => views.forEach((v) => (v.hidden = v.dataset.view !== name));

let member = null;
let loadedFor; // user id the page currently shows, to ignore repeated sign-in events

async function load(user) {
  loadedFor = user?.id ?? null;
  if (!user) return show("signed-out");
  if (api.isStaffEmail(user.email)) return show("staff");

  show("loading");
  member = await api.claimMembership();
  if (!member) return show("signed-out");
  const [years, payments] = await Promise.all([api.membershipYears(member.id), api.payments(member.id)]);
  renderMember(user, years, payments);
  show("member");
}

function renderMember(user, years, payments) {
  const firstName = (member.full_name || user.user_metadata?.full_name || "").split(" ")[0];
  document.getElementById("greeting").textContent = firstName ? `Hi, ${firstName}` : "Welcome";

  const form = document.getElementById("profile-form");
  form.elements.full_name.value = member.full_name ?? "";
  form.elements.phone.value = member.phone ?? "";
  document.getElementById("p-email").value = member.email ?? user.email ?? "";

  document.getElementById("membership-status").replaceChildren(statusBlock(years));
  document.getElementById("payments").replaceChildren(paymentsBlock(years, payments));
}

function statusBlock(years) {
  const status = STATUS[member.status] ?? STATUS.online;
  const current = years.find((y) => y.year === thisYear());
  const facts = [];
  if (member.member_number) facts.push(["Member no.", member.member_number]);
  if (member.registered_on) facts.push(["Member since", formatDate(member.registered_on)]);
  if (member.status === "registered") {
    facts.push([`${thisYear()} membership`, current ? badge(YEAR_STATUS[yearStatus(current.fee, current.paid)]) : "—"]);
  }

  const explain = {
    online:
      "You have an online account. To become a registered member of Active Zone Outdoor, contact us and we'll register you.",
    registered: "You're a registered member of Active Zone Outdoor. Thank you for being part of the team!",
    former: "You're no longer a registered member. Contact us any time to renew your membership.",
  }[member.status];

  return h(
    "div",
    { class: "status-block" },
    h("div", { class: `status-hero status-${member.status}` }, badge(status)),
    facts.length ? h("dl", { class: "facts" }, facts.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])) : null,
    h("p", { class: "muted" }, explain),
    member.status !== "registered"
      ? h("a", { class: "btn btn-outline btn-sm", href: "index.html#contact" }, "Contact us")
      : null,
  );
}

function paymentsBlock(years, payments) {
  if (!years.length && !payments.length) {
    return h(
      "p",
      { class: "empty" },
      member.status === "registered"
        ? "No membership years yet. Your yearly fees will appear here."
        : "Yearly membership payments appear here once you're a registered member.",
    );
  }

  const yearTable = h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "data-table" },
      h("thead", null, h("tr", null, h("th", null, "Year"), h("th", null, "Fee"), h("th", null, "Paid"), h("th", null, "Status"))),
      h(
        "tbody",
        null,
        years.map((y) =>
          h(
            "tr",
            null,
            h("td", null, String(y.year)),
            h("td", null, money(y.fee)),
            h("td", null, money(y.paid)),
            h("td", null, badge(YEAR_STATUS[yearStatus(y.fee, y.paid)])),
          )
        ),
      ),
    ),
  );

  const history = payments.length
    ? h(
      "details",
      { class: "history" },
      h("summary", null, `Payment history (${payments.length})`),
      h(
        "ul",
        { class: "payment-list" },
        payments.map((p) =>
          h(
            "li",
            null,
            h("strong", null, money(p.amount)),
            ` for ${p.year} · ${formatDate(p.paid_on)} · ${METHODS[p.method] ?? p.method}`,
            p.reference ? h("span", { class: "muted" }, ` · ${p.reference}`) : null,
          )
        ),
      ),
    )
    : null;

  return h("div", null, yearTable, history);
}

document.getElementById("profile-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const name = form.elements.full_name;
  if (!name.value.trim()) {
    name.setAttribute("aria-invalid", "true");
    name.focus();
    return toast("Please enter your name.", "error");
  }
  name.removeAttribute("aria-invalid");
  busy(form.querySelector("button[type=submit]"), async () => {
    member = await api.updateProfile(member.id, {
      full_name: name.value.trim(),
      phone: form.elements.phone.value.trim() || null,
    });
    toast("Your details were saved.");
  });
});

document.querySelectorAll("[data-action=sign-in]").forEach((b) =>
  b.addEventListener("click", () => busy(b, api.signInWithGoogle))
);
document.querySelectorAll("[data-action=sign-out]").forEach((b) =>
  b.addEventListener("click", () =>
    busy(b, async () => {
      await api.signOut();
      member = null;
      loadedFor = null;
      show("signed-out");
    })
  )
);

async function start() {
  if (!api.configured) return show("not-configured");
  try {
    api.onSignInChange((user) => {
      if ((user?.id ?? null) !== loadedFor) load(user).catch(fail);
    });
    await load(await api.currentUser());
  } catch (err) {
    fail(err);
  }
}

function fail(err) {
  show("signed-out");
  toast(err instanceof Error ? err.message : String(err), "error");
}

start();
