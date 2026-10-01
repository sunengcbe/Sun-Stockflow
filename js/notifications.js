/* Toast messages, pop-up windows (modals) and confirmation dialogs. */

const Toast = {
  show(message, type = "success", ms = 2600) {
    const root = $("#toastRoot");
    const t = document.createElement("div");
    t.className = "toast toast-" + type;
    t.setAttribute("role", type === "error" ? "alert" : "status");
    t.textContent = message;
    root.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, ms);
  },
  success(message) { this.show(message, "success"); },
  error(message) { this.show(message, "error", 4500); },
  info(message) { this.show(message, "info"); }
};

const Modal = {
  stack: [],

  /* options: title, body (HTML text or element), foot, headActions, size ("sm" | "lg"), onClose
     returns { el, body, foot, headActions, close() } */
  open(options) {
    const o = options || {};
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal ' + (o.size || "") + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title || "") + '">' +
        '<div class="modal-head">' +
          '<h2 class="modal-title">' + esc(o.title || "") + "</h2>" +
          '<div class="modal-head-actions"></div>' +
          '<button class="modal-close" type="button" aria-label="Close">' + icon("close") + "</button>" +
        "</div>" +
        '<div class="modal-body"></div>' +
        '<div class="modal-foot"></div>' +
      "</div>";

    const handle = {
      el: overlay,
      body: $(".modal-body", overlay),
      foot: $(".modal-foot", overlay),
      headActions: $(".modal-head-actions", overlay),
      _opener: document.activeElement,
      _closed: false,
      close() {
        if (handle._closed) return;
        handle._closed = true;
        Modal.stack = Modal.stack.filter((m) => m !== handle);
        overlay.classList.remove("show");
        setTimeout(() => overlay.remove(), 200);
        if (!Modal.stack.length) document.body.classList.remove("modal-open");
        if (handle._opener && handle._opener.focus) { try { handle._opener.focus(); } catch (e) {} }
        if (typeof o.onClose === "function") o.onClose();
      }
    };

    const fill = (target, content) => {
      if (content === undefined || content === null || content === "") return;
      if (typeof content === "string") target.innerHTML = content; else target.appendChild(content);
    };
    fill(handle.body, o.body);
    fill(handle.foot, o.foot);
    fill(handle.headActions, o.headActions);
    if (!handle.foot.childNodes.length) handle.foot.hidden = true;

    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) handle.close(); });
    $(".modal-close", overlay).addEventListener("click", () => handle.close());

    $("#modalRoot").appendChild(overlay);
    document.body.classList.add("modal-open");
    this.stack.push(handle);
    requestAnimationFrame(() => overlay.classList.add("show"));
    $(".modal-close", overlay).focus();
    return handle;
  }
};

// Esc closes the top-most pop-up
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && Modal.stack.length) Modal.stack[Modal.stack.length - 1].close();
});

/* Yes/No box. Usage: if (await confirmDialog({ message: "Are you sure?" })) { ... } */
function confirmDialog(options) {
  const o = options || {};
  return new Promise((resolve) => {
    let finished = false;
    const finish = (answer) => { if (finished) return; finished = true; resolve(answer); modal.close(); };

    const foot = document.createElement("div");
    foot.className = "modal-foot-buttons";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "btn btn-secondary"; cancel.textContent = o.cancelText || "Cancel";
    const ok = document.createElement("button");
    ok.type = "button"; ok.className = "btn " + (o.danger ? "btn-danger" : "btn-primary"); ok.textContent = o.confirmText || "Confirm";
    foot.append(cancel, ok);

    const modal = Modal.open({
      title: o.title || "Please confirm",
      size: "sm",
      body: '<p class="confirm-text">' + esc(o.message || "") + "</p>",
      foot,
      onClose: () => finish(false)
    });
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    cancel.focus();
  });
}
