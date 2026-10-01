/* ==========================================================
   settings.js
   1. Cleanup       finds and deletes old records (owner only)
   2. SettingsPage  theme, account, Excel downloads, owner shortcuts
   3. DataPage      the Data Management page (owner only)
   ========================================================== */

/* ---------- 1. OLD DATA CLEANUP ----------
   Deleted:   history lines older than N days (except lines of stocks still IN or ROLLED),
              stocks that went OUT more than N days ago (with their photos),
              finished or cancelled jobs closed more than N days ago.
   Protected: every stock that is currently IN or ROLLED, and its history. */
const Cleanup = {
  MAX: 20000,

  // Reads documents in pages of 500 and keeps the ones keepFn accepts
  async _pull(query, keepFn) {
    const out = [];
    let last = null;
    while (out.length < this.MAX) {
      let q = query.limit(500);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      snap.docs.forEach((d) => { if (keepFn(d)) out.push(d); });
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < 500) break;
    }
    return out;
  },

  async plan(days) {
    Permissions.require("manageData");
    Stocks._online();
    if (!Store.loaded.in || !Store.loaded.rolled) throw { userMessage: "Please wait a moment while the data loads, then try again." };

    const cutoff = Timestamp.fromDate(new Date(Date.now() - days * 86400000));
    const active = new Set(Store.stocksIn.concat(Store.stocksRolled).map((s) => s.id));

    const history = await this._pull(
      db.collection("stockHistory").where("timestamp", "<", cutoff).orderBy("timestamp"),
      (d) => !active.has(d.data().stockId));
    const stocks = await this._pull(
      db.collection("stocks").where("stockOutAt", "<", cutoff).orderBy("stockOutAt"),
      (d) => d.data().status === "OUT");
    const jobs = await this._pull(
      db.collection("jobs").where("closedAt", "<", cutoff).orderBy("closedAt"),
      (d) => { const s = d.data().status; return s === "DONE" || s === "CANCELLED"; });

    const photoRefs = stocks.filter((d) => d.data().hasPhoto).map((d) => db.collection("stockPhotos").doc(d.id));
    return {
      days, history, stocks, jobs, photoRefs,
      total: history.length + stocks.length + jobs.length,
      capped: history.length >= this.MAX || stocks.length >= this.MAX || jobs.length >= this.MAX
    };
  },

  async run(plan) {
    Permissions.require("manageData");
    const refs = [];
    plan.history.forEach((d) => refs.push(d.ref));
    plan.stocks.forEach((d) => refs.push(d.ref));
    plan.photoRefs.forEach((r) => refs.push(r));
    plan.jobs.forEach((d) => refs.push(d.ref));
    for (let i = 0; i < refs.length; i += 450) {
      const batch = db.batch();
      refs.slice(i, i + 450).forEach((r) => batch.delete(r));
      await batch.commit();
    }
    return refs.length;
  }
};

/* ---------- 2. SETTINGS PAGE ---------- */
const SettingsPage = {
  title: "Settings",

  render(root) {
    const user = Auth.user;
    const isOwner = Permissions.role === "owner";
    const canDownload = Permissions.can("exportStocks");
    const dl = (kind, label) => '<button type="button" class="btn btn-secondary" data-excel="' + kind + '">' + icon("download", 18) + "<span>" + label + "</span></button>";

    root.innerHTML =
      '<div class="page-head"><div><h1 class="page-title">Settings</h1></div></div>' +
      '<div class="settings-grid">' +
        '<section class="card"><h2 class="section-title" style="margin-top:0">Appearance</h2>' +
          '<div class="seg" role="group" aria-label="Theme">' +
            '<button type="button" class="seg-btn" data-theme-btn="light" aria-pressed="false">Light Mode</button>' +
            '<button type="button" class="seg-btn" data-theme-btn="dark" aria-pressed="false">Dark Mode</button></div>' +
          '<p class="field-hint" style="margin-top:10px">Your choice is remembered on this device.</p></section>' +
        '<section class="card"><h2 class="section-title" style="margin-top:0">Account</h2>' +
          '<div class="setting-row"><span class="muted">Logged in as</span><strong>' + esc(user.email) + "</strong></div>" +
          '<div class="setting-row"><span class="muted">Role</span><span class="badge badge-job">' + esc(user.role.toUpperCase()) + "</span></div>" +
          '<div style="margin-top:14px"><button type="button" class="btn btn-secondary btn-block" id="stSignOut">' + icon("logout", 18) + "<span>Sign Out</span></button></div></section>" +
        (isOwner
          ? '<section class="card"><h2 class="section-title" style="margin-top:0">Owner tools</h2><div class="btn-stack">' +
              '<button type="button" class="btn btn-secondary" data-route="machines">' + icon("gear", 18) + "<span>Machine Management</span></button>" +
              '<button type="button" class="btn btn-secondary" data-route="data">' + icon("trash", 18) + "<span>Data Management</span></button></div></section>"
          : "") +
        (canDownload
          ? '<section class="card"><h2 class="section-title" style="margin-top:0">Excel downloads</h2><div class="btn-stack">' +
              dl("today", "Today's Stocks IN") + dl("in", "All Stocks IN") + dl("out", "All Stocks OUT") +
              (Permissions.can("exportAdmin") ? dl("history", "Full History") : "") + "</div></section>"
          : "") +
      "</div>";

    const paintTheme = () => $$("[data-theme-btn]", root).forEach((b) => {
      const on = b.dataset.themeBtn === Theme.current();
      b.classList.toggle("selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    paintTheme();

    root.addEventListener("click", (e) => {
      const themeBtn = e.target.closest("[data-theme-btn]");
      if (themeBtn) { Theme.set(themeBtn.dataset.themeBtn); paintTheme(); return; }
      if (e.target.closest("#stSignOut")) { Auth.signOut(); return; }
      const route = e.target.closest("[data-route]");
      if (route) { Router.go(route.dataset.route); return; }
      const excel = e.target.closest("[data-excel]");
      if (excel) runBusy(excel, () => Excel.download(excel.dataset.excel));
    });
  }
};

/* ---------- 3. DATA MANAGEMENT PAGE (owner only) ---------- */
const DataPage = {
  title: "Data Management",

  render(root) {
    root.innerHTML =
      '<div class="page-head"><div><h1 class="page-title">Data Management</h1>' +
      '<p class="page-sub">Delete old records to keep the system fast. Nothing is deleted automatically.</p></div></div>' +
      '<div class="settings-grid">' +
        '<section class="card danger-zone"><h2 class="section-title" style="margin-top:0">Delete data older than:</h2>' +
          '<div class="seg" style="grid-template-columns:1fr 1fr">' +
            [30, 60, 90, 120].map((d) => '<button type="button" class="seg-btn" data-days="' + d + '">' + d + " days</button>").join("") + "</div>" +
          '<p class="field-hint" style="margin-top:12px"><strong>Deleted permanently:</strong> history entries older than the chosen days, stocks that went OUT before that date (with their photos), and finished jobs.</p>' +
          '<p class="field-hint"><strong>Never deleted:</strong> any stock that is currently IN or ROLLED, and its history.</p>' +
          '<p class="field-hint">Before you delete, you will see exactly how many records are affected.</p></section>' +
        '<section class="card"><h2 class="section-title" style="margin-top:0">Backup first</h2>' +
          '<p class="field-hint" style="margin-bottom:14px">Downloading the Full History to Excel before cleaning up is a good habit.</p>' +
          '<div class="btn-stack"><button type="button" class="btn btn-secondary" data-excel="history">' + icon("download", 18) + "<span>Download Full History</span></button>" +
          '<button type="button" class="btn btn-secondary" data-excel="out">' + icon("download", 18) + "<span>Download All Stocks OUT</span></button></div></section>" +
      "</div>";

    async function start(days, btn) {
      await runBusy(btn, async () => {
        const plan = await Cleanup.plan(days);
        if (!plan.total) { Toast.info("There are no records older than " + days + " days."); return; }

        const ok = await confirmDialog({
          title: "Delete old data",
          message: "You are about to delete " + plan.total + " records older than " + days + " days (" +
            plan.history.length + " history entries, " + plan.stocks.length + " completed stocks, " + plan.jobs.length + " finished jobs). " +
            "This will permanently delete them. This cannot be undone." +
            (plan.capped ? " Only the first " + Cleanup.MAX + " of each kind will be deleted now; run it again for the rest." : ""),
          confirmText: "Delete Permanently", danger: true
        });
        if (!ok) return;

        const count = await Cleanup.run(plan);
        Toast.success("Old data deleted (" + count + " records).");
      });
    }

    root.addEventListener("click", (e) => {
      const daysBtn = e.target.closest("[data-days]");
      if (daysBtn) { start(Number(daysBtn.dataset.days), daysBtn); return; }
      const excel = e.target.closest("[data-excel]");
      if (excel) runBusy(excel, () => Excel.download(excel.dataset.excel));
    });
  }
};
