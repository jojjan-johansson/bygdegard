document.addEventListener("DOMContentLoaded", () => {
  const calendarEl = document.getElementById("calendar");
  const dateInput = document.getElementById("date");

  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    locale: "sv",
    firstDay: 1,
    height: "auto",
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,listMonth"
    },
    events: async (info, success, failure) => {
      try {
        const res = await fetch("/api/bookings");
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Kunde inte hämta bokningar");
        success(data.events);
      } catch (e) {
        failure(e);
      }
    },
    dateClick: (info) => {
      if (dateInput) {
        dateInput.value = info.dateStr; // YYYY-MM-DD
        dateInput.focus();
      }
    }
  });

  calendar.render();
});
