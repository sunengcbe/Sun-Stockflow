/* ==========================================================
   operators.js: the people who run the machines.
   Stored in the "operators" collection: name, email (optional), active.
   An operator with a Gmail address is also allowed to log in
   (an entry is written to the "users" collection, source = "app").
   ========================================================== */

const Operators = {
  toItem(op) {
    return { value: op.id, label: op.name, sub: op.email || "", data: op };
  },

  // Drop-down items. Disabled operators are hidden unless it is the one already chosen.
  comboItems(keepId) {
    return Store.operators
      .filter((o) => o.active !== false || o.id === keepId)
      .map((o) => this.toItem(o));
  },

  _clean(name) { return String(name || "").trim().replace(/\s+/g, " "); },

  // Checks the typed values. Returns an existing operator with the same name (or null).
  _check(name, email, ignoreId) {
    if (!name) throw { userMessage: "Please enter the operator name." };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw { userMessage: "That Gmail address does not look right." };
    return Store.operators.find((o) => o.id !== ignoreId && norm(o.name) === norm(name)) || null;
  },

  /* ----- login access for operators added inside the app ----- */
  async _grantLogin(email) {
    try {
      if (!email) return true;
      // People already listed in config.js are handled by the normal sync
      if (APP_CONFIG.ownerEmails.concat(APP_CONFIG.staffEmails).some((e) => norm(e) === email)) return true;
      const ref = db.collection("users").doc(email);
      const snap = await ref.get();
      if (snap.exists) return true;   // already has a role
      await ref.set({ email, role: "operator", source: "app", updatedBy: Auth.user.email, updatedAt: SERVER_TS() });
      return true;
    } catch (err) { console.warn("Could not grant login", err); return false; }
  },

  async _revokeLogin(email) {
    try {
      if (!email) return;
      const ref = db.collection("users").doc(email);
      const snap = await ref.get();
      if (snap.exists && snap.data().source === "app") await ref.delete();   // never touches config.js people
    } catch (err) { console.warn("Could not revoke login", err); }
  },

  /* ----- ADD ----- */
  async add(name, email) {
    Permissions.require("manageOperators");
    Stocks._online();
    const clean = this._clean(name);
    const mail = norm(email);
    const dup = this._check(clean, mail, null);
    if (dup) return Object.assign({}, dup, { existed: true });

    const ref = await db.collection("operators").add({
      name: clean, nameLower: norm(clean), email: mail, active: true,
      createdAt: SERVER_TS(), createdBy: Auth.user.email
    });
    if (mail) {
      const ok = await this._grantLogin(mail);
      if (!ok) Toast.info("Operator saved, but login access could not be activated. You can add the Gmail to js/config.js instead.");
    }
    return { id: ref.id, name: clean, email: mail, active: true };
  },

  /* ----- EDIT (name, email, enable/disable) ----- */
  async update(op, changes) {
    Permissions.require("manageOperators");
    Stocks._online();
    const name = this._clean(changes.name);
    const mail = norm(changes.email);
    const active = changes.active !== false;
    const dup = this._check(name, mail, op.id);
    if (dup) throw { userMessage: "Another operator already has that name." };

    const me = Auth.user.email;
    const batch = db.batch();
    batch.update(db.collection("operators").doc(op.id), {
      name, nameLower: norm(name), email: mail, active, updatedBy: me, updatedAt: SERVER_TS()
    });
    // Keep the names shown on job cards and stock cards in step
    if (name !== op.name) {
      Store.jobs.filter((j) => j.operatorId === op.id).forEach((j) =>
        batch.update(db.collection("jobs").doc(j.id), { operatorName: name }));
      Store.stocksIn.filter((s) => s.assignedOperatorId === op.id).forEach((s) =>
        batch.update(db.collection("stocks").doc(s.id), { assignedOperatorName: name, updatedBy: me, updatedAt: SERVER_TS() }));
    }
    await batch.commit();

    const oldMail = norm(op.email);
    if (oldMail && (oldMail !== mail || !active)) await this._revokeLogin(oldMail);
    if (mail && active) await this._grantLogin(mail);
  },

  setActive(op, active) {
    return this.update(op, { name: op.name, email: op.email || "", active });
  },

  /* ----- The small pop-up (add when op is empty, edit when given).
         Resolves with the saved operator, or null if cancelled. ----- */
  openForm(op) {
    const editing = !!op;
    return new Promise((resolve) => {
      let result = null;

      const form = document.createElement("form");
      form.noValidate = true;
      form.innerHTML =
        '<div class="field"><label class="field-label" for="opName">Operator Name <span class="req">*</span></label>' +
        '<input class="input" id="opName" type="text" maxlength="80" autocomplete="off">' +
        '<div class="field-error" role="alert"></div></div>' +
        '<div class="field" style="margin-top:16px"><label class="field-label" for="opEmail">Operator Gmail <span class="muted">(optional)</span></label>' +
        '<input class="input" id="opEmail" type="email" maxlength="120" autocomplete="off">' +
        '<div class="field-hint">If entered, this person can sign in and view the job schedule.</div></div>';

      const foot = document.createElement("div");
      foot.className = "modal-foot-buttons";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button"; cancelBtn.className = "btn btn-secondary"; cancelBtn.textContent = "Cancel";
      const saveBtn = document.createElement("button");
      saveBtn.type = "button"; saveBtn.className = "btn btn-primary"; saveBtn.textContent = editing ? "Save Changes" : "Save Operator";
      foot.append(cancelBtn, saveBtn);

      const modal = Modal.open({
        title: editing ? "Edit Operator" : "Add New Operator", size: "sm", body: form, foot,
        onClose: () => resolve(result)
      });

      const nameInput = $("#opName", form);
      const emailInput = $("#opEmail", form);
      const errorBox = $(".field-error", form);
      if (editing) { nameInput.value = op.name || ""; emailInput.value = op.email || ""; }

      const save = async () => {
        const name = nameInput.value.trim();
        if (!name) { errorBox.textContent = "Please enter the operator name."; nameInput.focus(); return; }
        errorBox.textContent = "";
        await runBusy(saveBtn, async () => {
          if (editing) {
            await Operators.update(op, { name, email: emailInput.value, active: op.active !== false });
            result = Object.assign({}, op, { name: Operators._clean(name), email: norm(emailInput.value) });
            Toast.success("Operator Updated!");
          } else {
            const record = await Operators.add(name, emailInput.value);
            result = record;
            if (record.existed) Toast.info("That operator already exists, so it has been selected for you.");
            else Toast.success("Operator Added!");
          }
          modal.close();
        });
      };

      form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
      saveBtn.addEventListener("click", save);
      cancelBtn.addEventListener("click", () => modal.close());
      nameInput.focus();
    });
  }
};
