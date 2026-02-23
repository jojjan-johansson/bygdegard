// =============================================================================
// gallery.js — Hanterar gallerisidan (galleri.html)
//
// VARFÖR FINNS DEN HÄR?
//   Galleriet hämtas dynamiskt från servern så att admin kan ladda upp/ta bort
//   bilder utan att redigera HTML.
//
// VAD GÖR DEN?
//   Hämtar bilder från GET /api/gallery och renderar dem i ett masonry-grid.
//   Klick på en bild öppnar en lightbox (förstoring). Visar laddnings- och tomt-state.
//
// HUR FUNGERAR DEN?
//   1. DOMContentLoaded → hämta /api/gallery
//   2. Rendera bilder (renderGallery) i ett CSS-columns masonry-grid
//   3. Klick på bild → öppna lightbox, klick på X eller utanför → stäng
// =============================================================================


/**
 * VARFÖR: Lightbox-stängning används från fleraställen (klick på ×, klick utanför, Escape).
 * VAD: Döljer lightbox-overlayern och rensar src (frigör minnesreferens).
 * HUR: Sätter display:none och tömmer img-src.
 */
function closeLightbox() {
  const lb  = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  lb.style.display  = "none";
  img.src           = "";
}


/**
 * VARFÖR: Användaren ska kunna klicka på en bild för att se den i fullstorlek.
 * VAD: Visar lightbox-overlayern med den klickade bilden.
 * HUR: Sätter img-src till bildens URL och visar overlayern med display:flex.
 */
function openLightbox(url) {
  const lb  = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  img.src           = url;
  lb.style.display  = "flex";
}


/**
 * VARFÖR: Galleriet ska visas som ett masonry-liknande grid (oregelbundna höjder).
 * VAD: Bygger HTML för varje bild och sätter innerHTML i #galleryGrid.
 *      Hanterar tomt-state och döljer skeleton-loadern.
 * HUR: Bilderna infogas i en CSS-columns-container (.gallery-masonry).
 *      Varje bild-wrapper har click-handler för att öppna lightbox.
 *      loading="lazy" används för att inte ladda alla bilder på en gång.
 */
function renderGallery(images) {
  const loading = document.getElementById("galleryLoading");
  const empty   = document.getElementById("galleryEmpty");
  const grid    = document.getElementById("galleryGrid");

  loading.style.display = "none";

  if (!images || images.length === 0) {
    empty.style.display = "block";
    return;
  }

  grid.innerHTML = images.map(img => `
    <div class="gallery-item" data-url="${img.url}" role="button" tabindex="0" aria-label="Förstora bild">
      <img src="${img.url}" alt="Galleribild" loading="lazy" />
      <div class="gallery-overlay">
        <span class="gallery-zoom-icon">⤢</span>
      </div>
    </div>
  `).join("");

  // Lägg till klick-lyssnare på varje bild-wrapper
  // Vi gör detta efter att innerHTML satts för att slippa globalt event delegation
  grid.querySelectorAll(".gallery-item").forEach(item => {
    item.addEventListener("click", () => openLightbox(item.dataset.url));
    // Tillgänglighet: tangentbord-Enter och Space fungerar som klick
    item.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openLightbox(item.dataset.url);
      }
    });
  });
}


/**
 * VARFÖR: Sidan behöver hämta galleribilder och sätta upp lightbox-lyssnare när den laddas.
 * VAD: Triggas när DOM är redo. Hämtar /api/gallery, renderar grid och kopplar lightbox-stängning.
 * HUR: Async fetch med try/catch. Lightbox stängs via knapp, klick utanför bilden eller Escape.
 */
document.addEventListener("DOMContentLoaded", async () => {
  // Hämta och rendera galleribilder
  try {
    const res  = await fetch("/api/gallery");
    const data = await res.json();

    if (data.ok) {
      renderGallery(data.images);
    } else {
      throw new Error(data.error);
    }
  } catch {
    const loading = document.getElementById("galleryLoading");
    loading.innerHTML = `<p class="muted">Kunde inte ladda galleriet. Försök ladda om sidan.</p>`;
  }

  // Lightbox-stängning via ×-knappen
  document.getElementById("lightboxClose").addEventListener("click", closeLightbox);

  // Lightbox-stängning via klick på bakgrunden (men inte på bilden)
  document.getElementById("lightbox").addEventListener("click", e => {
    if (e.target === document.getElementById("lightbox")) {
      closeLightbox();
    }
  });

  // Lightbox-stängning via Escape-tangenten
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeLightbox();
  });
});
