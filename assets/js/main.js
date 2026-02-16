async function loadPartial(selector, file) {
  const el = document.querySelector(selector);
  if (!el) return;

  const res = await fetch(file);
  if (!res.ok) {
    el.innerHTML = `<div style="padding:1rem">Kunde inte ladda ${file} (${res.status}).</div>`;
    return;
  }
  el.innerHTML = await res.text();
}

function setActiveNavLink() {
  const current = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll("nav a").forEach(a => {
    const href = (a.getAttribute("href") || "").toLowerCase();
    if (href === current) a.classList.add("active");
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  // Dina partials ligger här:
  await loadPartial("#header", "assets/js/partials/header.html");
  await loadPartial("#footer", "assets/js/partials/footer.html");

  setActiveNavLink();

  // Mobilmeny (efter header laddats)
  document.addEventListener("click", (e) => {
    if (e.target && e.target.matches(".menu-toggle")) {
      document.querySelector("nav")?.classList.toggle("open");
    }
  });

  // Footer-år
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  // Formulär:
  // - Om action="#" eller tomt: lokalt test (stoppa och visa alert)
  // - Annars: låt formuläret skickas till servern på riktigt
  document.querySelectorAll("form").forEach(form => {
    form.addEventListener("submit", (e) => {
      const action = (form.getAttribute("action") || "").trim();
      if (action === "" || action === "#") {
        e.preventDefault();
        alert("Tack! (lokalt test) När servern är igång skickas formuläret till e-post.");
        form.reset();
      }
    });
  });
});
