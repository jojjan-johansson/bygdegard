// =============================================================================
// admin.js — Adminpanelens JavaScript (admin.html)
//
// VARFÖR FINNS DEN HÄR?
//   Adminpanelen behöver hanteras helt i webbläsaren via API-anrop.
//   Ingen sidladdning vid varje åtgärd — all interaktion sker via fetch.
//
// VAD GÖR DEN?
//   - Inloggning/utloggning via session (cookies)
//   - Visa och hantera bokningar (status, manuell tillägg)
//   - Visa kontaktmeddelanden
//   - Skapa, redigera, ta bort och sätta bild på event
//   - Ladda upp och ta bort bilder i galleriet
//
// HUR FUNGERAR DEN?
//   Allting sker i en DOMContentLoaded-lyssnare.
//   showAdmin() respektive showLogin() växlar synligheten på de två sektionerna.
//   Varje datakälla har en egen load*()-funktion som renderar HTML i ett container-element.
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {

  // ─────────────────────────────
  // DOM-referenser
  // ─────────────────────────────
  const loginSection   = document.getElementById("loginSection");
  const adminPanel     = document.getElementById("adminPanel");
  const loginForm      = document.getElementById("loginForm");
  const loginMsg       = document.getElementById("loginMsg");
  const logoutBtn      = document.getElementById("logoutBtn");

  // Bokningslista (manuell tillägg)
  const addForm        = document.getElementById("addForm");
  const addMsg         = document.getElementById("addMsg");
  const listEl         = document.getElementById("list");

  // Kontaktmeddelanden
  const messagesEl     = document.getElementById("messagesList");

  // Medlemsanmälningar
  const membersEl      = document.getElementById("membersList");

  // Styrelsen
  const boardList      = document.getElementById("boardList");
  const addBoardForm   = document.getElementById("addBoardForm");
  const addBoardMsg    = document.getElementById("addBoardMsg");

  // Håller koll på vilket styrelsemedlem-id som är aktivt vid bilduppladdning
  let currentBoardImageId = null;

  // Information-sidan
  const infoList      = document.getElementById("infoList");
  const addInfoForm   = document.getElementById("addInfoForm");
  const addInfoMsg    = document.getElementById("addInfoMsg");

  // Event-hantering
  const addEventForm   = document.getElementById("addEventForm");
  const addEventMsg    = document.getElementById("addEventMsg");
  const eventsListEl   = document.getElementById("eventsList");
  const eventImageInput = document.getElementById("eventImageInput");

  // Galleri
  const galleryGrid    = document.getElementById("galleryAdminGrid");
  const galleryMsg     = document.getElementById("galleryMsg");
  const galleryFileInput = document.getElementById("galleryFileInput");
  const galleryUploadBtn = document.getElementById("galleryUploadBtn");

  // Håller koll på vilket event-id som är aktivt vid bilduppladdning
  let currentEventImageId = null;


  // ─────────────────────────────
  // Hjälpfunktioner
  // ─────────────────────────────

  /**
   * VARFÖR: Förhindrar XSS — aldrig stoppa in ohanterade strängar i innerHTML.
   * VAD: Escapar HTML-specialtecken i en sträng.
   * HUR: Ersätter &, <, >, " och ' med deras HTML-entiteter.
   */
  function esc(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /**
   * VARFÖR: Feedback-meddelanden dyker upp på flera ställen med samma beteende.
   * VAD: Sätter text + färg på ett element och nollställer det automatiskt.
   * HUR: ok=true → grön accentfärg, ok=false → röd. Timeouten rensar efter 5s.
   */
  function showMsg(el, text, ok = true) {
    el.textContent   = text;
    el.style.color   = ok ? "var(--accent)" : "#f87171";
    setTimeout(() => { el.textContent = ""; }, 5000);
  }


  // ─────────────────────────────
  // Inloggning / Utloggning
  // ─────────────────────────────

  /**
   * VARFÖR: När inloggningen lyckas ska adminpanelen visas och all data laddas.
   * VAD: Döljer login-formuläret, visar adminpanelen och triggar alla datahämtningar.
   */
  function showAdmin() {
    loginSection.style.display = "none";
    adminPanel.style.display   = "block";
    loadList();
    loadMessages();
    loadEvents();
    loadGalleryAdmin();
    loadMembers();
    loadBoard();
    loadInfo();
  }

  function showLogin() {
    loginSection.style.display = "";
    adminPanel.style.display   = "none";
  }

  /**
   * VARFÖR: Admin loggar in med lösenord — session sätts i backend.
   * VAD: Skickar lösenordet till POST /api/login, visar adminpanel om OK.
   * HUR: fetch POST med JSON-kropp. Fel visas i loginMsg-elementet.
   */
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginMsg.textContent = "";

    try {
      const res  = await fetch("/api/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password: document.getElementById("password").value }),
      });
      const data = await res.json();

      if (data.ok) {
        showAdmin();
      } else {
        showMsg(loginMsg, data.error || "Inloggning misslyckades", false);
      }
    } catch {
      showMsg(loginMsg, "Kunde inte ansluta till servern", false);
    }
  });

  /**
   * VARFÖR: Admin ska kunna logga ut och lämna sessionen.
   * VAD: Anropar POST /api/logout och återgår till login-vyn.
   */
  logoutBtn.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    showLogin();
  });

  // Kolla om en admin-session redan är aktiv (från en tidigare sidladdning)
  // Om så är fallet: visa adminpanelen direkt utan att behöva logga in igen
  fetch("/api/admin/bookings").then(res => {
    if (res.ok) showAdmin();
  });


  // ─────────────────────────────
  // Bokningslista
  // ─────────────────────────────

  /**
   * VARFÖR: Admin behöver se och hantera alla bokningar.
   * VAD: Hämtar GET /api/admin/bookings och renderar dem som kort med statusknapper.
   * HUR: Varje bokning visas med metadata och tre knappar: godkänn, pending, avslå.
   *      Event delegation används på listEl för att slippa sätta lyssnare per knapp.
   */
  async function loadList() {
    listEl.textContent = "Laddar…";

    try {
      const res  = await fetch("/api/admin/bookings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte ladda");

      if (data.items.length === 0) {
        listEl.innerHTML = "<p class='muted'>Inga bokningar än.</p>";
        return;
      }

      listEl.innerHTML = data.items.map(item => {
        const meta = [
          `<strong>Status:</strong> ${esc(item.status)}`,
          `<strong>Datum:</strong> ${esc(item.start)}${item.end ? " → " + esc(item.end) : ""}`,
          item.name         ? `<strong>Namn:</strong> ${esc(item.name)}`            : "",
          item.email        ? `<strong>E-post:</strong> ${esc(item.email)}`         : "",
          item.phone        ? `<strong>Telefon:</strong> ${esc(item.phone)}`        : "",
          item.booking_type ? `<strong>Typ:</strong> ${esc(item.booking_type)}`    : "",
          item.message      ? `<strong>Meddelande:</strong> ${esc(item.message)}`  : "",
        ].filter(Boolean).join("<br>");

        return `
          <div class="admin-booking-row">
            <div class="admin-booking-title">${esc(item.title)} <span class="muted small">#${item.id}</span></div>
            <div class="admin-booking-meta">${meta}</div>
            <div class="admin-booking-actions">
              <button class="btn" data-action="approved" data-id="${item.id}">Godkänn</button>
              <button class="btn" data-action="pending"  data-id="${item.id}">Pending</button>
              <button class="btn btn-danger" data-action="denied"  data-id="${item.id}">Avslå</button>
              <button class="btn btn-danger" data-action="delete"  data-id="${item.id}">Ta bort</button>
            </div>
          </div>
        `;
      }).join("");

    } catch (err) {
      listEl.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  // Statusknapparna använder event delegation — ett lyssnare på hela listan
  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const id     = Number(btn.getAttribute("data-id"));
    const action = btn.getAttribute("data-action");

    // "delete" är en destructiv åtgärd — kräver bekräftelse och anropar DELETE-endpoint
    if (action === "delete") {
      if (!confirm("Ta bort bokningen permanent? Detta går inte att ångra.")) return;
      try {
        const res  = await fetch(`/api/admin/bookings/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Kunde inte ta bort");
        await loadList();
      } catch (err) {
        alert(err.message);
      }
      return;
    }

    // Övriga actions (approved, pending, denied) → set-status
    try {
      const res  = await fetch("/api/admin/set-status", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id, status: action }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte uppdatera");
      await loadList();
    } catch (err) {
      alert(err.message);
    }
  });

  // Manuell tillägg av bokning
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    addMsg.textContent = "";

    try {
      const payload = {
        title: addForm.querySelector('[name="title"]').value.trim(),
        start: addForm.querySelector('[name="start"]').value,
        end:   addForm.querySelector('[name="end"]').value,
      };

      const res  = await fetch("/api/admin/add", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte lägga till");

      showMsg(addMsg, "Bokning tillagd!");
      addForm.reset();
      await loadList();
    } catch (err) {
      showMsg(addMsg, err.message, false);
    }
  });


  // ─────────────────────────────
  // Kontaktmeddelanden
  // ─────────────────────────────

  /**
   * VARFÖR: Admin behöver läsa meddelanden som skickats via kontaktformuläret.
   * VAD: Hämtar GET /api/admin/messages och renderar dem som en lista.
   */
  async function loadMessages() {
    messagesEl.textContent = "Laddar…";

    try {
      const res  = await fetch("/api/admin/messages");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte ladda");

      if (data.items.length === 0) {
        messagesEl.innerHTML = "<p class='muted'>Inga meddelanden än.</p>";
        return;
      }

      messagesEl.innerHTML = data.items.map(item => `
        <div class="admin-msg-row">
          <div class="admin-msg-header">
            <div>
              <strong>${esc(item.name)}</strong> &lt;${esc(item.email)}&gt;
              <span class="muted small"> · ${esc(item.created_at.slice(0, 16).replace("T", " "))}</span>
            </div>
            <button class="btn btn-danger btn-small" data-del-msg="${item.id}" title="Ta bort meddelande">Ta bort</button>
          </div>
          <div style="margin-top:.35rem;">${esc(item.message)}</div>
        </div>
      `).join("");

    } catch (err) {
      messagesEl.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  // Delete-knappar på meddelanden via event delegation
  messagesEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-del-msg]");
    if (!btn) return;
    if (!confirm("Ta bort meddelandet permanent?")) return;
    const id = btn.getAttribute("data-del-msg");
    try {
      const res  = await fetch(`/api/admin/messages/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte ta bort");
      await loadMessages();
    } catch (err) {
      alert(err.message);
    }
  });


  // ─────────────────────────────
  // Medlemsanmälningar
  // ─────────────────────────────

  /**
   * VARFÖR: Admin behöver se och hantera inkomna medlemsanmälningar.
   * VAD: Hämtar GET /api/admin/members och renderar dem med delete-knappar.
   * HUR: Varje anmälan visas med namn, e-post, telefon och datum.
   *      Delete-knapp finns för GDPR-radering.
   */
  async function loadMembers() {
    membersEl.innerHTML = "<p class='muted'>Laddar…</p>";

    try {
      const res  = await fetch("/api/admin/members");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte ladda");

      if (data.items.length === 0) {
        membersEl.innerHTML = "<p class='muted'>Inga anmälningar än.</p>";
        return;
      }

      membersEl.innerHTML = data.items.map(item => `
        <div class="admin-msg-row">
          <div class="admin-msg-header">
            <div>
              <span class="member-nr-badge">#${esc(item.member_number || "–")}</span>
              <strong>${esc(item.name)}</strong> &lt;${esc(item.email)}&gt;
              ${item.phone ? ` · ${esc(item.phone)}` : ""}
              <span class="muted small"> · ${esc(item.created_at.slice(0, 16).replace("T", " "))}</span>
            </div>
            <button class="btn btn-danger btn-small" data-del-member="${item.id}" title="Radera (GDPR)">Radera</button>
          </div>
        </div>
      `).join("");

    } catch (err) {
      membersEl.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  // Delete-knappar på medlemsanmälningar via event delegation
  membersEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-del-member]");
    if (!btn) return;
    if (!confirm("Radera anmälan permanent? (GDPR-radering)")) return;
    const id = btn.getAttribute("data-del-member");
    try {
      const res  = await fetch(`/api/admin/members/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte radera");
      await loadMembers();
    } catch (err) {
      alert(err.message);
    }
  });


  // ─────────────────────────────
  // Styrelsen
  // ─────────────────────────────

  /**
   * VARFÖR: Admin behöver se och hantera styrelsemedlemmar (ordförande, kassör, etc.).
   * VAD: Hämtar GET /api/board och renderar dem med redigera/ta-bort-knappar.
   * HUR: Varje medlem visas med roll, namn, kontakt och två knappar.
   */
  async function loadBoard() {
    boardList.innerHTML = "<p class='muted'>Laddar…</p>";

    try {
      const res  = await fetch("/api/board");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte ladda");

      if (!data.members || data.members.length === 0) {
        boardList.innerHTML = "<p class='muted'>Inga styrelsemedlemmar inlagda än.</p>";
        return;
      }

      boardList.innerHTML = data.members.map(m => boardRowHtml(m)).join("");

    } catch (err) {
      boardList.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  /**
   * VARFÖR: Varje styrelsemedlem i listan behöver en enhetlig HTML-struktur.
   * VAD: Returnerar HTML-strängen för en styrelsemedlem-rad (info + bild-thumbnail + knappar).
   */
  function boardRowHtml(m) {
    const imgHtml = m.image_path
      ? `<img src="/${esc(m.image_path)}" alt="" class="event-admin-thumb" />`
      : `<div class="event-admin-thumb event-admin-thumb-placeholder"></div>`;

    return `
      <div class="admin-event-row" data-board-id="${m.id}">
        ${imgHtml}
        <div class="admin-event-info">
          <strong>${esc(m.role)}</strong> — ${esc(m.name)}
          ${m.contact ? `<p class="muted small">${esc(m.contact)}</p>` : ""}
        </div>
        <div class="admin-event-actions">
          <button class="btn" data-board-edit="${m.id}" data-role="${esc(m.role)}" data-name="${esc(m.name)}" data-contact="${esc(m.contact || "")}">Redigera</button>
          <button class="btn" data-board-img="${m.id}">Ladda upp bild</button>
          <button class="btn btn-danger" data-board-del="${m.id}">Ta bort</button>
        </div>
      </div>
    `;
  }

  /**
   * VARFÖR: Admin ska kunna redigera en styrelsemedlem utan att lämna sidan.
   * VAD: Byter ut en styrelsemedlem-rad mot ett inline-redigeringsformulär.
   */
  function showBoardEditForm(id, role, name, contact) {
    const row = boardList.querySelector(`[data-board-id="${id}"]`);
    if (!row) return;

    row.innerHTML = `
      <form class="admin-edit-form form" data-board-save="${id}">
        <div class="form-row">
          <label>Roll * <input name="role" value="${esc(role)}" required /></label>
          <label>Namn * <input name="name" value="${esc(name)}" required /></label>
        </div>
        <label>Kontakt
          <input name="contact" value="${esc(contact)}" />
        </label>
        <div style="display:flex; gap:.5rem; flex-wrap:wrap;">
          <button class="btn" type="submit">Spara</button>
          <button class="btn" type="button" data-board-cancel="${id}">Avbryt</button>
        </div>
        <span class="admin-msg" id="editBoardMsg${id}"></span>
      </form>
    `;
  }

  // Event delegation på styrelselistan
  boardList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    // Redigera-knapp
    if (btn.hasAttribute("data-board-edit")) {
      const id      = btn.getAttribute("data-board-edit");
      const role    = btn.getAttribute("data-role");
      const name    = btn.getAttribute("data-name");
      const contact = btn.getAttribute("data-contact");
      showBoardEditForm(id, role, name, contact);
      return;
    }

    // Avbryt-knapp
    if (btn.hasAttribute("data-board-cancel")) {
      await loadBoard();
      return;
    }

    // Bilduppladdnings-knapp: trigga den dolda file-input
    if (btn.hasAttribute("data-board-img")) {
      currentBoardImageId = Number(btn.getAttribute("data-board-img"));
      const boardImageInput = document.getElementById("boardImageInput");
      if (boardImageInput) {
        boardImageInput.value = "";  // nollställ
        boardImageInput.click();
      }
      return;
    }

    // Ta bort-knapp
    if (btn.hasAttribute("data-board-del")) {
      const id = btn.getAttribute("data-board-del");
      if (!confirm("Ta bort styrelsemedlemmen permanent?")) return;
      try {
        const res  = await fetch(`/api/admin/board/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Kunde inte ta bort");
        await loadBoard();
      } catch (err) {
        alert(err.message);
      }
      return;
    }
  });

  // Spara redigerad styrelsemedlem via event delegation
  boardList.addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-board-save]");
    if (!form) return;
    e.preventDefault();

    const id  = form.getAttribute("data-board-save");
    const msg = document.getElementById(`editBoardMsg${id}`);

    try {
      const payload = {
        role:    form.querySelector('[name="role"]').value.trim(),
        name:    form.querySelector('[name="name"]').value.trim(),
        contact: form.querySelector('[name="contact"]').value.trim() || null,
      };

      const res  = await fetch(`/api/admin/board/${id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte spara");

      await loadBoard();
    } catch (err) {
      if (msg) showMsg(msg, err.message, false);
    }
  });

  // Lägg till ny styrelsemedlem
  addBoardForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    addBoardMsg.textContent = "";

    try {
      const payload = {
        role:    addBoardForm.querySelector('[name="role"]').value.trim(),
        name:    addBoardForm.querySelector('[name="name"]').value.trim(),
        contact: addBoardForm.querySelector('[name="contact"]').value.trim() || null,
      };

      const res  = await fetch("/api/admin/board", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte lägga till");

      showMsg(addBoardMsg, "Styrelsemedlem tillagd!");
      addBoardForm.reset();
      await loadBoard();
    } catch (err) {
      showMsg(addBoardMsg, err.message, false);
    }
  });


  /**
   * VARFÖR: Bilduppladdning för styrelsemedlemmar sker via en dold file-input.
   * VAD: När användaren väljer en fil via "Ladda upp bild"-knappen skickas den
   *      till POST /api/admin/board/<id>/image som multipart/form-data.
   * HUR: currentBoardImageId håller koll på vilket styrelsemedlem bilden tillhör.
   */
  const boardImageInput = document.getElementById("boardImageInput");
  if (boardImageInput) {
    boardImageInput.addEventListener("change", async () => {
      if (!boardImageInput.files.length || currentBoardImageId === null) return;

      const file = boardImageInput.files[0];
      const form = new FormData();
      form.append("image", file);

      try {
        const res  = await fetch(`/api/admin/board/${currentBoardImageId}/image`, {
          method: "POST",
          body:   form,
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Uppladdning misslyckades");

        await loadBoard();
      } catch (err) {
        alert(`Bilduppladdning misslyckades: ${err.message}`);
      } finally {
        currentBoardImageId = null;
      }
    });
  }


  // ─────────────────────────────
  // Information-sidan
  // ─────────────────────────────

  async function loadInfo() {
    infoList.innerHTML = "<p class='muted'>Laddar…</p>";

    try {
      const res  = await fetch("/api/page-sections/information");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte ladda");

      if (!data.sections || data.sections.length === 0) {
        infoList.innerHTML = "<p class='muted'>Inga sektioner inlagda än.</p>";
        return;
      }

      infoList.innerHTML = data.sections.map(s => infoRowHtml(s)).join("");

    } catch (err) {
      infoList.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  function infoRowHtml(s) {
    // Visa en kort preview av innehållet (max 100 tecken)
    const preview = s.content.length > 100 ? s.content.substring(0, 100) + "…" : s.content;
    return `
      <div class="admin-event-row" data-info-id="${s.id}">
        <div class="admin-event-info">
          <strong>${esc(s.title)}</strong>
          <p class="muted small">${esc(preview.replace(/<[^>]*>/g, ''))}</p>
        </div>
        <div class="admin-event-actions">
          <button class="btn" data-info-edit="${s.id}" data-title="${esc(s.title)}" data-content="${esc(s.content)}">Redigera</button>
          <button class="btn btn-danger" data-info-del="${s.id}">Ta bort</button>
        </div>
      </div>
    `;
  }

  function showInfoEditForm(id, title, content) {
    const row = infoList.querySelector(`[data-info-id="${id}"]`);
    if (!row) return;

    row.innerHTML = `
      <form class="admin-edit-form form" data-info-save="${id}">
        <label>Rubrik * <input name="title" value="${esc(title)}" required /></label>
        <label>Innehåll *
          <textarea name="content" rows="4" required>${esc(content)}</textarea>
        </label>
        <div style="display:flex; gap:.5rem; flex-wrap:wrap;">
          <button class="btn" type="submit">Spara</button>
          <button class="btn" type="button" data-info-cancel="${id}">Avbryt</button>
        </div>
        <span class="admin-msg" id="editInfoMsg${id}"></span>
      </form>
    `;
  }

  infoList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    if (btn.hasAttribute("data-info-edit")) {
      const id      = btn.getAttribute("data-info-edit");
      const title   = btn.getAttribute("data-title");
      const content = btn.getAttribute("data-content");
      showInfoEditForm(id, title, content);
      return;
    }

    if (btn.hasAttribute("data-info-cancel")) {
      await loadInfo();
      return;
    }

    if (btn.hasAttribute("data-info-del")) {
      const id = btn.getAttribute("data-info-del");
      if (!confirm("Ta bort sektionen permanent?")) return;
      try {
        const res  = await fetch(`/api/admin/page-sections/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Kunde inte ta bort");
        await loadInfo();
      } catch (err) {
        alert(err.message);
      }
      return;
    }
  });

  infoList.addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-info-save]");
    if (!form) return;
    e.preventDefault();

    const id  = form.getAttribute("data-info-save");
    const msg = document.getElementById(`editInfoMsg${id}`);

    try {
      const payload = {
        title:   form.querySelector('[name="title"]').value.trim(),
        content: form.querySelector('[name="content"]').value.trim(),
      };

      const res  = await fetch(`/api/admin/page-sections/${id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte spara");

      await loadInfo();
    } catch (err) {
      if (msg) showMsg(msg, err.message, false);
    }
  });

  addInfoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    addInfoMsg.textContent = "";

    try {
      const payload = {
        page:    "information",
        title:   addInfoForm.querySelector('[name="title"]').value.trim(),
        content: addInfoForm.querySelector('[name="content"]').value.trim(),
      };

      const res  = await fetch("/api/admin/page-sections", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte lägga till");

      showMsg(addInfoMsg, "Sektion tillagd!");
      addInfoForm.reset();
      await loadInfo();
    } catch (err) {
      showMsg(addInfoMsg, err.message, false);
    }
  });


  // ─────────────────────────────
  // Event-hantering
  // ─────────────────────────────

  /**
   * VARFÖR: Adminpanelen ska visa alla event med möjlighet att redigera, ta bort och ladda upp bild.
   * VAD: Hämtar GET /api/events och renderar dem som rader med knappar.
   * HUR: Varje rad har tre knappar: Redigera (inline), Ta bort, Ladda upp bild.
   *      "Redigera" byter ut textraden mot ett inline-formulär utan att ladda om sidan.
   */
  async function loadEvents() {
    eventsListEl.innerHTML = "<p class='muted'>Laddar…</p>";

    try {
      const res  = await fetch("/api/events");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte ladda event");

      if (!data.events || data.events.length === 0) {
        eventsListEl.innerHTML = "<p class='muted'>Inga event inlagda än.</p>";
        return;
      }

      eventsListEl.innerHTML = data.events.map(ev => eventRowHtml(ev)).join("");

    } catch (err) {
      eventsListEl.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  /**
   * VARFÖR: Varje event i listan behöver en enhetlig HTML-struktur.
   * VAD: Returnerar HTML-strängen för en event-rad (visar info + knappar).
   * HUR: Bygger strängen med template literals. Bild visas som en liten thumbnail.
   *      data-id på wrappar-divven används av event delegation för att identifiera eventet.
   */
  function eventRowHtml(ev) {
    const imgHtml = ev.image_path
      ? `<img src="/${esc(ev.image_path)}" alt="" class="event-admin-thumb" />`
      : `<div class="event-admin-thumb event-admin-thumb-placeholder"></div>`;

    const dateStr = ev.date ? ` — ${ev.date}` : "";

    return `
      <div class="admin-event-row" data-event-id="${ev.id}">
        ${imgHtml}
        <div class="admin-event-info">
          <strong>${esc(ev.title)}</strong>${esc(dateStr)}
          ${ev.description ? `<p class="muted small">${esc(ev.description)}</p>` : ""}
        </div>
        <div class="admin-event-actions">
          <button class="btn" data-ev-edit="${ev.id}" data-title="${esc(ev.title)}" data-date="${esc(ev.date || "")}" data-desc="${esc(ev.description || "")}">Redigera</button>
          <button class="btn" data-ev-img="${ev.id}">Ladda upp bild</button>
          <button class="btn btn-danger" data-ev-del="${ev.id}">Ta bort</button>
        </div>
      </div>
    `;
  }

  /**
   * VARFÖR: Admin ska kunna redigera ett event utan att lämna sidan.
   * VAD: Byter ut en event-rad mot ett inline-redigeringsformulär.
   * HUR: Hittar rätt rad via data-event-id och ersätter dess innerHTML med ett formulär.
   *      Avbryt-knappen återställer raden via loadEvents().
   */
  function showEditForm(id, title, date, desc) {
    const row = eventsListEl.querySelector(`[data-event-id="${id}"]`);
    if (!row) return;

    row.innerHTML = `
      <form class="admin-edit-form form" data-ev-save="${id}">
        <div class="form-row">
          <label>Titel * <input name="title" value="${esc(title)}" required /></label>
          <label>Datum <input name="date" type="date" value="${esc(date)}" /></label>
        </div>
        <label>Beskrivning
          <textarea name="description" rows="2">${esc(desc)}</textarea>
        </label>
        <div style="display:flex; gap:.5rem; flex-wrap:wrap;">
          <button class="btn" type="submit">Spara</button>
          <button class="btn" type="button" data-ev-cancel="${id}">Avbryt</button>
        </div>
        <span class="admin-msg" id="editMsg${id}"></span>
      </form>
    `;
  }

  /**
   * VARFÖR: Alla event-knappar (redigera, ta bort, bilduppladdning) sitter i samma lista.
   * VAD: Event delegation — ett klick-lyssnare på hela event-listan fångar alla knappar.
   * HUR: Kollar vilket data-attribut knappen har och anropar rätt funktion.
   *      Undviker att sätta individuella lyssnare varje gång listan ritas om.
   */
  eventsListEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    // Redigera-knapp: visa inline-formulär
    if (btn.hasAttribute("data-ev-edit")) {
      const id    = btn.getAttribute("data-ev-edit");
      const title = btn.getAttribute("data-title");
      const date  = btn.getAttribute("data-date");
      const desc  = btn.getAttribute("data-desc");
      showEditForm(id, title, date, desc);
      return;
    }

    // Avbryt-knapp: ladda om event-listan (återställer raden)
    if (btn.hasAttribute("data-ev-cancel")) {
      await loadEvents();
      return;
    }

    // Bilduppladdnings-knapp: trigga den dolda file-input
    if (btn.hasAttribute("data-ev-img")) {
      currentEventImageId = Number(btn.getAttribute("data-ev-img"));
      eventImageInput.value = "";  // nollställ så att samma fil kan väljas igen
      eventImageInput.click();
      return;
    }

    // Ta bort-knapp
    if (btn.hasAttribute("data-ev-del")) {
      const id = btn.getAttribute("data-ev-del");
      if (!confirm("Ta bort eventet permanent?")) return;

      try {
        const res  = await fetch(`/api/admin/events/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Kunde inte ta bort");
        await loadEvents();
      } catch (err) {
        alert(err.message);
      }
      return;
    }
  });

  /**
   * VARFÖR: Sparande av redigerat event hanteras via event delegation på hela listan.
   * VAD: Fångar submit-event på inline-redigeringsformulär och skickar PUT till API.
   * HUR: Formuläret har data-ev-save="${id}" — det används för att hitta rätt event-id.
   */
  eventsListEl.addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-ev-save]");
    if (!form) return;
    e.preventDefault();

    const id  = form.getAttribute("data-ev-save");
    const msg = document.getElementById(`editMsg${id}`);

    try {
      const payload = {
        title:       form.querySelector('[name="title"]').value.trim(),
        date:        form.querySelector('[name="date"]').value || null,
        description: form.querySelector('[name="description"]').value.trim() || null,
      };

      const res  = await fetch(`/api/admin/events/${id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte spara");

      await loadEvents();
    } catch (err) {
      if (msg) showMsg(msg, err.message, false);
    }
  });

  // Lägg till nytt event via formuläret ovanför listan
  addEventForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    addEventMsg.textContent = "";

    try {
      const payload = {
        title:       addEventForm.querySelector('[name="title"]').value.trim(),
        date:        addEventForm.querySelector('[name="date"]').value || null,
        description: addEventForm.querySelector('[name="description"]').value.trim() || null,
      };

      const res  = await fetch("/api/admin/events", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte lägga till");

      showMsg(addEventMsg, "Event skapat! Ladda nu upp en bild om du vill.");
      addEventForm.reset();
      await loadEvents();
    } catch (err) {
      showMsg(addEventMsg, err.message, false);
    }
  });

  /**
   * VARFÖR: Bilduppladdning för event sker via en dold file-input.
   * VAD: När användaren väljer en fil via "Ladda upp bild"-knappen skickas den
   *      till POST /api/admin/events/<id>/image som multipart/form-data.
   * HUR: currentEventImageId håller koll på vilket event bilden tillhör.
   *      FormData används för att skicka filen — inte JSON.
   */
  eventImageInput.addEventListener("change", async () => {
    if (!eventImageInput.files.length || currentEventImageId === null) return;

    const file = eventImageInput.files[0];
    const form = new FormData();
    form.append("image", file);

    try {
      const res  = await fetch(`/api/admin/events/${currentEventImageId}/image`, {
        method: "POST",
        body:   form,
        // OBS: Sätt INTE Content-Type header manuellt vid FormData-uppladdning.
        // Webbläsaren sätter den automatiskt med rätt boundary-värde.
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Uppladdning misslyckades");

      await loadEvents();
    } catch (err) {
      alert(`Bilduppladdning misslyckades: ${err.message}`);
    } finally {
      currentEventImageId = null;
    }
  });


  // ─────────────────────────────
  // Galleri
  // ─────────────────────────────

  /**
   * VARFÖR: Admin behöver se vilka bilder som finns i galleriet och kunna ta bort dem.
   * VAD: Hämtar GET /api/gallery och renderar ett bildgrid med delete-knapper.
   * HUR: Varje bild visas som en thumbnail med en ×-knapp i hörnet.
   */
  async function loadGalleryAdmin() {
    galleryGrid.innerHTML = "<p class='muted'>Laddar…</p>";

    try {
      const res  = await fetch("/api/gallery");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte ladda galleri");

      if (!data.images || data.images.length === 0) {
        galleryGrid.innerHTML = "<p class='muted'>Inga bilder uppladdade än.</p>";
        return;
      }

      galleryGrid.innerHTML = data.images.map(img => `
        <div class="gallery-admin-item">
          <img src="${esc(img.url)}" alt="${esc(img.filename)}" loading="lazy" />
          <button class="gallery-admin-delete" data-filename="${esc(img.filename)}" title="Ta bort bild">×</button>
        </div>
      `).join("");

    } catch (err) {
      galleryGrid.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  /**
   * VARFÖR: Admin ska kunna ladda upp en eller flera bilder till galleriet.
   * VAD: Skickar varje vald fil till POST /api/admin/gallery som multipart/form-data.
   * HUR: Laddar upp filerna i sekvens (ej parallellt för att undvika serveröverlast).
   *      Uppdaterar galleriet när alla är klara.
   */
  async function uploadGalleryImages(files) {
    showMsg(galleryMsg, `Laddar upp ${files.length} bild(er)…`);

    let errors = 0;
    for (const file of files) {
      const form = new FormData();
      form.append("image", file);

      try {
        const res  = await fetch("/api/admin/gallery", { method: "POST", body: form });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
      } catch {
        errors++;
      }
    }

    if (errors === 0) {
      showMsg(galleryMsg, `${files.length} bild(er) uppladdade!`);
    } else {
      showMsg(galleryMsg, `${errors} av ${files.length} misslyckades.`, false);
    }

    await loadGalleryAdmin();
  }

  // Knappen triggar den dolda file-input
  galleryUploadBtn.addEventListener("click", () => {
    galleryFileInput.value = "";
    galleryFileInput.click();
  });

  // När filer valts: starta uppladdning
  galleryFileInput.addEventListener("change", async () => {
    if (!galleryFileInput.files.length) return;
    await uploadGalleryImages(Array.from(galleryFileInput.files));
  });

  // Delete-knapper via event delegation på galleri-griden
  galleryGrid.addEventListener("click", async (e) => {
    const btn = e.target.closest(".gallery-admin-delete");
    if (!btn) return;

    const filename = btn.getAttribute("data-filename");
    if (!confirm(`Ta bort "${filename}" permanent?`)) return;

    try {
      const res  = await fetch(`/api/admin/gallery/${encodeURIComponent(filename)}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Kunde inte ta bort");
      await loadGalleryAdmin();
    } catch (err) {
      alert(err.message);
    }
  });

});
