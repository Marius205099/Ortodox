"use strict";

const VERSION = "ortodox-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png"];
const STATE_CACHE = "ortodox-state";
const STATE_KEY = "./__notif-state";
const NOTIFY_HOUR = 20;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== STATE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// rețea întâi (date mereu proaspete), cache dacă suntem offline
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: url.pathname.endsWith("/") }))
  );
});

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

async function readState() {
  const r = await (await caches.open(STATE_CACHE)).match(STATE_KEY);
  return r ? r.json() : {};
}

// Chrome (aplicație instalată) trezește periodic service worker-ul
self.addEventListener("periodicsync", (e) => {
  if (e.tag !== "ortodox-maine") return;
  e.waitUntil((async () => {
    const now = new Date();
    if (now.getHours() < NOTIFY_HOUR) return;
    const todayKey = ymd(now);
    if ((await readState()).lastShown === todayKey) return;
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const key = ymd(t);
    let day = null;
    try {
      const list = await (await fetch(`data/${key.slice(0, 4)}/${key.slice(4, 6)}.json`)).json();
      day = list.find((d) => d.date === key);
    } catch { /* offline */ }
    const title = `Mâine, ${t.toLocaleDateString("ro-RO", { weekday: "short", day: "numeric", month: "long" })}`;
    await self.registration.showNotification(title, {
      body: day ? day.title + (day.holiday ? "\nZi liberă legală" : "") : "Deschide calendarul pentru detalii.",
      icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: `maine-${key}`, data: { url: `./?d=${key}` },
    });
    await (await caches.open(STATE_CACHE)).put(STATE_KEY, new Response(JSON.stringify({ lastShown: todayKey })));
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("navigate" in c) { await c.navigate(url); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
