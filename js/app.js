/* ==========================================================
   app.js: starts the app and switches between pages.
   Every page is an object with:
       title                    text for the browser tab
       render(root, params)     draws the page into "root";
                                may return a function that cleans up
   To add a new page: create the object, add it to ROUTES below,
   add it to ROUTE_PERMISSIONS (permissions.js) and to Shell.NAV (ui.js).
   ========================================================== */

// Written as small functions so a missing file only breaks its own page
const ROUTES = {
  "dashboard": () => DashboardPage,
  "add-stock": () => AddStockPage,
  "stocks-in": () => StocksInPage,
  "rolled": () => RolledPage,
  "stocks-out": () => StocksOutPage,
  "history": () => HistoryPage,
  "schedule": () => SchedulePage,
  "assign-job": () => AssignJobPage,
  "machines": () => MachinesPage,
  "data": () => DataPage,
  "settings": () => SettingsPage
};

const Router = {
  cleanup: null,
  _started: false,

  // "#/stocks-in?focus=abc"  ->  { route: "stocks-in", params: { focus: "abc" } }
  parse() {
    const raw = location.hash.replace(/^#\/?/, "");
    const parts = raw.split("?");
    const params = {};
    new URLSearchParams(parts[1] || "").forEach((v, k) => { params[k] = v; });
    return { route: parts[0] || "", params };
  },

  // Go to a page:  Router.go("stocks-in", { focus: stockId })
  go(route, params) {
    let hash = "#/" + route;
    if (params) {
      const q = new URLSearchParams(params).toString();
      if (q) hash += "?" + q;
    }
    if (location.hash === hash) this.render(); else location.hash = hash;
  },

  start() {
    if (!this._started) {
      this._started = true;
      window.addEventListener("hashchange", () => { if (Auth.user) this.render(); });
    }
    this.render();
  },

  teardown() {
    if (typeof this.cleanup === "function") { try { this.cleanup(); } catch (e) { console.error(e); } }
    this.cleanup = null;
  },

  render() {
    if (!Permissions.role) return;
    const { route, params } = this.parse();

    // Unknown page or no permission: send the user to their home page
    if (!route || !Permissions.canOpenRoute(route)) {
      if (route && route in ROUTE_PERMISSIONS) Toast.error("You do not have access to that page.");
      history.replaceState(null, "", "#/" + Permissions.landingPage());
      return this.render();
    }

    this.teardown();
    Shell.closeDrawer();

    const root = $("#pageRoot");
    root.innerHTML = "";
    root.classList.remove("page-enter");
    void root.offsetWidth;                 // restarts the fade-in animation
    root.classList.add("page-enter");

    let page = null;
    try { page = ROUTES[route](); } catch (e) { page = null; }
    if (!page) { root.innerHTML = UI.emptyHtml("This page is not available yet."); return; }

    document.title = (page.title ? page.title + " | " : "") + "Sun - Stock Flow";
    Shell.setActive(route);
    try {
      const cleanup = page.render(root, params);
      if (typeof cleanup === "function") this.cleanup = cleanup;
    } catch (e) {
      console.error(e);
      root.innerHTML = UI.emptyHtml("Something went wrong while opening this page. Please try again.");
    }
    window.scrollTo(0, 0);
  }
};

const App = {
  // Called by auth.js once a user is signed in AND authorised
  start(user) {
    Router.teardown();
    Shell.build(user);
    Store.start();
    Screens.show("appShell");
    Router.start();
  }
};

/* ---------- START ---------- */
if (typeof firebase !== "undefined" && typeof auth !== "undefined") {
  Auth.init();
  // Phones that used the "redirect" sign-in style report problems here
  auth.getRedirectResult().catch((err) => { $("#loginError").textContent = friendlyError(err); });
}
