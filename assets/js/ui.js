// Small DOM and formatting helpers shared by the members and admin pages.

/**
 * Creates an element. Children may be strings (added as text, never parsed as HTML), nodes, or null.
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...any} children
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key in el && typeof value !== "string") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const euro = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
export const money = (value) => (value == null ? "—" : euro.format(Number(value)));

export const formatDate = (iso) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "—";

export const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
export const thisYear = () => new Date().getFullYear();

export const STATUS = {
  online: { label: "Online account", tone: "neutral" },
  registered: { label: "Registered member", tone: "good" },
  former: { label: "Former member", tone: "muted" },
};

export const METHODS = { cash: "Cash", bank_transfer: "Bank transfer", card: "Card", other: "Other" };

/** Payment status of one year: paid, partial, due, or unset (no fee set and nothing paid). */
export function yearStatus(fee, paid) {
  const f = fee == null ? null : Number(fee);
  const p = Number(paid ?? 0);
  if (f == null) return p > 0 ? "paid" : "unset";
  if (p >= f) return "paid";
  return p > 0 ? "partial" : "due";
}

export const YEAR_STATUS = {
  paid: { label: "Paid", tone: "good" },
  partial: { label: "Partly paid", tone: "warn" },
  due: { label: "Due", tone: "bad" },
  unset: { label: "Fee not set", tone: "muted" },
};

export const badge = ({ label, tone }) => h("span", { class: `badge badge-${tone}` }, label);

/** Shows a short message at the bottom of the screen. */
export function toast(message, kind = "ok") {
  const el = h("div", { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : "status" }, message);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("is-shown"));
  setTimeout(() => {
    el.classList.remove("is-shown");
    setTimeout(() => el.remove(), 300);
  }, kind === "error" ? 6000 : 3000);
}

/** Runs an async action with the button disabled; shows errors as a toast. */
export async function busy(button, action) {
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Please wait…";
  }
  try {
    return await action();
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
  }
}
