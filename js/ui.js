/* ==========================================================
   ui.js: shared interface pieces used by every page
   1. Theme       dark / light mode
   2. UI          badges, stock card, photo viewer, searchable drop-down
   3. Shell       the header and the slide-in side menu
   ========================================================== */

/* ---------- 1. THEME ---------- */
const Theme = {
  current() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; },
  set(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("sunTheme", theme); } catch (e) { /* private mode: ignore */ }
  },
  toggle() { this.set(this.current() === "dark" ? "light" : "dark"); }
};

/* ---------- 2. UI HELPERS ---------- */
const UI = {
  statusBadge(status) {
    const s = String(status || "").toUpperCase();
    const cls = { IN: "badge-in", ROLLED: "badge-rolled", OUT: "badge-out" }[s] || "badge-normal";
    return '<span class="badge ' + cls + '">' + esc(s) + "</span>";
  },

  jobBadge(stock) {
    return stock.jobAssigned
      ? '<span class="badge badge-job">Job Assigned</span>'
      : '<span class="badge badge-nojob">Not Assigned</span>';
  },

  priorityBadge(priority) {
    return String(priority || "").toUpperCase() === "URGENT"
      ? '<span class="badge badge-urgent">Urgent</span>'
      : '<span class="badge badge-normal">Normal</span>';
  },

  emptyHtml(text) { return '<div class="empty">' + esc(text) + "</div>"; },
  loadingHtml() { return '<div class="loading-box"><div class="spinner" aria-label="Loading"></div></div>'; },

  // One card in the Stocks IN / Rolled / Stocks OUT lists
  stockCardHtml(s) {
    const st = String(s.status || "IN").toUpperCase();
    const cls = { IN: "s-in", ROLLED: "s-rolled", OUT: "s-out" }[st] || "";
    const dateInfo = { IN: ["Stock IN", s.stockInAt], ROLLED: ["Rolled", s.rolledAt], OUT: ["Stock OUT", s.stockOutAt] }[st] || ["", null];
    const overdue = Stocks.overdueInfo(s);

    let foot = "";
    if (st === "IN") {
      foot += this.jobBadge(s);
      if (s.jobAssigned && s.assignedMachineName) foot += '<span class="meta-v">' + esc(s.assignedMachineName) + "</span>";
    }
    if (overdue) foot += '<span class="badge badge-alert">Over ' + overdue.limit + " days</span>";
    foot += '<span class="stock-card-date">' + esc(dateInfo[0]) + ": " + esc(fmtDate(dateInfo[1])) + "</span>";

    const meta = (k, v) => '<div><div class="meta-k">' + k + '</div><div class="meta-v">' + (v ? esc(v) : "—") + "</div></div>";

    return '<button type="button" class="stock-card ' + cls + '" data-id="' + esc(s.id) + '">' +
      '<div class="stock-card-top"><div class="stock-card-supplier">' + esc(s.supplierName || "—") + "</div>" + this.statusBadge(st) + "</div>" +
      '<div class="stock-card-meta">' + meta("Thread Form", s.threadForm) + meta("Material Type", s.materialType) + meta("Quantity", s.quantity) + "</div>" +
      '<div class="stock-card-foot">' + foot + "</div>" +
    "</button>";
  },

  // Big photo viewer
  openLightbox(src) {
    const img = new Image();
    img.className = "lightbox-img";
    img.alt = "Attached photo";
    img.src = src;
    Modal.open({ title: "Photo", size: "lg", body: img });
  }
};

/* ---------- SEARCHABLE DROP-DOWN ("combo") ----------
   options:
     placeholder, addLabel (text of the "+ Add New ..." row),
     getItems()  -> [{ value, label, sub, data }]
     onAdd()     -> Promise of a new item (or null). Leave out for no "+ Add New" row.
     onChange(item)
   returns { el, input, value, setValue(item), clear(), focus() } */
function createCombo(o) {
  const id = "combo" + Math.random().toString(36).slice(2, 8);
  const el = document.createElement("div");
  el.className = "combo";
  el.innerHTML =
    '<input class="combo-input" id="' + id + '" type="text" role="combobox" autocomplete="off" ' +
      'aria-autocomplete="list" aria-expanded="false" aria-controls="' + id + '-list" placeholder="' + esc(o.placeholder || "Select…") + '">' +
    '<button class="combo-arrow" type="button" tabindex="-1" aria-label="Show options">' + icon("down", 18) + "</button>" +
    '<ul class="combo-list" id="' + id + '-list" role="listbox"></ul>';

  const input = $("input", el);
  const list = $("ul", el);
  const arrow = $("button", el);
  let selected = null;   // the chosen item
  let rows = [];         // rows currently shown
  let active = -1;       // row highlighted by keyboard
  let typed = false;     // true once the user types (then we filter)

  const isOpen = () => el.classList.contains("open");

  function build() {
    const q = typed ? input.value : "";
    const items = (o.getItems() || []).filter((it) => matchesSearch([it.label, it.sub || ""], q));
    rows = [];
    if (o.onAdd) rows.push({ add: true });
    items.forEach((it) => rows.push({ item: it }));

    let html = rows.map((r, i) => {
      if (r.add) return '<li class="combo-item add" role="option" id="' + id + "-" + i + '" data-i="' + i + '">+ ' + esc(o.addLabel || "Add New") + "</li>";
      const isSel = selected && selected.label === r.item.label;
      return '<li class="combo-item" role="option" id="' + id + "-" + i + '" data-i="' + i + '" aria-selected="' + (isSel ? "true" : "false") + '">' +
        esc(r.item.label) + (r.item.sub ? "<small>" + esc(r.item.sub) + "</small>" : "") + "</li>";
    }).join("");
    if (!items.length) html += '<li class="combo-empty">' + (q ? "No matches found." : "No saved options yet.") + "</li>";
    list.innerHTML = html;
    active = -1;
  }

  function open() {
    build();
    el.classList.add("open");
    input.setAttribute("aria-expanded", "true");
  }

  function close() {
    el.classList.remove("open");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    typed = false;
    input.value = selected ? selected.label : "";
  }

  function setActive(i) {
    const lis = $$("[data-i]", list);
    if (!lis.length) return;
    active = Math.max(0, Math.min(lis.length - 1, i));
    lis.forEach((li, idx) => li.classList.toggle("active", idx === active));
    lis[active].scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", lis[active].id);
  }

  function setValue(item, silent) {
    selected = item || null;
    input.value = selected ? selected.label : "";
    if (!silent && typeof o.onChange === "function") o.onChange(selected);
  }

  async function choose(row) {
    if (!row) return;
    if (row.add) {
      close();
      const created = await o.onAdd();
      if (created) setValue(created);
      return;
    }
    setValue(row.item);
    close();
  }

  input.addEventListener("focus", () => { open(); input.select(); });
  input.addEventListener("click", () => { if (!isOpen()) open(); });
  input.addEventListener("blur", close);
  input.addEventListener("input", () => { typed = true; if (!isOpen()) el.classList.add("open"); build(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!isOpen()) open(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (!isOpen()) open(); setActive(active - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();   // never submit the form from a drop-down
      if (!isOpen()) return;
      let idx = active;
      if (idx < 0 && typed) {
        const itemRows = rows.map((r, i) => (r.add ? -1 : i)).filter((i) => i >= 0);
        if (itemRows.length === 1) idx = itemRows[0];
      }
      if (idx >= 0) choose(rows[idx]);
    }
    else if (e.key === "Escape" && isOpen()) { e.stopPropagation(); close(); }
  });

  list.addEventListener("mousedown", (e) => e.preventDefault());   // keeps the cursor in the box
  list.addEventListener("click", (e) => {
    const li = e.target.closest("[data-i]");
    if (li) choose(rows[Number(li.dataset.i)]);
  });
  arrow.addEventListener("mousedown", (e) => e.preventDefault());
  arrow.addEventListener("click", () => { if (isOpen()) close(); else { input.focus(); open(); } });

  return {
    el, input,
    get value() { return selected; },
    setValue,
    clear() { setValue(null, true); },
    focus() { input.focus(); }
  };
}

/* ---------- 3. SHELL: header + side menu ---------- */
const Shell = {
  _bound: false,

  // group: "main" (no heading), "owner", "account"
  NAV: [
    { route: "dashboard", label: "Dashboard", icon: "dashboard", group: "main" },
    { route: "add-stock", label: "Add New", icon: "plus", group: "main" },
    { route: "stocks-in", label: "Stocks IN", icon: "box", group: "main" },
    { route: "rolled", label: "Rolled", icon: "roll", group: "main" },
    { route: "stocks-out", label: "Stocks OUT", icon: "out", group: "main" },
    { route: "schedule", label: "Job Schedule", icon: "calendar", group: "main" },
    { route: "history", label: "Full History", icon: "history", group: "main" },
    { route: "assign-job", label: "Assign Jobs", icon: "assign", group: "owner" },
    { route: "machines", label: "Machine Management", icon: "gear", group: "owner" },
    { route: "data", label: "Data Management", icon: "trash", group: "owner" },
    { route: "settings", label: "Settings", icon: "user", group: "account" }
  ],

  GROUP_HEADINGS: { owner: "Owner tools", account: "Account" },

  build(user) {
    const initial = esc((user.email || "?").charAt(0).toUpperCase());
    const avatar = user.photo
      ? '<img src="' + esc(user.photo) + '" alt="" referrerpolicy="no-referrer">'
      : initial;
    const role = esc(user.role.toUpperCase());

    // Menu items (only the ones this role may open)
    let items = "";
    let lastGroup = "";
    this.NAV.forEach((item) => {
      if (!Permissions.canOpenRoute(item.route)) return;
      if (item.group !== lastGroup && this.GROUP_HEADINGS[item.group]) {
        items += '<li class="nav-heading">' + this.GROUP_HEADINGS[item.group] + "</li>";
      }
      lastGroup = item.group;
      items += '<li><button type="button" class="nav-item" data-route="' + item.route + '">' + icon(item.icon) + "<span>" + esc(item.label) + "</span></button></li>";
    });
    items += '<li><button type="button" class="nav-item" id="navSignOut">' + icon("logout") + "<span>Sign Out</span></button></li>";

    $("#appShell").innerHTML =
      '<header class="app-header">' +
        '<button class="menu-btn" id="menuBtn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="drawer">' + icon("menu") + "</button>" +
        '<button class="brand-title" id="brandBtn" type="button">' + esc(APP_CONFIG.appName + " - " + APP_CONFIG.appSubtitle) + "</button>" +
        '<div class="profile-chip"><span class="profile-role">' + role + '</span><span class="profile-avatar" title="' + esc(user.email) + '">' + avatar + "</span></div>" +
      "</header>" +
      '<div class="drawer-overlay" id="drawerOverlay"></div>' +
      '<aside class="drawer" id="drawer" aria-label="Main menu">' +
        '<div class="drawer-user"><span class="profile-avatar">' + avatar + "</span>" +
          '<div class="drawer-email">' + esc(user.email) + '</div><span class="profile-role">' + role + "</span></div>" +
        '<ul class="nav-list">' + items + "</ul>" +
      "</aside>" +
      '<main id="pageRoot" class="page" tabindex="-1"></main>';

    $("#drawer").inert = true;   // keeps the hidden menu out of keyboard focus

    $("#menuBtn").addEventListener("click", () => this.openDrawer());
    $("#drawerOverlay").addEventListener("click", () => this.closeDrawer());
    $("#brandBtn").addEventListener("click", () => Router.go(Permissions.landingPage()));
    $("#drawer").addEventListener("click", (e) => {
      const nav = e.target.closest("[data-route]");
      if (nav) { Router.go(nav.dataset.route); this.closeDrawer(); return; }
      if (e.target.closest("#navSignOut")) { this.closeDrawer(); Auth.signOut(); }
    });

    if (!this._bound) {
      this._bound = true;
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !Modal.stack.length && $("#drawer") && $("#drawer").classList.contains("open")) this.closeDrawer();
      });
    }
  },

  openDrawer() {
    const drawer = $("#drawer");
    drawer.inert = false;
    drawer.classList.add("open");
    $("#drawerOverlay").classList.add("open");
    $("#menuBtn").setAttribute("aria-expanded", "true");
    document.body.classList.add("drawer-open");
    const first = $(".nav-item", drawer);
    if (first) first.focus();
  },

  closeDrawer() {
    const drawer = $("#drawer");
    if (!drawer || !drawer.classList.contains("open")) return;
    const hadFocus = drawer.contains(document.activeElement);
    drawer.classList.remove("open");
    drawer.inert = true;
    $("#drawerOverlay").classList.remove("open");
    $("#menuBtn").setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-open");
    if (hadFocus) $("#menuBtn").focus();
  },

  setActive(route) {
    $$(".nav-item[data-route]").forEach((b) => {
      const on = b.dataset.route === route;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
  }
};
