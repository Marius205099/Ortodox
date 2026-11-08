#!/usr/bin/env python3
"""Trimite notificarea Web Push de la 20:00 (ora României) către telefoanele abonate.

Variabile de mediu (din secretele repo-ului):
  VAPID_PRIVATE_KEY   - cheia privată PEM pentru semnarea mesajelor
  PUSH_SUBSCRIPTIONS  - unul sau mai multe coduri de abonare copiate din site
                        (fiecare e un obiect JSON; pot fi puse unul sub altul)

Workflow-ul rulează la 15:30 și 16:30 UTC; scriptul continuă doar pentru rularea
aflată la ~90 de minute înainte de 20:00 (ține cont de ora de vară), apoi așteaptă
până la 20:00 fix și trimite.
"""
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from notify import LUNI, SITE, ZILE, load_day  # noqa: E402

TZ = ZoneInfo("Europe/Bucharest")
HOUR = 20


def parse_subscriptions(raw):
    subs, dec, i = [], json.JSONDecoder(), 0
    raw = raw.strip()
    while i < len(raw):
        if raw[i] in " \t\r\n,[]":
            i += 1
            continue
        obj, i = dec.raw_decode(raw, i)
        subs.append(obj)
    return subs


def message():
    tomorrow = (datetime.now(TZ) + timedelta(days=1)).date()
    day = load_day(tomorrow)
    title = f"Mâine, {ZILE[tomorrow.weekday()]} {tomorrow.day} {LUNI[tomorrow.month - 1]}"
    if day:
        body = day["title"]
        if day.get("holiday"):
            body += "\nZi liberă legală"
    else:
        body = "Deschide calendarul pentru detalii."
    return {"title": title, "body": body, "url": f"{SITE}?d={tomorrow:%Y%m%d}", "tag": f"maine-{tomorrow:%Y%m%d}"}


def wait_until_eight():
    schedule = os.environ.get("SCHEDULE")  # ex. "30 15 * * *", pus de workflow
    now = datetime.now(TZ)
    target = now.replace(hour=HOUR, minute=0, second=0, microsecond=0)
    if schedule:
        minute, hour = (int(x) for x in schedule.split()[:2])
        nominal = datetime.now(ZoneInfo("UTC")).replace(hour=hour, minute=minute, second=0, microsecond=0).astimezone(TZ)
        lead = (target - nominal).total_seconds() / 60
        if not 60 <= lead < 120:
            print(f"Rularea de la {nominal:%H:%M} (ora RO) nu e cea potrivită azi; o face cealaltă.")
            return False
    wait = (target - datetime.now(TZ)).total_seconds()
    if wait > 0:
        print(f"Aștept {wait / 60:.0f} minute, până la {target:%H:%M}.")
        time.sleep(wait)
    return True


def main():
    from pywebpush import WebPushException, webpush

    if "--now" not in sys.argv and not wait_until_eight():
        return
    subs = parse_subscriptions(os.environ.get("PUSH_SUBSCRIPTIONS", ""))
    key = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    if not subs or not key:
        raise SystemExit("Lipsesc secretele PUSH_SUBSCRIPTIONS sau VAPID_PRIVATE_KEY.")

    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as f:
        f.write(key + "\n")
        key_path = f.name

    payload = json.dumps(message(), ensure_ascii=False)
    ok = 0
    for n, sub in enumerate(subs, 1):
        try:
            webpush(sub, payload, vapid_private_key=key_path,
                    vapid_claims={"sub": "https://marius205099.github.io"}, ttl=6 * 3600)
            ok += 1
            print(f"Abonament {n}: trimis.")
        except WebPushException as e:
            code = e.response.status_code if e.response is not None else "?"
            hint = " (abonamentul a expirat: activează din nou notificările pe telefon și înlocuiește codul)" if code in (404, 410) else ""
            print(f"::warning::Abonament {n}: eroare {code}{hint}")
    os.unlink(key_path)
    if not ok:
        raise SystemExit("Nicio notificare nu a putut fi trimisă.")


if __name__ == "__main__":
    main()
