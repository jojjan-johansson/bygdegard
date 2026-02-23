// =============================================================================
// board.js — Hanterar styrelsen-sidan (styrelsen.html)
//
// VARFÖR FINNS DEN HÄR?
//   Styrelsemedlemmar lagras i databasen så admin kan uppdatera dem utan att
//   redigera HTML-koden. Det gör det enkelt att byta roller när styrelsen ändras.
//
// VAD GÖR DEN?
//   Hämtar styrelsemedlemmar från GET /api/board och renderar dem som kort.
//   Visar skelettkort under laddning och ett tomt-state om listan är tom.
//
// HUR FUNGERAR DEN?
//   DOMContentLoaded → fetch /api/board → rendera kort eller tomt-state.
// =============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  const loading = document.getElementById("boardLoading");
  const empty   = document.getElementById("boardEmpty");
  const grid    = document.getElementById("boardGrid");

  try {
    const res  = await fetch("/api/board");
    const data = await res.json();

    loading.style.display = "none";

    if (!data.ok) throw new Error(data.error || "Kunde inte hämta styrelsen");

    if (!data.members || data.members.length === 0) {
      empty.style.display = "block";
      return;
    }

    // Rendera varje styrelsemedlem som ett kort med bild om den finns
    grid.innerHTML = data.members.map(member => `
      <article class="card board-card">
        ${member.image_path
          ? `<img src="/${escapeHtml(member.image_path)}" alt="${escapeHtml(member.name)}" class="board-photo" />`
          : `<div class="board-photo-placeholder"></div>`
        }
        <div class="board-info">
          <h2>${escapeHtml(member.role)}</h2>
          <p><strong>${escapeHtml(member.name)}</strong></p>
          ${member.contact ? `<p class="muted small">${escapeHtml(member.contact)}</p>` : ""}
        </div>
      </article>
    `).join("");

  } catch (err) {
    loading.innerHTML = `<p class="muted">Kunde inte ladda styrelsen. Försök ladda om sidan.</p>`;
  }
});

/**
 * VARFÖR: Förhindrar XSS — aldrig stoppa in ohanterade strängar i innerHTML.
 * VAD: Escapar HTML-specialtecken.
 */
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
