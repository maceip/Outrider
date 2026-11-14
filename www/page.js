// Door scan and day strip, same behavior as www.silvector.com/extras.js.
// The day counts use the published fixed-seed demo generator. They are not shop data.

const DEMO_DOOR = "https://demo.silvector.com/#/readiness/";
const HOST = /^(?=.{3,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

function cleanDomain(raw) {
  let value = String(raw || "").trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "").replace(/^www\./, "");
  value = value.split(/[/?#]/)[0] || "";
  if (!HOST.test(value)) return null;
  if (/^\d+(\.\d+)*$/.test(value)) return null;
  return value;
}

const door = document.querySelector("#door-form");
if (door) {
  const input = door.querySelector("#door-domain");
  const status = door.querySelector("#door-status");
  door.addEventListener("submit", (event) => {
    event.preventDefault();
    const domain = cleanDomain(input && input.value);
    if (!domain) {
      if (status) status.textContent = "Type a website name, like yourshop.com.";
      return;
    }
    if (status) status.textContent = `Opening the scan for ${domain} in the demo.`;
    window.location.assign(DEMO_DOOR + encodeURIComponent(domain));
  });
}

function chicagoDate(now) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type) => (parts.find((part) => part.type === type) || {}).value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function seedOf(date) {
  let hash = 2166136261;
  for (let i = 0; i < date.length; i += 1) {
    hash ^= date.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulatedDay(date) {
  const next = random(seedOf(date));
  const total = 1200 + Math.floor(next() * 600);
  const askedToVerify = Math.round(total * (0.12 + next() * 0.06));
  const blocked = Math.round(total * (0.05 + next() * 0.04));
  return { date, total, letThrough: total - askedToVerify - blocked, askedToVerify, blocked };
}

const strip = document.querySelector("#day-strip");
if (strip) {
  const day = simulatedDay(chicagoDate(new Date()));
  const fmt = (n) => n.toLocaleString("en-US");
  const set = (sel, text) => { for (const el of strip.querySelectorAll(sel)) el.textContent = text; };
  set("[data-day=date]", day.date);
  set("[data-day=total]", fmt(day.total));
  set("[data-day=through]", fmt(day.letThrough));
  set("[data-day=verify]", fmt(day.askedToVerify));
  set("[data-day=blocked]", fmt(day.blocked));
  for (const [key, value] of [["through", day.letThrough], ["verify", day.askedToVerify], ["blocked", day.blocked]]) {
    const bar = strip.querySelector(`[data-bar=${key}]`);
    if (bar) bar.style.flexGrow = String(value);
  }
  strip.hidden = false;
}

const board = document.querySelector("#board");
if (board) {
  const buttons = Array.from(board.querySelectorAll("[data-chapter-button]"));
  const select = (index) => {
    board.setAttribute("data-chapter", String(index));
    for (const button of buttons) {
      button.setAttribute("aria-current", button.getAttribute("data-chapter-button") === String(index) ? "step" : "false");
    }
  };
  for (const button of buttons) {
    button.addEventListener("click", () => select(Number(button.getAttribute("data-chapter-button"))));
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const current = Number(board.getAttribute("data-chapter") || "0");
      const next = Math.max(0, Math.min(buttons.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)));
      select(next);
      buttons[next].focus();
    });
  }
  select(0);
}
