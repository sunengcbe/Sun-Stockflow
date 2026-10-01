/* ==========================================================
   history.js: the Full History page.
   Reads the "stockHistory" collection, newest first, 50 records at a time.
   The date range and sort order run on the server.
   The other filters run on the records already loaded; the page keeps loading
   more automatically (up to a limit) until enough records match.
   ========================================================== */

const HISTORY_ACTIONS = {
  STOCK_IN: { label: "Stock IN", cls: "badge-in" },
  ROLLED: { label: "Rolled", cls: "badge-rolled" },
  UNDO_ROLLED: { label: "Undo Rolled", cls: "badge-alert" },
  STOCK_OUT: { label: "Stock OUT", cls: "badge-out" },
  UNDO_STOCK_OUT: { label: "Undo Stock OUT", cls: "badge-alert" },
  EDITED: { label: "Edited", cls: "badge-normal" },
  DELETED: { label: "Deleted", cls: "badge-out" },
  JOB_ASSIGNED: { label: "Job Assigned", cls: "badge-job" },
  JOB_UPDATED: { label: "Job Updated", cls: "badge-job" }
};

const HistoryPage = {
  title: "Full History",

  render(root) {
    const PAGE = APP_CONFIG.historyPageSize;
    const canExcel = Permissions.can("exportAdmin");

    let rows = [], cursor = null, exhausted = false, loading = false;
    let sortDir = "desc", dateFrom = "", dateTo = "";
    let token = 0;               // ignores answers that arrive after a reset
    let optionSig = "";
    const f = { search: "", supplier: "", threadForm: "", materialType: "", status: "", action: "", machine: "", operator: "", job: "" };

    const field = (label, inner) => '<div class="field"><label class="field-label">' + label + "</label>" + inner + "</div>";
    const sel = (id, label) => '<div class="field"><label class="field-label" for="' + id + '">' + label + '</label><select class="select" id="' + id + '"></select></div>';

    root.innerHTML =
      '<div class="page-head"><div><h1 class="page-title">Full History</h1>' +
      '<p class="page-sub">Every stock movement, job change and edit.</p></div>' +
      '<div class="page-actions">' +
        (canExcel ? '<button type="button" class="btn btn-secondary" id="hExcel">' + icon("download", 18) + "<span>Download Excel</span></button>" : "") +
      "</div></div>" +
      '<div class="card filters">' +
        '<div class="field"><label class="field-label" for="hSearch">Search</label><input class="input" id="hSearch" type="search" placeholder="Supplier, thread form, user…" autocomplete="off"></div>' +
        sel("hSupplier", "Supplier") + sel("hThread", "Thread Form") + sel("hMaterial", "Material Type") +
        sel("hStatus", "Status") + sel("hAction", "Action") + sel("hMachine", "Machine") + sel("hOperator", "Operator") + sel("hJob", "Job Assignment") +
        '<div class="field"><label class="field-label" for="hFrom">From date</label><input class="input" id="hFrom" type="date"></div>' +
        '<div class="field"><label class="field-label" for="hTo">To date</label><input class="input" id="hTo" type="date"></div>' +
        sel("hSort", "Sort") +
        '<div class="field"><span class="field-label">&nbsp;</span><button type="button" class="btn btn-secondary" id="hClear">Clear Filters</button></div>' +
      "</div>" +
      '<div id="histArea"></div>';

    const el = (id) => $("#" + id, root);

    /* ----- drop-down contents ----- */
    const opt = (value, label) => '<option value="' + esc(value) + '">' + esc(label) + "</option>";
    function setOptions(id, html, current) {
      const s = el(id);
      s.innerHTML = html;
      s.value = current;
      if (s.value !== current) s.value = "";   // the old choice no longer exists
    }
    function fillStaticOptions() {
      setOptions("hStatus", opt("", "All statuses") + ["IN", "ROLLED", "OUT", "DELETED"].map((s) => opt(s, s)).join(""), f.status);
      setOptions("hAction", opt("", "All actions") + Object.keys(HISTORY_ACTIONS).map((k) => opt(k, HISTORY_ACTIONS[k].label)).join(""), f.action);
      setOptions("hJob", opt("", "Any") + opt("yes", "Job assigned") + opt("no", "Not assigned"), f.job);
      setOptions("hSort", opt("desc", "Newest first") + opt("asc", "Oldest first"), sortDir);
    }
    function fillNameOptions() {
      const names = (list, key) => list.map((x) => x[key]).filter(Boolean);
      const lists = {
        hSupplier: ["All suppliers", names(Store.suppliers, "name"), f.supplier],
        hThread: ["All thread forms", names(Store.threadForms, "name"), f.threadForm],
        hMaterial: ["All material types", names(Store.materialTypes, "name"), f.materialType],
        hMachine: ["All machines", names(Store.machines, "machineName"), f.machine],
        hOperator: ["All operators", names(Store.operators, "name"), f.operator]
      };
      const sig = JSON.stringify(Object.keys(lists).map((k) => lists[k][1]));
      if (sig === optionSig) return;
      optionSig = sig;
      Object.keys(lists).forEach((id) => {
        const [all, values, current] = lists[id];
        setOptions(id, opt("", all) + values.map((v) => opt(v, v)).join(""), current);
      });
    }

    /* ----- filtering (on loaded rows) ----- */
    const rowStatus = (r) => (r.action === "DELETED" ? "DELETED" : (r.toStatus || r.fromStatus || ""));
    const hasFilters = () => Object.keys(f).some((k) => f[k]);

    function matches(r) {
      if (f.supplier && r.supplierName !== f.supplier) return false;
      if (f.threadForm && r.threadForm !== f.threadForm) return false;
      if (f.materialType && r.materialType !== f.materialType) return false;
      if (f.status && rowStatus(r) !== f.status) return false;
      if (f.action && r.action !== f.action) return false;
      if (f.machine && r.machineName !== f.machine) return false;
      if (f.operator && r.operatorName !== f.operator) return false;
      if (f.job === "yes" && !r.jobAssigned) return false;
      if (f.job === "no" && r.jobAssigned) return false;
      return matchesSearch([r.supplierName, r.threadForm, r.materialType, r.quantity, r.userEmail, r.details, r.machineName, r.operatorName, (HISTORY_ACTIONS[r.action] || {}).label], f.search);
    }
    const filtered = () => rows.filter(matches);

    /* ----- loading from Firestore ----- */
    async function fetchPage() {
      let q = db.collection("stockHistory");
      if (dateFrom) q = q.where("timestamp", ">=", Timestamp.fromDate(new Date(dateFrom + "T00:00:00")));
      if (dateTo) q = q.where("timestamp", "<=", Timestamp.fromDate(new Date(dateTo + "T23:59:59.999")));
      q = q.orderBy("timestamp", sortDir);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.limit(PAGE).get();
      return {
        last: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
        size: snap.docs.length,
        list: snap.docs.map((d) => Object.assign({ id: d.id }, d.data({ serverTimestamps: "estimate" })))
      };
    }

    async function loadMore() {
      if (loading || exhausted) return;
      const mine = token;
      loading = true;
      paint();
      try {
        const before = filtered().length;
        let rounds = 0;
        do {
          const page = await fetchPage();
          if (mine !== token) return;   // filters were reset meanwhile
          rows = rows.concat(page.list);
          if (page.last) cursor = page.last;
          if (page.size < PAGE) exhausted = true;
          rounds++;
        } while (!exhausted && hasFilters() && filtered().length < before + PAGE && rounds < 8);
      } catch (err) {
        Toast.error(friendlyError(err));
      }
      if (mine === token) { loading = false; paint(); }
    }

    function reset() {      // used when the date range or sort order changes
      token++;
      rows = []; cursor = null; exhausted = false; loading = false;
      loadMore();
    }

    function ensureEnough() {
      if (hasFilters() && !exhausted && !loading && filtered().length < PAGE) loadMore();
    }

    /* ----- drawing ----- */
    function rowHtml(r) {
      const a = HISTORY_ACTIONS[r.action] || { label: r.action || "—", cls: "badge-normal" };
      const flow = (r.fromStatus || r.toStatus) && r.fromStatus !== r.toStatus ? (r.fromStatus || "—") + " → " + (r.toStatus || "—") : "";
      const sub = [r.materialType, r.quantity ? "Qty " + r.quantity : "", r.machineName, r.operatorName ? "Operator: " + r.operatorName : "", flow].filter(Boolean).join(" · ");
      const inner =
        '<span class="history-time">' + esc(fmtDateTime(r.timestamp)) + "</span>" +
        '<span><span class="badge ' + a.cls + '">' + esc(a.label) + "</span></span>" +
        '<span class="history-main"><strong>' + esc(r.supplierName || "—") + "</strong> · " + esc(r.threadForm || "—") +
          (sub ? '<div class="history-sub">' + esc(sub) + "</div>" : "") +
          (r.details ? '<div class="history-sub">' + esc(r.details) + "</div>" : "") + "</span>" +
        '<span class="history-sub">' + esc(r.userEmail || "") + "</span>";
      if (r.action === "DELETED" || !r.stockId) return '<div class="history-row">' + inner + "</div>";
      return '<button type="button" class="history-row" data-stock="' + esc(r.stockId) + '">' + inner + "</button>";
    }

    function paint() {
      const area = el("histArea");
      if (!rows.length && loading) { area.innerHTML = UI.loadingHtml(); return; }
      if (!rows.length && exhausted) { area.innerHTML = UI.emptyHtml("No history records found."); return; }

      const list = filtered();
      let html;
      if (!list.length) {
        html = UI.emptyHtml(rows.length ? "No loaded records match these filters." : "No history records found.");
      } else {
        html = '<div class="result-count">Showing ' + list.length + (list.length === 1 ? " record" : " records") + " (" + rows.length + " loaded so far)</div>" +
          '<div class="history-list">' + list.map(rowHtml).join("") + "</div>";
      }
      if (!exhausted) {
        html += '<div class="load-more"><button type="button" class="btn btn-secondary" id="hMore"' + (loading ? " disabled" : "") + ">" + (loading ? "Loading…" : "Load more records") + "</button></div>";
      } else if (rows.length) {
        html += '<p class="muted" style="text-align:center;margin-top:18px">End of history.</p>';
      }
      area.innerHTML = html;
    }

    /* ----- events ----- */
    const bindSelect = (id, key) => el(id).addEventListener("change", (e) => { f[key] = e.target.value; paint(); ensureEnough(); });
    bindSelect("hSupplier", "supplier"); bindSelect("hThread", "threadForm"); bindSelect("hMaterial", "materialType");
    bindSelect("hStatus", "status"); bindSelect("hAction", "action"); bindSelect("hMachine", "machine");
    bindSelect("hOperator", "operator"); bindSelect("hJob", "job");

    el("hSearch").addEventListener("input", debounce((e) => { f.search = e.target.value; paint(); ensureEnough(); }, 250));
    el("hFrom").addEventListener("change", (e) => { dateFrom = e.target.value; reset(); });
    el("hTo").addEventListener("change", (e) => { dateTo = e.target.value; reset(); });
    el("hSort").addEventListener("change", (e) => { sortDir = e.target.value; reset(); });

    el("hClear").addEventListener("click", () => {
      Object.keys(f).forEach((k) => { f[k] = ""; });
      el("hSearch").value = ""; el("hFrom").value = ""; el("hTo").value = "";
      const dateOrSortChanged = dateFrom || dateTo || sortDir !== "desc";
      dateFrom = ""; dateTo = ""; sortDir = "desc";
      optionSig = "";
      fillStaticOptions(); fillNameOptions();
      if (dateOrSortChanged) reset(); else paint();
    });

    root.addEventListener("click", (e) => {
      if (e.target.closest("#hMore")) { loadMore(); return; }
      const row = e.target.closest("[data-stock]");
      if (row) StockDetail.open(row.dataset.stock);
    });

    const excelBtn = $("#hExcel", root);
    if (excelBtn) excelBtn.addEventListener("click", () => runBusy(excelBtn, () => Excel.download("history")));

    fillStaticOptions();
    fillNameOptions();
    loadMore();
    return Store.subscribe(fillNameOptions);   // names may arrive after the page opens
  }
};
