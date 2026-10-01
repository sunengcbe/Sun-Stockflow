/* ==========================================================
   ROLES AND PERMISSIONS  (one place for all rules)
   To change who may do what, edit the PERMISSIONS table.
   Reminder: firestore.rules enforces the same rules on the server.
   ========================================================== */

const PERMISSIONS = {
  viewDashboard:   ["owner", "staff"],
  viewStocks:      ["owner", "staff"],
  addStock:        ["owner", "staff"],
  editStock:       ["owner", "staff"],
  deleteStock:     ["owner", "staff"],
  rollStock:       ["owner", "staff"],
  undoRoll:        ["owner", "staff"],
  stockOut:        ["owner", "staff"],
  undoStockOut:    ["owner", "staff"],
  viewHistory:     ["owner", "staff"],
  exportStocks:    ["owner", "staff"],
  viewSchedule:    ["owner", "staff", "operator"],
  assignJob:       ["owner"],
  reorderJobs:     ["owner"],
  manageMachines:  ["owner"],
  manageOperators: ["owner"],
  manageData:      ["owner"],
  exportAdmin:     ["owner"]
};

// Which permission each page needs (null = every signed-in user)
const ROUTE_PERMISSIONS = {
  "dashboard": "viewDashboard",
  "add-stock": "addStock",
  "stocks-in": "viewStocks",
  "rolled": "viewStocks",
  "stocks-out": "viewStocks",
  "history": "viewHistory",
  "schedule": "viewSchedule",
  "assign-job": "assignJob",
  "machines": "manageMachines",
  "data": "manageData",
  "settings": null
};

const Permissions = {
  role: null,
  setRole(role) { this.role = role; },
  can(action) {
    const allowed = PERMISSIONS[action];
    return !!allowed && allowed.includes(this.role);
  },
  // Used at the start of every data-changing function (second line of defence)
  require(action) {
    if (!this.can(action)) {
      throw { code: "permission-denied", userMessage: "You do not have permission to do this." };
    }
  },
  canOpenRoute(route) {
    if (!(route in ROUTE_PERMISSIONS)) return false;
    const needed = ROUTE_PERMISSIONS[route];
    return needed === null || this.can(needed);
  },
  landingPage() { return this.can("viewDashboard") ? "dashboard" : "schedule"; }
};
