document.addEventListener("DOMContentLoaded", () => {
  const keyInput = document.getElementById("key");

  const addForm = document.getElementById("addForm");
  const addMsg = document.getElementById("addMsg");
  const listEl = document.getElementById("list");

  function adminHeaders() {
    return {
      "Content-Type": "application/json",
      "X-Admin-Key": keyInput.value.trim()
    };
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function loadList() {
    listEl.textContent = "Laddar…";

    try {
      const res = await fetch("/api/admin/bookings", { headers: adminHeaders() });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte ladda");

      if (data.items.length === 0) {
        listEl.innerHTML = "<p>Inga bokningar än.</p>";
        return;
      }

      listEl.innerHTML = data.items.map(item => {
        const meta = [
          `<strong>Status:</strong> ${escapeHtml(item.status)}`,
          `<strong>Datum:</strong> ${escapeHtml(item.start)}${item.end ? " → " + escapeHtml(item.end) : ""}`,
          item.name ? `<strong>Namn:</strong> ${escapeHtml(item.name)}` : "",
          item.email ? `<strong>E-post:</strong> ${escapeHtml(item.email)}` : "",
          item.phone ? `<strong>Telefon:</strong> ${escapeHtml(item.phone)}` : "",
          item.booking_type ? `<strong>Typ:</strong> ${escapeHtml(item.booking_type)}` : "",
          item.message ? `<strong>Meddelande:</strong> ${escapeHtml(item.message)}` : ""
        ].filter(Boolean).join("<br>");

        return `
          <div style="padding:1rem; border:1px solid rgba(255,255,255,.12); border-radius:12px; margin:.75rem 0;">
            <div style="font-weight:700;">${escapeHtml(item.title)} (ID: ${item.id})</div>
            <div style="margin-top:.35rem;">${meta}</div>

            <div style="margin-top:.75rem; display:flex; gap:.5rem; flex-wrap:wrap;">
              <button class="btn" data-action="approved" data-id="${item.id}">Godkänn</button>
              <button class="btn" data-action="pending" data-id="${item.id}">Sätt pending</button>
              <button class="btn" data-action="denied" data-id="${item.id}">Avslå</button>
            </div>
          </div>
        `;
      }).join("");

    } catch (e) {
      listEl.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
    }
  }

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    addMsg.textContent = "";

    try {
      const payload = {
        title: addForm.title.value.trim(),
        start: addForm.start.value,
        end: addForm.end.value
      };

      const res = await fetch("/api/admin/add", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte lägga till");

      addMsg.textContent = "Bokning tillagd!";
      addForm.reset();
      await loadList();
    } catch (err) {
      addMsg.textContent = err.message;
    }
  });

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    try {
      const id = Number(btn.getAttribute("data-id"));
      const status = btn.getAttribute("data-action");

      const res = await fetch("/api/admin/set-status", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ id, status })
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte uppdatera");

      await loadList();
    } catch (err) {
      alert(err.message);
    }
  });

  // Ladda först när du skrivit nyckel
  keyInput.addEventListener("input", () => {
    if (keyInput.value.trim().length >= 4) loadList();
  });

  // Första läget
  listEl.innerHTML = "<p>Skriv in admin-nyckeln ovan för att ladda bokningar.</p>";
});
