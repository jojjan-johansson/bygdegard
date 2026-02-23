// =============================================================================
// member.js — Hanterar intresseanmälan för medlemskap (член.html)
//
// VARFÖR FINNS DEN HÄR?
//   Anmälningsformuläret ska skickas utan sidladdning och spara data i databasen.
//   Ingen e-post skickas — admin läser anmälningarna i adminpanelen.
//
// VAD GÖR DEN?
//   Lyssnar på submit-event på #memberForm, skickar POST till /api/members
//   och visar bekräftelse eller felmeddelande i #memberMsg.
//
// HUR FUNGERAR DEN?
//   fetch POST med JSON-kropp. Vid lyckat svar: töm formuläret och visa
//   grön bekräftelsetext. Vid fel: visa röd feltext.
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("memberForm");
  if (!form) return;  // defensiv koll — skript laddas bara på член.html

  const msg = document.getElementById("memberMsg");

  /**
   * VARFÖR: Formuläret ska skickas asynkront utan att sidan laddas om.
   * VAD: Fångar submit-eventet, skickar formulärdata till POST /api/members,
   *      visar bekräftelse eller fel utan sidnavigering.
   * HUR: Skapar ett JSON-objekt från fältvärdena, POST via fetch.
   *      Återställer formuläret vid lyckat svar.
   */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";
    msg.style.color = "";

    const payload = {
      name:  form.querySelector('[name="name"]').value.trim(),
      email: form.querySelector('[name="email"]').value.trim(),
      phone: form.querySelector('[name="phone"]').value.trim() || null,
    };

    try {
      const res  = await fetch("/api/members", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.ok) {
        msg.style.color = "var(--accent)";
        // Servern skickar meddelandet inkl. medlemsnummer, t.ex.:
        // "Tack för att du gör skillnad! Du är nu registrerad som medlem. Ditt medlemsnummer är 2601."
        msg.textContent = data.message;
        form.reset();
      } else {
        msg.style.color = "#f87171";
        msg.textContent = data.error || "Något gick fel. Försök igen.";
      }
    } catch {
      msg.style.color = "#f87171";
      msg.textContent = "Kunde inte skicka anmälan. Kontrollera din uppkoppling.";
    }
  });
});
