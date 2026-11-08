#!/usr/bin/env python3
"""Programează pe ntfy.sh notificarea de la 20:00 (ora României) despre ziua de mâine.

ntfy păstrează mesajul și îl livrează exact la ora cerută (câmpul `delay`),
așa că workflow-ul poate rula oricând în cursul zilei.
Dacă e deja trecut de 20:00, mesajul pleacă imediat.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Bucharest")
TOPIC = os.environ.get("NTFY_TOPIC", "ortodox-marius205099")
SERVER = os.environ.get("NTFY_SERVER", "https://ntfy.sh")
SITE = "https://marius205099.github.io/Ortodox/"
DATA = Path(__file__).resolve().parent.parent / "data"
HOUR = 20

ZILE = ["luni", "marți", "miercuri", "joi", "vineri", "sâmbătă", "duminică"]
LUNI = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie",
        "august", "septembrie", "octombrie", "noiembrie", "decembrie"]


def load_day(d):
    path = DATA / f"{d:%Y}" / f"{d:%m}.json"
    if not path.exists():
        return None
    key = f"{d:%Y%m%d}"
    return next((x for x in json.loads(path.read_text(encoding="utf-8")) if x["date"] == key), None)


def main():
    now = datetime.now(TZ)
    tomorrow = (now + timedelta(days=1)).date()
    day = load_day(tomorrow)

    title = f"Mâine, {ZILE[tomorrow.weekday()]} {tomorrow.day} {LUNI[tomorrow.month - 1]}"
    if day:
        lines = [day["title"]]
        if day.get("subtitle"):
            lines.append(day["subtitle"])
        if day.get("holiday"):
            lines.append("Zi liberă legală")
        for k, name in (("apostle", "Apostolul"), ("gospel", "Evanghelia")):
            if day.get(k) and day[k].get("ref"):
                lines.append(f"{name}: {day[k]['ref']}")
        red = bool(day.get("cross") and day["cross"]["color"] == "r")
    else:
        lines, red = ["Deschide calendarul pentru detalii."], False

    url = f"{SITE}?d={tomorrow:%Y%m%d}"
    msg = {
        "topic": TOPIC,
        "title": title,
        "message": "\n".join(lines),
        "tags": ["red_circle" if red else "church"],
        "priority": 4 if red else 3,
        "click": url,
        "icon": SITE + "icons/icon-192.png",
        "actions": [{"action": "view", "label": "Deschide calendarul", "url": url}],
    }
    at = now.replace(hour=HOUR, minute=0, second=0, microsecond=0)
    if at - now > timedelta(minutes=1):
        msg["delay"] = str(int(at.timestamp()))
        when = f"programată pentru {at:%Y-%m-%d %H:%M %Z}"
    else:
        when = "trimisă imediat"

    if "--dry-run" in sys.argv:
        print(json.dumps(msg, ensure_ascii=False, indent=1), "\n", when)
        return
    req = urllib.request.Request(SERVER, data=json.dumps(msg).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        print(r.status, r.read().decode("utf-8")[:300])
    print(f"Notificare {when} pe {SERVER}/{TOPIC}")


if __name__ == "__main__":
    main()
