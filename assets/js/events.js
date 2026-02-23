// =============================================================================
// events.js — Hanterar event-sidan (event.html)
//
// VARFÖR FINNS DEN HÄR?
//   Event lagras i databasen och ska visas dynamiskt — inte som statisk HTML.
//   Det gör att admin kan lägga till/redigera event utan att redigera kod.
//
// VAD GÖR DEN?
//   Hämtar event från GET /api/events och renderar dem som kort i #eventsGrid.
//   Visar skelettkort under laddning och ett tomt-state om inga event finns.
//
// HUR FUNGERAR DEN?
//   1. DOMContentLoaded → hämta /api/events
//   2. Rendera kort (renderEvents) eller visa tomt-state
//   3. Dölj skeleton-loader när klart
// =============================================================================


/**
 * VARFÖR: Datum från API:et är i formatet "2026-03-15" (ISO 8601).
 *         Det ska visas som "15 mars 2026" på svenska.
 * VAD: Omvandlar en datumstränger till ett läsbart svenskt format.
 * HUR: Använder Intl.DateTimeFormat med locale 'sv-SE'.
 *      Lägger till T00:00:00 för att undvika tidszonsförskjutning vid parsing.
 */
function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("sv-SE", {
    day:   "numeric",
    month: "long",
    year:  "numeric",
  });
}


/**
 * VARFÖR: Varje event kan ha en bild. Om ingen bild finns ska det ändå se snyggt ut.
 * VAD: Returnerar antingen en <img>-tagg eller en gradient-placeholder.
 * HUR: Om image_path finns används det som src (Flask serverar sökvägar från projektroten).
 *      Annars renderas en div med en bakgrundsgradient som placeholder.
 */
function eventImageHtml(event) {
  if (event.image_path) {
    // image_path är relativ projektroten, t.ex. "data/images/events/3/foto.jpg"
    // Flask serverar den under /<path> via static_files-routern
    return `<img class="event-img" src="/${event.image_path}" alt="${event.title}" loading="lazy" />`;
  }
  // Gradient-placeholder när ingen bild finns — varieras på event-id för lite mångfald
  const gradients = [
    "linear-gradient(135deg, rgba(110,231,183,.25), rgba(147,197,253,.15))",
    "linear-gradient(135deg, rgba(147,197,253,.25), rgba(251,191,36,.10))",
    "linear-gradient(135deg, rgba(251,191,36,.15), rgba(110,231,183,.20))",
  ];
  const gradient = gradients[(event.id - 1) % gradients.length];
  return `<div class="event-img event-img-placeholder" style="background:${gradient}"></div>`;
}


/**
 * VARFÖR: Alla event ska visas som kort i ett grid.
 * VAD: Bygger HTML för varje event och infogar i #eventsGrid.
 *      Hanterar också tomt-state och döljer skeleton-loadern.
 * HUR: Mappar event-listan till HTML-strängar med mal-literals och sätter innerHTML.
 */
function renderEvents(events) {
  const loading = document.getElementById("eventsLoading");
  const empty   = document.getElementById("eventsEmpty");
  const grid    = document.getElementById("eventsGrid");

  // Dölj skeleton-loader nu när vi har data
  loading.style.display = "none";

  if (!events || events.length === 0) {
    empty.style.display = "block";
    return;
  }

  grid.innerHTML = events.map(e => `
    <article class="card event-card">
      ${eventImageHtml(e)}
      <div class="event-body">
        ${e.date ? `<p class="event-date">${formatDate(e.date)}</p>` : ""}
        <h2 class="event-title">${e.title}</h2>
        ${e.description ? `<p class="event-desc">${e.description}</p>` : ""}
      </div>
    </article>
  `).join("");
}


/**
 * VARFÖR: Sidan behöver hämta event när den laddas.
 * VAD: Triggas när DOM är redo. Hämtar /api/events och anropar renderEvents.
 * HUR: Async fetch med try/catch — om det misslyckas visas ett felmeddelande
 *      i skeleton-loadern istället för att krascha tyst.
 */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const res  = await fetch("/api/events");
    const data = await res.json();

    if (data.ok) {
      renderEvents(data.events);
    } else {
      throw new Error(data.error);
    }
  } catch {
    const loading = document.getElementById("eventsLoading");
    loading.innerHTML = `<p class="muted">Kunde inte ladda event. Försök ladda om sidan.</p>`;
  }
});
