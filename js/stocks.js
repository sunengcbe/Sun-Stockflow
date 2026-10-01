/* ==========================================================
   stocks.js
   1. Stocks        every action that changes a stock (add, edit, roll, undo, stock out, delete)
   2. StockDetail   the big pop-up shown when a stock card is clicked
   3. List pages    Stocks IN, Rolled and Stocks OUT pages
   Every action checks the permission first. firestore.rules checks again on the server.
   ========================================================== */

/* ---------- 1. STOCK ACTIONS ---------- */

// Values used to clear the job fields on a stock
const NO_JOB = {
  jobAssigned: false, jobId: null,
  assignedMachineId: null, assignedMachineName: null,
  assignedOperatorId: null, assignedOperatorName: null,
  assignedAt: null, expectedDuration: "", priority: null
};

const Stocks = {
  photoCache: {},

  _online() { if (navigator.onLine === false) throw { code: "network-request-failed" }; },

  // Shows an orange alert if the stock has waited too long (limits are in config.js)
  overdueInfo(s) {
    if (s.status === "IN") {
      const days = daysSince(s.stockInAt);
      const limit = APP_CONFIG.stockNotRolledDays;
      if (days > limit) return { days, limit, message: "Stock has not been rolled for more than " + limit + " days." };
    }
    if (s.status === "ROLLED") {
      const days = daysSince(s.rolledAt);
      const limit = APP_CONFIG.rolledNotStockedOutDays;
      if (days > limit) return { days, limit, message: "Stock has not been stocked out for more than " + limit + " days." };
    }
    return null;
  },

  // One line for the "stockHistory" collection (also used by jobs.js)
  historyData(action, stock, fromStatus, toStatus, extra) {
    return Object.assign({
      stockId: stock.id,
      action,
      fromStatus: fromStatus || null,
      toStatus: toStatus || null,
      timestamp: SERVER_TS(),
      userEmail: Auth.user.email,
      supplierName: stock.supplierName || "",
      threadForm: stock.threadForm || "",
      materialType: stock.materialType || "",
      quantity: stock.quantity || "",
      jobAssigned: !!stock.jobAssigned,
      machineId: stock.assignedMachineId || null,
      machineName: stock.assignedMachineName || "",
      operatorId: stock.assignedOperatorId || null,
      operatorName: stock.assignedOperatorName || "",
      details: ""
    }, extra || {});
  },

  async getPhoto(id) {
    if (this.photoCache[id] !== undefined) return this.photoCache[id];
    const snap = await db.collection("stockPhotos").doc(id).get();
    const url = snap.exists ? snap.data().dataUrl : null;
    const keys = Object.keys(this.photoCache);
    if (keys.length >= 10) delete this.photoCache[keys[0]];   // keep memory small
    this.photoCache[id] = url;
    return url;
  },

  /* ----- ADD ----- */
  async create(data, photoDataUrl) {
    Permissions.require("addStock");
    this._online();
    const email = Auth.user.email;
    const ref = db.collection("stocks").doc();

    const doc = Object.assign({}, data, {
      hasPhoto: !!photoDataUrl,
      createdAt: SERVER_TS(), stockInAt: SERVER_TS(), rolledAt: null, stockOutAt: null, updatedAt: SERVER_TS(),
      status: "IN",
      createdBy: email, updatedBy: email, rolledBy: null, stockedOutBy: null
    }, NO_JOB);

    const batch = db.batch();
    batch.set(ref, doc);
    if (photoDataUrl) {
      batch.set(db.collection("stockPhotos").doc(ref.id), { dataUrl: photoDataUrl, updatedBy: email, updatedAt: SERVER_TS() });
    }
    batch.set(db.collection("stockHistory").doc(),
      this.historyData("STOCK_IN", Object.assign({ id: ref.id }, data), null, "IN"));
    await batch.commit();
    return ref.id;
  },

  /* ----- EDIT (only descriptive fields; the timestamps are never touched) ----- */
  async update(stock, data, photo) {
    Permissions.require("editStock");
    this._online();
    const email = Auth.user.email;
    const fields = ["supplierName", "supplierPhone", "threadForm", "materialType", "threadLength", "sides", "quantity", "description"];

    const changed = fields.filter((f) => String(stock[f] ?? "") !== String(data[f] ?? ""));
    if (photo && photo.dataUrl) changed.push("photo");
    else if (photo && photo.remove) changed.push("photo removed");
    if (!changed.length) return false;   // nothing changed

    const patch = {};
    fields.forEach((f) => { patch[f] = data[f] ?? ""; });
    patch.updatedBy = email;
    patch.updatedAt = SERVER_TS();

    const batch = db.batch();
    const photoRef = db.collection("stockPhotos").doc(stock.id);
    if (photo && photo.dataUrl) {
      patch.hasPhoto = true;
      batch.set(photoRef, { dataUrl: photo.dataUrl, updatedBy: email, updatedAt: SERVER_TS() });
    } else if (photo && photo.remove) {
      patch.hasPhoto = false;
      batch.delete(photoRef);
    }
    batch.update(db.collection("stocks").doc(stock.id), patch);

    // Keep the job card in the schedule in step with the stock
    if (stock.status === "IN" && stock.jobAssigned && stock.jobId) {
      batch.update(db.collection("jobs").doc(stock.jobId), {
        supplierName: patch.supplierName, threadForm: patch.threadForm,
        materialType: patch.materialType, quantity: patch.quantity
      });
    }
    batch.set(db.collection("stockHistory").doc(),
      this.historyData("EDITED", Object.assign({}, stock, patch), stock.status, stock.status, { details: "Changed: " + changed.join(", ") }));
    await batch.commit();
    delete this.photoCache[stock.id];
    return true;
  },

  /* Status changes run inside a transaction: the database re-checks the stock's
     current status first, so two people clicking at the same moment cannot corrupt it. */
  async _transition(stockId, expectedStatus, build) {
    this._online();
    const ref = db.collection("stocks").doc(stockId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw { userMessage: "This stock no longer exists." };
      const cur = Object.assign({ id: snap.id }, snap.data());
      if (cur.status !== expectedStatus) throw { userMessage: "Someone else has already changed this stock. Please check the lists." };
      build(tx, ref, cur);
    });
  },

  _history(tx, action, cur, from, to, extra) {
    tx.set(db.collection("stockHistory").doc(), this.historyData(action, cur, from, to, extra));
  },

  /* ----- ROLL (IN -> ROLLED). Its job, if any, is marked DONE ----- */
  async roll(stock) {
    Permissions.require("rollStock");
    const email = Auth.user.email;
    await this._transition(stock.id, "IN", (tx, ref, cur) => {
      tx.update(ref, { status: "ROLLED", rolledAt: SERVER_TS(), rolledBy: email, updatedBy: email, updatedAt: SERVER_TS() });
      if (cur.jobAssigned && cur.jobId) {
        tx.update(db.collection("jobs").doc(cur.jobId), { status: "DONE", closedAt: SERVER_TS(), closedBy: email, closeReason: "ROLLED" });
      }
      this._history(tx, "ROLLED", cur, "IN", "ROLLED");
    });
  },

  /* ----- UNDO ROLLED (ROLLED -> IN). The old job stays in history; the stock is "not assigned" again ----- */
  async undoRoll(stock) {
    Permissions.require("undoRoll");
    const email = Auth.user.email;
    await this._transition(stock.id, "ROLLED", (tx, ref, cur) => {
      tx.update(ref, Object.assign({ status: "IN", rolledAt: null, rolledBy: null, updatedBy: email, updatedAt: SERVER_TS() }, NO_JOB));
      this._history(tx, "UNDO_ROLLED", cur, "ROLLED", "IN");
    });
  },

  /* ----- STOCK OUT (ROLLED -> OUT) ----- */
  async stockOut(stock) {
    Permissions.require("stockOut");
    const email = Auth.user.email;
    await this._transition(stock.id, "ROLLED", (tx, ref, cur) => {
      tx.update(ref, { status: "OUT", stockOutAt: SERVER_TS(), stockedOutBy: email, updatedBy: email, updatedAt: SERVER_TS() });
      this._history(tx, "STOCK_OUT", cur, "ROLLED", "OUT");
    });
  },

  /* ----- UNDO STOCK OUT (OUT -> ROLLED) ----- */
  async undoOut(stock) {
    Permissions.require("undoStockOut");
    const email = Auth.user.email;
    await this._transition(stock.id, "OUT", (tx, ref, cur) => {
      tx.update(ref, { status: "ROLLED", stockOutAt: null, stockedOutBy: null, updatedBy: email, updatedAt: SERVER_TS() });
      this._history(tx, "UNDO_STOCK_OUT", cur, "OUT", "ROLLED");
    });
  },

  /* ----- DELETE (only from Stocks IN). A waiting job is cancelled ----- */
  async remove(stock) {
    Permissions.require("deleteStock");
    const email = Auth.user.email;
    await this._transition(stock.id, "IN", (tx, ref, cur) => {
      tx.delete(ref);
      if (cur.hasPhoto) tx.delete(db.collection("stockPhotos").doc(cur.id));
      if (cur.jobAssigned && cur.jobId) {
        tx.update(db.collection("jobs").doc(cur.jobId), { status: "CANCELLED", closedAt: SERVER_TS(), closedBy: email, closeReason: "STOCK_DELETED" });
      }
      this._history(tx, "DELETED", cur, "IN", null, { details: "Deleted by " + email, deletedBy: email });
    });
    delete this.photoCache[stock.id];
  }
};

/* ---------- 2. STOCK DETAIL POP-UP ---------- */

function detailBodyHtml(s) {
  const row = (k, v, full) =>
    '<div class="detail-row' + (full ? " full" : "") + '"><div class="k">' + k + '</div><div class="v">' + (v ? esc(v) : "—") + "</div></div>";
  const rawRow = (k, html) => '<div class="detail-row"><div class="k">' + k + '</div><div class="v">' + html + "</div></div>";

  const overdue = Stocks.overdueInfo(s);
  let statusHtml = UI.statusBadge(s.status);
  if (s.status === "IN") statusHtml += " " + UI.jobBadge(s);
  if (overdue) statusHtml += ' <span class="badge badge-alert">Over ' + overdue.limit + " days</span>";

  let grid =
    row("Supplier Name", s.supplierName) + row("Supplier Phone", s.supplierPhone) +
    row("Thread Form", s.threadForm) + row("Material Type", s.materialType) +
    row("Thread Length", s.threadLength) + row("Sides", s.sides) +
    row("Quantity", s.quantity) + rawRow("Status", statusHtml) +
    row("Stock IN", fmtDateTime(s.stockInAt));
  if (s.rolledAt || s.status === "ROLLED" || s.status === "OUT") grid += row("Rolled", s.rolledAt ? fmtDateTime(s.rolledAt) : "");
  if (s.stockOutAt || s.status === "OUT") grid += row("Stock OUT", s.stockOutAt ? fmtDateTime(s.stockOutAt) : "");
  grid += row("Description", s.description, true);
  grid += row("Added by", s.createdBy);
  if (s.rolledBy) grid += row("Rolled by", s.rolledBy);
  if (s.stockedOutBy) grid += row("Stocked out by", s.stockedOutBy);

  let job = "";
  if (s.status === "IN" && s.jobAssigned) {
    job = '<div class="detail-job"><h3>Job Assignment</h3><div class="detail-grid">' +
      row("Machine", s.assignedMachineName) + row("Operator", s.assignedOperatorName) +
      rawRow("Priority", UI.priorityBadge(s.priority)) + row("Expected Time", s.expectedDuration) +
      row("Assignment Date", s.assignedAt ? fmtDateTime(s.assignedAt) : "") + "</div></div>";
  }

  return '<div class="detail-layout' + (s.hasPhoto ? " has-photo" : "") + '">' +
    "<div>" + '<div class="detail-grid">' + grid + "</div>" + job + "</div>" +
    (s.hasPhoto ? '<div class="detail-photo" id="detailPhoto"></div>' : "") +
  "</div>";
}

const StockDetail = {
  async open(id) {
    let stock = Store.findStock(id);
    const fromStore = !!stock;
    if (!stock) {   // e.g. an old record opened from Full History
      try {
        const snap = await db.collection("stocks").doc(id).get();
        if (snap.exists) stock = Object.assign({ id: snap.id }, snap.data());
      } catch (err) { Toast.error(friendlyError(err)); return; }
    }
    if (!stock) { Toast.error("This stock no longer exists. It may have been deleted."); return; }

    let photoSrc = null;
    let photoState = "none";   // none | loading | ready | error
    let unsub = null;
    const sigOf = (s) => [s.status, timeValue(s.updatedAt), s.jobAssigned, s.assignedMachineName, s.assignedOperatorName, s.priority, s.hasPhoto].join("|");
    let sig = sigOf(stock);

    const handle = Modal.open({
      title: "Stock Details", size: "lg", body: "", foot: document.createElement("div"),
      onClose: () => { if (unsub) unsub(); }
    });

    const mk = (text, cls, iconName, handler) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn " + cls;
      b.innerHTML = icon(iconName, 18) + "<span>" + esc(text) + "</span>";
      b.addEventListener("click", () => handler(b));
      return b;
    };

    const paintPhoto = () => {
      const box = $("#detailPhoto", handle.body);
      if (!box) return;
      box.innerHTML = "";
      if (photoState === "loading") { box.innerHTML = '<div class="photo-loading">Loading photo…</div>'; return; }
      if (photoState === "error") { box.innerHTML = '<div class="photo-loading">Photo could not be loaded.</div>'; return; }
      if (photoState !== "ready") { box.innerHTML = '<div class="photo-loading">Photo not available.</div>'; return; }
      const img = new Image();
      img.src = photoSrc;
      img.alt = "Photo attached to this stock";
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      const view = () => UI.openLightbox(photoSrc);
      img.addEventListener("click", view);
      img.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); view(); } });
      const caption = document.createElement("div");
      caption.className = "photo-caption";
      caption.textContent = "Tap the photo to enlarge";
      box.append(img, caption);
    };

    const loadPhoto = async () => {
      if (!stock.hasPhoto) { photoSrc = null; photoState = "none"; paintPhoto(); return; }
      photoState = "loading"; paintPhoto();
      try {
        photoSrc = await Stocks.getPhoto(stock.id);
        photoState = photoSrc ? "ready" : "none";
      } catch (err) { console.error(err); photoState = "error"; }
      paintPhoto();
    };

    const render = () => {
      const s = stock;
      handle.body.innerHTML = detailBodyHtml(s);
      paintPhoto();

      // top-right: Edit (Stocks IN only)
      handle.headActions.innerHTML = "";
      if (s.status === "IN" && Permissions.can("editStock")) {
        handle.headActions.appendChild(mk("Edit", "btn-secondary btn-sm", "edit", () => StockForm.openEdit(stock)));
      }

      // bottom buttons
      const bar = document.createElement("div");
      bar.className = "modal-foot-buttons";
      if (s.status === "IN") {
        if (Permissions.can("deleteStock")) bar.appendChild(mk("Delete", "btn-danger", "trash", (b) => this._delete(stock, b, handle)));
        if (Permissions.can("assignJob")) {
          bar.appendChild(mk(s.jobAssigned ? "Edit Job" : "Assign Job", "btn-secondary", "assign", () => {
            handle.close();
            Router.go("assign-job", { stock: stock.id });
          }));
        }
        if (Permissions.can("rollStock")) bar.appendChild(mk("Rolled", "btn-primary", "roll", (b) => this._roll(stock, b, handle)));
      } else if (s.status === "ROLLED") {
        if (Permissions.can("undoRoll")) bar.appendChild(mk("Undo", "btn-secondary", "undo", (b) => this._undoRoll(stock, b, handle)));
        if (Permissions.can("stockOut")) bar.appendChild(mk("Stock Out", "btn-primary", "out", (b) => this._stockOut(stock, b, handle)));
      } else if (s.status === "OUT") {
        if (Permissions.can("undoStockOut")) bar.appendChild(mk("Undo", "btn-secondary", "undo", (b) => this._undoOut(stock, b, handle)));
      }
      handle.foot.innerHTML = "";
      handle.foot.hidden = !bar.childNodes.length;
      handle.foot.appendChild(bar);
    };

    render();
    loadPhoto();

    // Live updates: if someone else changes this stock, the pop-up refreshes itself
    unsub = Store.subscribe(() => {
      if (handle._closed) return;
      const fresh = Store.findStock(id);
      if (!fresh) { if (fromStore) { handle.close(); Toast.info("This stock was moved or removed."); } return; }
      const newSig = sigOf(fresh);
      if (newSig === sig) return;
      const photoChanged = fresh.hasPhoto !== stock.hasPhoto || timeValue(fresh.updatedAt) !== timeValue(stock.updatedAt);
      stock = fresh; sig = newSig;
      render();
      if (photoChanged) loadPhoto();
    });
  },

  async _roll(stock, btn, handle) {            // no confirmation, as requested
    await runBusy(btn, async () => { await Stocks.roll(stock); Toast.success("Stock Rolled Successfully!"); handle.close(); });
  },

  async _stockOut(stock, btn, handle) {        // no confirmation, as requested
    await runBusy(btn, async () => { await Stocks.stockOut(stock); Toast.success("Stocked Out Successfully!"); handle.close(); });
  },

  async _undoRoll(stock, btn, handle) {
    const ok = await confirmDialog({ title: "Undo Rolled", message: "Move this stock back to Stocks IN?", confirmText: "Move Back" });
    if (!ok) return;
    await runBusy(btn, async () => { await Stocks.undoRoll(stock); Toast.success("Stock Moved Back!"); handle.close(); });
  },

  async _undoOut(stock, btn, handle) {
    const ok = await confirmDialog({ title: "Undo Stock Out", message: "Move this stock back to Rolled?", confirmText: "Move Back" });
    if (!ok) return;
    await runBusy(btn, async () => { await Stocks.undoOut(stock); Toast.success("Stock Moved Back!"); handle.close(); });
  },

  async _delete(stock, btn, handle) {
    const ok = await confirmDialog({
      title: "Delete stock", message: "Are you sure you want to permanently delete this stock?",
      confirmText: "Delete", danger: true
    });
    if (!ok) return;
    await runBusy(btn, async () => { await Stocks.remove(stock); Toast.success("Stock Deleted."); handle.close(); });
  }
};

/* ---------- 3. LIST PAGES (Stocks IN / Rolled / Stocks OUT) ---------- */

function createStockListPage(cfg) {
  return {
    title: cfg.title,

    render(root, params) {
      const PAGE_SIZE = 60;
      let query = "";
      let sortKey = "newest";
      let limit = PAGE_SIZE;
      let focusId = (params && params.focus) || null;

      const byDate = (a, b) => timeValue(b[cfg.dateField]) - timeValue(a[cfg.dateField]);
      const comparators = {
        newest: byDate,
        oldest: (a, b) => timeValue(a[cfg.dateField]) - timeValue(b[cfg.dateField]),
        supplier: (a, b) => naturalCompare(a.supplierName, b.supplierName),
        unassigned: (a, b) => ((a.jobAssigned ? 1 : 0) - (b.jobAssigned ? 1 : 0)) || byDate(a, b),
        urgent: (a, b) => ((b.priority === "URGENT" ? 1 : 0) - (a.priority === "URGENT" ? 1 : 0)) || byDate(a, b)
      };

      const canAdd = cfg.status === "IN" && Permissions.can("addStock");
      const canExport = cfg.excel && Permissions.can("exportStocks");

      root.innerHTML =
        '<div class="page-head"><div><h1 class="page-title">' + esc(cfg.title) + '</h1><p class="page-sub">' + esc(cfg.subtitle) + "</p></div>" +
          '<div class="page-actions">' +
            (canAdd ? '<button type="button" class="btn btn-primary" id="btnAddNew">' + icon("plus", 18) + "<span>Add New</span></button>" : "") +
            (canExport ? '<button type="button" class="btn btn-secondary" id="btnExcel">' + icon("download", 18) + "<span>Download Excel</span></button>" : "") +
          "</div></div>" +
        '<div class="toolbar">' +
          '<div class="search-wrap">' + icon("search", 20) +
            '<input class="search-input" id="listSearch" type="search" placeholder="Search supplier, thread form, material, quantity…" aria-label="Search" autocomplete="off"></div>' +
          '<select class="select" id="listSort" aria-label="Sort by">' +
            cfg.sorts.map((x) => '<option value="' + x.key + '">' + esc(x.label) + "</option>").join("") +
          "</select>" +
        "</div>" +
        '<div id="listArea"></div>';

      const area = $("#listArea", root);

      function paint() {
        if (!Store.loaded[cfg.loadedKey]) { area.innerHTML = UI.loadingHtml(); return; }
        const all = Store[cfg.listKey];
        if (!all.length) { area.innerHTML = UI.emptyHtml(cfg.emptyText) + olderHtml(); return; }

        const list = all
          .filter((s) => matchesSearch([s.supplierName, s.threadForm, s.materialType, s.quantity, s.threadLength, s.supplierPhone], query))
          .sort(comparators[sortKey]);
        if (!list.length) { area.innerHTML = UI.emptyHtml("No stocks match your search.") + olderHtml(); return; }

        // Make sure a stock we were sent to (from an alert) is within the visible part
        if (focusId) {
          const at = list.findIndex((s) => s.id === focusId);
          if (at >= limit) limit = at + 1;
        }
        const shown = list.slice(0, limit);
        area.innerHTML =
          '<div class="result-count">Showing ' + shown.length + " of " + list.length + "</div>" +
          '<div class="stock-grid">' + shown.map((s) => UI.stockCardHtml(s)).join("") + "</div>" +
          (list.length > shown.length ? '<div class="load-more"><button type="button" class="btn btn-secondary" id="btnMore">Show more</button></div>' : "") +
          olderHtml();

        if (focusId) {
          const card = area.querySelector('.stock-card[data-id="' + CSS.escape(focusId) + '"]');
          if (card) {
            card.scrollIntoView({ block: "center", behavior: "smooth" });
            card.classList.add("flash");
            focusId = null;   // only once
          }
        }
      }

      // Stocks OUT keeps only recent records loaded; this button loads older ones
      function olderHtml() {
        return cfg.status === "OUT"
          ? '<div class="load-more"><button type="button" class="btn btn-secondary" id="btnOlder">Load older records (currently last ' + Store.outDays + " days)</button></div>"
          : "";
      }

      area.addEventListener("click", (e) => {
        if (e.target.closest("#btnMore")) { limit += PAGE_SIZE; paint(); return; }
        if (e.target.closest("#btnOlder")) { Store.extendOutDays(30); Toast.info("Loading older records…"); return; }
        const card = e.target.closest(".stock-card");
        if (card) StockDetail.open(card.dataset.id);
      });

      $("#listSearch", root).addEventListener("input", debounce((e) => { query = e.target.value; limit = PAGE_SIZE; paint(); }, 200));
      $("#listSort", root).addEventListener("change", (e) => { sortKey = e.target.value; limit = PAGE_SIZE; paint(); });
      const addBtn = $("#btnAddNew", root);
      if (addBtn) addBtn.addEventListener("click", () => Router.go("add-stock"));
      const excelBtn = $("#btnExcel", root);
      if (excelBtn) excelBtn.addEventListener("click", () => runBusy(excelBtn, () => Excel.download(cfg.excel)));

      paint();
      return Store.subscribe(paint);
    }
  };
}

const COMMON_SORTS = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "supplier", label: "Supplier (A to Z)" }
];

const StocksInPage = createStockListPage({
  title: "Stocks IN", subtitle: "Stock that has arrived and is waiting to be rolled.",
  status: "IN", listKey: "stocksIn", loadedKey: "in", dateField: "stockInAt",
  emptyText: "No stocks are currently in stock.", excel: "in",
  sorts: COMMON_SORTS.concat([
    { key: "unassigned", label: "Not assigned first" },
    { key: "urgent", label: "Urgent first" }
  ])
});

const RolledPage = createStockListPage({
  title: "Rolled", subtitle: "Rolled stock waiting to go out.",
  status: "ROLLED", listKey: "stocksRolled", loadedKey: "rolled", dateField: "rolledAt",
  emptyText: "No rolled stocks found.", excel: null, sorts: COMMON_SORTS
});

const StocksOutPage = createStockListPage({
  title: "Stocks OUT", subtitle: "Completed stock that has left.",
  status: "OUT", listKey: "stocksOut", loadedKey: "out", dateField: "stockOutAt",
  emptyText: "No completed stocks found.", excel: "out", sorts: COMMON_SORTS
});
