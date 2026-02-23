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
  await loadPartial("#header", "assets/js/partials/header.html");
  await loadPartial("#footer", "assets/js/partials/footer.html");

  setActiveNavLink();

  // Mobilmeny
  document.addEventListener("click", (e) => {
    if (e.target && e.target.matches(".menu-toggle")) {
      document.querySelector("nav")?.classList.toggle("open");
    }
  });

  // Footer-år
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  // Kontaktformulär (AJAX)
  const contactForm = document.getElementById("contactForm");
  if (contactForm) {
    const contactMsg = document.getElementById("contactMsg");
    contactForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      contactMsg.textContent = "";
      contactMsg.style.color = "";

      const payload = {
        name: contactForm.name.value.trim(),
        email: contactForm.email.value.trim(),
        message: contactForm.message.value.trim(),
      };

      try {
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (data.ok) {
          contactMsg.style.color = "var(--accent)";
          contactMsg.textContent = data.message || "Tack! Meddelandet har skickats.";
          contactForm.reset();
        } else {
          contactMsg.style.color = "#f87171";
          contactMsg.textContent = data.error || "Något gick fel.";
        }
      } catch {
        contactMsg.style.color = "#f87171";
        contactMsg.textContent = "Kunde inte skicka meddelandet. Försök igen.";
      }
    });
  }
});
