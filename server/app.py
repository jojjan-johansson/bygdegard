from __future__ import annotations

# =============================================================================
# app.py — Flask-backend för Via Bygdegårdsförening
#
# VARFÖR FINNS DEN HÄR?
#   Serverar både API-endpoints (JSON) och statiska HTML-filer från en enda
#   process, vilket eliminerar CORS-problem och håller driftsättningen enkel.
#
# VAD GÖR DEN?
#   - Autentisering: session-baserad inloggning för admin
#   - Bokningsflöde: direktbokning med kollisionskontroll
#   - Kontaktformulär: sparar meddelanden i SQLite
#   - Events: admin kan skapa/redigera/ta bort event med bild
#   - Galleri: admin kan ladda upp/ta bort bilder i ett bildgalleri
#   - Statiska filer: serverar HTML, CSS, JS och uppladdade bilder
#
# HUR FUNGERAR DEN?
#   Flask-appen startas direkt med `python server/app.py`.
#   All data sparas i SQLite (data/bookings.sqlite).
#   Uppladdade bilder sparas under data/images/.
# =============================================================================

import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, request, send_from_directory, jsonify, session
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename


# =========================
# App + sökvägar
# =========================

# Flask-appen pekar på projektroten (..) som static folder så att alla
# HTML/CSS/JS-filer serveras direkt utan en separat webbserver.
app = Flask(__name__, static_folder="..", static_url_path="")
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(24))

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
DATA_DIR      = PROJECT_ROOT / "data"
DB_PATH       = DATA_DIR / "bookings.sqlite"
IMAGES_DIR    = DATA_DIR / "images"
EVENTS_IMG    = IMAGES_DIR / "events"   # en mapp per event: events/<id>/bild.jpg
GALLERY_DIR   = IMAGES_DIR / "gallery"  # platta mappar: gallery/bild.jpg

# Tillåtna bildtyper vid uppladdning
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif"}

# Hashat admin-lösenord.
# Ändra via: python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('ditt_lösenord'))"
ADMIN_PASSWORD_HASH = generate_password_hash("kokobahia")


# =========================
# Hjälpfunktioner
# =========================

def utc_now_iso() -> str:
    """Returnerar aktuell UTC-tid som ISO 8601-sträng (för created_at-fält)."""
    return datetime.now(timezone.utc).isoformat()


def allowed_file(filename: str) -> bool:
    """
    VARFÖR: Förhindrar uppladdning av skadliga filtyper (t.ex. .exe, .php).
    VAD: Kontrollerar att filnamnet har ett tillåtet tillägg.
    HUR: Splittar på '.' och jämför sista delen mot ALLOWED_EXTENSIONS.
    """
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def ensure_db() -> None:
    """
    VARFÖR: Databasen och bildmappar måste finnas innan appen tar emot requests.
    VAD: Skapar SQLite-tabeller och filsystemskataloger om de saknas.
    HUR: Körs automatiskt innan varje DB-anrop via db()-funktionen.
    """
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(EVENTS_IMG, exist_ok=True)
    os.makedirs(GALLERY_DIR, exist_ok=True)

    with sqlite3.connect(DB_PATH) as con:
        # Bokningar — används för kalendern och direktbokning
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS bookings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                status      TEXT NOT NULL,
                title       TEXT NOT NULL,
                start       TEXT NOT NULL,
                end         TEXT,
                name        TEXT,
                email       TEXT,
                phone       TEXT,
                booking_type TEXT,
                message     TEXT,
                created_at  TEXT NOT NULL
            )
            """
        )
        # Kontaktmeddelanden — sparas från kontaktformuläret
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                email      TEXT NOT NULL,
                message    TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        # Events — årets aktiviteter, hanteras av admin
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL,
                date        TEXT,
                description TEXT,
                image_path  TEXT,
                created_at  TEXT NOT NULL
            )
            """
        )
        # Medlemsanmälningar — GDPR-säkert: sparas lokalt, admin kan radera
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS members (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                member_number TEXT NOT NULL,
                name          TEXT NOT NULL,
                email         TEXT NOT NULL,
                phone         TEXT,
                created_at    TEXT NOT NULL
            )
            """
        )
        # Migrering: lägg till member_number om tabellen redan finns utan den
        try:
            con.execute("ALTER TABLE members ADD COLUMN member_number TEXT NOT NULL DEFAULT ''")
        except Exception:
            pass  # kolumnen finns redan

        # Sidinnehåll — redigerbara sektioner för information-sidan
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS page_sections (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                page          TEXT NOT NULL,
                title         TEXT NOT NULL,
                content       TEXT NOT NULL,
                display_order INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL
            )
            """
        )

        # Styrelsemedlemmar — roller som admin kan redigera (ordförande, kassör, etc.)
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS board_members (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                role          TEXT NOT NULL,
                name          TEXT NOT NULL,
                contact       TEXT,
                image_path    TEXT,
                display_order INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL
            )
            """
        )
        # Migrering: lägg till image_path om tabellen redan finns utan den
        try:
            con.execute("ALTER TABLE board_members ADD COLUMN image_path TEXT")
        except Exception:
            pass  # kolumnen finns redan

        # Sponsorer — företag/organisationer som stödjer bygdegården
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS sponsors (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT NOT NULL,
                description   TEXT,
                url           TEXT,
                image_path    TEXT,
                display_order INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL
            )
            """
        )
        con.commit()


def db() -> sqlite3.Connection:
    """
    VARFÖR: Central plats för att öppna DB-anslutningar med rätt inställningar.
    VAD: Returnerar en sqlite3-anslutning med row_factory satt till sqlite3.Row,
         vilket gör att kolumner kan nås med namn (row["title"]) istället för index.
    HUR: Anropar ensure_db() för att garantera att tabeller finns.
    """
    ensure_db()
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def is_admin() -> bool:
    """
    VARFÖR: Alla admin-endpoints måste skyddas — detta är grindvakten.
    VAD: Returnerar True om den aktuella sessionen tillhör en inloggad admin.
    HUR: Läser Flask-sessionens "admin"-nyckel (sätts vid inloggning).
    """
    return session.get("admin") is True


# =========================
# Auth: Login / Logout
# =========================

@app.post("/api/login")
def api_login():
    """
    VARFÖR: Adminpanelen kräver autentisering — detta är inloggningsendpointen.
    VAD: Tar emot ett lösenord (JSON), verifierar mot det hashade lösenordet
         och sätter en session-cookie vid rätt lösenord.
    HUR: Använder werkzeug.security.check_password_hash för säker jämförelse.
    """
    data = request.get_json(silent=True) or {}
    password = (data.get("password") or "").strip()

    if not password or not check_password_hash(ADMIN_PASSWORD_HASH, password):
        return jsonify({"ok": False, "error": "Fel lösenord"}), 401

    session["admin"] = True
    return jsonify({"ok": True})


@app.post("/api/logout")
def api_logout():
    """
    VARFÖR: Admin ska kunna logga ut.
    VAD: Rensar sessionen (tar bort "admin"-nyckeln och alla andra sessionsdata).
    HUR: Anropar session.clear() och returnerar bekräftelse.
    """
    session.clear()
    return jsonify({"ok": True})


# =========================
# API: Bokningar (publik)
# =========================

@app.get("/api/bookings")
def api_get_bookings():
    """
    VARFÖR: Kalendern på boka.html behöver veta vilka datum som är bokade.
    VAD: Returnerar alla godkända bokningar som FullCalendar-kompatibla event-objekt.
    HUR: Hämtar status='approved'-rader och bygger JSON-lista med id, title, start, end.
    """
    try:
        with db() as con:
            rows = con.execute(
                "SELECT id, title, start, end, booking_type FROM bookings WHERE status='approved' ORDER BY start ASC"
            ).fetchall()

        events = []
        for r in rows:
            item = {
                "id": r["id"],
                "title": r["title"],
                "start": r["start"],
            }
            if r["end"]:
                item["end"] = r["end"]
            if r["booking_type"]:
                item["booking_type"] = r["booking_type"]
            events.append(item)

        return jsonify({"ok": True, "events": events})
    except Exception:
        return jsonify({"ok": False, "error": "Kunde inte hämta bokningar"}), 500


# =========================
# API: Direktbokning (publik)
# =========================

@app.post("/api/book")
def api_book():
    """
    VARFÖR: Besökare ska kunna boka lokalen direkt från kalendern utan att vänta på godkännande.
    VAD: Tar emot bokningsdata (namn, e-post, telefon, datum, bokningstyp), kontrollerar
         att datumet är ledigt och sparar direkt som 'approved'.
    HUR:
      - booking_type "2h" → 10:00–12:00 samma dag
      - "heldag" → heldagsevent utan sluttid
      - "helg" → lördag + söndag (FullCalendar exclusive end = datum+2 dagar)
      Kollisionskontroll via SQL mot befintliga approved-bokningar.
    """
    data = request.get_json(silent=True) or {}
    name         = (data.get("name")         or "").strip()
    email        = (data.get("email")        or "").strip()
    phone        = (data.get("phone")        or "").strip()
    date_str     = (data.get("date")         or "").strip()
    booking_type = (data.get("booking_type") or "").strip()
    time_slot    = (data.get("time_slot")    or "").strip()  # bara för 2h-bokningar

    if not name or not email or not date_str:
        return jsonify({"ok": False, "error": "Namn, e-post och datum krävs"}), 400

    if booking_type not in ("2h", "heldag", "helg"):
        return jsonify({"ok": False, "error": "Ogiltig bokningstyp"}), 400

    # Tillgängliga tidsluckor för 2h-bokningar (matchar de i calendar.js)
    SLOTS: dict[str, tuple[str, str]] = {
        "09:00": ("09:00", "11:00"),
        "12:00": ("12:00", "14:00"),
        "15:00": ("15:00", "17:00"),
        "18:00": ("18:00", "20:00"),
    }

    try:
        chosen_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"ok": False, "error": "Ogiltigt datumformat"}), 400

    # Beräkna start/end utifrån bokningstyp
    if booking_type == "2h":
        if time_slot not in SLOTS:
            return jsonify({"ok": False, "error": "Ogiltig tidslucka"}), 400
        start_t, end_t = SLOTS[time_slot]
        start = f"{date_str}T{start_t}:00"
        end   = f"{date_str}T{end_t}:00"
        title = f"{name} ({start_t}–{end_t})"
    elif booking_type == "heldag":
        start = date_str
        end   = None
        title = f"{name} (heldag)"
    else:  # helg
        start    = date_str
        end_date = chosen_date + timedelta(days=2)  # FullCalendar exclusive end
        end      = end_date.isoformat()
        title    = f"{name} (helhelg)"

    try:
        with db() as con:
            # ── Kollisionskontroll ──
            # Logik:
            #   2h     → blockeras av: exakt samma tidslucka, eller heldag/helg samma dag
            #   heldag → blockeras av: annan heldag/helg eller befintliga 2h-bokningar
            #   helg   → blockeras av: heldag/helg eller 2h-bokningar lör eller sön

            if booking_type == "2h":
                # Exakt samma tidslucka (samma start-datetime)
                slot_conflict = con.execute(
                    "SELECT COUNT(*) as cnt FROM bookings WHERE status='approved' AND start=?",
                    (start,),
                ).fetchone()["cnt"]
                # Heldag/helg som täcker detta datum
                fullday_conflict = con.execute(
                    """
                    SELECT COUNT(*) as cnt FROM bookings
                    WHERE status='approved'
                    AND booking_type IN ('heldag', 'helg')
                    AND (start = ? OR (start <= ? AND end > ?))
                    """,
                    (date_str, date_str, date_str),
                ).fetchone()["cnt"]
                conflicts = slot_conflict + fullday_conflict

            elif booking_type == "heldag":
                # Alla befintliga bokningar på detta datum (2h, heldag eller helg)
                conflicts = con.execute(
                    """
                    SELECT COUNT(*) as cnt FROM bookings
                    WHERE status='approved'
                    AND (start = ? OR start LIKE ? OR (start <= ? AND end > ?))
                    """,
                    (date_str, f"{date_str}T%", date_str, date_str),
                ).fetchone()["cnt"]

            else:  # helg: kolla lördag + söndag
                day1 = date_str
                day2 = (chosen_date + timedelta(days=1)).isoformat()
                conflicts = con.execute(
                    """
                    SELECT COUNT(*) as cnt FROM bookings
                    WHERE status='approved'
                    AND (
                        start = ? OR start = ?
                        OR start LIKE ? OR start LIKE ?
                        OR (start <= ? AND end > ?)
                        OR (start <= ? AND end > ?)
                    )
                    """,
                    (day1, day2, f"{day1}T%", f"{day2}T%", day1, day1, day2, day2),
                ).fetchone()["cnt"]

            if conflicts > 0:
                return jsonify({"ok": False, "error": "Datumet/tiden är redan bokat"}), 409

            con.execute(
                """
                INSERT INTO bookings
                (status, title, start, end, name, email, phone, booking_type, message, created_at)
                VALUES
                ('approved', ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                """,
                (title, start, end, name, email, phone, booking_type, utc_now_iso()),
            )
            con.commit()

        return jsonify({"ok": True, "message": "Bokning bekräftad!"})
    except Exception:
        return jsonify({"ok": False, "error": "Kunde inte spara bokning"}), 500


# =========================
# API: Kontakt (sparas i DB)
# =========================

@app.post("/api/contact")
def api_contact():
    """
    VARFÖR: Kontaktformuläret ska inte kräva e-postserver — meddelanden sparas direkt i DB.
    VAD: Tar emot namn, e-post och meddelande och sparar i messages-tabellen.
    HUR: Validerar att alla fält är ifyllda, sparar med tidsstämpel, returnerar JSON.
    """
    data    = request.get_json(silent=True) or {}
    name    = (data.get("name")    or "").strip()
    email   = (data.get("email")   or "").strip()
    message = (data.get("message") or "").strip()

    if not name or not email or not message:
        return jsonify({"ok": False, "error": "Alla fält måste fyllas i"}), 400

    try:
        with db() as con:
            con.execute(
                "INSERT INTO messages (name, email, message, created_at) VALUES (?, ?, ?, ?)",
                (name, email, message, utc_now_iso()),
            )
            con.commit()

        return jsonify({"ok": True, "message": "Tack! Ditt meddelande har skickats."})
    except Exception:
        return jsonify({"ok": False, "error": "Kunde inte spara meddelande"}), 500


# =========================
# API: Medlemsanmälan (publik)
# =========================

@app.post("/api/members")
def api_members():
    """
    VARFÖR: Besökare ska kunna anmäla intresse för medlemskap via webbsidan.
    VAD: Sparar namn, e-post och telefon i members-tabellen.
    HUR: Validerar att namn och e-post finns, sparar med tidsstämpel, returnerar JSON.
         Ingen e-post skickas — admin läser anmälningarna i adminpanelen.
         GDPR: Uppgifterna lagras lokalt i SQLite och admin kan radera dem.
    """
    data  = request.get_json(silent=True) or {}
    name  = (data.get("name")  or "").strip()
    email = (data.get("email") or "").strip()
    phone = (data.get("phone") or "").strip() or None

    if not name or not email:
        return jsonify({"ok": False, "error": "Namn och e-post krävs"}), 400

    try:
        with db() as con:
            # Generera ett unikt medlemsnummer: YY + löpande nummer inom året
            # Exempel: första medlemmen 2026 → "2601", andra → "2602"
            year_short = datetime.now().strftime("%y")  # "26" för år 2026
            count = con.execute(
                "SELECT COUNT(*) FROM members WHERE member_number LIKE ?",
                (f"{year_short}%",),
            ).fetchone()[0]
            member_number = f"{year_short}{count + 1:02d}"

            con.execute(
                "INSERT INTO members (member_number, name, email, phone, created_at) VALUES (?, ?, ?, ?, ?)",
                (member_number, name, email, phone, utc_now_iso()),
            )
            con.commit()
        return jsonify({
            "ok": True,
            "member_number": member_number,
            "message": f"Tack för att du gör skillnad! Du är nu registrerad som medlem. Ditt medlemsnummer är {member_number}.",
        })
    except Exception:
        return jsonify({"ok": False, "error": "Kunde inte spara anmälan"}), 500


# =========================
# API: Events (publik)
# =========================

@app.get("/api/events")
def api_get_events():
    """
    VARFÖR: event.html behöver hämta årets event dynamiskt från databasen.
    VAD: Returnerar alla event sorterade på datum (närmast datum först).
    HUR: Hämtar alla rader från events-tabellen, inkluderar image_path om det finns.
    """
    try:
        with db() as con:
            rows = con.execute(
                "SELECT id, title, date, description, image_path FROM events ORDER BY date ASC, id ASC"
            ).fetchall()

        items = []
        for r in rows:
            items.append({
                "id":          r["id"],
                "title":       r["title"],
                "date":        r["date"],
                "description": r["description"],
                # image_path är relativ projektroten, t.ex. "data/images/events/1/bild.jpg"
                # Vi returnerar den direkt — Flask serverar den via static_files-routern
                "image_path":  r["image_path"],
            })

        return jsonify({"ok": True, "events": items})
    except Exception:
        return jsonify({"ok": False, "error": "Kunde inte hämta event"}), 500


# =========================
# API: Galleri (publik)
# =========================

@app.get("/api/gallery")
def api_get_gallery():
    """
    VARFÖR: galleri.html behöver en lista på alla uppladdade bilder.
    VAD: Returnerar alla bildfiler i gallery-mappen som en JSON-lista med URL-sökvägar.
    HUR: Skannar GALLERY_DIR med os.listdir och filtrerar på tillåtna ändelser.
         URL-sökvägen byggs som "/data/images/gallery/<filnamn>" och serveras av Flask.
    """
    try:
        ensure_db()  # säkerställer att GALLERY_DIR finns
        files = []
        if GALLERY_DIR.exists():
            for f in sorted(GALLERY_DIR.iterdir()):
                if f.is_file() and f.suffix.lower().lstrip(".") in ALLOWED_EXTENSIONS:
                    files.append({
                        "filename": f.name,
                        "url": f"/data/images/gallery/{f.name}",
                    })
        return jsonify({"ok": True, "images": files})
    except Exception:
        return jsonify({"ok": False, "error": "Kunde inte hämta galleri"}), 500


# =========================
# API: Admin — Bokningar
# =========================

@app.get("/api/admin/messages")
def api_admin_messages():
    """
    VARFÖR: Admin behöver läsa kontaktmeddelanden som skickats via formuläret.
    VAD: Returnerar alla meddelanden, nyaste först.
    HUR: Kräver admin-session, hämtar från messages-tabellen.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    with db() as con:
        rows = con.execute(
            "SELECT id, name, email, message, created_at FROM messages ORDER BY created_at DESC"
        ).fetchall()

    return jsonify({"ok": True, "items": [dict(r) for r in rows]})


@app.get("/api/admin/bookings")
def api_admin_list():
    """
    VARFÖR: Adminpanelen visar alla bokningar oavsett status.
    VAD: Returnerar samtliga bokningsrader med alla fält.
    HUR: Kräver admin-session, sorterar nyaste först.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    with db() as con:
        rows = con.execute(
            """
            SELECT id, status, title, start, end, name, email, phone, booking_type, message, created_at
            FROM bookings
            ORDER BY created_at DESC
            """
        ).fetchall()

    return jsonify({"ok": True, "items": [dict(r) for r in rows]})


@app.post("/api/admin/add")
def api_admin_add():
    """
    VARFÖR: Admin ska kunna lägga till bokningar manuellt (t.ex. externa event).
    VAD: Skapar en ny bokning med status 'approved' direkt.
    HUR: Tar emot titel, start och slut (valfritt), kräver admin-session.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data  = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    start = (data.get("start") or "").strip()
    end   = (data.get("end")   or "").strip() or None

    if not title or not start:
        return jsonify({"ok": False, "error": "Titel och start krävs"}), 400

    with db() as con:
        con.execute(
            """
            INSERT INTO bookings
            (status, title, start, end, name, email, phone, booking_type, message, created_at)
            VALUES
            ('approved', ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)
            """,
            (title, start, end, utc_now_iso()),
        )
        con.commit()

    return jsonify({"ok": True})


@app.delete("/api/admin/bookings/<int:booking_id>")
def api_admin_delete_booking(booking_id: int):
    """
    VARFÖR: Admin ska kunna ta bort bokningar permanent (t.ex. felaktiga eller gamla).
    VAD: Raderar en bokning ur databasen.
    HUR: Kräver admin-session. Returnerar 404 om bokningen inte hittas.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    with db() as con:
        result = con.execute("DELETE FROM bookings WHERE id=?", (booking_id,))
        con.commit()
        if result.rowcount == 0:
            return jsonify({"ok": False, "error": "Bokning hittades inte"}), 404

    return jsonify({"ok": True})


@app.delete("/api/admin/messages/<int:message_id>")
def api_admin_delete_message(message_id: int):
    """
    VARFÖR: Admin ska kunna rensa kontaktmeddelanden (t.ex. hanterade ärenden).
    VAD: Raderar ett meddelande ur messages-tabellen.
    HUR: Kräver admin-session. Returnerar 404 om meddelandet inte hittas.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    with db() as con:
        result = con.execute("DELETE FROM messages WHERE id=?", (message_id,))
        con.commit()
        if result.rowcount == 0:
            return jsonify({"ok": False, "error": "Meddelande hittades inte"}), 404

    return jsonify({"ok": True})


@app.get("/api/admin/members")
def api_admin_members():
    """
    VARFÖR: Admin behöver se inkomna medlemsanmälningar.
    VAD: Returnerar alla anmälningar, nyaste först.
    HUR: Kräver admin-session. Hämtar från members-tabellen.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    with db() as con:
        rows = con.execute(
            "SELECT id, member_number, name, email, phone, created_at FROM members ORDER BY created_at DESC"
        ).fetchall()

    return jsonify({"ok": True, "items": [dict(r) for r in rows]})


@app.delete("/api/admin/members/<int:member_id>")
def api_admin_delete_member(member_id: int):
    """
    VARFÖR: Admin ska kunna radera medlemsanmälningar (GDPR-rätt att bli glömd).
    VAD: Raderar en anmälan permanent ur members-tabellen.
    HUR: Kräver admin-session. Returnerar 404 om posten inte hittas.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    with db() as con:
        result = con.execute("DELETE FROM members WHERE id=?", (member_id,))
        con.commit()
        if result.rowcount == 0:
            return jsonify({"ok": False, "error": "Anmälan hittades inte"}), 404

    return jsonify({"ok": True})


@app.post("/api/admin/set-status")
def api_admin_set_status():
    """
    VARFÖR: Admin behöver kunna ändra status på bokningar (t.ex. godkänna eller neka).
    VAD: Uppdaterar status-fältet på en specifik bokning.
    HUR: Tar emot {id, status} i JSON, validerar status-värdet, uppdaterar i DB.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data       = request.get_json(silent=True) or {}
    booking_id = int(data.get("id") or 0)
    status     = (data.get("status") or "").strip()

    if booking_id <= 0 or status not in ("approved", "pending", "denied"):
        return jsonify({"ok": False, "error": "Ogiltig data"}), 400

    with db() as con:
        con.execute("UPDATE bookings SET status=? WHERE id=?", (status, booking_id))
        con.commit()

    return jsonify({"ok": True})


# =========================
# API: Admin — Events
# =========================

@app.post("/api/admin/events")
def api_admin_create_event():
    """
    VARFÖR: Admin ska kunna skapa nya event som visas på event-sidan.
    VAD: Sparar ett nytt event med titel, datum och beskrivning i databasen.
    HUR: Tar emot JSON, validerar att titel finns, infogar i events-tabellen.
         Bild laddas upp separat via POST /api/admin/events/<id>/image.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data        = request.get_json(silent=True) or {}
    title       = (data.get("title")       or "").strip()
    date        = (data.get("date")        or "").strip() or None
    description = (data.get("description") or "").strip() or None

    if not title:
        return jsonify({"ok": False, "error": "Titel krävs"}), 400

    with db() as con:
        cur = con.execute(
            "INSERT INTO events (title, date, description, image_path, created_at) VALUES (?, ?, ?, NULL, ?)",
            (title, date, description, utc_now_iso()),
        )
        con.commit()
        event_id = cur.lastrowid

    return jsonify({"ok": True, "id": event_id})


@app.put("/api/admin/events/<int:event_id>")
def api_admin_update_event(event_id: int):
    """
    VARFÖR: Admin ska kunna redigera befintliga event (ändra titel, datum, beskrivning).
    VAD: Uppdaterar ett events textfält i databasen.
    HUR: Tar emot JSON med de fält som ska ändras, kör UPDATE på rätt rad via event_id.
         Bild hanteras separat via POST /api/admin/events/<id>/image.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data        = request.get_json(silent=True) or {}
    title       = (data.get("title")       or "").strip()
    date        = (data.get("date")        or "").strip() or None
    description = (data.get("description") or "").strip() or None

    if not title:
        return jsonify({"ok": False, "error": "Titel krävs"}), 400

    with db() as con:
        con.execute(
            "UPDATE events SET title=?, date=?, description=? WHERE id=?",
            (title, date, description, event_id),
        )
        con.commit()

    return jsonify({"ok": True})


@app.delete("/api/admin/events/<int:event_id>")
def api_admin_delete_event(event_id: int):
    """
    VARFÖR: Admin ska kunna ta bort gamla event.
    VAD: Tar bort eventet ur databasen och raderar eventuell bild från filsystemet.
    HUR: Hämtar image_path från DB, tar bort bildfilen om den finns, sedan DELETE på raden.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    with db() as con:
        row = con.execute("SELECT image_path FROM events WHERE id=?", (event_id,)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "Event hittades inte"}), 404

        # Ta bort bildfil om den finns
        if row["image_path"]:
            img_file = PROJECT_ROOT / row["image_path"]
            if img_file.is_file():
                img_file.unlink()

        con.execute("DELETE FROM events WHERE id=?", (event_id,))
        con.commit()

    return jsonify({"ok": True})


@app.post("/api/admin/events/<int:event_id>/image")
def api_admin_event_image(event_id: int):
    """
    VARFÖR: Varje event kan ha en bild som visas på event-sidan.
    VAD: Tar emot en bild-fil (multipart/form-data) och sparar den på servern.
         Uppdaterar events.image_path i databasen med sökvägen till filen.
    HUR:
      - Filen sparas i data/images/events/<event_id>/<säkertfilnamn>
      - Eventuell gammal bild tas bort
      - image_path sparas relativt projektroten (t.ex. "data/images/events/3/foto.jpg")
        så att Flask kan serva den via /<path:filename>-routern
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    if "image" not in request.files:
        return jsonify({"ok": False, "error": "Ingen fil skickades"}), 400

    file = request.files["image"]
    if not file.filename or not allowed_file(file.filename):
        return jsonify({"ok": False, "error": "Otillåten filtyp"}), 400

    # Kontrollera att eventet finns
    with db() as con:
        row = con.execute("SELECT image_path FROM events WHERE id=?", (event_id,)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "Event hittades inte"}), 404

        # Ta bort gammal bild om det finns en
        if row["image_path"]:
            old_file = PROJECT_ROOT / row["image_path"]
            if old_file.is_file():
                old_file.unlink()

        # Spara ny bild i events/<event_id>/
        event_dir = EVENTS_IMG / str(event_id)
        event_dir.mkdir(parents=True, exist_ok=True)

        filename  = secure_filename(file.filename)
        save_path = event_dir / filename
        file.save(save_path)

        # Sökväg relativt projektroten — används som URL-stig
        rel_path = save_path.relative_to(PROJECT_ROOT).as_posix()

        con.execute("UPDATE events SET image_path=? WHERE id=?", (rel_path, event_id))
        con.commit()

    return jsonify({"ok": True, "image_path": rel_path})


# =========================
# API: Admin — Galleri
# =========================

@app.post("/api/admin/gallery")
def api_admin_gallery_upload():
    """
    VARFÖR: Admin ska kunna ladda upp foton till ett bildgalleri på hemsidan.
    VAD: Tar emot en bild-fil (multipart/form-data) och sparar den i gallery-mappen.
    HUR:
      - Filen sparas i data/images/gallery/<säkertfilnamn>
      - Om ett filnamn redan finns läggs ett suffix till för att undvika kollision
      - Returnerar filnamnet och URL:en för den sparade bilden
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    if "image" not in request.files:
        return jsonify({"ok": False, "error": "Ingen fil skickades"}), 400

    file = request.files["image"]
    if not file.filename or not allowed_file(file.filename):
        return jsonify({"ok": False, "error": "Otillåten filtyp"}), 400

    ensure_db()  # säkerställer att GALLERY_DIR finns

    filename  = secure_filename(file.filename)
    save_path = GALLERY_DIR / filename

    # Undvik kollision: lägg till _1, _2 osv. om filnamnet redan finns
    if save_path.exists():
        stem = save_path.stem
        suffix = save_path.suffix
        counter = 1
        while save_path.exists():
            save_path = GALLERY_DIR / f"{stem}_{counter}{suffix}"
            counter += 1
        filename = save_path.name

    file.save(save_path)

    return jsonify({
        "ok":       True,
        "filename": filename,
        "url":      f"/data/images/gallery/{filename}",
    })


@app.delete("/api/admin/gallery/<filename>")
def api_admin_gallery_delete(filename: str):
    """
    VARFÖR: Admin ska kunna ta bort bilder från galleriet.
    VAD: Raderar en specifik bildfil från gallery-mappen på servern.
    HUR:
      - secure_filename används för att förhindra path traversal-attacker
        (t.ex. att någon försöker radera "../../../etc/passwd")
      - Returnerar 404 om filen inte finns
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    safe_name = secure_filename(filename)
    file_path = GALLERY_DIR / safe_name

    if not file_path.is_file():
        return jsonify({"ok": False, "error": "Filen hittades inte"}), 404

    file_path.unlink()
    return jsonify({"ok": True})


# =========================
# API: Sidinnehåll (publik)
# =========================

@app.get("/api/page-sections/<page_name>")
def api_get_page_sections(page_name: str):
    """
    VARFÖR: Information-sidan (och eventuellt andra sidor) behöver ladda innehåll dynamiskt.
    VAD: Returnerar alla sektioner för en specifik sida, sorterade efter display_order.
    HUR: Hämtar från page_sections-tabellen där page = page_name.
    """
    try:
        with db() as con:
            rows = con.execute(
                "SELECT id, title, content FROM page_sections WHERE page=? ORDER BY display_order ASC, id ASC",
                (page_name,),
            ).fetchall()
        return jsonify({"ok": True, "sections": [dict(r) for r in rows]})
    except Exception:
        return jsonify({"ok": False, "error": "Kunde inte hämta sidinnehåll"}), 500


# =========================
# API: Styrelsen (publik)
# =========================

@app.get("/api/board")
def api_get_board():
    """
    VARFÖR: Styrelsen-sidan behöver lista alla roller och kontaktpersoner.
    VAD: Returnerar alla styrelsemedlemmar sorterade efter display_order.
    HUR: Hämtar från board_members-tabellen, ordnade så admin kan bestämma ordning.
    """
    try:
        with db() as con:
            rows = con.execute(
                "SELECT id, role, name, contact, image_path FROM board_members ORDER BY display_order ASC, id ASC"
            ).fetchall()
        return jsonify({"ok": True, "members": [dict(r) for r in rows]})
    except Exception:
        return jsonify({"ok": False, "error": "Kunde inte hämta styrelsen"}), 500


# =========================
# API: Admin — Styrelsen
# =========================

@app.post("/api/admin/board")
def api_admin_create_board_member():
    """
    VARFÖR: Admin ska kunna lägga till nya styrelseroller (t.ex. Suppliant).
    VAD: Skapar en ny styrelsemedlem med roll, namn och kontaktinfo.
    HUR: Tar emot JSON, sätter display_order till max+1 för att hamna sist.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data    = request.get_json(silent=True) or {}
    role    = (data.get("role")    or "").strip()
    name    = (data.get("name")    or "").strip()
    contact = (data.get("contact") or "").strip() or None

    if not role or not name:
        return jsonify({"ok": False, "error": "Roll och namn krävs"}), 400

    with db() as con:
        # Hitta högsta display_order och sätt nya medlemmen sist
        max_order = con.execute("SELECT COALESCE(MAX(display_order), 0) FROM board_members").fetchone()[0]
        con.execute(
            "INSERT INTO board_members (role, name, contact, display_order, created_at) VALUES (?, ?, ?, ?, ?)",
            (role, name, contact, max_order + 1, utc_now_iso()),
        )
        con.commit()

    return jsonify({"ok": True})


@app.put("/api/admin/board/<int:board_id>")
def api_admin_update_board_member(board_id: int):
    """
    VARFÖR: Admin ska kunna redigera befintliga styrelsemedlemmar (byta namn/kontakt).
    VAD: Uppdaterar en styrelsemedlems uppgifter.
    HUR: PUT med JSON-kropp, uppdaterar DB-raden via board_id.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data    = request.get_json(silent=True) or {}
    role    = (data.get("role")    or "").strip()
    name    = (data.get("name")    or "").strip()
    contact = (data.get("contact") or "").strip() or None

    if not role or not name:
        return jsonify({"ok": False, "error": "Roll och namn krävs"}), 400

    with db() as con:
        con.execute(
            "UPDATE board_members SET role=?, name=?, contact=? WHERE id=?",
            (role, name, contact, board_id),
        )
        con.commit()

    return jsonify({"ok": True})


@app.delete("/api/admin/board/<int:board_id>")
def api_admin_delete_board_member(board_id: int):
    """
    VARFÖR: Admin ska kunna ta bort en styrelseroll (t.ex. när någon slutar).
    VAD: Raderar en styrelsemedlem permanent och tar bort eventuell bild.
    HUR: DELETE-request, tar bort raden från board_members.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    with db() as con:
        # Hämta image_path för att kunna radera bilden
        row = con.execute("SELECT image_path FROM board_members WHERE id=?", (board_id,)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "Styrelsemedlem hittades inte"}), 404

        # Ta bort bildfil om den finns
        if row["image_path"]:
            img_file = PROJECT_ROOT / row["image_path"]
            if img_file.is_file():
                img_file.unlink()

        result = con.execute("DELETE FROM board_members WHERE id=?", (board_id,))
        con.commit()

    return jsonify({"ok": True})


@app.post("/api/admin/board/<int:board_id>/image")
def api_admin_board_image(board_id: int):
    """
    VARFÖR: Styrelsemedlemmar kan ha profilbilder (t.ex. porträtt).
    VAD: Tar emot en bild-fil (multipart/form-data) och sparar den på servern.
         Uppdaterar board_members.image_path i databasen.
    HUR:
      - Filen sparas i data/images/board/<board_id>/<säkertfilnamn>
      - Eventuell gammal bild tas bort
      - image_path sparas relativt projektroten
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    if "image" not in request.files:
        return jsonify({"ok": False, "error": "Ingen fil skickades"}), 400

    file = request.files["image"]
    if not file.filename or not allowed_file(file.filename):
        return jsonify({"ok": False, "error": "Otillåten filtyp"}), 400

    # Kontrollera att styrelsemedlemmen finns
    with db() as con:
        row = con.execute("SELECT image_path FROM board_members WHERE id=?", (board_id,)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "Styrelsemedlem hittades inte"}), 404

        # Ta bort gammal bild om det finns en
        if row["image_path"]:
            old_file = PROJECT_ROOT / row["image_path"]
            if old_file.is_file():
                old_file.unlink()

        # Spara ny bild i board/<board_id>/
        board_dir = IMAGES_DIR / "board" / str(board_id)
        board_dir.mkdir(parents=True, exist_ok=True)

        filename  = secure_filename(file.filename)
        save_path = board_dir / filename
        file.save(save_path)

        # Sökväg relativt projektroten
        rel_path = save_path.relative_to(PROJECT_ROOT).as_posix()

        con.execute("UPDATE board_members SET image_path=? WHERE id=?", (rel_path, board_id))
        con.commit()

    return jsonify({"ok": True, "image_path": rel_path})


# =========================
# API: Sponsorer (publik)
# =========================

@app.get("/api/sponsors")
def api_get_sponsors():
    """
    VARFÖR: Sponsorer-sidan behöver lista alla sponsorer som stödjer bygdegården.
    VAD: Returnerar alla sponsorer sorterade efter display_order.
    HUR: Hämtar från sponsors-tabellen med namn, beskrivning, URL och logotyp.
    """
    try:
        with db() as con:
            rows = con.execute(
                "SELECT id, name, description, url, image_path FROM sponsors ORDER BY display_order ASC, id ASC"
            ).fetchall()
        return jsonify({"ok": True, "sponsors": [dict(r) for r in rows]})
    except Exception:
        return jsonify({"ok": False, "error": "Kunde inte hämta sponsorer"}), 500


# =========================
# API: Admin — Sponsorer
# =========================

@app.post("/api/admin/sponsors")
def api_admin_create_sponsor():
    """
    VARFÖR: Admin ska kunna lägga till nya sponsorer.
    VAD: Skapar en ny sponsor med namn, beskrivning och URL.
    HUR: Tar emot JSON, sätter display_order till max+1 för att hamna sist.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data        = request.get_json(silent=True) or {}
    name        = (data.get("name")        or "").strip()
    description = (data.get("description") or "").strip() or None
    url         = (data.get("url")         or "").strip() or None

    if not name:
        return jsonify({"ok": False, "error": "Namn krävs"}), 400

    with db() as con:
        # Hitta högsta display_order och sätt nya sponsorn sist
        max_order = con.execute("SELECT COALESCE(MAX(display_order), 0) FROM sponsors").fetchone()[0]
        con.execute(
            "INSERT INTO sponsors (name, description, url, display_order, created_at) VALUES (?, ?, ?, ?, ?)",
            (name, description, url, max_order + 1, utc_now_iso()),
        )
        con.commit()

    return jsonify({"ok": True})


@app.put("/api/admin/sponsors/<int:sponsor_id>")
def api_admin_update_sponsor(sponsor_id: int):
    """
    VARFÖR: Admin ska kunna redigera befintliga sponsorer.
    VAD: Uppdaterar en sponsors uppgifter.
    HUR: PUT med JSON-kropp, uppdaterar DB-raden via sponsor_id.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data        = request.get_json(silent=True) or {}
    name        = (data.get("name")        or "").strip()
    description = (data.get("description") or "").strip() or None
    url         = (data.get("url")         or "").strip() or None

    if not name:
        return jsonify({"ok": False, "error": "Namn krävs"}), 400

    with db() as con:
        con.execute(
            "UPDATE sponsors SET name=?, description=?, url=? WHERE id=?",
            (name, description, url, sponsor_id),
        )
        con.commit()

    return jsonify({"ok": True})


@app.delete("/api/admin/sponsors/<int:sponsor_id>")
def api_admin_delete_sponsor(sponsor_id: int):
    """
    VARFÖR: Admin ska kunna ta bort sponsorer.
    VAD: Raderar en sponsor permanent och tar bort eventuell logotyp.
    HUR: DELETE-request, tar bort raden från sponsors.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    with db() as con:
        # Hämta image_path för att kunna radera logotypen
        row = con.execute("SELECT image_path FROM sponsors WHERE id=?", (sponsor_id,)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "Sponsor hittades inte"}), 404

        # Ta bort logotyp om den finns
        if row["image_path"]:
            img_file = PROJECT_ROOT / row["image_path"]
            if img_file.is_file():
                img_file.unlink()

        result = con.execute("DELETE FROM sponsors WHERE id=?", (sponsor_id,))
        con.commit()

    return jsonify({"ok": True})


@app.post("/api/admin/sponsors/<int:sponsor_id>/image")
def api_admin_sponsor_image(sponsor_id: int):
    """
    VARFÖR: Sponsorer kan ha logotyper.
    VAD: Tar emot en bild-fil (multipart/form-data) och sparar den på servern.
         Uppdaterar sponsors.image_path i databasen.
    HUR:
      - Filen sparas i data/images/sponsors/<sponsor_id>/<säkertfilnamn>
      - Eventuell gammal bild tas bort
      - image_path sparas relativt projektroten
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    if "image" not in request.files:
        return jsonify({"ok": False, "error": "Ingen fil skickades"}), 400

    file = request.files["image"]
    if not file.filename or not allowed_file(file.filename):
        return jsonify({"ok": False, "error": "Otillåten filtyp"}), 400

    # Kontrollera att sponsorn finns
    with db() as con:
        row = con.execute("SELECT image_path FROM sponsors WHERE id=?", (sponsor_id,)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "Sponsor hittades inte"}), 404

        # Ta bort gammal bild om det finns en
        if row["image_path"]:
            old_file = PROJECT_ROOT / row["image_path"]
            if old_file.is_file():
                old_file.unlink()

        # Spara ny bild i sponsors/<sponsor_id>/
        sponsor_dir = IMAGES_DIR / "sponsors" / str(sponsor_id)
        sponsor_dir.mkdir(parents=True, exist_ok=True)

        filename  = secure_filename(file.filename)
        save_path = sponsor_dir / filename
        file.save(save_path)

        # Sökväg relativt projektroten
        rel_path = save_path.relative_to(PROJECT_ROOT).as_posix()

        con.execute("UPDATE sponsors SET image_path=? WHERE id=?", (rel_path, sponsor_id))
        con.commit()

    return jsonify({"ok": True, "image_path": rel_path})


# =========================
# API: Admin — Sidinnehåll
# =========================

@app.post("/api/admin/page-sections")
def api_admin_create_page_section():
    """
    VARFÖR: Admin ska kunna lägga till nya sektioner på information-sidan.
    VAD: Skapar en ny sektion med titel och innehåll.
    HUR: Tar emot JSON med page, title, content. Sätter display_order till max+1.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data    = request.get_json(silent=True) or {}
    page    = (data.get("page")    or "").strip()
    title   = (data.get("title")   or "").strip()
    content = (data.get("content") or "").strip()

    if not page or not title or not content:
        return jsonify({"ok": False, "error": "Sida, titel och innehåll krävs"}), 400

    with db() as con:
        # Hitta högsta display_order för denna sida och sätt nya sektionen sist
        max_order = con.execute(
            "SELECT COALESCE(MAX(display_order), 0) FROM page_sections WHERE page=?",
            (page,),
        ).fetchone()[0]
        con.execute(
            "INSERT INTO page_sections (page, title, content, display_order, created_at) VALUES (?, ?, ?, ?, ?)",
            (page, title, content, max_order + 1, utc_now_iso()),
        )
        con.commit()

    return jsonify({"ok": True})


@app.put("/api/admin/page-sections/<int:section_id>")
def api_admin_update_page_section(section_id: int):
    """
    VARFÖR: Admin ska kunna redigera befintliga sektioner.
    VAD: Uppdaterar en sektions titel och innehåll.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data    = request.get_json(silent=True) or {}
    title   = (data.get("title")   or "").strip()
    content = (data.get("content") or "").strip()

    if not title or not content:
        return jsonify({"ok": False, "error": "Titel och innehåll krävs"}), 400

    with db() as con:
        con.execute(
            "UPDATE page_sections SET title=?, content=? WHERE id=?",
            (title, content, section_id),
        )
        con.commit()

    return jsonify({"ok": True})


@app.delete("/api/admin/page-sections/<int:section_id>")
def api_admin_delete_page_section(section_id: int):
    """
    VARFÖR: Admin ska kunna ta bort sektioner.
    VAD: Raderar en sektion permanent.
    """
    if not is_admin():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    with db() as con:
        result = con.execute("DELETE FROM page_sections WHERE id=?", (section_id,))
        con.commit()
        if result.rowcount == 0:
            return jsonify({"ok": False, "error": "Sektion hittades inte"}), 404

    return jsonify({"ok": True})


# =========================
# Statiska filer (sist i filen)
# =========================

@app.get("/")
def home():
    """Serverar startsidan (index.html) från projektroten."""
    return send_from_directory("..", "index.html")


@app.get("/<path:filename>")
def static_files(filename: str):
    """
    VARFÖR: HTML-sidorna importerar CSS, JS och bilder med relativa sökvägar.
    VAD: Serverar alla statiska filer från projektroten, inklusive uppladdade bilder.
    HUR: Flask letar efter filen under PROJECT_ROOT (..) och returnerar den direkt.
         Uppladdade bilder (t.ex. data/images/gallery/foto.jpg) serveras automatiskt
         eftersom de ligger inuti projektroten.
    """
    return send_from_directory("..", filename)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True)
