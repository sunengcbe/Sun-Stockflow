/* ==========================================================
   schedule.js: the Job Schedule page.
   Visible to owner, staff and operators.
   Only the owner sees the Move Up / Move Down / Edit Job buttons.
   Updates live whenever the owner changes the schedule.
   Each machine shows: Previous job, Current job (large), Next job,
   and any further queued jobs below.
   ========================================================== */

const SchedulePage = {
  title: "Job Schedule",

  render(root) {
    const isOperator = Permissions.role === "operator";
    const canReorder = Permissions.can("reorderJobs");
    const canEditJob = Permissions.can("assignJob");
    const canOpenStock = Permissions.can("viewStocks");
    let refocus = null;   // keeps keyboard focus on the button just used

    root.innerHTML =
      '<div class="page-head"><div><h1 class="page-title">Machine Job Schedule</h1>' +
      '<p class="page-sub" id="schedSub"></p></div></div><div id="schedBox"></div>';

    const kv = (k, v) => '<div><div class="meta-k">' + k + '</div><div class="meta-v">' + (v ? esc(v) : "—") + "</div></div>";

    function controlsHtml(job, kind, index, total) {
      let h = "";
      if (canReorder && kind !== "prev") {
        if (index > 0) h += '<button type="button" class="btn btn-secondary btn-sm" data-move="-1" data-job="' + esc(job.id) + '">' + icon("up", 16) + "<span>Move Up</span></button>";
        if (index < total - 1) h += '<button type="button" class="btn btn-secondary btn-sm" data-move="1" data-job="' + esc(job.id) + '">' + icon("down", 16) + "<span>Move Down</span></button>";
      }
      if (canEditJob && kind !== "prev") h += '<button type="button" class="btn btn-secondary btn-sm" data-edit="' + esc(job.stockId) + '">' + icon("edit", 16) + "<span>Edit Job</span></button>";
      if (canOpenStock) h += '<button type="button" class="btn btn-ghost btn-sm" data-open="' + esc(job.stockId) + '"><span>Details</span></button>';
      return h ? '<div class="job-controls">' + h + "</div>" : "";
    }

    function stripHtml(job, kind, label, index, total) {
      const urgent = job.priority === "URGENT";
      const controls = controlsHtml(job, kind, index, total);

      if (kind === "current") {
        return '<article class="job-strip current' + (urgent ? " urgent" : "") + '" aria-label="Current job">' +
          '<div class="job-top"><span class="job-label">' + esc(label) + "</span>" + UI.priorityBadge(job.priority) + "</div>" +
          '<div class="job-big"><span class="job-key">Thread Form</span><span class="job-thread">' + esc(job.threadForm || "—") + "</span></div>" +
          '<div class="job-big"><span class="job-key">Supplier</span><span class="job-supplier">' + esc(job.supplierName || "—") + "</span></div>" +
          '<div class="job-fields">' + kv("Material", job.materialType) + kv("Quantity", job.quantity) +
            kv("Operator", job.operatorName) + kv("Expected Time", job.expectedDuration) + "</div>" +
          controls + "</article>";
      }

      const meta = [job.materialType, job.quantity ? "Qty " + job.quantity : "", job.operatorName ? "Operator: " + job.operatorName : ""].filter(Boolean).join(" · ");
      return '<article class="job-strip small' + (kind === "prev" ? " prev" : "") + (urgent && kind !== "prev" ? " urgent" : "") + '" aria-label="' + esc(label) + '">' +
        '<div class="job-top"><span class="job-label">' + esc(label) + "</span>" + (kind === "prev" ? "" : UI.priorityBadge(job.priority)) + "</div>" +
        '<div class="job-line"><span class="job-key">Thread</span> <span class="job-thread-sm">' + esc(job.threadForm || "—") + "</span></div>" +
        '<div class="job-line"><span class="job-key">Supplier</span> <span class="job-supplier">' + esc(job.supplierName || "—") + "</span></div>" +
        (meta ? '<div class="job-meta">' + esc(meta) + "</div>" : "") +
        controls + "</article>";
    }

    function emptyStrip(kind, label, text) {
      return '<div class="job-strip ' + (kind === "current" ? "current" : "small") + ' empty"><div class="job-label">' + esc(label) + '</div><div class="job-empty">' + esc(text) + "</div></div>";
    }

    function machineHtml(m, mine) {
      const q = Jobs.queue(m.id);
      const prev = Jobs.previous(m.id);
      const total = q.length;
      let h = '<section class="machine-card' + (mine ? " mine" : "") + (m.active === false ? " disabled" : "") + '" aria-label="' + esc(m.machineName) + '">' +
        '<header class="machine-head"><h2 class="machine-name">' + esc(m.machineName) + "</h2>" +
        (mine ? '<span class="badge badge-job">Your machine</span>' : "") +
        (m.active === false ? '<span class="badge badge-nojob">Disabled</span>' : "") +
        '<span class="machine-count">' + total + (total === 1 ? " job" : " jobs") + " waiting</span></header>";

      h += prev ? stripHtml(prev, "prev", "Previous Job", 0, 0) : emptyStrip("prev", "Previous Job", "No previous job");
      h += total ? stripHtml(q[0], "current", "Current / In Progress", 0, total) : emptyStrip("current", "Current / In Progress", "No job in progress");
      h += total > 1 ? stripHtml(q[1], "next", "Next Job", 1, total) : emptyStrip("next", "Next Job", "No next job");

      if (total > 2 && !isOperator) {
        h += '<div class="queue-more"><h3 class="queue-title">Also queued (' + (total - 2) + ")</h3>" +
          q.slice(2).map((j, i) => stripHtml(j, "next", "Queued #" + (i + 3), i + 2, total)).join("") + "</div>";
      }
      return h + "</section>";
    }

    function paint() {
      const box = $("#schedBox", root);
      if (!Store.loaded.machines || !Store.loaded.jobs || !Store.loaded.closedJobs) { box.innerHTML = UI.loadingHtml(); return; }

      const me = isOperator ? Store.operators.find((o) => o.email && norm(o.email) === norm(Auth.user.email)) : null;
      const isMine = (m) => !!me && Jobs.queue(m.id).some((j) => j.operatorId === me.id);

      let machines = Store.machines.filter((m) => m.active !== false || Jobs.queue(m.id).length);
      if (me) machines = machines.slice().sort((a, b) => (isMine(b) ? 1 : 0) - (isMine(a) ? 1 : 0));

      $("#schedSub", root).textContent = (me && machines.some(isMine))
        ? "Your machine is shown first. This page updates by itself."
        : "This page updates by itself. No need to refresh.";

      if (!machines.length) {
        box.innerHTML = UI.emptyHtml("No machines have been set up yet.") +
          (Permissions.can("manageMachines") ? '<div class="load-more"><button type="button" class="btn btn-primary" data-route="machines">Open Machine Management</button></div>' : "");
        return;
      }

      box.innerHTML =
        (Store.jobs.length ? "" : '<div class="empty slim">No jobs scheduled.</div>') +
        '<div class="machine-grid">' + machines.map((m) => machineHtml(m, isMine(m))).join("") + "</div>";

      if (refocus) {
        const btn = box.querySelector('[data-job="' + CSS.escape(refocus.job) + '"][data-move="' + refocus.dir + '"]') ||
                    box.querySelector('[data-job="' + CSS.escape(refocus.job) + '"]');
        if (btn) btn.focus();
      }
    }

    root.addEventListener("click", (e) => {
      const route = e.target.closest("[data-route]");
      if (route) { Router.go(route.dataset.route); return; }

      const move = e.target.closest("[data-move]");
      if (move) {
        const job = Store.jobs.find((j) => j.id === move.dataset.job);
        if (!job) return;
        refocus = { job: job.id, dir: move.dataset.move };
        runBusy(move, async () => { await Jobs.move(job, Number(move.dataset.move)); })
          .then(() => setTimeout(() => { refocus = null; }, 1500));
        return;
      }
      const edit = e.target.closest("[data-edit]");
      if (edit) { Router.go("assign-job", { stock: edit.dataset.edit }); return; }
      const open = e.target.closest("[data-open]");
      if (open) StockDetail.open(open.dataset.open);
    });

    paint();
    return Store.subscribe(paint);
  }
};
