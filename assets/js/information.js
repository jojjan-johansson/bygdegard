// =============================================================================
// information.js — Hanterar information-sidan (information.html)
//
// VARFÖR FINNS DEN HÄR?
//   Informationsinnehållet lagras i databasen så admin kan uppdatera det
//   utan att redigera HTML-filen.
//
// VAD GÖR DEN?
//   Hämtar sektioner från GET /api/page-sections/information och renderar dem.
//
// HUR FUNGERAR DEN?
//   DOMContentLoaded → fetch → rendera kort eller tomt-state.
// =============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  const loading = document.getElementById("infoLoading");
  const empty   = document.getElementById("infoEmpty");
  const grid    = document.getElementById("infoGrid");

  try {
    const res  = await fetch("/api/page-sections/information");
    const data = await res.json();

    loading.style.display = "none";

    if (!data.ok) throw new Error(data.error || "Kunde inte hämta information");

    if (!data.sections || data.sections.length === 0) {
      empty.style.display = "block";
      return;
    }

    // Rendera varje sektion som ett kort
    // Innehållet renderas som HTML (admin ansvarar för innehållet)
    grid.innerHTML = data.sections.map(section => `
      <article class="card">
        <h2>${escapeHtml(section.title)}</h2>
        <div class="info-content">${section.content}</div>
      </article>
    `).join("");

  } catch (err) {
    loading.innerHTML = `<p class="muted">Kunde inte ladda information. Försök ladda om sidan.</p>`;
  }
});

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
