/* ==========================================================
   jobs.js
   1. Jobs            create, edit, remove and re-order jobs
   2. AssignJobPage   the owner-only "Assign Jobs" page

   How a job works:
     - A job is one document in "jobs" and belongs to one machine.
     - status QUEUED = waiting or running. The FIRST queued job of a machine
       (lowest queueOrder) is the CURRENT job; the second is NEXT.
     - When the stock is Rolled, its job becomes DONE and the next job moves up.
     - The stock stays in "Stocks IN" until it is rolled.
   ========================================================== */

const Jobs = {

  // Waiting jobs of one machine, in running order
  queue(machineId) {
    return Store.jobs
      .filter((j) => j.machineId === machineId)
      .sort((a, b) => ((a.queueOrder || 0) - (b.queueOrder || 0)) || String(a.id).localeCompare(String(b.id)));
  },

  // The most recently finished job of a machine
  previous(machineId) {
    return Store.closedJobs.find((j) => j.machineId === machineId && j.status === "DONE") || null;
  },

  /* opts: { stockId, machine: {id, machineName}, operator: {id, name}, duration, priority }
     Creates a new job, or updates the existing one if the stock already has a job.
     Returns "assigned", "updated" or "unchanged". */
  async assign(opts) {
    Permissions.require("assignJob");
    Stocks._online();
    const me = Auth.user.email;
    const machine = opts.machine;
    const operator = opts.operator;
    if (!machine) throw { userMessage: "Please select a machine." };
    if (!operator) throw { userMessage: "Please select an operator." };
    const duration = String(opts.duration || "").trim();
    const priority = opts.priority === "URGENT" ? "URGENT" : "NORMAL";

    const stockRef = db.collection("stocks").doc(opts.stockId);
    let outcome = "assigned";

    await db.runTransaction(async (tx) => {
      outcome = "assigned";

      // ---- reads first ----
      const stockSnap = await tx.get(stockRef);
      if (!stockSnap.exists) throw { userMessage: "This stock no longer exists." };
      const cur = Object.assign({ id: stockSnap.id }, stockSnap.data());
      if (cur.status !== "IN") throw { userMessage: "Only stock in Stocks IN can be assigned a job." };

      let oldJob = null, jobRef = null;
      if (cur.jobAssigned && cur.jobId) {
        const ref = db.collection("jobs").doc(cur.jobId);
        const js = await tx.get(ref);
        if (js.exists && js.data().status === "QUEUED") { oldJob = js.data(); jobRef = ref; }
      }

      // ---- writes ----
      const jobFields = {
        machineId: machine.id, machineName: machine.machineName,
        operatorId: operator.id, operatorName: operator.name,
        expectedDuration: duration, priority
      };
      let details = "";

      if (oldJob) {
        const changes = [];
        if (oldJob.machineId !== machine.id) changes.push("Machine: " + (oldJob.machineName || "—") + " → " + machine.machineName);
        if (oldJob.operatorId !== operator.id) changes.push("Operator: " + (oldJob.operatorName || "—") + " → " + operator.name);
        if ((oldJob.expectedDuration || "") !== duration) changes.push("Time: " + (oldJob.expectedDuration || "—") + " → " + (duration || "—"));
        if ((oldJob.priority || "NORMAL") !== priority) changes.push("Priority: " + (oldJob.priority || "NORMAL") + " → " + priority);
        if (!changes.length) { outcome = "unchanged"; return; }
        outcome = "updated";
        details = changes.join("; ");
        tx.update(jobRef, Object.assign({}, jobFields, {
          // moving to another machine puts the job at the end of that machine's queue
          queueOrder: oldJob.machineId !== machine.id ? Date.now() : (oldJob.queueOrder || Date.now()),
          updatedAt: SERVER_TS(), updatedBy: me
        }));
      } else {
        jobRef = db.collection("jobs").doc();
        details = "Machine: " + machine.machineName + "; Operator: " + operator.name + (duration ? "; Time: " + duration : "") + "; Priority: " + priority;
        tx.set(jobRef, Object.assign({}, jobFields, {
          stockId: cur.id, status: "QUEUED", queueOrder: Date.now(),
          assignedAt: SERVER_TS(), assignedBy: me, updatedAt: SERVER_TS(), updatedBy: me,
          // a copy of the stock details, so the schedule needs no extra reads
          supplierName: cur.supplierName || "", threadForm: cur.threadForm || "",
          materialType: cur.materialType || "", quantity: cur.quantity || "", threadLength: cur.threadLength || ""
        }));
      }

      const stockPatch = {
        jobAssigned: true, jobId: jobRef.id,
        assignedMachineId: machine.id, assignedMachineName: machine.machineName,
        assignedOperatorId: operator.id, assignedOperatorName: operator.name,
        expectedDuration: duration, priority,
        updatedBy: me, updatedAt: SERVER_TS()
      };
      if (!oldJob) { stockPatch.assignedAt = SERVER_TS(); stockPatch.assignedBy = me; }
      tx.update(stockRef, stockPatch);

      tx.set(db.collection("stockHistory").doc(),
        Stocks.historyData(oldJob ? "JOB_UPDATED" : "JOB_ASSIGNED", Object.assign({}, cur, stockPatch), "IN", "IN", { details }));
    });
    return outcome;
  },

  /* Takes a stock off the schedule. The job stays in the database as CANCELLED (history is kept). */
  async remove(stock) {
    Permissions.require("assignJob");
    Stocks._online();
    const me = Auth.user.email;
    const stockRef = db.collection("stocks").doc(stock.id);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(stockRef);
      if (!snap.exists) throw { userMessage: "This stock no longer exists." };
      const cur = Object.assign({ id: snap.id }, snap.data());
      if (cur.status !== "IN") throw { userMessage: "Only stock in Stocks IN can be changed here." };
      let jobRef = null, job = null;
      if (cur.jobId) {
        jobRef = db.collection("jobs").doc(cur.jobId);
        const js = await tx.get(jobRef);
        if (js.exists) job = js.data();
      }
      if (jobRef && job && job.status === "QUEUED") {
        tx.update(jobRef, { status: "CANCELLED", closedAt: SERVER_TS(), closedBy: me, closeReason: "REMOVED" });
      }
      tx.update(stockRef, Object.assign({ updatedBy: me, updatedAt: SERVER_TS() }, NO_JOB));
      tx.set(db.collection("stockHistory").doc(),
        Stocks.historyData("JOB_UPDATED", cur, "IN", "IN", { details: "Job removed from " + (cur.assignedMachineName || "machine") }));
    });
  },

  /* direction: -1 = move up (earlier), +1 = move down (later). Swaps two jobs of the same machine. */
  async move(job, direction) {
    Permissions.require("reorderJobs");
    Stocks._online();
    const queue = this.queue(job.machineId);
    const at = queue.findIndex((j) => j.id === job.id);
    const other = queue[at + direction];
    if (at < 0 || !other) return;

    const me = Auth.user.email;
    const refA = db.collection("jobs").doc(job.id);
    const refB = db.collection("jobs").doc(other.id);
    await db.runTransaction(async (tx) => {
      const a = await tx.get(refA);
      const b = await tx.get(refB);
      if (!a.exists || !b.exists || a.data().status !== "QUEUED" || b.data().status !== "QUEUED" || a.data().machineId !== b.data().machineId) {
        throw { userMessage: "The schedule has just changed. Please look again." };
      }
      const orderA = a.data().queueOrder || 0;
      const orderB = b.data().queueOrder || 0;
      let newA = orderB, newB = orderA;
      if (orderA === orderB) { newA = orderB + (direction > 0 ? 0.5 : -0.5); newB = orderB; }   // tie: nudge
      tx.update(refA, { queueOrder: newA, updatedBy: me, updatedAt: SERVER_TS() });
      tx.update(refB, { queueOrder: newB, updatedBy: me, updatedAt: SERVER_TS() });
    });
  }
};

/* ---------- 2. ASSIGN JOBS PAGE (owner only) ---------- */

const AssignJobPage = {
  title: "Assign Jobs",

  render(root, params) {
    const PAGE_SIZE = 40;
    const DURATIONS = ["30 minutes", "1 hour", "2 hours", "3 hours", "4 hours", "6 hours", "8 hours", "1 day"];

    let query = "";
    let filter = "free";                       // free | assigned | all
    let limit = PAGE_SIZE;
    let selectedId = (params && params.stock) || null;
    let panelFor = null;                       // the stock the right-hand panel is built for
    let priority = "NORMAL";
    let operatorCombo = null;
    let warned = false;

    root.innerHTML =
      '<div class="page-head"><div><h1 class="page-title">Assign Jobs</h1>' +
      '<p class="page-sub">Pick a stock on the left, then choose the machine and operator on the right.</p></div></div>' +
      '<div class="assign-layout">' +
        '<section aria-label="Available stocks">' +
          '<div class="toolbar">' +
            '<div class="search-wrap">' + icon("search", 20) +
              '<input class="search-input" id="availSearch" type="search" placeholder="Search supplier, thread form, material, quantity…" aria-label="Search stocks" autocomplete="off"></div>' +
            '<select class="select" id="availFilter" aria-label="Show">' +
              '<option value="free">Not assigned</option><option value="assigned">Already assigned</option><option value="all">All Stocks IN</option></select>' +
          "</div>" +
          '<div class="result-count" id="availCount"></div>' +
          '<div class="assign-list" id="availList"></div>' +
        "</section>" +
        '<aside class="card assign-panel" id="jobPanel" aria-label="Selected job"></aside>' +
      "</div>";

    const panel = $("#jobPanel", root);
    const list = $("#availList", root);

    const kv = (k, v) => '<div><div class="meta-k">' + k + '</div><div class="meta-v">' + (v ? esc(v) : "—") + "</div></div>";

    /* ----- right-hand panel ----- */
    function setErr(name, message) {
      const field = $('[data-field="' + name + '"]', panel);
      if (!field) return;
      field.classList.toggle("invalid", !!message);
      $(".field-error", field).textContent = message || "";
    }

    function placeholder() {
      panelFor = null; operatorCombo = null;
      panel.innerHTML = '<div class="panel-placeholder">' + icon("assign", 40) + "<p><strong>No stock selected</strong></p><p>Select a stock from the list to assign a job.</p></div>";
    }

    function buildPanel() {
      const stock = selectedId ? Store.findStock(selectedId) : null;
      if (!stock || stock.status !== "IN") { placeholder(); return; }

      panelFor = stock.id;
      const assigned = !!stock.jobAssigned;
      priority = stock.priority === "URGENT" ? "URGENT" : "NORMAL";
      const currentMachine = stock.assignedMachineId;
      const machines = Store.machines.filter((m) => m.active !== false || m.id === currentMachine);

      panel.innerHTML =
        '<h2 class="panel-title">' + (assigned ? "Edit Job Assignment" : "Selected Job") + "</h2>" +
        '<div class="selected-summary">' +
          kv("Supplier", stock.supplierName) + kv("Thread Form", stock.threadForm) +
          kv("Material Type", stock.materialType) + kv("Quantity", stock.quantity) + "</div>" +
        '<div class="field" data-field="machine"><label class="field-label" for="jpMachine">Machine <span class="req">*</span></label>' +
          '<select class="select" id="jpMachine"><option value="">Select machine</option>' +
          machines.map((m) => '<option value="' + esc(m.id) + '"' + (m.id === currentMachine ? " selected" : "") + ">" +
            esc(m.machineName) + (m.active === false ? " (disabled)" : "") + "</option>").join("") +
          "</select>" +
          '<div class="field-hint" id="jpMachineHint">' + (machines.length ? "" : "No machines yet. The owner can add them in Machine Management.") + "</div>" +
          '<div class="field-error" role="alert"></div></div>' +
        '<div class="field"><label class="field-label" for="jpDuration">Expected Time <span class="muted">(optional)</span></label>' +
          '<input class="input" id="jpDuration" type="text" maxlength="40" list="jpDurations" autocomplete="off" placeholder="e.g. 2 hours">' +
          '<datalist id="jpDurations">' + DURATIONS.map((d) => '<option value="' + d + '">').join("") + "</datalist></div>" +
        '<div class="field" data-field="operator"><label class="field-label">Operator <span class="req">*</span></label>' +
          '<div id="jpOperatorSlot"></div><div class="field-error" role="alert"></div></div>' +
        '<div class="field"><span class="field-label" id="jpPrioLabel">Priority</span>' +
          '<div class="seg" role="group" aria-labelledby="jpPrioLabel">' +
            '<button type="button" class="seg-btn" data-prio="NORMAL" aria-pressed="false">NORMAL</button>' +
            '<button type="button" class="seg-btn urgent" data-prio="URGENT" aria-pressed="false">URGENT</button></div></div>' +
        '<button type="button" class="btn btn-primary btn-lg btn-block" id="jpSave">' + icon("assign", 20) + "<span>" + (assigned ? "Update Job" : "Assign Job") + "</span></button>" +
        (assigned ? '<button type="button" class="btn btn-danger btn-block" id="jpRemove">' + icon("trash", 18) + "<span>Remove Job from Schedule</span></button>" : "");

      $("#jpDuration", panel).value = stock.expectedDuration || "";

      // Operator drop-down with "+ Add New Operator"
      operatorCombo = createCombo({
        placeholder: "Select or search operator",
        addLabel: "Add New Operator",
        getItems: () => Operators.comboItems(stock.assignedOperatorId),
        onAdd: async () => { const rec = await Operators.openForm(); return rec ? Operators.toItem(rec) : null; },
        onChange: () => setErr("operator", "")
      });
      const opField = $('[data-field="operator"]', panel);
      $("#jpOperatorSlot", panel).appendChild(operatorCombo.el);
      $(".field-label", opField).setAttribute("for", operatorCombo.input.id);
      if (stock.assignedOperatorId) {
        const known = Store.findOperator(stock.assignedOperatorId);
        operatorCombo.setValue(known
          ? Operators.toItem(known)
          : { value: stock.assignedOperatorId, label: stock.assignedOperatorName || "Operator", data: { id: stock.assignedOperatorId, name: stock.assignedOperatorName } }, true);
      }

      // Priority buttons
      const prioButtons = $$("[data-prio]", panel);
      const paintPrio = () => prioButtons.forEach((b) => {
        const on = b.dataset.prio === priority;
        b.classList.toggle("selected", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      prioButtons.forEach((b) => b.addEventListener("click", () => { priority = b.dataset.prio; paintPrio(); }));
      paintPrio();

      // Machine hint
      const machineSelect = $("#jpMachine", panel);
      const paintHint = () => {
        const id = machineSelect.value;
        const hint = $("#jpMachineHint", panel);
        setErr("machine", "");
        if (!id) { hint.textContent = machines.length ? "" : hint.textContent; return; }
        if (id === currentMachine) { hint.textContent = "This job keeps its current place in the queue."; return; }
        const waiting = Jobs.queue(id).filter((j) => j.stockId !== stock.id).length;
        hint.textContent = waiting
          ? waiting + (waiting === 1 ? " job is" : " jobs are") + " already waiting on this machine. This job will go to the end of the queue."
          : "No jobs waiting on this machine. This job will be the current job.";
      };
      machineSelect.addEventListener("change", paintHint);
      paintHint();

      $("#jpSave", panel).addEventListener("click", (e) => submit(e.currentTarget));
      const removeBtn = $("#jpRemove", panel);
      if (removeBtn) removeBtn.addEventListener("click", (e) => removeJob(e.currentTarget));
    }

    // Only a real clash gets a question: the new job would start right away,
    // but the chosen operator is already running the current job on another machine.
    function operatorClash(machineId, operatorId, stockId) {
      if (Jobs.queue(machineId).filter((j) => j.stockId !== stockId).length) return null;
      return Store.machines.find((m) => m.id !== machineId && ((Jobs.queue(m.id)[0] || {}).operatorId === operatorId)) || null;
    }

    async function submit(btn) {
      const stock = Store.findStock(selectedId);
      if (!stock || stock.status !== "IN") { Toast.error("This stock is no longer in Stocks IN."); buildPanel(); return; }

      const machineId = $("#jpMachine", panel).value;
      const operatorItem = operatorCombo.value;
      setErr("machine", machineId ? "" : "Please select a machine.");
      setErr("operator", operatorItem ? "" : "Please select an operator.");
      if (!machineId) { Toast.error("Please select a machine."); $("#jpMachine", panel).focus(); return; }
      if (!operatorItem) { Toast.error("Please select an operator."); operatorCombo.focus(); return; }

      const machine = Store.findMachine(machineId);
      const clash = operatorClash(machineId, operatorItem.value, stock.id);
      if (clash) {
        const go = await confirmDialog({
          title: "Operator already busy",
          message: operatorItem.label + " is already running the current job on " + clash.machineName + ". Assign this job anyway?",
          confirmText: "Assign Anyway"
        });
        if (!go) return;
      }

      await runBusy(btn, async () => {
        const result = await Jobs.assign({
          stockId: stock.id, machine,
          operator: { id: operatorItem.value, name: operatorItem.label },
          duration: $("#jpDuration", panel).value, priority
        });
        if (result === "unchanged") Toast.info("Nothing was changed.");
        else Toast.success(result === "updated" ? "Job Updated Successfully!" : "Job Assigned Successfully!");
        selectedId = null;
        buildPanel();
        paintList();
      });
    }

    async function removeJob(btn) {
      const stock = Store.findStock(selectedId);
      if (!stock) return;
      const ok = await confirmDialog({
        title: "Remove job", message: "Remove this job from the machine schedule? The stock stays in Stocks IN.",
        confirmText: "Remove Job", danger: true
      });
      if (!ok) return;
      await runBusy(btn, async () => {
        await Jobs.remove(stock);
        Toast.success("Job Removed.");
        selectedId = null;
        buildPanel();
        paintList();
      });
    }

    /* ----- left-hand list (updates live) ----- */
    function paintList() {
      if (!Store.loaded.in) { list.innerHTML = UI.loadingHtml(); return; }

      if (selectedId) {
        const sel = Store.findStock(selectedId);
        if (sel && sel.status === "IN") {
          if (panelFor !== selectedId) {
            if (sel.jobAssigned && filter === "free") { filter = "all"; $("#availFilter", root).value = "all"; }
            buildPanel();
          }
        } else {
          if (!warned) { warned = true; Toast.info("That stock is no longer available for assignment."); }
          selectedId = null;
          buildPanel();
        }
      } else if (panelFor !== null || !panel.firstChild) {
        buildPanel();
      }

      const all = Store.stocksIn
        .filter((s) => filter === "all" || (filter === "free" ? !s.jobAssigned : !!s.jobAssigned))
        .filter((s) => matchesSearch([s.supplierName, s.threadForm, s.materialType, s.quantity], query));

      $("#availCount", root).textContent = all.length + (all.length === 1 ? " stock" : " stocks");

      if (!all.length) {
        list.innerHTML = UI.emptyHtml(!Store.stocksIn.length ? "No stocks are currently in stock."
          : (query ? "No stocks match your search." : filter === "free" ? "Every stock already has a job assigned." : "No stocks found."));
        return;
      }
      const shown = all.slice(0, limit);
      list.innerHTML = shown.map((s) => {
        const on = s.id === selectedId;
        return UI.stockCardHtml(s)
          .replace('<button type="button"', '<button type="button" aria-pressed="' + (on ? "true" : "false") + '"')
          .replace('class="stock-card ', 'class="stock-card selectable' + (on ? " selected" : "") + " ");
      }).join("") +
        (all.length > shown.length ? '<div class="load-more"><button type="button" class="btn btn-secondary" id="availMore">Show more</button></div>' : "");
    }

    list.addEventListener("click", (e) => {
      if (e.target.closest("#availMore")) { limit += PAGE_SIZE; paintList(); return; }
      const card = e.target.closest(".stock-card");
      if (!card) return;
      selectedId = card.dataset.id;
      warned = false;
      buildPanel();
      paintList();
      if (window.innerWidth <= 1000) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    $("#availSearch", root).addEventListener("input", debounce((e) => { query = e.target.value; limit = PAGE_SIZE; paintList(); }, 200));
    $("#availFilter", root).addEventListener("change", (e) => { filter = e.target.value; limit = PAGE_SIZE; paintList(); });

    placeholder();
    paintList();
    return Store.subscribe(paintList);
  }
};
