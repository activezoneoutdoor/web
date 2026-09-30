// Members admin (staff only): register members, set their status, record yearly payments and set fees.
// The database only lets @activezoneoutdoor.cy accounts do any of this; the checks here just pick the right view.
import * as api from "./api.js";
import {
  badge,
  busy,
  formatDate,
  h,
  METHODS,
  money,
  STATUS,
  thisYear,
  today,
  toast,
  YEAR_STATUS,
  yearStatus,
} from "./ui.js";

const views = document.querySelectorAll("[data-view]");
const show = (name) => views.forEach((v) => (v.hidden = v.dataset.view !== name));

const state = { members: [], currentYear: new Map(), fees: [], editing: null, loadedFor: undefined };

const memberDialog = document.getElementById("member-dialog");
const memberForm = document.getElementById("member-form");
const paymentForm = document.getElementById("payment-form");
const feesDialog = document.getElementById("fees-dialog");
const feeForm = document.getElementById("fee-form");
const search = document.getElementById("search");
const statusFilter = document.getElementById("status-filter");

async function load(user) {
  state.loadedFor = user?.id ?? null;
  if (!user) return show("signed-out");
  if (!api.isStaffEmail(user.email)) return show("not-staff");
  show("loading");
  await refresh();
  show("staff");
}

async function refresh() {
  const [members, summary, fees] = await Promise.all([
    api.listMembers(),
    api.yearSummary(thisYear()),
    api.listFees(),
  ]);
  state.members = members;
  state.currentYear = new Map(summary.map((r) => [r.member_id, r]));
  state.fees = fees;
  renderStats();
  renderTable();
}

const thisYearStatus = (m) => {
  const row = state.currentYear.get(m.id);
  if (row) return yearStatus(row.fee, row.paid);
  return m.status === "registered" ? "due" : null;
};

function renderStats() {
  const registered = state.members.filter((m) => m.status === "registered");
  const paid = registered.filter((m) => thisYearStatus(m) === "paid").length;
  const stats = [
    ["Registered members", registered.length],
    ["Online accounts", state.members.filter((m) => m.status === "online").length],
    [`Paid ${thisYear()}`, paid],
    [`Not paid ${thisYear()}`, registered.length - paid],
  ];
  document.getElementById("stats").replaceChildren(
    ...stats.map(([label, value]) => h("li", null, h("strong", null, String(value)), h("span", null, label))),
  );
  document.getElementById("year-col").textContent = String(thisYear());
}

function renderTable() {
  const q = search.value.trim().toLowerCase();
  const status = statusFilter.value;
  const rows = state.members.filter((m) =>
    (!status || m.status === status) &&
    (!q || [m.full_name, m.email, m.phone, m.member_number].some((v) => v?.toLowerCase().includes(q)))
  );

  const tbody = document.querySelector("#members-table tbody");
  tbody.replaceChildren(
    ...rows.map((m) => {
      const ys = thisYearStatus(m);
      return h(
        "tr",
        null,
        h(
          "td",
          null,
          h("strong", null, m.full_name || "(no name)"),
          h("div", { class: "muted small" }, [m.email, m.phone].filter(Boolean).join(" · ") || "—"),
        ),
        h("td", null, badge(STATUS[m.status])),
        h("td", null, m.member_number ?? "—"),
        h("td", null, ys ? badge(YEAR_STATUS[ys]) : "—"),
        h(
          "td",
          { class: "cell-actions" },
          h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: () => openMember(m) }, "Open"),
        ),
      );
    }),
  );
  if (!rows.length) {
    tbody.append(h("tr", null, h("td", { colspan: "5", class: "empty" }, "No members match.")));
  }
  document.getElementById("members-count").textContent =
    `Showing ${rows.length} of ${state.members.length} member${state.members.length === 1 ? "" : "s"}.`;
}

// ---------- Member dialog ----------

async function openMember(m) {
  state.editing = m ?? null;
  const f = memberForm.elements;
  document.getElementById("member-dialog-title").textContent = m ? m.full_name || "Member" : "Add member";
  f.full_name.value = m?.full_name ?? "";
  f.email.value = m?.email ?? "";
  f.phone.value = m?.phone ?? "";
  f.status.value = m?.status ?? "registered";
  f.member_number.value = m?.member_number ?? "";
  f.registered_on.value = m?.registered_on ?? (m ? "" : today());
  f.email.readOnly = Boolean(m?.user_id);
  document.getElementById("m-email-help").textContent = m?.user_id
    ? "Linked to their Google account."
    : "They sign in with the Google account for this email.";
  memberForm.querySelector("[data-action=delete-member]").hidden = !m;
  memberForm.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));

  const paymentsSection = document.getElementById("member-payments");
  paymentsSection.hidden = !m;
  if (m) {
    paymentForm.reset();
    suggestedAmount = "";
    paymentForm.elements.year.value = String(thisYear());
    paymentForm.elements.paid_on.value = today();
    suggestAmount();
    await renderMemberPayments();
  }
  if (!memberDialog.open) memberDialog.showModal();
}

async function renderMemberPayments() {
  const id = state.editing.id;
  const [years, payments] = await Promise.all([api.membershipYears(id), api.payments(id)]);

  document.getElementById("member-years").replaceChildren(
    years.length
      ? h(
        "ul",
        { class: "year-chips" },
        years.map((y) =>
          h(
            "li",
            null,
            h("strong", null, String(y.year)),
            badge(YEAR_STATUS[yearStatus(y.fee, y.paid)]),
            h("span", { class: "muted small" }, `${money(y.paid)} of ${money(y.fee)}`),
          )
        ),
      )
      : h("p", { class: "muted small" }, "No membership years yet. Set a registration date to start tracking fees."),
  );

  document.getElementById("member-payment-list").replaceChildren(
    payments.length
      ? h(
        "ul",
        { class: "payment-list" },
        payments.map((p) =>
          h(
            "li",
            null,
            h("span", null, h("strong", null, money(p.amount)), ` for ${p.year} · ${formatDate(p.paid_on)} · ${METHODS[p.method] ?? p.method}`),
            p.reference ? h("span", { class: "muted" }, ` · ${p.reference}`) : null,
            h("button", {
              class: "btn-link danger",
              type: "button",
              "aria-label": `Delete payment of ${money(p.amount)} for ${p.year}`,
              onclick: (e) => removePayment(e.currentTarget, p),
            }, "Delete"),
          )
        ),
      )
      : h("p", { class: "muted small" }, "No payments recorded."),
  );
}

// Pre-fills the amount with the year's fee, but never overwrites an amount staff typed themselves.
let suggestedAmount = "";
function suggestAmount() {
  const amount = paymentForm.elements.amount;
  if (amount.value !== "" && amount.value !== suggestedAmount) return;
  const fee = state.fees.find((f) => f.year === Number(paymentForm.elements.year.value));
  suggestedAmount = fee ? String(fee.amount) : "";
  amount.value = suggestedAmount;
}
paymentForm.elements.year.addEventListener("input", suggestAmount);

document.querySelector("[data-action=add-member]").addEventListener("click", () => openMember(null));

memberForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = memberForm.elements;
  const email = f.email.value.trim().toLowerCase();
  const invalid = [];
  if (!f.full_name.value.trim()) invalid.push(f.full_name);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid.push(f.email);
  memberForm.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  if (invalid.length) {
    invalid.forEach((el) => el.setAttribute("aria-invalid", "true"));
    invalid[0].focus();
    return toast("Please enter a name and a valid email (or leave email empty).", "error");
  }
  if (api.isStaffEmail(email)) {
    return toast("Staff email addresses can't be members.", "error");
  }

  busy(memberForm.querySelector("button[type=submit]"), async () => {
    const saved = await api.saveMember({
      id: state.editing?.id,
      full_name: f.full_name.value.trim(),
      ...(f.email.readOnly ? {} : { email: email || null }),
      phone: f.phone.value.trim() || null,
      status: f.status.value,
      member_number: f.member_number.value.trim() || null,
      registered_on: f.registered_on.value || null,
    });
    toast(state.editing ? "Member saved." : "Member added.");
    await refresh();
    await openMember(saved);
  });
});

memberForm.querySelector("[data-action=delete-member]").addEventListener("click", (e) => {
  const m = state.editing;
  const warning = m.user_id
    ? `Delete ${m.full_name || m.email}? Their payment records are deleted too. If they sign in again, they get a new online account.`
    : `Delete ${m.full_name || m.email} and their payment records?`;
  if (!confirm(warning)) return;
  busy(e.currentTarget, async () => {
    await api.deleteMember(m.id);
    memberDialog.close();
    toast("Member deleted.");
    await refresh();
  });
});

paymentForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = paymentForm.elements;
  const year = Number(f.year.value);
  const amount = Number(f.amount.value);
  if (!Number.isInteger(year) || year < 2019 || year > 2100 || !(amount > 0) || !f.paid_on.value) {
    return toast("Enter a year, an amount above 0 and the payment date.", "error");
  }
  busy(paymentForm.querySelector("button[type=submit]"), async () => {
    await api.addPayment({
      member_id: state.editing.id,
      year,
      amount,
      paid_on: f.paid_on.value,
      method: f.method.value,
      reference: f.reference.value.trim() || null,
    });
    toast(`Payment of ${money(amount)} recorded.`);
    f.reference.value = "";
    f.amount.value = "";
    suggestedAmount = "";
    suggestAmount();
    await Promise.all([renderMemberPayments(), refresh()]);
  });
});

function removePayment(button, p) {
  if (!confirm(`Delete the ${money(p.amount)} payment for ${p.year}?`)) return;
  busy(button, async () => {
    await api.deletePayment(p.id);
    toast("Payment deleted.");
    await Promise.all([renderMemberPayments(), refresh()]);
  });
}

// ---------- Fees dialog ----------

function renderFees() {
  document.getElementById("fee-list").replaceChildren(
    state.fees.length
      ? h(
        "ul",
        { class: "payment-list" },
        state.fees.map((fee) =>
          h(
            "li",
            null,
            h("span", null, h("strong", null, String(fee.year)), ` · ${money(fee.amount)}`),
            h("button", {
              class: "btn-link danger",
              type: "button",
              "aria-label": `Delete the ${fee.year} fee`,
              onclick: (e) => {
                if (!confirm(`Delete the ${fee.year} fee?`)) return;
                busy(e.currentTarget, async () => {
                  await api.deleteFee(fee.year);
                  await refresh();
                  renderFees();
                });
              },
            }, "Delete"),
          )
        ),
      )
      : h("p", { class: "muted small" }, "No fees set yet."),
  );
}

document.querySelector("[data-action=fees]").addEventListener("click", () => {
  feeForm.reset();
  feeForm.elements.year.value = String(thisYear());
  const current = state.fees.find((f) => f.year === thisYear());
  if (current) feeForm.elements.amount.value = String(current.amount);
  renderFees();
  feesDialog.showModal();
});

feeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const year = Number(feeForm.elements.year.value);
  const amount = Number(feeForm.elements.amount.value);
  if (!Number.isInteger(year) || year < 2019 || year > 2100 || feeForm.elements.amount.value === "" || amount < 0) {
    return toast("Enter a year and a fee of 0 or more.", "error");
  }
  busy(feeForm.querySelector("button[type=submit]"), async () => {
    await api.saveFee(year, amount);
    toast(`${year} fee set to ${money(amount)}.`);
    await refresh();
    renderFees();
  });
});

// ---------- Wiring ----------

search.addEventListener("input", renderTable);
statusFilter.addEventListener("change", renderTable);

document.querySelectorAll("[data-action=sign-in]").forEach((b) =>
  b.addEventListener("click", () => busy(b, api.signInWithGoogle))
);
document.querySelectorAll("[data-action=sign-out]").forEach((b) =>
  b.addEventListener("click", () =>
    busy(b, async () => {
      await api.signOut();
      state.loadedFor = null;
      show("signed-out");
    })
  )
);

function fail(err) {
  show("signed-out");
  toast(err instanceof Error ? err.message : String(err), "error");
}

async function start() {
  if (!api.configured) return show("not-configured");
  try {
    api.onSignInChange((user) => {
      if ((user?.id ?? null) !== state.loadedFor) load(user).catch(fail);
    });
    await load(await api.currentUser());
  } catch (err) {
    fail(err);
  }
}

start();
