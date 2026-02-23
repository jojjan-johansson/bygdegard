// =============================================================================
// calendar.js — Bokningskalender (boka.html)
//
// VARFÖR FINNS DEN HÄR?
//   Boka-sidan har en interaktiv FullCalendar-kalender där besökare kan boka
//   direkt utan att skicka en förfrågan som måste godkännas.
//
// VAD GÖR DEN?
//   - Renderar FullCalendar med befintliga bokningar från /api/bookings
//   - Klick på datum öppnar en bokningsmodal
//   - 2h-bokningar har tidsluckor (09-11, 12-14, 15-17, 18-20), flera per dag
//   - Heldag/helg blockerar hela dagen och kan inte bokas om 2h-bokningar finns
//   - Skickar bokningsdata till POST /api/book och uppdaterar kalendern
//
// HUR FUNGERAR DEN?
//   currentEvents cachelar laddade bokningar så att kollisionskollen kan ske
//   i webbläsaren utan extra API-anrop. Servern gör en slutgiltig kontroll.
// =============================================================================

// Tillgängliga tidsluckor för 2h-bokningar
// Nyckel = starttid som skickas till API, värde = label som visas för användaren
const TIME_SLOTS = {
  "09:00": "09:00 – 11:00",
  "12:00": "12:00 – 14:00",
  "15:00": "15:00 – 17:00",
  "18:00": "18:00 – 20:00",
};

document.addEventListener("DOMContentLoaded", () => {
  const calendarEl   = document.getElementById("calendar");
  const modal        = document.getElementById("bookingModal");
  const modalClose   = document.getElementById("modalClose");
  const modalTitle   = document.getElementById("modalTitle");
  const modalDate    = document.getElementById("modalDate");
  const modalOccupied = document.getElementById("modalOccupied");
  const bookingForm  = document.getElementById("bookingForm");
  const bookType     = document.getElementById("bookType");
  const bookSlot     = document.getElementById("bookSlot");
  const timeSlotRow  = document.getElementById("timeSlotRow");
  const bookMsg      = document.getElementById("bookMsg");

  let selectedDate  = "";
  let currentEvents = [];  // cachelade bokningar från senaste API-anrop


  // ─────────────────────────────
  // FullCalendar-initiering
  // ─────────────────────────────

  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView:   "dayGridMonth",
    locale:        "sv",
    firstDay:      1,         // måndag som veckans första dag
    height:        "auto",
    headerToolbar: {
      left:   "prev,next today",
      center: "title",
      right:  "dayGridMonth,listMonth",
    },

    // Hämtar bokningar från API varje gång kalendern byter vy eller uppdateras
    events: async (info, success, failure) => {
      try {
        const res  = await fetch("/api/bookings");
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Kunde inte hämta bokningar");
        currentEvents = data.events;
        success(data.events);
      } catch (e) {
        failure(e);
      }
    },

    // Klick på ett datum öppnar bokningsmodalen
    dateClick: (info) => {
      selectedDate = info.dateStr;
      openModal(selectedDate);
    },
  });

  calendar.render();


  // ─────────────────────────────
  // Kollisionskoll (klientsidan)
  // ─────────────────────────────

  /**
   * VARFÖR: Heldag/helg-bokningar ska blockera hela dagen och kan inte bokas
   *         om det redan finns en fulldag/helg-bokning för samma datum.
   * VAD: Returnerar true om ett heldag- eller helg-event täcker det givna datumet.
   * HUR: Kontrollerar exakt datumsträng-match (heldag) och datumintervall (helg).
   */
  function isFullDayOccupied(dateStr) {
    return currentEvents.some(ev => {
      if (ev.booking_type !== "heldag" && ev.booking_type !== "helg") return false;
      const start = ev.start.substring(0, 10);
      const end   = ev.end   ? ev.end.substring(0, 10) : start;
      if (start === dateStr) return true;
      if (ev.end && dateStr >= start && dateStr < end) return true;
      return false;
    });
  }

  /**
   * VARFÖR: Flera 2h-bokningar per dag är tillåtna — men samma tidslucka kan bara bokas en gång.
   * VAD: Returnerar en Set med starttider (t.ex. {"09:00", "15:00"}) som redan är bokade
   *      som 2h-bokningar på det givna datumet.
   * HUR: Filtrerar currentEvents på booking_type="2h" och samma datum som start, extraherar HH:MM.
   */
  function takenSlots(dateStr) {
    const taken = new Set();
    for (const ev of currentEvents) {
      if (ev.booking_type !== "2h") continue;
      const evDate = ev.start.substring(0, 10);
      if (evDate !== dateStr) continue;
      // start är i formatet "2026-03-15T09:00:00" — ta ut HH:MM
      const time = ev.start.length > 10 ? ev.start.substring(11, 16) : null;
      if (time) taken.add(time);
    }
    return taken;
  }

  /**
   * VARFÖR: Om det redan finns 2h-bokningar på ett datum kan man inte boka heldag/helg.
   * VAD: Returnerar true om det finns minst en 2h-bokning på det givna datumet.
   */
  function has2hBookings(dateStr) {
    return currentEvents.some(ev => {
      if (ev.booking_type !== "2h") return false;
      return ev.start.substring(0, 10) === dateStr;
    });
  }


  // ─────────────────────────────
  // Modal
  // ─────────────────────────────

  /**
   * VARFÖR: Bokningsmodalen måste reflektera tillgängligheten för det valda datumet.
   * VAD: Öppnar modalen, uppdaterar tidsluckor och visar/döljer formuläret beroende
   *      på om datumet är fullt bokat.
   * HUR:
   *   - Fyller i rubrik och datum
   *   - Om heldag/helg täcker datumet: visa "redan bokat"-meddelande
   *   - Annars: fyll tidslucke-väljaren med lediga/bokade alternativ
   */
  function openModal(dateStr) {
    const fullDayBlocked = isFullDayOccupied(dateStr);
    const taken          = takenSlots(dateStr);
    const allSlotsTaken  = Object.keys(TIME_SLOTS).every(s => taken.has(s));

    modalTitle.textContent = "Boka " + dateStr;
    modalDate.textContent  = new Date(dateStr + "T00:00:00").toLocaleDateString("sv-SE", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    bookMsg.textContent = "";

    if (fullDayBlocked || allSlotsTaken) {
      // Hela dagen är fullbokad
      modalOccupied.style.display = "";
      bookingForm.style.display   = "none";
    } else {
      modalOccupied.style.display = "none";
      bookingForm.style.display   = "";
      updateSlotPicker(taken, dateStr);
    }

    modal.style.display = "flex";
  }

  /**
   * VARFÖR: Tidslucke-väljaren ska visa vilka tider som är lediga och bokade.
   * VAD: Uppdaterar <select id="bookSlot"> med alternativ, där bokade luckor
   *      visas som inaktiverade med "(bokad)" i etiketten.
   * HUR: Itererar TIME_SLOTS, skapar <option>-element och sätter disabled om
   *      starttiden finns i taken-setet. Väljer första lediga alternativ automatiskt.
   */
  function updateSlotPicker(taken, dateStr) {
    // Visa/dölj tidslucke-raden beroende på bokningstyp
    toggleSlotRow();

    // Fyll alla alternativ med ledigt/bokat-status
    bookSlot.innerHTML = Object.entries(TIME_SLOTS).map(([value, label]) => {
      const isTaken = taken.has(value);
      return `<option value="${value}" ${isTaken ? 'disabled' : ''}>${label}${isTaken ? " (bokad)" : ""}</option>`;
    }).join("");

    // Välj automatiskt första lediga alternativ
    const firstFree = Object.keys(TIME_SLOTS).find(s => !taken.has(s));
    if (firstFree) bookSlot.value = firstFree;
  }

  /**
   * VARFÖR: Tidslucke-väljaren är bara relevant för 2h-bokningar.
   * VAD: Visar eller döljer #timeSlotRow beroende på valt bokningstyp.
   */
  function toggleSlotRow() {
    timeSlotRow.style.display = bookType.value === "2h" ? "" : "none";
  }

  // Uppdatera slot-rad när bokningstypen ändras
  bookType.addEventListener("change", () => {
    toggleSlotRow();

    // Om heldag/helg väljs och det finns 2h-bokningar: visa varning
    if (bookType.value !== "2h" && has2hBookings(selectedDate)) {
      bookMsg.style.color   = "#f87171";
      bookMsg.textContent   = "Obs: Det finns 2h-bokningar detta datum. Heldag/helg kan inte bokas.";
    } else {
      bookMsg.textContent = "";
    }
  });

  function closeModal() {
    modal.style.display = "none";
    bookingForm.reset();
    bookMsg.textContent = "";
    toggleSlotRow();  // återställ slot-rad till korrekt state
  }

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });


  // ─────────────────────────────
  // Bokning — skicka till API
  // ─────────────────────────────

  /**
   * VARFÖR: Formuläret ska skicka bokningsdata till servern utan sidladdning.
   * VAD: Samlar formulärdata, skickar POST till /api/book, visar svar i modalen.
   *      Vid lyckad bokning: uppdatera kalendern och stäng modalen efter 1,5s.
   * HUR:
   *   - time_slot skickas med bara för 2h-bokningar
   *   - Servern gör den slutgiltiga kollisionskontrollen (klienten visar bara tidig feedback)
   */
  bookingForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    bookMsg.textContent = "";
    bookMsg.style.color = "";

    const booking_type = bookType.value;
    const payload = {
      name:         document.getElementById("bookName").value.trim(),
      email:        document.getElementById("bookEmail").value.trim(),
      phone:        document.getElementById("bookPhone").value.trim(),
      date:         selectedDate,
      booking_type,
    };

    // Skicka med vald tidslucka för 2h-bokningar
    if (booking_type === "2h") {
      payload.time_slot = bookSlot.value;
    }

    // Klientsidan: varna om heldag/helg bokas men 2h-bokningar finns
    if (booking_type !== "2h" && has2hBookings(selectedDate)) {
      bookMsg.style.color = "#f87171";
      bookMsg.textContent = "Datumet har befintliga 2h-bokningar. Kontakta admin.";
      return;
    }

    try {
      const res  = await fetch("/api/book", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.ok) {
        bookMsg.style.color = "var(--accent)";
        bookMsg.textContent = data.message || "Bokning bekräftad!";
        calendar.refetchEvents();
        setTimeout(closeModal, 1500);
      } else {
        bookMsg.style.color = "#f87171";
        bookMsg.textContent = data.error || "Något gick fel.";
      }
    } catch {
      bookMsg.style.color = "#f87171";
      bookMsg.textContent = "Kunde inte ansluta till servern.";
    }
  });
});
