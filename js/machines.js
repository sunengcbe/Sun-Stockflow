/* ==========================================================
   machines.js: the Machine Management page (owner only).
   Machines: add, rename, enable / disable.
   Operators: add, edit, enable / disable (logic in operators.js).
   Machines are never deleted, only disabled, so old history stays correct.
   ========================================================== */

// A small "type a name" pop-up. Resolves with the text, or null if cancelled.
function promptText(o) {
  return new Promise((resolve) => {
    let result = null;
    const form = document.createElement("form");
    form.noValidate = true;
    form.innerHTML =
      '<div class="field"><label class="field-label" for="ptInput">' + esc(o.label) + "</label>" +
      '<input class="input" id="ptInput" type="text" maxlength="' + (o.maxLength || 60) + '" autocomplete="off">' +
      '<div class="field-error" role="alert"></div></div>';

    const foot = document.createElement("div");
    foot.className = "modal-foot-buttons";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button"; cancelBtn.className = "btn btn-secondary"; cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.type = "button"; okBtn.className = "btn btn-primary"; okBtn.textContent = o.confirmText || "Save";
    foot.append(cancelBtn, okBtn);

    const modal = Modal.open({ title: o.title, size: "sm", body: form, foot, onClose: () => resolve(result) });
    const input = $("#ptInput", form);
    input.value = o.value || "";
    input.select();

    const done = () => {
      const text = input.value.trim();
      if (!text) { $(".field-error", form).textContent = o.emptyMessage || "Please type a name."; input.focus(); return; }
      result = text;
      modal.close();
    };
    form.addEventListener("submit", (e) => { e.preventDefault(); done(); });
    okBtn.addEventListener("click", done);
    cancelBtn.addEventListener("click", () => modal.close());
    input.focus();
  });
}

const Machines = {
  _name(name) {
    const clean = String(name || "").trim().replace(/\s+/g, " ");
    if (!clean) throw { userMessage: "Please enter the machine name." };
    return clean;
  },

  async add(name) {
    Permissions.require("manageMachines");
    Stocks._online();
    const clean = this._name(name);
    if (Store.machines.some((m) => norm(m.machineName) === norm(clean))) throw { userMessage: "A machine with this name already exists." };
    await db.collection("machines").add({ machineName: clean, active: true, createdAt: SERVER_TS(), createdBy: Auth.user.email });
  },

  // Creates "Machine 1" ... "Machine 6" (skips names that already exist)
  async addDefaults(count) {
    Permissions.require("manageMachines");
    Stocks._online();
    const batch = db.batch();
    let added = 0;
    for (let i = 1; i <= count; i++) {
      const name = "Machine " + i;
      if (Store.machines.some((m) => norm(m.machineName) === norm(name))) continue;
      batch.set(db.collection("machines").doc(), { machineName: name, active: true, createdAt: SERVER_TS(), createdBy: Auth.user.email });
      added++;
    }
    if (added) await batch.commit();
    return added;
  },

  async rename(machine, newName) {
    Permissions.require("manageMachines");
    Stocks._online();
    const clean = this._name(newName);
    if (clean === machine.machineName) return false;
    if (Store.machines.some((m) => m.id !== machine.id && norm(m.machineName) === norm(clean))) throw { userMessage: "A machine with this name already exists." };

    const me = Auth.user.email;
    const batch = db.batch();
    batch.update(db.collection("machines").doc(machine.id), { machineName: clean, updatedBy: me, updatedAt: SERVER_TS() });
    // keep the names shown on job cards and stock cards in step
    Store.jobs.filter((j) => j.machineId === machine.id).forEach((j) =>
      batch.update(db.collection("jobs").doc(j.id), { machineName: clean }));
    Store.stocksIn.filter((s) => s.assignedMachineId === machine.id).forEach((s) =>
      batch.update(db.collection("stocks").doc(s.id), { assignedMachineName: clean, updatedBy: me, updatedAt: SERVER_TS() }));
    await batch.commit();
    return true;
  },

  async setActive(machine, active) {
    Permissions.require("manageMachines");
    Stocks._online();
    await db.collection("machines").doc(machine.id).update({ active, updatedBy: Auth.user.email, updatedAt: SERVER_TS() });
  }
};

const MachinesPage = {
  title: "Machine Management",

  render(root) {
    root.innerHTML =
      '<div class="page-head"><div><h1 class="page-title">Machine Management</h1>' +
      '<p class="page-sub">Add or rename machines and operators. Disabled items are hidden when assigning jobs.</p></div></div>' +
      '<div class="two-col">' +
        '<section class="card" aria-labelledby="machTitle"><h2 class="section-title" id="machTitle" style="margin-top:0">Machines</h2>' +
          '<form class="inline-form" id="machineForm" novalidate>' +
            '<div class="field"><label class="field-label" for="machineName">New machine name</label>' +
            '<input class="input" id="machineName" type="text" maxlength="60" placeholder="e.g. Machine 7" autocomplete="off"></div>' +
            '<button class="btn btn-primary" type="submit">' + icon("plus", 18) + "<span>Add Machine</span></button></form>" +
          '<div id="machineList" style="margin-top:18px"></div></section>' +
        '<section class="card" aria-labelledby="opTitle"><h2 class="section-title" id="opTitle" style="margin-top:0">Operators ' +
          '<button type="button" class="btn btn-primary btn-sm" id="btnAddOperator">' + icon("plus", 16) + "<span>Add Operator</span></button></h2>" +
          '<div id="operatorList"></div></section>' +
      "</div>";

    const rowButtons = (act, id, active, editLabel) =>
      '<button type="button" class="btn btn-secondary btn-sm" data-act="' + act + '-edit" data-id="' + esc(id) + '">' + editLabel + "</button>" +
      '<button type="button" class="btn ' + (active ? "btn-warn" : "btn-secondary") + ' btn-sm" data-act="' + act + '-toggle" data-id="' + esc(id) + '">' + (active ? "Disable" : "Enable") + "</button>";
    const stateBadge = (active) => active ? '<span class="badge badge-rolled">Active</span>' : '<span class="badge badge-nojob">Disabled</span>';

    function paintMachines() {
      const box = $("#machineList", root);
      if (!Store.loaded.machines) { box.innerHTML = UI.loadingHtml(); return; }
      if (!Store.machines.length) {
        box.innerHTML = UI.emptyHtml("No machines yet.") +
          '<div class="load-more"><button type="button" class="btn btn-secondary" id="btnDefaults">Add 6 starter machines (Machine 1 to Machine 6)</button></div>';
        return;
      }
      box.innerHTML = '<div class="simple-list">' + Store.machines.map((m) => {
        const waiting = Jobs.queue(m.id).length;
        const active = m.active !== false;
        return '<div class="simple-row"><span class="grow">' + esc(m.machineName) + "</span>" + stateBadge(active) +
          (waiting ? '<span class="muted">' + waiting + " waiting</span>" : "") + rowButtons("m", m.id, active, "Rename") + "</div>";
      }).join("") + "</div>";
    }

    function paintOperators() {
      const box = $("#operatorList", root);
      if (!Store.loaded.operators) { box.innerHTML = UI.loadingHtml(); return; }
      if (!Store.operators.length) { box.innerHTML = UI.emptyHtml("No operators yet."); return; }
      box.innerHTML = '<div class="simple-list">' + Store.operators.map((o) => {
        const active = o.active !== false;
        return '<div class="simple-row"><span class="grow">' + esc(o.name) + (o.email ? '<div class="muted" style="font-weight:500;font-size:.88rem">' + esc(o.email) + "</div>" : "") + "</span>" +
          stateBadge(active) + rowButtons("o", o.id, active, "Edit") + "</div>";
      }).join("") + "</div>";
    }

    function paint() { paintMachines(); paintOperators(); }

    // Add machine
    $("#machineForm", root).addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#machineName", root);
      runBusy($("button[type=submit]", e.currentTarget), async () => {
        await Machines.add(input.value);
        input.value = "";
        Toast.success("Machine Added!");
      });
    });

    $("#btnAddOperator", root).addEventListener("click", () => Operators.openForm());

    // All other buttons
    root.addEventListener("click", async (e) => {
      if (e.target.closest("#btnDefaults")) {
        const btn = e.target.closest("#btnDefaults");
        await runBusy(btn, async () => { const n = await Machines.addDefaults(6); Toast.success(n ? "Machines Added!" : "Those machines already exist."); });
        return;
      }
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;

      if (act === "m-edit") {
        const m = Store.findMachine(id);
        if (!m) return;
        const name = await promptText({ title: "Rename Machine", label: "Machine name", value: m.machineName, confirmText: "Save Name", emptyMessage: "Please enter the machine name." });
        if (!name) return;
        await runBusy(btn, async () => { const changed = await Machines.rename(m, name); if (changed) Toast.success("Machine Updated!"); });
      }
      else if (act === "m-toggle") {
        const m = Store.findMachine(id);
        if (!m) return;
        const turnOff = m.active !== false;
        const waiting = Jobs.queue(m.id).length;
        if (turnOff && waiting) {
          const ok = await confirmDialog({
            title: "Disable machine",
            message: m.machineName + " still has " + waiting + " waiting " + (waiting === 1 ? "job" : "jobs") + ". They will stay on the schedule, but new jobs cannot be assigned to it. Disable anyway?",
            confirmText: "Disable"
          });
          if (!ok) return;
        }
        await runBusy(btn, async () => { await Machines.setActive(m, !turnOff); Toast.success(turnOff ? "Machine Disabled." : "Machine Enabled."); });
      }
      else if (act === "o-edit") {
        const o = Store.findOperator(id);
        if (o) Operators.openForm(o);
      }
      else if (act === "o-toggle") {
        const o = Store.findOperator(id);
        if (!o) return;
        const turnOff = o.active !== false;
        await runBusy(btn, async () => { await Operators.setActive(o, !turnOff); Toast.success(turnOff ? "Operator Disabled." : "Operator Enabled."); });
      }
    });

    paint();
    return Store.subscribe(paint);
  }
};
