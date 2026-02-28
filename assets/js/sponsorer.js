// =============================================================================
// sponsorer.js — Hanterar sponsorer-sidan (sponsorer.html)
//
// VARFÖR FINNS DEN HÄR?
//   Sponsorerna lagras i databasen och ska visas dynamiskt — admin kan
//   lägga till, redigera och ta bort sponsorer utan att röra kod.
//
// VAD GÖR DEN?
//   Hämtar sponsorer från GET /api/sponsors och renderar dem som kort
//   identiska i struktur med event-korten (bild i topp, info nedan).
//
// HUR FUNGERAR DEN?
//   DOMContentLoaded → fetch /api/sponsors → renderSponsors()
//   Visar skelettkort under laddning och ett tomt-state om inga sponsors finns.
// =============================================================================


/**
 * VARFÖR: Förhindrar XSS — aldrig stoppa in ohanterade strängar direkt i innerHTML.
 * VAD: Escapar HTML-specialtecken i en sträng.
 * HUR: Ersätter &, <, >, " och ' med deras HTML-entiteter.
 */
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/**
 * VARFÖR: Varje sponsor kan ha en logotyp. Utan bild ska kortet ändå se bra ut.
 * VAD: Returnerar antingen en <img>-tagg eller en gradient-placeholder,
 *      inbäddad i ett wrapper-element med fast höjd.
 * HUR: Om image_path finns används det som src.
 *      Annars visas en gradient-div som placeholder.
 */
function sponsorImageHtml(sponsor) {
  const inner = sponsor.image_path
    ? `<img class="sponsor-logo" src="/${escapeHtml(sponsor.image_path)}"
            alt="${escapeHtml(sponsor.name)}" loading="lazy" />`
    : `<div class="sponsor-logo-placeholder"></div>`;

  return `<div class="sponsor-img-wrap">${inner}</div>`;
}


/**
 * VARFÖR: Alla sponsorer ska visas som kort i ett grid.
 * VAD: Bygger HTML för varje sponsor och infogar i #sponsorsGrid.
 *      Hanterar tomt-state och döljer skeleton-loadern.
 * HUR: Mappar sponsor-listan till HTML-strängar och sätter innerHTML.
 */
function renderSponsors(sponsors) {
  const loading = document.getElementById("sponsorsLoading");
  const empty   = document.getElementById("sponsorsEmpty");
  const grid    = document.getElementById("sponsorsGrid");

  loading.style.display = "none";

  if (!sponsors || sponsors.length === 0) {
    empty.style.display = "block";
    return;
  }

  grid.innerHTML = sponsors.map(s => `
    <article class="card sponsor-card">
      ${sponsorImageHtml(s)}
      <div class="sponsor-body">
        <h2>${escapeHtml(s.name)}</h2>
        ${s.description ? `<p class="muted small">${escapeHtml(s.description)}</p>` : ""}
        ${s.url
          ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="btn">
               Besök webbplats
             </a>`
          : ""}
      </div>
    </article>
  `).join("");
}


/**
 * VARFÖR: Sidan behöver hämta sponsorer när den laddas.
 * VAD: Triggas när DOM är redo. Hämtar /api/sponsors och anropar renderSponsors.
 * HUR: Async fetch med try/catch — fel visas i skeleton-elementet.
 */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const res  = await fetch("/api/sponsors");
    const data = await res.json();

    if (!data.ok) throw new Error(data.error || "Kunde inte hämta sponsorer");
    renderSponsors(data.sponsors);
  } catch {
    const loading = document.getElementById("sponsorsLoading");
    loading.innerHTML = `<p class="muted">Kunde inte ladda sponsorer. Försök ladda om sidan.</p>`;
  }
});
