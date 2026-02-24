// =============================================================================
// sponsorer.js — Hanterar sponsorer-sidan (sponsorer.html)
//
// VARFÖR FINNS DEN HÄR?
//   Sponsorerna lagras i databasen så admin kan uppdatera dem dynamiskt.
//
// VAD GÖR DEN?
//   Hämtar sponsorer från GET /api/sponsors och renderar dem med logotyper.
//
// HUR FUNGERAR DEN?
//   DOMContentLoaded → fetch → rendera kort med logotyper.
// =============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  const loading = document.getElementById("sponsorsLoading");
  const empty   = document.getElementById("sponsorsEmpty");
  const grid    = document.getElementById("sponsorsGrid");

  try {
    const res  = await fetch("/api/sponsors");
    const data = await res.json();

    loading.style.display = "none";

    if (!data.ok) throw new Error(data.error || "Kunde inte hämta sponsorer");

    if (!data.sponsors || data.sponsors.length === 0) {
      empty.style.display = "block";
      return;
    }

    // Rendera varje sponsor som ett kort med logotyp
    grid.innerHTML = data.sponsors.map(sponsor => `
      <article class="card sponsor-card">
        ${sponsor.image_path
          ? `<img src="/${escapeHtml(sponsor.image_path)}" alt="${escapeHtml(sponsor.name)}" class="sponsor-logo" />`
          : `<div class="sponsor-logo-placeholder"></div>`
        }
        <h2>${escapeHtml(sponsor.name)}</h2>
        ${sponsor.description ? `<p class="muted">${escapeHtml(sponsor.description)}</p>` : ''}
        ${sponsor.url ? `<a href="${escapeHtml(sponsor.url)}" target="_blank" rel="noopener" class="btn">Besök webbplats</a>` : ''}
      </article>
    `).join("");

  } catch (err) {
    loading.innerHTML = `<p class="muted">Kunde inte ladda sponsorer. Försök ladda om sidan.</p>`;
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
