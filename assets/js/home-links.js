// =============================================================================
// home-links.js — Hanterar länk-sektionen på startsidan (index.html)
//
// VARFÖR FINNS DEN HÄR?
//   Admin ska kunna lägga till externa länkar (Facebook, Instagram m.m.)
//   direkt via adminpanelen utan att redigera kod. Länkarna lagras i
//   page_sections-tabellen med page='startsida-lankar'.
//
// VAD GÖR DEN?
//   Hämtar länkar från GET /api/page-sections/startsida-lankar och
//   renderar dem som klickbara pill-knappar i #homeLinksGrid.
//   Om inga länkar finns visas sektionen inte alls.
//
// HUR FUNGERAR DEN?
//   DOMContentLoaded → fetch → om träff: visa sektionen och rendera pills.
//   Sektionen är dold (display:none) och visas bara om det finns länkar.
// =============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  const section = document.getElementById("homeLinksSection");
  const grid    = document.getElementById("homeLinksGrid");
  if (!section || !grid) return;

  try {
    const res  = await fetch("/api/page-sections/startsida-lankar");
    const data = await res.json();

    if (!data.ok || !data.sections || data.sections.length === 0) return;

    // Visa sektionen och rendera en pill-knapp per länk.
    // title = visningsnamn, content = URL
    section.style.display = "";
    grid.innerHTML = data.sections.map(link => `
      <a href="${escLink(link.content)}"
         target="_blank"
         rel="noopener noreferrer"
         class="link-pill">
        ${escLink(link.title)}
      </a>
    `).join("");

  } catch {
    // Tyst fel — sektionen förblir dold om API:et inte svarar
  }
});

/**
 * VARFÖR: Förhindrar XSS när länknamn och URL:er stoppas in i HTML.
 * VAD: Escapar HTML-specialtecken i en sträng.
 * HUR: Ersätter &, <, >, " och ' med HTML-entiteter.
 */
function escLink(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
