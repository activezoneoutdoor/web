// Active Zone Outdoor — site interactions (no dependencies)

// Contact form delivery. With CONTACT_ENDPOINT set, messages go to the
// Supabase Edge Function (supabase/functions/contact), which stores them and
// emails the team instantly. Left empty, the form falls back to opening the
// visitor's email app addressed to CONTACT_EMAIL.
// Example: "https://<project-ref>.supabase.co/functions/v1/contact"
const CONTACT_ENDPOINT = "https://drqdwpyhdprggaazaeuo.supabase.co/functions/v1/contact";
// TODO: confirm this is the organisation's real inbox before going live.
const CONTACT_EMAIL = "info@activezoneoutdoor.cy";

document.documentElement.classList.add("js");

const header = document.querySelector(".site-header");
const nav = document.getElementById("site-nav");
const toggle = document.querySelector(".nav-toggle");

// Solid header once the user scrolls past the hero top
const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 24);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// Mobile menu
function setMenu(open) {
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  nav.classList.toggle("is-open", open);
  header.classList.toggle("menu-open", open);
  document.body.style.overflow = open ? "hidden" : "";
}
toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
nav.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

// Highlight the nav link for the section in view
const links = [...nav.querySelectorAll('a[href^="#"]:not(.btn)')];
const sections = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
const spy = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    links.forEach((a) => a.classList.toggle("is-current", a.getAttribute("href") === `#${entry.target.id}`));
  });
}, { rootMargin: "-45% 0px -50% 0px" });
sections.forEach((s) => spy.observe(s));

// Reveal-on-scroll
const revealer = new IntersectionObserver((entries, obs) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      obs.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
document.querySelectorAll(".reveal").forEach((el) => revealer.observe(el));

// Activity filter
const chips = document.querySelectorAll(".chip");
const cards = document.querySelectorAll("#activity-grid .card");
chips.forEach((chip) => chip.addEventListener("click", () => {
  const filter = chip.dataset.filter;
  chips.forEach((c) => {
    const active = c === chip;
    c.classList.toggle("is-active", active);
    c.setAttribute("aria-pressed", String(active));
  });
  cards.forEach((card) => {
    card.hidden = filter !== "all" && card.dataset.cat !== filter;
    card.classList.add("is-visible");
  });
}));

// "Get involved" cards pre-select the contact topic
const topic = document.getElementById("topic");
document.querySelectorAll(".involve-card[data-topic]").forEach((card) => {
  card.addEventListener("click", () => { topic.value = card.dataset.topic; });
});

// Contact form
const form = document.getElementById("contact-form");
const status = form.querySelector(".form-status");
const submitBtn = form.querySelector('button[type="submit"]');

function setStatus(text, kind) {
  status.textContent = text;
  status.className = `form-status${kind ? ` is-${kind}` : ""}`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  let firstInvalid = null;
  form.querySelectorAll("[required]").forEach((field) => {
    const ok = field.checkValidity() && field.value.trim() !== "";
    field.setAttribute("aria-invalid", String(!ok));
    if (!ok && !firstInvalid) firstInvalid = field;
  });
  if (firstInvalid) {
    setStatus("Please fill in your name, a valid email and a message.", "error");
    firstInvalid.focus();
    return;
  }

  const data = Object.fromEntries(new FormData(form));
  const openEmailApp = () => {
    const subject = `Website enquiry: ${data.topic}`;
    const body = `${data.message}\n\n— ${data.name} (${data.email})`;
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setStatus("Thanks! Your email app should open with your message ready to send.", "ok");
  };

  if (!CONTACT_ENDPOINT) {
    openEmailApp();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";
  setStatus("", "");
  try {
    const res = await fetch(CONTACT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.ok) throw new Error(result.error || "Something went wrong.");
    form.reset();
    setStatus("Thank you! Your message has been sent — we'll get back to you soon.", "ok");
  } catch (err) {
    // Endpoint unreachable (offline, not deployed yet): fall back to the visitor's email app.
    if (err instanceof TypeError) openEmailApp();
    else setStatus(`${err.message} You can also call us on +357 99 541 017.`, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Send message";
  }
});

document.getElementById("year").textContent = new Date().getFullYear();
