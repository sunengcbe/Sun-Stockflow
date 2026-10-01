/* ==========================================================
   excel.js: real .xlsx downloads, made in the browser (no server).
   Uses the SheetJS library loaded in index.html.
   Excel.download("today" | "in" | "out" | "history")
   Quantity is saved as text, exactly as typed.
   ========================================================== */

const Excel = {
  STOCK_HEADERS: ["Date", "Supplier", "Phone", "Thread Form", "Material", "Thread Length", "Sides", "Quantity",
                  "Description", "Status", "Job Assigned", "Machine", "Operator", "Rolled At", "Stock OUT At"],

  _stockRow(s) {
    return [
      fmtDateTime(s.stockInAt), s.supplierName || "", s.supplierPhone || "", s.threadForm || "", s.materialType || "",
      s.threadLength || "", s.sides || "", String(s.quantity ?? ""), s.description || "", s.status || "",
      s.jobAssigned ? "YES" : "NO", s.assignedMachineName || "", s.assignedOperatorName || "",
      s.rolledAt ? fmtDateTime(s.rolledAt) : "", s.stockOutAt ? fmtDateTime(s.stockOutAt) : ""
    ];
  },

  _historyRow(h) {
    const a = HISTORY_ACTIONS[h.action] ? HISTORY_ACTIONS[h.action].label : (h.action || "");
    return [
      fmtDateTime(h.timestamp), a, h.supplierName || "", h.threadForm || "", h.materialType || "", String(h.quantity ?? ""),
      h.fromStatus || "", h.toStatus || "", h.machineName || "", h.operatorName || "", h.userEmail || "", h.details || ""
    ];
  },

  _docs(snap) {
    return snap.docs.map((d) => Object.assign({ id: d.id }, d.data({ serverTimestamps: "estimate" })));
  },

  async download(kind) {
    if (typeof XLSX === "undefined") throw { userMessage: "The Excel library could not be loaded. Check the internet connection and reload the page." };
    Permissions.require(kind === "history" ? "exportAdmin" : "exportStocks");
    Stocks._online();

    const limit = APP_CONFIG.exportLimit;
    const day = isoDate();
    let headers, rows, filename, sheetName;

    if (kind === "today") {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const snap = await db.collection("stocks")
        .where("stockInAt", ">=", Timestamp.fromDate(start)).orderBy("stockInAt", "desc").limit(limit).get();
      headers = this.STOCK_HEADERS; rows = this._docs(snap).map((s) => this._stockRow(s));
      filename = "stocks-in-" + day + ".xlsx"; sheetName = "Today Stocks IN";
    }
    else if (kind === "in") {
      let list = Store.stocksIn;
      if (!Store.loaded.in) {
        const snap = await db.collection("stocks").where("status", "==", "IN").limit(limit).get();
        list = this._docs(snap).sort((a, b) => timeValue(b.stockInAt) - timeValue(a.stockInAt));
      }
      headers = this.STOCK_HEADERS; rows = list.slice(0, limit).map((s) => this._stockRow(s));
      filename = "all-stocks-in-" + day + ".xlsx"; sheetName = "Stocks IN";
    }
    else if (kind === "out") {
      const snap = await db.collection("stocks")
        .where("stockOutAt", ">", Timestamp.fromMillis(0)).orderBy("stockOutAt", "desc").limit(limit).get();
      headers = this.STOCK_HEADERS; rows = this._docs(snap).filter((s) => s.status === "OUT").map((s) => this._stockRow(s));
      filename = "stocks-out-" + day + ".xlsx"; sheetName = "Stocks OUT";
    }
    else if (kind === "history") {
      const snap = await db.collection("stockHistory").orderBy("timestamp", "desc").limit(limit).get();
      headers = ["Date", "Action", "Supplier", "Thread Form", "Material", "Quantity", "From", "To", "Machine", "Operator", "User", "Details"];
      rows = this._docs(snap).map((h) => this._historyRow(h));
      filename = "full-history-" + day + ".xlsx"; sheetName = "Full History";
    }
    else { throw { userMessage: "Unknown export type." }; }

    if (!rows.length) { Toast.info("There is nothing to export yet."); return; }

    const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
    ws["!cols"] = headers.map((h, i) => {
      let w = h.length;
      rows.forEach((r) => { w = Math.max(w, String(r[i] || "").length); });
      return { wch: Math.min(45, w + 2) };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
    Toast.success("Excel file downloaded (" + rows.length + " rows).");
  }
};
