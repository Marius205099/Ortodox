# Ortodox

Calendar creștin ortodox, cu datele preluate automat de pe [calendar.patriarhia.ro](https://calendar.patriarhia.ro/), și notificare în fiecare seară la 20:00 despre ziua de mâine.

Site: https://marius205099.github.io/Ortodox/

## Cum funcționează

- `scripts/fetch_calendar.py` descarcă calendarul și scrie `data/<an>/<luna>.json` și `data/ortodox.ics`.
- `.github/workflows/daily.yml` rulează zilnic la 06:00 UTC: actualizează datele, publică site-ul pe GitHub Pages și programează pe [ntfy.sh](https://ntfy.sh/ortodox-marius205099) notificarea de la 20:00 (ora României).

## Notificări

1. **ntfy** (recomandat): instalează aplicația ntfy și abonează-te la `ortodox-marius205099`.
2. **Direct de la site (Web Push)**: pe iPhone, adaugă site-ul pe ecranul principal, deschide-l de acolo și apasă „Activează notificările”. Codul afișat se pune în secretul `PUSH_SUBSCRIPTIONS` al repo-ului. `.github/workflows/push.yml` îl trimite la 20:00 fix, semnat cu secretul `VAPID_PRIVATE_KEY`.
3. **Calendar**: abonare la `data/ortodox.ics`, cu memento la 20:00 în seara dinainte.
