/* ==========================================================
   STORE: live data from Firestore.
   Firestore "listeners" keep these lists up to date by themselves,
   so every screen updates without refreshing.
   Pages read lists from here: Store.stocksIn, Store.machines ...
   ========================================================== */

const Store = {
  stocksIn: [], stocksRolled: [], stocksOut: [],
  jobs: [],            // jobs waiting or running (status QUEUED)
  closedJobs: [],      // recently finished jobs (status DONE / CANCELLED)
  machines: [], operators: [],
  suppliers: [], threadForms: [], materialTypes: [],

  outDays: APP_CONFIG.recentOutDays,
  loaded: {},

  _unsubs: [], _outUnsub: null, _subs: new Set(), _pending: false, _errorShown: {},

  // Pages call Store.subscribe(fn); fn runs whenever data changes. Returns an "unsubscribe" function.
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },

  _notify() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => {
      this._pending = false;
      this._subs.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    });
  },

  _listen(name, query, onData) {
    const unsub = query.onSnapshot(
      (snap) => {
        // 'estimate' avoids empty timestamps while the server time is still being saved
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
        onData(list);
        this.loaded[name] = true;
        this._notify();
      },
      (err) => {
        console.error("Listener error:", name, err);
        if (!this._errorShown[name]) { this._errorShown[name] = true; Toast.error(friendlyError(err)); }
      }
    );
    return unsub;
  },

  start() {
    this.stop();
    const col = (name) => db.collection(name);
    const keep = (u) => { this._unsubs.push(u); };
    const byName = (field) => (a, b) => naturalCompare(a[field], b[field]);

    if (Permissions.can("viewStocks")) {
      keep(this._listen("in", col("stocks").where("status", "==", "IN"),
        (l) => { this.stocksIn = l.sort((a, b) => timeValue(b.stockInAt) - timeValue(a.stockInAt)); }));
      keep(this._listen("rolled", col("stocks").where("status", "==", "ROLLED"),
        (l) => { this.stocksRolled = l.sort((a, b) => timeValue(b.rolledAt) - timeValue(a.rolledAt)); }));
      this._listenOut();
      keep(this._listen("suppliers", col("suppliers"), (l) => { this.suppliers = l.sort(byName("name")); }));
      keep(this._listen("threadForms", col("threadForms"), (l) => { this.threadForms = l.sort(byName("name")); }));
      keep(this._listen("materialTypes", col("materialTypes"), (l) => { this.materialTypes = l.sort(byName("name")); }));
    }

    // Everyone (including operators) needs the schedule data
    keep(this._listen("machines", col("machines"), (l) => { this.machines = l.sort(byName("machineName")); }));
    keep(this._listen("operators", col("operators"), (l) => { this.operators = l.sort(byName("name")); }));
    keep(this._listen("jobs", col("jobs").where("status", "==", "QUEUED"), (l) => { this.jobs = l; }));
    keep(this._listen("closedJobs", col("jobs").orderBy("closedAt", "desc").limit(60), (l) => { this.closedJobs = l; }));
  },

  // Stocks OUT in the last N days (single-field query, so no special index is needed)
  _listenOut() {
    if (this._outUnsub) this._outUnsub();
    const since = new Date(Date.now() - this.outDays * 86400000);
    this._outUnsub = this._listen("out",
      db.collection("stocks").where("stockOutAt", ">=", Timestamp.fromDate(since)).orderBy("stockOutAt", "desc").limit(500),
      (l) => { this.stocksOut = l; });
  },

  // "Load older" button on the Stocks OUT page
  extendOutDays(extra = 30) { this.outDays += extra; this._listenOut(); },

  stop() {
    this._unsubs.forEach((u) => u());
    this._unsubs = [];
    if (this._outUnsub) { this._outUnsub(); this._outUnsub = null; }
    this.stocksIn = []; this.stocksRolled = []; this.stocksOut = [];
    this.jobs = []; this.closedJobs = []; this.machines = []; this.operators = [];
    this.suppliers = []; this.threadForms = []; this.materialTypes = [];
    this.loaded = {}; this._errorShown = {}; this.outDays = APP_CONFIG.recentOutDays;
  },

  findStock(id) {
    return this.stocksIn.find((s) => s.id === id) ||
           this.stocksRolled.find((s) => s.id === id) ||
           this.stocksOut.find((s) => s.id === id) || null;
  },
  findMachine(id) { return this.machines.find((m) => m.id === id) || null; },
  findOperator(id) { return this.operators.find((o) => o.id === id) || null; }
};
