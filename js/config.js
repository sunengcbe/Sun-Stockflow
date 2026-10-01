/* ==========================================================
   SUN - STOCK FLOW  |  SETTINGS FILE  (the only file you
   normally need to edit)
   ==========================================================
   IMPORTANT: this file only controls what people SEE.
   The real security is in firestore.rules. If you change
   ownerEmails here, change the owner list in firestore.rules too.

   After changing staffEmails or operatorEmails: push to GitHub,
   then sign in once as an OWNER. The app activates the new
   people automatically.
   ========================================================== */

const APP_CONFIG = {
  // ---------- Names shown in the app ----------
  appName: "Sun Engineering Works",
  appSubtitle: "Stock Flow",

  // ---------- Firebase web settings (safe to be public) ----------
  firebase: {
    apiKey: "AIzaSyBc_RIqVFYJIjmSHa77wDGlGZV7LClkXEY",
    authDomain: "sunstock-5599d.firebaseapp.com",
    projectId: "sunstock-5599d",
    appId: "1:129016698617:web:24013a3b739e080df5b428"
  },

  // ---------- Who can use the app (Gmail addresses) ----------
  // Add more by adding another line. Keep the commas.
  ownerEmails: [
    "sunengcbe@gmail.com"
    // , "another.owner@gmail.com"
  ],
  staffEmails: [
    "viyask456@gmail.com"
    // , "another.staff@gmail.com"
  ],
  operatorEmails: [
    "viyask234@gmail.com"
    // , "another.operator@gmail.com"
  ],

  // ---------- Alerts ----------
  stockNotRolledDays: 15,        // IN for longer than this -> orange alert
  rolledNotStockedOutDays: 15,   // ROLLED for longer than this -> orange alert

  // ---------- Lists ----------
  recentOutDays: 30,    // Stocks OUT page shows this many days first ("Load older" adds more)
  historyPageSize: 50,  // History rows loaded per click
  exportLimit: 5000     // Max rows in an Excel export
};
