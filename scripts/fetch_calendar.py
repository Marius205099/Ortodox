#!/usr/bin/env python3
"""Descarcă calendarul de pe calendar.patriarhia.ro și îl salvează ca JSON + ICS.

Pagina principală conține tot anul într-o variabilă JavaScript (`var copData = {...}`).
Scriptul o extrage, curăță HTML-ul și scrie:
  data/<an>/<luna>.json   - zilele unei luni
  data/index.json         - lunile disponibile și data actualizării
  data/ortodox.ics        - calendar cu alarmă la 20:00 în seara dinainte
"""
import html
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path

SOURCE = "https://calendar.patriarhia.ro/"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

ALLOWED = {"h2", "h3", "h4", "p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "blockquote"}
DROP_CONTENT = {"script", "style", "iframe", "noscript"}
COLOR_CLASS = {"e52b34": "r", "1c58bb": "b"}  # roșu = sărbătoare mare, albastru = sfânt cu cruce albastră


class Sanitizer(HTMLParser):
    """Păstrează doar etichete simple, fără atribute; culorile roșu/albastru devin clase."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.stack = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in DROP_CONTENT:
            self.skip += 1
            return
        if self.skip:
            return
        if tag == "span":
            style = dict(attrs).get("style") or ""
            m = re.search(r"#([0-9a-fA-F]{6})", style)
            cls = COLOR_CLASS.get(m.group(1).lower()) if m else None
            self.stack.append("span" if cls else None)
            if cls:
                self.out.append(f'<span class="{cls}">')
            return
        if tag == "h1":
            tag = "h3"
        if tag in ALLOWED:
            self.out.append(f"<{tag}>")

    def handle_endtag(self, tag):
        if tag in DROP_CONTENT:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag == "span":
            if self.stack and self.stack.pop():
                self.out.append("</span>")
            return
        if tag == "h1":
            tag = "h3"
        if tag in ALLOWED and tag != "br":
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(html.escape(data, quote=False))


def sanitize(raw):
    p = Sanitizer()
    p.feed(raw or "")
    p.close()
    return "".join(p.out).strip()


def text_of(raw):
    s = re.sub(r"<[^>]+>", " ", raw or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def paragraphs(raw):
    """Transformă textul WordPress (paragrafe despărțite de rânduri goale) în <p>."""
    s = sanitize(raw).replace("\r\n", "\n")
    s = re.sub(r"(</h\d>)", r"\1\n\n", s)
    out = []
    for chunk in re.split(r"\n\s*\n", s):
        chunk = chunk.strip()
        if not chunk:
            continue
        if re.match(r"<(h\d|p|ul|ol|blockquote)>", chunk):
            out.append(chunk.replace("\n", " "))
        else:
            out.append("<p>" + chunk.replace("\n", "<br>") + "</p>")
    return "".join(out)


def reading(raw):
    """Evanghelia / Apostolul: referința (din <h2>) și textul."""
    if not raw:
        return None
    m = re.search(r"<h2[^>]*>(.*?)</h2>", raw, re.S)
    ref = text_of(m.group(1)) if m else ""
    body = re.search(r'class="view-mode-full"[^>]*>(.*?)</div>', raw, re.S)
    txt = text_of(body.group(1)) if body else text_of(raw.replace(m.group(0), "") if m else raw)
    if not ref and not txt:
        return None
    return {"ref": ref, "text": txt}


def cross(raw):
    t = text_of(raw)
    if not t or t.lower().startswith("nu se aplic"):
        return None
    color = "r" if "#E52B34" in (raw or "").upper() else "b" if "#1C58BB" in (raw or "").upper() else "k"
    return {"label": t, "color": color}


def clean_day(e):
    d = str(e["data_zilei"])
    return {
        "date": d,
        "title": text_of(e.get("titlu_acf")),
        "title_html": sanitize(re.sub(r"</?h\d[^>]*>", "", e.get("titlu_acf") or "")),
        "subtitle": text_of(e.get("subtitlu_acf")) or None,
        "extra": text_of(e.get("text_suplimentar_acf")) or None,
        "holiday": bool(e.get("zi_libera_acf")),
        "cross": cross(e.get("crucea_zilei")),
        "synaxarion": paragraphs(e.get("sinaxar_text_acf")),
        "gospel": reading(e.get("evanghelia_zilei_acf")),
        "apostle": reading(e.get("apostolul_zilei_acf")),
        "image": e.get("featured_image") or None,
        "link": e.get("link") or None,
    }


def fetch(url=SOURCE):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Ortodox calendar reader; +https://marius205099.github.io/Ortodox/)",
        "Accept-Language": "ro-RO,ro;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def extract(page):
    marker = "var copData = "
    i = page.find(marker)
    if i < 0:
        raise SystemExit("Nu am găsit datele calendarului în pagină (copData lipsește).")
    data, _ = json.JSONDecoder().raw_decode(page[i + len(marker):])
    return [e for month in data["calendarData"].values() for e in month]


def ics_escape(s):
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def fold(line):
    b = line.encode("utf-8")
    parts = []
    while len(b) > 74:
        cut = 74
        while (b[cut] & 0xC0) == 0x80:  # nu tăia un caracter UTF-8 la mijloc
            cut -= 1
        parts.append(b[:cut].decode("utf-8"))
        b = b[cut:]
    parts.append(b.decode("utf-8"))
    return "\r\n ".join(parts)


def write_ics(days):
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ortodox//Calendar//RO", "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH", "X-WR-CALNAME:Calendar Ortodox", "X-WR-TIMEZONE:Europe/Bucharest",
        "REFRESH-INTERVAL;VALUE=DURATION:P1D", "X-PUBLISHED-TTL:P1D",
    ]
    for d in days:
        start = datetime.strptime(d["date"], "%Y%m%d").date()
        desc = [d["title"]]
        if d["subtitle"]:
            desc.append(d["subtitle"])
        if d["holiday"]:
            desc.append("Zi liberă legală")
        for k, name in (("apostle", "Apostolul"), ("gospel", "Evanghelia")):
            if d[k] and d[k]["ref"]:
                desc.append(f"{name}: {d[k]['ref']}")
        desc.append(f"https://marius205099.github.io/Ortodox/?d={d['date']}")
        summary = ("† " if d["cross"] and d["cross"]["color"] == "r" else "") + d["title"]
        lines += [
            "BEGIN:VEVENT",
            f"UID:{d['date']}@marius205099.github.io-ortodox",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{start:%Y%m%d}",
            f"DTEND;VALUE=DATE:{start + timedelta(days=1):%Y%m%d}",
            "SUMMARY:" + ics_escape(summary[:240]),
            "DESCRIPTION:" + ics_escape("\n".join(desc)),
            "TRANSP:TRANSPARENT",
            "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + ics_escape("Mâine: " + d["title"][:200]),
            "TRIGGER:-PT4H",  # 4 ore înainte de miezul nopții = ora 20:00 în ziua precedentă
            "END:VALARM",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    (DATA / "ortodox.ics").write_text("\r\n".join(fold(l) for l in lines) + "\r\n", encoding="utf-8")


def main():
    page = Path(sys.argv[1]).read_text(encoding="utf-8") if len(sys.argv) > 1 else fetch()
    days = sorted((clean_day(e) for e in extract(page)), key=lambda d: d["date"])
    if len(days) < 300:
        raise SystemExit(f"Prea puține zile găsite ({len(days)}), nu suprascriu datele.")

    by_month = {}
    for d in days:
        by_month.setdefault((d["date"][:4], d["date"][4:6]), []).append(d)
    for (y, m), items in by_month.items():
        folder = DATA / y
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{m}.json").write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # index cu toți anii prezenți pe disc (anii vechi rămân după schimbarea anului)
    months = sorted(f"{p.parent.name}{p.stem}" for p in DATA.glob("[0-9][0-9][0-9][0-9]/[0-9][0-9].json"))
    index = {"source": SOURCE, "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "months": months}
    (DATA / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    # ICS: de ieri până la sfârșitul datelor disponibile (toți anii de pe disc)
    all_days = []
    for ym in months:
        all_days += json.loads((DATA / ym[:4] / f"{ym[4:]}.json").read_text(encoding="utf-8"))
    since = (date.today() - timedelta(days=60)).strftime("%Y%m%d")
    write_ics([d for d in all_days if d["date"] >= since])
    print(f"OK: {len(days)} zile, luni disponibile: {months[0]}–{months[-1]}")


if __name__ == "__main__":
    main()
