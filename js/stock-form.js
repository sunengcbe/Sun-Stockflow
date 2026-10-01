/* ==========================================================
   stock-form.js: the Add New Stock page and the Edit pop-up.
   Both use the same form, built by StockForm.create().
   ========================================================== */

const StockForm = {

  /* options: { stock (when editing), onSubmit (Enter key) }
     returns: { el, validate(), getData(), getPhoto(), reset() } */
  create(options) {
    const opts = options || {};
    const s = opts.stock || {};
    const uid = Math.random().toString(36).slice(2, 7);

    const form = document.createElement("form");
    form.className = "form-grid";
    form.noValidate = true;
    form.innerHTML =
      '<div class="field" data-field="supplier"><label class="field-label">Supplier Name <span class="req">*</span></label><div data-slot="supplier"></div><div class="field-error" role="alert"></div></div>' +
      '<div class="field" data-field="threadForm"><label class="field-label">Thread Form <span class="req">*</span></label><div data-slot="threadForm"></div><div class="field-error" role="alert"></div></div>' +
      '<div class="field" data-field="materialType"><label class="field-label">Material Type <span class="req">*</span></label><div data-slot="materialType"></div><div class="field-error" role="alert"></div></div>' +
      '<div class="field" data-field="threadLength"><label class="field-label" for="tl-' + uid + '">Thread Length <span class="muted">(optional)</span></label>' +
        '<input class="input" id="tl-' + uid + '" type="text" maxlength="60" autocomplete="off"></div>' +
      '<div class="field"><span class="field-label" id="sd-' + uid + '">Sides <span class="muted">(optional)</span></span>' +
        '<div class="seg" role="group" aria-labelledby="sd-' + uid + '">' +
          '<button type="button" class="seg-btn" data-side="ONE" aria-pressed="false">ONE</button>' +
          '<button type="button" class="seg-btn" data-side="TWO" aria-pressed="false">TWO</button></div></div>' +
      '<div class="field" data-field="quantity"><label class="field-label" for="qty-' + uid + '">Quantity <span class="req">*</span></label>' +
        '<input class="input" id="qty-' + uid + '" type="text" maxlength="60" autocomplete="off" placeholder="e.g. 10, 10 pcs, 5 bundles, 2.5">' +
        '<div class="field-hint">Type it exactly as you want it saved.</div><div class="field-error" role="alert"></div></div>' +
      '<div class="field full"><label class="field-label" for="ds-' + uid + '">Description <span class="muted">(optional)</span></label>' +
        '<textarea class="textarea" id="ds-' + uid + '" maxlength="1000"></textarea></div>' +
      '<div class="field full"><span class="field-label">Photo <span class="muted">(optional)</span></span>' +
        '<div class="photo-box">' +
          '<div class="photo-actions">' +
            '<button type="button" class="btn btn-secondary" data-act="camera">' + icon("camera", 20) + "<span>Take Photo</span></button>" +
            '<button type="button" class="btn btn-secondary" data-act="gallery">' + icon("image", 20) + "<span>Choose Photo</span></button>" +
            '<button type="button" class="btn btn-ghost" data-act="remove" hidden>Remove Photo</button></div>' +
          '<input class="photo-input" type="file" accept="image/*" capture="environment" data-input="camera" tabindex="-1">' +
          '<input class="photo-input" type="file" accept="image/*" data-input="gallery" tabindex="-1">' +
          '<div class="photo-preview" hidden><img alt="Attached photo preview"><span class="muted" data-role="note"></span></div>' +
        "</div></div>";

    /* ----- the three searchable drop-downs ----- */
    const makeCombo = (name, kind, placeholder, addLabel) => {
      const combo = createCombo({
        placeholder, addLabel,
        getItems: () => Lookups.comboItems(kind),
        onAdd: async () => { const record = await Lookups.openAdd(kind); return record ? Lookups.toItem(kind, record) : null; },
        onChange: () => setError(name, "")
      });
      const field = $('[data-field="' + name + '"]', form);
      $('[data-slot="' + name + '"]', field).appendChild(combo.el);
      $(".field-label", field).setAttribute("for", combo.input.id);
      return combo;
    };
    const supplier = makeCombo("supplier", "supplier", "Select or search supplier", "Add New Supplier");
    const threadForm = makeCombo("threadForm", "threadForm", "Select or search thread form", "Add New Thread Form");
    const materialType = makeCombo("materialType", "materialType", "Select or search material type", "Add New Material Type");

    const lengthInput = $("#tl-" + uid, form);
    const qtyInput = $("#qty-" + uid, form);
    const descInput = $("#ds-" + uid, form);

    /* ----- Sides (ONE / TWO, click again to un-select) ----- */
    let sides = "";
    const sideButtons = $$(".seg-btn", form);
    const paintSides = () => sideButtons.forEach((b) => {
      const on = b.dataset.side === sides;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    sideButtons.forEach((b) => b.addEventListener("click", () => { sides = (sides === b.dataset.side) ? "" : b.dataset.side; paintSides(); }));

    /* ----- Photo ----- */
    const preview = $(".photo-preview", form);
    const previewImg = $("img", preview);
    const previewNote = $('[data-role="note"]', preview);
    const removeBtn = $('[data-act="remove"]', form);
    let newPhoto = null;        // newly chosen photo (data URL)
    let removedPhoto = false;   // user removed the saved photo
    let savedPhoto = null;      // photo already saved with this stock (edit only)

    const paintPhoto = () => {
      const src = newPhoto || (removedPhoto ? null : savedPhoto);
      preview.hidden = !src;
      removeBtn.hidden = !src;
      if (src) {
        previewImg.src = src;
        previewNote.textContent = newPhoto ? "New photo, it will be saved." : "Tap the photo to enlarge.";
      }
    };
    previewImg.addEventListener("click", () => { if (previewImg.src) UI.openLightbox(previewImg.src); });

    const pick = async (input) => {
      const file = input.files && input.files[0];
      input.value = "";   // lets the same photo be chosen again later
      if (!file) return;
      try { newPhoto = await resizeImageToDataUrl(file); paintPhoto(); }
      catch (err) { Toast.error(friendlyError(err)); }
    };
    $('[data-act="camera"]', form).addEventListener("click", () => $('[data-input="camera"]', form).click());
    $('[data-act="gallery"]', form).addEventListener("click", () => $('[data-input="gallery"]', form).click());
    $('[data-input="camera"]', form).addEventListener("change", (e) => pick(e.target));
    $('[data-input="gallery"]', form).addEventListener("change", (e) => pick(e.target));
    removeBtn.addEventListener("click", () => { newPhoto = null; removedPhoto = true; paintPhoto(); });

    /* ----- errors ----- */
    function setError(name, message) {
      const field = $('[data-field="' + name + '"]', form);
      if (!field) return;
      field.classList.toggle("invalid", !!message);
      const box = $(".field-error", field);
      if (box) box.textContent = message || "";
    }
    qtyInput.addEventListener("input", () => setError("quantity", ""));

    form.addEventListener("submit", (e) => { e.preventDefault(); if (typeof opts.onSubmit === "function") opts.onSubmit(); });

    /* ----- fill with existing values (edit) ----- */
    if (opts.stock) {
      if (s.supplierName) supplier.setValue({ value: "", label: s.supplierName, sub: s.supplierPhone || "", data: { name: s.supplierName, phone: s.supplierPhone || "" } }, true);
      if (s.threadForm) threadForm.setValue({ value: "", label: s.threadForm, data: { name: s.threadForm } }, true);
      if (s.materialType) materialType.setValue({ value: "", label: s.materialType, data: { name: s.materialType } }, true);
      lengthInput.value = s.threadLength || "";
      qtyInput.value = s.quantity || "";
      descInput.value = s.description || "";
      sides = s.sides || "";
      paintSides();
      if (s.hasPhoto) {
        Stocks.getPhoto(s.id).then((url) => { if (url) { savedPhoto = url; paintPhoto(); } }).catch(() => {});
      }
    }

    return {
      el: form,

      // Checks the required fields; shows inline messages; returns true if all good
      validate() {
        const problems = [];
        const check = (name, ok, message, focusTarget) => {
          setError(name, ok ? "" : message);
          if (!ok) problems.push({ message, focusTarget });
        };
        check("supplier", !!supplier.value, "Please select a supplier.", supplier.input);
        check("threadForm", !!threadForm.value, "Please select a thread form.", threadForm.input);
        check("materialType", !!materialType.value, "Please select a material type.", materialType.input);
        check("quantity", qtyInput.value.trim() !== "", "Please enter the quantity.", qtyInput);
        if (problems.length) {
          Toast.error(problems[0].message);
          problems[0].focusTarget.focus();
          return false;
        }
        return true;
      },

      getData() {
        return {
          supplierName: supplier.value.data.name,
          supplierPhone: supplier.value.data.phone || "",
          threadForm: threadForm.value.data.name,
          materialType: materialType.value.data.name,
          threadLength: lengthInput.value.trim(),
          sides: sides,
          quantity: qtyInput.value.trim(),      // always saved as TEXT
          description: descInput.value.trim()
        };
      },

      // null = unchanged, { dataUrl } = new photo, { remove: true } = delete saved photo
      getPhoto() {
        if (newPhoto) return { dataUrl: newPhoto };
        if (removedPhoto && s.hasPhoto) return { remove: true };
        return null;
      },

      reset() {
        supplier.clear(); threadForm.clear(); materialType.clear();
        lengthInput.value = ""; qtyInput.value = ""; descInput.value = "";
        sides = ""; paintSides();
        newPhoto = null; removedPhoto = false; savedPhoto = null; paintPhoto();
        ["supplier", "threadForm", "materialType", "quantity"].forEach((n) => setError(n, ""));
      }
    };
  },

  /* ----- EDIT pop-up (owner and staff) ----- */
  openEdit(stock) {
    if (!Permissions.can("editStock")) { Toast.error("You do not have permission to do this."); return; }

    const form = this.create({ stock, onSubmit: () => save() });

    const foot = document.createElement("div");
    foot.className = "modal-foot-buttons";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button"; cancelBtn.className = "btn btn-secondary"; cancelBtn.textContent = "Cancel";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button"; saveBtn.className = "btn btn-primary"; saveBtn.textContent = "Save Changes";
    foot.append(cancelBtn, saveBtn);

    const modal = Modal.open({ title: "Edit Stock", size: "lg", body: form.el, foot });

    const save = async () => {
      if (!form.validate()) return;
      await runBusy(saveBtn, async () => {
        const latest = Store.findStock(stock.id) || stock;   // compare with the newest saved version
        const changed = await Stocks.update(latest, form.getData(), form.getPhoto());
        if (changed) Toast.success("Changes Saved!"); else Toast.info("No changes to save.");
        modal.close();
      });
    };
    saveBtn.addEventListener("click", save);
    cancelBtn.addEventListener("click", () => modal.close());
  }
};

/* ---------- ADD NEW STOCK PAGE ---------- */
const AddStockPage = {
  title: "Add New Stock",

  render(root) {
    root.innerHTML =
      '<div class="page-head"><div><h1 class="page-title">Add New Stock</h1>' +
      '<p class="page-sub">Fields marked <span class="req">*</span> are required.</p></div></div>' +
      '<div class="card form-card" id="formHost"></div>';

    const host = $("#formHost", root);
    const form = StockForm.create({ onSubmit: () => save() });
    host.appendChild(form.el);

    const actions = document.createElement("div");
    actions.className = "form-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button"; saveBtn.className = "btn btn-primary btn-lg";
    saveBtn.innerHTML = icon("plus", 20) + "<span>Save Stock</span>";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button"; clearBtn.className = "btn btn-secondary btn-lg"; clearBtn.textContent = "Clear Form";
    actions.append(saveBtn, clearBtn);
    host.appendChild(actions);

    const save = async () => {
      if (!form.validate()) return;
      await runBusy(saveBtn, async () => {
        const photo = form.getPhoto();
        await Stocks.create(form.getData(), photo && photo.dataUrl ? photo.dataUrl : null);
        Toast.success("Saved Successfully!");   // disappears after about 2.6 seconds
        form.reset();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    };
    saveBtn.addEventListener("click", save);
    clearBtn.addEventListener("click", () => form.reset());
  }
};
