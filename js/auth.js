/* ==========================================================
   LOGIN: Google sign-in, finding the user's role, blocking
   unauthorised accounts. No passwords are stored by this app.
   ========================================================== */

const Screens = {
  show(name) {
    ["loadingScreen", "loginScreen", "deniedScreen", "appShell"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = (id !== name);
    });
  }
};

const Auth = {
  user: null,   // { uid, email, name, photo, role }

  init() {
    $("#btnGoogle").addEventListener("click", (e) => runBusy(e.currentTarget, () => this.signIn()));
    $("#btnDeniedSignOut").addEventListener("click", () => this.signOut());
    auth.onAuthStateChanged((u) => this._onUser(u));
  },

  async _onUser(fbUser) {
    if (!fbUser) {
      this.user = null;
      Permissions.setRole(null);
      Store.stop();
      Screens.show("loginScreen");
      return;
    }
    Screens.show("loadingScreen");
    const email = norm(fbUser.email);
    try {
      const found = await this._findRole(email);
      if (!found.role) { this._showDenied(email, found.pending); return; }

      this.user = { uid: fbUser.uid, email, name: fbUser.displayName || email, photo: fbUser.photoURL || "", role: found.role };
      Permissions.setRole(found.role);

      // Owners copy the staff / operator lists from config.js into the database
      if (found.role === "owner") {
        try { await this._syncRoles(email); } catch (e) { console.warn("Role sync failed", e); }
      }
      App.start(this.user);
    } catch (err) {
      $("#loadingText").textContent = friendlyError(err);
      Toast.error(friendlyError(err));
      Screens.show("loginScreen");
    }
  },

  // Decides the role for this Gmail address
  async _findRole(email) {
    if (APP_CONFIG.ownerEmails.some((e) => norm(e) === email)) return { role: "owner" };

    const snap = await db.collection("users").doc(email).get();
    if (snap.exists) {
      const role = snap.data().role;
      if (role === "staff" || role === "operator") return { role };
    }
    // Listed in config.js, but the owner has not signed in yet to activate the list
    const listed = APP_CONFIG.staffEmails.concat(APP_CONFIG.operatorEmails).some((e) => norm(e) === email);
    return { role: null, pending: listed };
  },

  _showDenied(email, pending) {
    $("#deniedEmail").textContent = email;
    $("#deniedMessage").textContent = pending
      ? "Your account is listed but not activated yet. Please ask the owner to sign in once, then try again."
      : "Your account is not authorized to access this application.";
    Screens.show("deniedScreen");
  },

  /* Writes the staff/operator lists from config.js into the "users" collection.
     firestore.rules reads that collection to know who is staff / operator.
     Only an owner can do this (enforced by the rules). */
  async _syncRoles(ownerEmail) {
    const wanted = {};
    APP_CONFIG.operatorEmails.forEach((e) => { if (norm(e)) wanted[norm(e)] = "operator"; });
    APP_CONFIG.staffEmails.forEach((e) => { if (norm(e)) wanted[norm(e)] = "staff"; });   // staff wins if listed twice
    APP_CONFIG.ownerEmails.forEach((e) => { delete wanted[norm(e)]; });

    const users = db.collection("users");
    const batch = db.batch();
    Object.keys(wanted).forEach((email) => {
      batch.set(users.doc(email), { email, role: wanted[email], source: "config", updatedBy: ownerEmail, updatedAt: SERVER_TS() }, { merge: true });
    });
    // People removed from config.js lose access (people added inside the app are left alone)
    const old = await users.where("source", "==", "config").get();
    old.forEach((d) => { if (!wanted[d.id]) batch.delete(d.ref); });
    await batch.commit();
  },

  async signIn() {
    $("#loginError").textContent = "";
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await auth.signInWithPopup(provider);
    } catch (err) {
      const code = err.code || "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        await auth.signInWithRedirect(provider);   // phones / strict browsers
        return;
      }
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
      $("#loginError").textContent = friendlyError(err);
    }
  },

  async signOut() {
    Store.stop();
    await auth.signOut();
    location.hash = "";
  }
};
