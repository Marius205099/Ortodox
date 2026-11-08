"use strict";

const NTFY_TOPIC = "ortodox-marius205099";
const NOTIFY_HOUR = 20;
const STATE_CACHE = "ortodox-state";
const STATE_KEY = "./__notif-state";

const $ = (id) => document.getElementById(id);
const months = new Map();

// ---------- date ----------
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const parseYmd = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtLong = (d) => d.toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtShort = (d) => d.toLocaleDateString("ro-RO", { weekday: "short", day: "numeric", month: "long" });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function getDay(key) {
  const ym = key.slice(0, 6);
  if (!months.has(ym)) {
    months.set(ym, fetch(`data/${ym.slice(0, 4)}/${ym.slice(4)}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []));
  }
  const list = await months.get(ym);
  return list.find((d) => d.date === key) || null;
}

// ---------- afișare ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let current = new Date();

function badges(day) {
  const out = [];
  if (day.cross) out.push(`<span class="badge ${day.cross.color}">Cruce: ${esc(day.cross.label)}</span>`);
  if (day.holiday) out.push(`<span class="badge free">Zi liberă legală</span>`);
  return out.length ? `<div class="badges">${out.join("")}</div>` : "";
}

function reading(label, r) {
  if (!r) return "";
  return `<details><summary><span>${label}<small>${esc(r.ref)}</small></span></summary>
    <div class="body"><p>${esc(r.text)}</p></div></details>`;
}

async function renderDay(date) {
  current = date;
  const key = ymd(date);
  $("nav-label").textContent = cap(fmtLong(date));
  $("date").value = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6)}`;
  history.replaceState(null, "", key === ymd(new Date()) ? "./" : `?d=${key}`);
  markActive();

  const day = await getDay(key);
  if (key !== ymd(current)) return; // între timp s-a ales altă zi
  const el = $("day");
  if (!day) {
    el.innerHTML = `<p class="muted">Nu există încă date pentru această zi. Calendarul Patriarhiei este publicat an cu an.</p>`;
    return;
  }
  el.innerHTML = `
    ${badges(day)}
    <h1>${day.title_html || esc(day.title)}</h1>
    ${day.subtitle ? `<p class="sub">${esc(day.subtitle)}</p>` : ""}
    ${day.extra ? `<p class="sub">${esc(day.extra)}</p>` : ""}
    ${day.image ? `<figure><img src="${esc(day.image)}" alt="Icoana zilei" loading="lazy"></figure>` : ""}
    ${day.synaxarion ? `<details open><summary><span>Sinaxarul zilei</span></summary><div class="body">${day.synaxarion}</div></details>` : ""}
    ${reading("Apostolul", day.apostle)}
    ${reading("Evanghelia", day.gospel)}
    ${day.link ? `<p class="src"><a href="${esc(day.link)}" target="_blank" rel="noopener">Vezi pe calendar.patriarhia.ro ↗</a></p>` : ""}`;
}

async function renderMini() {
  const today = new Date();
  const tomorrow = addDays(today, 1);
  for (const [id, label, d] of [["mini-today", "Azi", today], ["mini-tomorrow", "Mâine", tomorrow]]) {
    const btn = $(id);
    btn.dataset.key = ymd(d);
    btn.innerHTML = `<div class="k">${label}</div><div class="d">${esc(cap(fmtShort(d)))}</div><div class="t">…</div>`;
    btn.onclick = () => renderDay(d);
    getDay(ymd(d)).then((day) => {
      btn.querySelector(".t").innerHTML = day ? day.title_html || esc(day.title) : "Fără date";
    });
  }
  markActive();
}

function markActive() {
  for (const id of ["mini-today", "mini-tomorrow"]) {
    $(id).classList.toggle("active", $(id).dataset.key === ymd(current));
  }
}

// ---------- notificări în browser ----------
let swReg = null;

async function readState() {
  try {
    const r = await (await caches.open(STATE_CACHE)).match(STATE_KEY);
    return r ? await r.json() : {};
  } catch { return {}; }
}
async function writeState(s) {
  try {
    await (await caches.open(STATE_CACHE)).put(STATE_KEY, new Response(JSON.stringify(s), { headers: { "Content-Type": "application/json" } }));
  } catch { /* stocare indisponibilă */ }
}

function prefsOn() {
  try { return localStorage.getItem("ortodox-notif") === "1"; } catch { return false; }
}
function setPrefs(on) {
  try { localStorage.setItem("ortodox-notif", on ? "1" : "0"); } catch { /* ignorat */ }
}

async function notifyTomorrow(force = false) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = new Date();
  const todayKey = ymd(now);
  if (!force) {
    if (!prefsOn() || now.getHours() < NOTIFY_HOUR) return;
    const st = await readState();
    if (st.lastShown === todayKey) return;
  }
  const t = addDays(now, 1);
  const day = await getDay(ymd(t));
  const title = `Mâine, ${fmtShort(t)}`;
  const body = day
    ? day.title + (day.holiday ? "\nZi liberă legală" : "")
    : "Deschide calendarul pentru detalii.";
  const opts = { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: `maine-${ymd(t)}`, data: { url: `./?d=${ymd(t)}` } };
  if (swReg) await swReg.showNotification(title, opts);
  else new Notification(title, opts);
  if (!force) await writeState({ lastShown: todayKey });
}

function updateBell() {
  const on = prefsOn() && "Notification" in window && Notification.permission === "granted";
  $("bell").classList.toggle("on", on);
  $("bell-label").textContent = on ? "Notificări active" : "Notificări 20:00";
  $("test").hidden = !on;
  $("enable").textContent = on ? "Dezactivează" : "Activează notificările";
}

async function toggleNotifications() {
  const status = $("enable-status");
  if (!("Notification" in window)) {
    status.textContent = "Acest browser nu suportă notificări. Pe iPhone, adaugă întâi site-ul pe ecranul principal (Partajare → Adaugă pe ecranul principal) sau folosește varianta 1.";
    return;
  }
  if (prefsOn() && Notification.permission === "granted") {
    setPrefs(false);
    status.textContent = "Notificările din browser au fost oprite.";
    updateBell();
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    status.textContent = "Permisiunea a fost refuzată. O poți reactiva din setările browserului pentru acest site.";
    return;
  }
  setPrefs(true);
  try {
    if (swReg && "periodicSync" in swReg) {
      await swReg.periodicSync.register("ortodox-maine", { minInterval: 6 * 60 * 60 * 1000 });
    }
  } catch { /* disponibil doar pentru aplicații instalate în Chrome */ }
  status.textContent = `Gata! Vei primi notificarea la ${NOTIFY_HOUR}:00. Pentru siguranță, folosește și varianta 1.`;
  updateBell();
  notifyTomorrow();
}

function scheduleCheck() {
  // verifică la fiecare minut; la 20:00 (sau prima deschidere după) trimite notificarea o dată pe zi
  notifyTomorrow();
  setInterval(() => notifyTomorrow(), 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) notifyTomorrow(); });
}

// ---------- pornire ----------
async function init() {
  const q = new URLSearchParams(location.search).get("d");
  const start = q && /^\d{8}$/.test(q) ? parseYmd(q) : new Date();

  $("prev").onclick = () => renderDay(addDays(current, -1));
  $("next").onclick = () => renderDay(addDays(current, 1));
  $("date").onchange = (e) => { if (e.target.value) renderDay(parseYmd(e.target.value.replaceAll("-", ""))); };
  $("bell").onclick = () => $("notif").scrollIntoView({ behavior: "smooth" });
  $("enable").onclick = toggleNotifications;
  $("test").onclick = () => notifyTomorrow(true);

  $("topic").textContent = NTFY_TOPIC;
  $("ntfy-web").href = `https://ntfy.sh/${NTFY_TOPIC}`;
  $("copy-topic").onclick = async () => {
    try { await navigator.clipboard.writeText(NTFY_TOPIC); $("copy-topic").textContent = "Copiat ✓"; } catch { /* ignorat */ }
  };
  const ics = new URL("data/ortodox.ics", location.href);
  $("ics").href = `webcal://${ics.host}${ics.pathname}`;

  renderMini();
  renderDay(start);

  fetch("data/index.json").then((r) => r.json()).then((ix) => {
    $("updated").textContent = `Actualizat: ${new Date(ix.updated).toLocaleString("ro-RO", { dateStyle: "long", timeStyle: "short" })}`;
  }).catch(() => {});

  if ("serviceWorker" in navigator) {
    try { swReg = await navigator.serviceWorker.register("sw.js"); await navigator.serviceWorker.ready; } catch { swReg = null; }
  }
  updateBell();
  scheduleCheck();

  // la miezul nopții, reîmprospătează cardurile Azi/Mâine
  let lastKey = ymd(new Date());
  setInterval(() => { if (ymd(new Date()) !== lastKey) { lastKey = ymd(new Date()); renderMini(); } }, 60 * 1000);
}

init();
