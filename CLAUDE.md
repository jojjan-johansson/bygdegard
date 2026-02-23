# Via Bygdegårdsförening

## Utvecklingsprinciper

- **Fråga innan du bygger** — använd alltid `AskUserQuestion` innan ny funktionalitet implementeras. Bekräfta riktning och avgränsa scope innan koden skrivs.
- **Iterativt, inte fullständigt på en gång** — bygg minsta möjliga fungerande version först. Lägg till mer när behovet är bekräftat, inte i förväg.
- **Enkelhet framför komplexitet** — välj alltid den enklaste lösningen som löser problemet. Undvik abstraktioner och generalisering som inte behövs nu. Följ inte designmönster blint — välj vad som passar just det här problemet.
- **Underhållbarhet** — koden ska vara lätt att förstå och ändra för någon som inte var med och skrev den. Tydliga namn, små funktioner, minimal magi.
- **Kommentarer med syfte** — varje metod/funktion ska ha en kort förklaring av tre saker: (1) varför finns den här? (2) vad gör den? (3) hur fungerar den i stora drag? Skriv för en utvecklare som inte är bekant med domänen — anta inte förkunskaper. Kommentera även icke-uppenbara rader inuti funktioner. Målet är att en ny utvecklare ska kunna läsa koden uppifrån och ned och förstå helheten utan att behöva fråga någon.
- **Struktur och läsbarhet** — stora filer bryts ned till mindre, fokuserade moduler. Varje fil har ett tydligt ansvar. Mappstrukturen ska vara självförklarande — en ny utvecklare ska kunna orientera sig utan att fråga. Hellre många små filer med tydliga namn än en stor fil som gör allt. Det ska finnas en röd tråd: relaterat hålls ihop, orelaterat separeras.
- **Kodkvalitet** — inga oanvända variabler, inga döda kodstigar, inget copy-paste. Om något görs tre gånger kan det bli en hjälpfunktion — men inte i förväg.
- **Förklara arkitekturval** — vid varje implementationsbeslut som inte är uppenbart, förklara varför just det valet gjordes och vilka alternativ som övervägdes.
- **Använd färdiga bibliotek** — uppfinn inte hjulet på nytt. Välj etablerade Python-paket för backend-logik och ett UI-komponentbibliotek (t.ex. Tailwind, shadcn, Radix) för frontend istället för att skriva allt från scratch. Motivera varför ett bibliotek valdes eller valdes bort.
- **Frontend-design** — använd alltid `frontend-design`-skillet (Skill-verktyget) vid alla designändringar i frontend. Aldrig generisk AI-estetik, alltid genomtänkt och distinkt.



## Starta projektet

```bash
cd ~/dev/bygdegard
./start.sh
```

Öppna sedan **http://localhost:8000** i webbläsaren.

## Projektstruktur

- `server/app.py` — Flask-backend (API + serverar statiska filer)
- `data/bookings.sqlite` — SQLite-databas (skapas automatiskt)
- HTML-sidor i roten: `index.html`, `boka.html`, `kontakt.html`, `admin.html`, etc.
- `assets/js/` — JavaScript (main.js, calendar.js, admin.js)
- `assets/css/style.css` — All CSS

## Viktiga sidor

- `/boka.html` — Kalender med direktbokning (2h, heldag, helg)
- `/kontakt.html` — Kontaktformulär (sparar i DB)
- `/admin.html` — Admin-panel (kräver inloggning)

## Admin-inloggning

Lösenord: `kokobahia` (hashat i app.py, ändra via `generate_password_hash()`)

## Dependencies

Hanteras med `uv`:

```bash
uv pip install -r requirements.txt -p .venv/bin/python
```

## Teknik

- Python/Flask (backend)
- SQLite (databas)
- FullCalendar 6 (kalender-CDN)
- Vanilla JS (ingen framework)
