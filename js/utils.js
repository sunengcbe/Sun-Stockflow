/* Small helper functions used everywhere. */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

// Makes text safe to place inside HTML (prevents broken pages / injected code)
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function norm(value) { return String(value ?? "").trim().toLowerCase(); }

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function timeValue(value) { const d = toDate(value); return d ? d.getTime() : 0; }

function fmtDateTime(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDate(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// yyyy-mm-dd in the user's own time zone
function isoDate(value = new Date()) {
  const d = toDate(value) || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function daysSince(value) {
  const d = toDate(value);
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function debounce(fn, ms = 200) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// True if every word typed in the search box appears in one of the fields
function matchesSearch(fields, query) {
  const q = norm(query);
  if (!q) return true;
  const hay = norm(fields.join(" "));
  return q.split(/\s+/).every((word) => hay.includes(word));
}

function naturalCompare(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true, sensitivity: "base" });
}

// Turns technical errors into short messages normal users can understand
function friendlyError(err) {
  console.error(err);
  const code = (err && err.code) || "";
  if (code.includes("permission-denied")) return "You do not have permission to do this.";
  if (code.includes("unavailable") || code.includes("network-request-failed")) return "Cannot reach the server. Check the internet connection and try again.";
  if (code.includes("unauthorized-domain")) return "This website address is not allowed in Firebase yet. Add it under Authentication > Settings > Authorized domains.";
  if (code.includes("failed-precondition")) return "The database needs one more setup step (an index). Please contact the owner.";
  if (code.includes("resource-exhausted")) return "Daily database limit reached. Try again later.";
  if (code.includes("not-found")) return "That record no longer exists. It may have been deleted by someone else.";
  if (err && err.userMessage) return err.userMessage;
  return "Something went wrong. Please try again.";
}

// Stops double-clicks: disables the button while the action runs
async function runBusy(button, fn) {
  if (button && button.disabled) return;
  if (button) { button.disabled = true; button.classList.add("is-busy"); }
  try { return await fn(); }
  catch (err) { Toast.error(friendlyError(err)); }
  finally { if (button) { button.disabled = false; button.classList.remove("is-busy"); } }
}

// Shrinks a photo so it fits inside a Firestore document (limit 1 MB)
function resizeImageToDataUrl(file, maxSide = 900) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      let quality = 0.75;
      let data = canvas.toDataURL("image/jpeg", quality);
      while (data.length > 700000 && quality > 0.3) { quality -= 0.1; data = canvas.toDataURL("image/jpeg", quality); }
      if (data.length > 900000) reject({ userMessage: "That photo is too large. Please use a smaller photo." });
      else resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject({ userMessage: "Could not read that photo." }); };
    img.src = url;
  });
}

/* ---------- Simple line icons (24x24) ---------- */
const ICONS = {
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  roll: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  out: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  dashboard: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  camera: '<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 17l-5-5-9 8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  assign: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'
};

function icon(name, size = 22) {
  return '<svg class="icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
}
