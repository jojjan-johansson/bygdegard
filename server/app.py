from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone

from flask import Flask, request, send_from_directory, jsonify


# =========================
# App + paths
# =========================
app = Flask(__name__, static_folder="..", static_url_path="")

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
DB_PATH = os.path.join(DATA_DIR, "bookings.sqlite")

# Enkel "admin-nyckel" (byt gärna)
ADMIN_KEY = "byt-den-har-nyckeln"


# =========================
# DB helpers
# =========================
def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_db() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with sqlite3.connect(DB_PATH) as con:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                status TEXT NOT NULL,         -- 'approved' | 'pending' | 'denied'
                title TEXT NOT NULL,
                start TEXT NOT NULL,          -- 'YYYY-MM-DD' eller ISO datetime
                end TEXT,                     -- valfritt
                name TEXT,
                email TEXT,
                phone TEXT,
                booking_type TEXT,
                message TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        con.commit()


def db() -> sqlite3.Connection:
    ensure_db()
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def is_admin(req: request) -> bool:
    # Admin skickar nyckeln i headern X-Admin-Key (enklast)
    return req.headers.get("X-Admin-Key", "") == ADMIN_KEY


# =========================
# API: Bookings
# =========================
@app.get("/api/bookings")
def api_get_bookings():
    """
    Publik endpoint till kalendern:
    Returnerar endast godkända bokningar.
    """
    try:
        with db() as con:
            rows = con.execute(
                "SELECT id, title, start, end FROM bookings WHERE status='approved' ORDER BY start ASC"
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
            events.append(item)

        return jsonify({"ok": True, "events": events})
    except Exception:
        return jsonify({"ok": False, "error": "Kunde inte hämta bokningar"}), 500


@app.post("/api/booking")
def api_booking():
    """
    Bokningsförfrågan (publik).
    Sparas som 'pending' och syns inte i publika kalendern förrän du godkänner i admin.
    """
    name = request.form.get("name", "").strip()
    email = request.form.get("email", "").strip()
    phone = request.form.get("phone", "").strip()
    date = request.form.get("date", "").strip()  # YYYY-MM-DD
    booking_type = request.form.get("type", "").strip()
    message = request.form.get("message", "").strip()

    if not name or not email or not date:
        return """
        <html lang="sv"><head><meta charset="utf-8"><title>Fel</title></head>
        <body style="font-family:system-ui;padding:2rem">
          <h1>Oj!</h1>
          <p>Du måste fylla i namn, e-post och datum.</p>
          <p><a href="/boka.html">Tillbaka</a></p>
        </body></html>
        """, 400

    try:
        with db() as con:
            con.execute(
                """
                INSERT INTO bookings
                (status, title, start, end, name, email, phone, booking_type, message, created_at)
                VALUES
                ('pending', ?, ?, NULL, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"Förfrågan: {date}",
                    date,
                    name,
                    email,
                    phone,
                    booking_type,
                    message,
                    utc_now_iso(),
                ),
            )
            con.commit()

        print("\n--- NY BOKNINGSFÖRFRÅGAN (SPARAD SOM PENDING) ---")
        print(f"Namn: {name}")
        print(f"E-post: {email}")
        print(f"Telefon: {phone}")
        print(f"Datum: {date}")
        print(f"Typ: {booking_type}")
        print("Meddelande:")
        print(message)
        print("--- SLUT ---\n")

        return """
        <html lang="sv"><head><meta charset="utf-8"><title>Tack!</title></head>
        <body style="font-family:system-ui;padding:2rem">
          <h1>Tack!</h1>
          <p>Bokningsförfrågan är mottagen. Vi bekräftar via e-post.</p>
          <p><a href="/boka.html">Tillbaka</a></p>
        </body></html>
        """
    except Exception:
        return """
        <html lang="sv"><head><meta charset="utf-8"><title>Fel</title></head>
        <body style="font-family:system-ui;padding:2rem">
          <h1>Oj!</h1>
          <p>Något gick fel när vi skulle spara förfrågan.</p>
          <p><a href="/boka.html">Tillbaka</a></p>
        </body></html>
        """, 500


@app.get("/api/admin/bookings")
def api_admin_list():
    if not is_admin(request):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    with db() as con:
        rows = con.execute(
            """
            SELECT id, status, title, start, end, name, email, phone, booking_type, message, created_at
            FROM bookings
            ORDER BY created_at DESC
            """
        ).fetchall()

    items = [dict(r) for r in rows]
    return jsonify({"ok": True, "items": items})


@app.post("/api/admin/add")
def api_admin_add():
    if not is_admin(request):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    start = (data.get("start") or "").strip()
    end = (data.get("end") or "").strip() or None

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


@app.post("/api/admin/set-status")
def api_admin_set_status():
    if not is_admin(request):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    booking_id = int(data.get("id") or 0)
    status = (data.get("status") or "").strip()

    if booking_id <= 0 or status not in ("approved", "pending", "denied"):
        return jsonify({"ok": False, "error": "Ogiltig data"}), 400

    with db() as con:
        con.execute("UPDATE bookings SET status=? WHERE id=?", (status, booking_id))
        con.commit()

    return jsonify({"ok": True})


@app.post("/api/contact")
def api_contact():
    name = request.form.get("name", "").strip()
    email = request.form.get("email", "").strip()
    message = request.form.get("message", "").strip()

    print("\n--- NYT KONTAKTMEDDELANDE ---")
    print(f"Namn: {name}")
    print(f"E-post: {email}")
    print("Meddelande:")
    print(message)
    print("--- SLUT ---\n")

    return """
    <html lang="sv"><head><meta charset="utf-8"><title>Tack!</title></head>
    <body style="font-family:system-ui;padding:2rem">
      <h1>Tack!</h1>
      <p>Ditt meddelande är mottaget. Vi återkommer så snart vi kan.</p>
      <p><a href="/kontakt.html">Tillbaka</a></p>
    </body></html>
    """


# =========================
# Static files (lägg sist)
# =========================
@app.get("/")
def home():
    return send_from_directory("..", "index.html")


@app.get("/<path:filename>")
def static_files(filename: str):
    return send_from_directory("..", filename)


if __name__ == "__main__":
    # Viktigt: debug=True är ok lokalt
    app.run(host="127.0.0.1", port=8000, debug=True)
