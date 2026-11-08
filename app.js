"use strict";

const NTFY_TOPIC = "ortodox-marius205099";
const VAPID_PUBLIC_KEY = "BKKLpAXOxlHjCDeuzpBCUEbMKD13yHcaEdE9Dup3QAFNtM9esibIKaMMoenKXPBqe4Ct7OeMOFGzhmwQQmDOr7E";

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

// ---------- notificări push ----------
let swReg = null;

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function b64ToBytes(b64) {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function showCode(sub) {
  $("sub-code").value = JSON.stringify(sub);
  $("code-box").hidden = false;
}

async function updatePushUI() {
  const status = $("enable-status");
  $("ios-home").hidden = !(isIOS() && !isStandalone());
  if (!pushSupported()) {
    $("enable").hidden = true;
    status.textContent = isIOS() && !isStandalone()
      ? "Adaugă site-ul pe ecranul principal și deschide-l de acolo; apoi butonul de activare apare aici."
      : "Acest browser nu suportă notificări push. Folosește varianta 1 sau 3.";
    return;
  }
  $("enable").hidden = false;
  const sub = swReg && (await swReg.pushManager.getSubscription());
  const on = !!sub && Notification.permission === "granted";
  $("bell").classList.toggle("on", on);
  $("bell-label").textContent = on ? "Notificări active" : "Notificări 20:00";
  $("test").hidden = !on;
  $("enable").textContent = on ? "Arată din nou codul" : "Activează notificările";
  if (on && !status.textContent) status.textContent = "Notificările sunt activate pe acest dispozitiv.";
}

async function enablePush() {
  const status = $("enable-status");
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      status.textContent = "Permisiunea a fost refuzată. Pe iPhone: Configurări → Notificări → Ortodox → Permite notificările.";
      return;
    }
    swReg = swReg || (await navigator.serviceWorker.ready);
    let sub = await swReg.pushManager.getSubscription();
    if (!sub) {
      sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
    }
    showCode(sub);
    status.textContent = "Notificările sunt activate. Mai e un singur pas, mai jos.";
  } catch (e) {
    status.textContent = `Nu am putut activa notificările: ${e.message || e}`;
  }
  updatePushUI();
}

async function testPush() {
  const t = addDays(new Date(), 1);
  const day = await getDay(ymd(t));
  await swReg.showNotification(`Mâine, ${fmtShort(t)}`, {
    body: day ? day.title : "Deschide calendarul pentru detalii.",
    icon: "icons/icon-192.png", tag: "test", data: { url: `./?d=${ymd(t)}` },
  });
}

// ---------- pornire ----------
async function init() {
  const q = new URLSearchParams(location.search).get("d");
  const start = q && /^\d{8}$/.test(q) ? parseYmd(q) : new Date();

  $("prev").onclick = () => renderDay(addDays(current, -1));
  $("next").onclick = () => renderDay(addDays(current, 1));
  $("date").onchange = (e) => { if (e.target.value) renderDay(parseYmd(e.target.value.replaceAll("-", ""))); };
  $("bell").onclick = () => $("notif").scrollIntoView({ behavior: "smooth" });
  $("enable").onclick = enablePush;
  $("test").onclick = testPush;
  $("copy-code").onclick = async () => {
    const box = $("sub-code");
    try { await navigator.clipboard.writeText(box.value); } catch { box.select(); document.execCommand("copy"); }
    $("copy-code").textContent = "Copiat ✓";
  };

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
  updatePushUI();

  // la miezul nopții, reîmprospătează cardurile Azi/Mâine
  let lastKey = ymd(new Date());
  setInterval(() => { if (ymd(new Date()) !== lastKey) { lastKey = ymd(new Date()); renderMini(); } }, 60 * 1000);
}

init();
