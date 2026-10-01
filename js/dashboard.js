/* ==========================================================
   dashboard.js: the home page (owner and staff).
   Updates by itself whenever the database changes.
   ========================================================== */

const DashboardPage = {
  title: "Dashboard",

  render(root) {
    let showAllAlerts = false;
    const ALERT_PREVIEW = 8;

    const TILES = [
      { route: "add-stock", cls: "add", label: "Add New", icon: "plus" },
      { route: "stocks-in", cls: "in", label: "Stocks IN", icon: "box" },
      { route: "rolled", cls: "rolled", label: "Rolled", icon: "roll" },
      { route: "stocks-out", cls: "out", label: "Stocks OUT", icon: "out" },
      { route: "schedule", cls: "sched tile-wide", label: "View Job Schedule", icon: "calendar" }
    ];

    root.innerHTML =
      '<div class="page-head"><div><h1 class="page-title">Dashboard</h1>' +
      '<p class="page-sub">Live overview of stock and jobs</p></div></div>' +
      '<section aria-label="Summary"><div class="stat-grid" id="dashStats"></div></section>' +
      '<section aria-label="Quick actions"><div class="tile-grid">' +
        TILES.map((t) =>
          '<button type="button" class="tile ' + t.cls + '" data-route="' + t.route + '">' +
          '<span class="tile-icon">' + icon(t.icon, 34) + "</span><span>" + t.label + "</span></button>").join("") +
      "</div></section>" +
      '<h2 class="section-title">Alerts</h2><div id="dashAlerts"></div>' +
      '<h2 class="section-title">Recent activity ' +
        '<button type="button" class="btn btn-secondary btn-sm" data-route="history">View Full History</button></h2>' +
      '<div class="two-col">' +
        '<div><h3 class="section-title" style="margin-top:0">Recent Stock IN</h3><div class="activity-list" id="recentIn"></div></div>' +
        '<div><h3 class="section-title" style="margin-top:0">Recent Stock OUT</h3><div class="activity-list" id="recentOut"></div></div>' +
      "</div>";

    /* ----- summary cards ----- */
    const stat = (cls, label, value, note) =>
      '<div class="stat-card ' + cls + '"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + value + "</div>" +
      (note ? '<div class="stat-note">' + esc(note) + "</div>" : "") + "</div>";
    const num = (loaded, n) => (loaded ? String(n) : "…");

    function paintStats() {
      const L = Store.loaded;
      const unassigned = Store.stocksIn.filter((s) => !s.jobAssigned).length;
      $("#dashStats").innerHTML =
        stat("in", "Stocks IN", num(L.in, Store.stocksIn.length), "Waiting to be rolled") +
        stat("rolled", "Rolled", num(L.rolled, Store.stocksRolled.length), "Waiting for stock out") +
        stat("out", "Stocks OUT", num(L.out, Store.stocksOut.length), "Last " + Store.outDays + " days") +
        stat("jobs", "Jobs Assigned", num(L.jobs, Store.jobs.length), "Waiting or running") +
        stat("unassigned", "Unassigned Stocks", num(L.in, unassigned), "Stocks IN without a job");
    }

    /* ----- alerts ----- */
    function computeAlerts() {
      const found = [];
      Store.stocksIn.forEach((s) => {
        const info = Stocks.overdueInfo(s);
        if (info) found.push({ stock: s, info, route: "stocks-in", line: "In stock for " + info.days + " days" });
      });
      Store.stocksRolled.forEach((s) => {
        const info = Stocks.overdueInfo(s);
        if (info) found.push({ stock: s, info, route: "rolled", line: "Rolled " + info.days + " days ago" });
      });
      return found.sort((a, b) => b.info.days - a.info.days);
    }

    function paintAlerts() {
      const box = $("#dashAlerts");
      if (!Store.loaded.in || !Store.loaded.rolled) { box.innerHTML = UI.loadingHtml(); return; }
      const all = computeAlerts();
      if (!all.length) { box.innerHTML = UI.emptyHtml("No alerts. Nothing is overdue."); return; }
      const shown = showAllAlerts ? all : all.slice(0, ALERT_PREVIEW);
      box.innerHTML =
        '<div class="alert-list">' +
        shown.map((a) =>
          '<button type="button" class="alert-item" data-route="' + a.route + '" data-id="' + esc(a.stock.id) + '">' +
          icon("alert", 26) +
          "<span>" + esc(a.info.message) +
          "<small>" + esc(a.stock.supplierName) + " · " + esc(a.stock.threadForm) + " · " + esc(a.line) + "</small></span></button>").join("") +
        "</div>" +
        (all.length > ALERT_PREVIEW && !showAllAlerts
          ? '<div class="load-more"><button type="button" class="btn btn-secondary" id="showAllAlerts">Show all ' + all.length + " alerts</button></div>"
          : "");
    }

    /* ----- recent activity ----- */
    function activityHtml(list, dateField, emptyText) {
      if (!list.length) return UI.emptyHtml(emptyText);
      return list.slice(0, 5).map((s) =>
        '<button type="button" class="activity-item" data-id="' + esc(s.id) + '">' +
        '<span class="activity-main"><div class="activity-title">' + esc(s.supplierName) + "</div>" +
        '<div class="activity-sub">' + esc(s.threadForm) + " · " + esc(s.materialType) + " · Qty " + esc(s.quantity) + "</div></span>" +
        '<span class="activity-sub">' + esc(fmtDate(s[dateField])) + "</span></button>").join("");
    }

    function paintRecent() {
      $("#recentIn").innerHTML = Store.loaded.in ? activityHtml(Store.stocksIn, "stockInAt", "No stock has come in yet.") : UI.loadingHtml();
      $("#recentOut").innerHTML = Store.loaded.out ? activityHtml(Store.stocksOut, "stockOutAt", "Nothing has gone out recently.") : UI.loadingHtml();
    }

    function paintAll() { paintStats(); paintAlerts(); paintRecent(); }

    /* ----- clicks (one listener for the whole page) ----- */
    root.addEventListener("click", (e) => {
      if (e.target.closest("#showAllAlerts")) { showAllAlerts = true; paintAlerts(); return; }
      const alertBtn = e.target.closest(".alert-item");
      if (alertBtn) { Router.go(alertBtn.dataset.route, { focus: alertBtn.dataset.id }); return; }
      const activity = e.target.closest(".activity-item");
      if (activity) { StockDetail.open(activity.dataset.id); return; }
      const nav = e.target.closest("[data-route]");
      if (nav) Router.go(nav.dataset.route);
    });

    paintAll();
    return Store.subscribe(paintAll);   // returned function = cleanup when leaving the page
  }
};
