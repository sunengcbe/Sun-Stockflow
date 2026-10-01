/* ==========================================================
   suppliers.js: saved Suppliers, Thread Forms and Material Types.
   All three work the same way, so one small system handles them.
   To add another kind of saved list, add an entry to LOOKUPS.
   ========================================================== */

const LOOKUPS = {
  supplier: {
    collection: "suppliers", storeKey: "suppliers",
    title: "Add New Supplier", nameLabel: "Supplier Name", hasPhone: true,
    emptyMessage: "Please enter the supplier name.", doneMessage: "Supplier Added!"
  },
  threadForm: {
    collection: "threadForms", storeKey: "threadForms",
    title: "Add New Thread Form", nameLabel: "Thread Form Name", hasPhone: false,
    emptyMessage: "Please enter the thread form name.", doneMessage: "Thread Form Added!"
  },
  materialType: {
    collection: "materialTypes", storeKey: "materialTypes",
    title: "Add New Material Type", nameLabel: "Material Type Name", hasPhone: false,
    emptyMessage: "Please enter the material type name.", doneMessage: "Material Type Added!"
  }
};

const Lookups = {
  // Converts a saved record into a drop-down item
  toItem(kind, record) {
    return { value: record.id, label: record.name, sub: LOOKUPS[kind].hasPhone ? (record.phone || "") : "", data: record };
  },

  comboItems(kind) {
    return Store[LOOKUPS[kind].storeKey].map((r) => this.toItem(kind, r));
  },

  // Saves a new record. If the same name already exists, returns the existing one.
  async add(kind, name, phone) {
    Permissions.require("addStock");
    if (navigator.onLine === false) throw { code: "network-request-failed" };
    const cfg = LOOKUPS[kind];
    const clean = String(name).trim().replace(/\s+/g, " ");
    const lower = norm(clean);

    const known = Store[cfg.storeKey].find((x) => (x.nameLower || norm(x.name)) === lower);
    if (known) return Object.assign({}, known, { existed: true });

    // Check the database too, in case the list has not finished loading
    const found = await db.collection(cfg.collection).where("nameLower", "==", lower).limit(1).get();
    if (!found.empty) return Object.assign({ id: found.docs[0].id }, found.docs[0].data(), { existed: true });

    const data = { name: clean, nameLower: lower, createdAt: SERVER_TS(), createdBy: Auth.user.email };
    if (cfg.hasPhone) data.phone = String(phone || "").trim();
    const ref = await db.collection(cfg.collection).add(data);
    return { id: ref.id, name: clean, phone: data.phone || "" };
  },

  // Opens the small "Add New ..." window. Resolves with the saved record, or null if cancelled.
  openAdd(kind) {
    const cfg = LOOKUPS[kind];
    return new Promise((resolve) => {
      let result = null;

      const form = document.createElement("form");
      form.noValidate = true;
      form.innerHTML =
        '<div class="field"><label class="field-label" for="lkName">' + esc(cfg.nameLabel) + ' <span class="req">*</span></label>' +
        '<input class="input" id="lkName" type="text" maxlength="80" autocomplete="off">' +
        '<div class="field-error" role="alert"></div></div>' +
        (cfg.hasPhone
          ? '<div class="field" style="margin-top:16px"><label class="field-label" for="lkPhone">Contact Number <span class="muted">(optional)</span></label>' +
            '<input class="input" id="lkPhone" type="tel" maxlength="30" autocomplete="off"></div>'
          : "");

      const foot = document.createElement("div");
      foot.className = "modal-foot-buttons";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button"; cancelBtn.className = "btn btn-secondary"; cancelBtn.textContent = "Cancel";
      const saveBtn = document.createElement("button");
      saveBtn.type = "button"; saveBtn.className = "btn btn-primary";
      saveBtn.textContent = cfg.hasPhone ? "Save Supplier" : "Save";
      foot.append(cancelBtn, saveBtn);

      const modal = Modal.open({ title: cfg.title, size: "sm", body: form, foot, onClose: () => resolve(result) });

      const nameInput = $("#lkName", form);
      const phoneInput = $("#lkPhone", form);
      const errorBox = $(".field-error", form);

      const save = async () => {
        const name = nameInput.value.trim();
        if (!name) { errorBox.textContent = cfg.emptyMessage; nameInput.focus(); return; }
        await runBusy(saveBtn, async () => {
          const record = await Lookups.add(kind, name, phoneInput ? phoneInput.value : "");
          result = record;
          if (record.existed) Toast.info("That already exists, so it has been selected for you.");
          else Toast.success(cfg.doneMessage);
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
