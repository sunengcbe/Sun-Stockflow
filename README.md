# Sun - Stock Flow

Stock inventory and production-flow system for **Sun Engineering Works**.
Staff add stock, the owner assigns jobs to 6 machines, operators see the machine schedule.
Everything is shared live between all users.

* Plain HTML, CSS and JavaScript (no build step, no Node needed to run it)
* Firebase Authentication (Google login, the app never sees passwords)
* Firebase Firestore (shared database)
* SheetJS (real .xlsx downloads in the browser)

---

## 1. What each role can do

| | Owner | Staff | Operator |
|---|:-:|:-:|:-:|
| Dashboard, Stocks IN / Rolled / OUT, Full History | yes | yes | no |
| Add, edit, delete stock; Roll, Stock Out, Undo | yes | yes | no |
| Job Schedule (view) | yes | yes | yes |
| Assign jobs, reorder schedule | yes | no | no |
| Machine and operator management | yes | no | no |
| Data cleanup (delete old records) | yes | no | no |
| Excel: Today's / Stocks IN / Stocks OUT | yes | yes | no |
| Excel: Full History | yes | no | no |

How roles are decided:

1. A person signs in with Google.
2. If their Gmail is in `ownerEmails` (`js/config.js`), they are an **owner**.
3. Otherwise the app looks for them in the `users` collection (see section 5), which holds the staff and operator lists.
4. Not found: "Your account is not authorized to access this application."

**Three layers of protection:** the menu hides what you may not use, every action checks permission in JavaScript (`js/permissions.js`), and `firestore.rules` enforces it on Google's servers. Only the third layer is real security; the first two are for convenience.

---

## 2. Project structure

```text
index.html            the only web page (all screens are drawn by JavaScript)
css/                  style.css (colours, layout), cards.css, forms.css, schedule.css
js/config.js          YOUR SETTINGS: emails, alert days, Firebase config
js/firebase.js        connects to Firebase
js/utils.js           small helpers and icons
js/notifications.js   toast messages, pop-ups, confirm dialogs
js/permissions.js     who may do what
js/store.js           live data from Firestore (all pages read from here)
js/auth.js            Google login and role detection
js/ui.js              theme, header, side menu, stock cards, searchable drop-down
js/app.js             page switching (router) and app start
js/dashboard.js       dashboard
js/suppliers.js       suppliers, thread forms, material types
js/stocks.js          stock actions, stock details pop-up, list pages
js/stock-form.js      Add New / Edit form
js/jobs.js            job assignment logic and Assign Jobs page
js/schedule.js        machine schedule page
js/machines.js        machine management page
js/operators.js       operators
js/history.js         full history page
js/excel.js           Excel downloads
js/settings.js        settings, data management, old-data cleanup
firestore.rules       database security rules
firestore.indexes.json  (empty on purpose: no special indexes are needed)
firebase.json, .firebaserc   only needed for Firebase Hosting / CLI deploy
```

---

## 3. Database layout (Firestore)

```text
users          {email}   role (staff|operator), source (config|app), email
stocks         {id}      supplierName, supplierPhone, threadForm, materialType, threadLength, sides,
                         quantity (TEXT), description, hasPhoto, status (IN|ROLLED|OUT),
                         createdAt, stockInAt, rolledAt, stockOutAt (server time),
                         jobAssigned, jobId, assignedMachineId/Name, assignedOperatorId/Name,
                         assignedAt, expectedDuration, priority,
                         createdBy, updatedBy, rolledBy, stockedOutBy
stockPhotos    {stockId} dataUrl (resized photo, kept apart so lists stay fast)
stockHistory   {id}      stockId, action, fromStatus, toStatus, timestamp, userEmail, details + stock snapshot
suppliers / threadForms / materialTypes   name, nameLower, (phone for suppliers)
machines       {id}      machineName, active, createdAt
operators      {id}      name, email, active
jobs           {id}      stockId, machineId, operatorId, queueOrder, status (QUEUED|DONE|CANCELLED),
                         priority, expectedDuration, assignedAt, assignedBy, closedAt, closedBy + display copy
```

History actions: STOCK_IN, ROLLED, UNDO_ROLLED, STOCK_OUT, UNDO_STOCK_OUT, EDITED, DELETED, JOB_ASSIGNED, JOB_UPDATED.
Edits never touch the timestamps. Jobs are never destroyed when reassigned: removed jobs stay as CANCELLED, finished jobs as DONE.

---

## 4. Firebase setup (once)

Your Firebase project `sunstock-5599d` already exists and its settings are already in `js/config.js`.

1. Open https://console.firebase.google.com and open the project **sunstock-5599d**.
2. **Authentication** > **Get started** > **Sign-in method** > **Google** > turn **Enable** on > choose a support email > **Save**.
3. **Firestore Database** > **Create database** > choose **Production mode** > choose a location near you (for Chennai, `asia-south1 (Mumbai)`). The location cannot be changed later.
4. **Firestore Database** > **Rules** tab > delete everything there > paste the full contents of `firestore.rules` > **Publish**.
   * Before pasting, check that the owner email in `ownerList()` is right.
5. **Authentication** > **Settings** > **Authorized domains** > **Add domain** > enter `YOURUSERNAME.github.io` (your GitHub name, no `https://`, no repository name).
   `localhost` is already listed, so local testing works.

---

## 5. Configuring people (`js/config.js`)

```javascript
ownerEmails:    [ "sunengcbe@gmail.com" ],
staffEmails:    [ "viyask456@gmail.com" ],
operatorEmails: [ "viyask234@gmail.com" ],
```

To add someone, add a new line inside the brackets (keep the commas between lines):

```javascript
staffEmails: [
  "viyask456@gmail.com",
  "new.staff@gmail.com"
],
```

**Important, two extra steps:**

* **New staff or operator:** save the file, upload it to GitHub, then **an owner must sign in once**. At that moment the app copies the lists into the database, which is what the security rules use. Until then the new person sees "Your account is listed but not activated yet".
* **New owner:** also add the email to `ownerList()` in `firestore.rules`, then paste the rules again in the Firebase console (Rules tab > Publish). Rules cannot read `config.js`.

Removing someone from `staffEmails` / `operatorEmails` removes their access the next time an owner signs in.

Operators can also be added inside the app (Machine Management > Add Operator, with their Gmail). That gives them login access immediately, with no file edit.

---

## 6. Deploy with GitHub Pages (recommended)

GitHub Pages only shows the web pages. The login and database are Firebase's. This is the right split, because the app has no server code.

1. Create a free account at https://github.com.
2. **New repository**, name it `sun-stock-flow`, set it to **Public** (private repositories need a paid plan for Pages; it is safe to be public because the Firebase web settings are not secret and the database is protected by the rules).
3. On the repository page: **Add file** > **Upload files**. Drag in **all** the files and folders (`index.html`, `css`, `js`, `firestore.rules`, ... ). Check that the folders `css` and `js` kept their files, then **Commit changes**.
4. **Settings** > **Pages** > **Source: Deploy from a branch** > Branch `main`, folder `/ (root)` > **Save**.
5. After a minute the page shows your address: `https://YOURUSERNAME.github.io/sun-stock-flow/`
6. Make sure that domain `YOURUSERNAME.github.io` is in Firebase **Authorized domains** (step 4.5).
7. Open the address and sign in **as the owner first**.

To update later: change a file, upload it again to GitHub (same name replaces it), wait a minute, and refresh the page with Ctrl+F5.

### Alternative: Firebase Hosting

Needs Node.js on your computer. In the project folder:

```text
npm install -g firebase-tools
firebase login
firebase deploy
```

This publishes the site to `https://sunstock-5599d.web.app` and the rules in one go. That domain is already authorized for login. Use `firebase deploy --only firestore:rules` to publish only the rules.

---

## 7. Test on your own computer

The page must be served by a small web server (opening `index.html` by double-click will not allow Google login).

```text
python -m http.server 8000      (or)      npx serve
```

then open http://localhost:8000

---

## 8. First-run test list

1. Sign in as the owner: the dashboard opens. Open **Machine Management** and press **Add 6 starter machines**.
2. **Add New**: add a supplier, thread form and material type from inside the form, save a stock (try a photo too). Refresh the page: it is still there.
3. Sign in as staff (another browser or a private window): staff sees no owner menu items.
4. Staff opens the stock, presses **Rolled**, then **Stock Out**, then **Undo**.
5. Owner: **Assign Jobs**, pick a stock, machine, operator, priority, **Assign Job**.
6. Sign in as the operator: only **Job Schedule** (and Settings) is visible. The owner reorders jobs and the operator's screen updates by itself.
7. Settings: dark/light mode, Excel downloads.

If something fails, press F12, open the **Console** tab and send me the red message.

---

## 9. Firestore rules: how they work

* Every rule starts by checking who you are: the owner list in `firestore.rules`, or your entry in the `users` collection.
* **Stocks:** owner and staff can read and add stock. Staff updates are limited to the exact changes the app makes (edit details, Roll, Stock Out and the two Undos), and staff can never write job fields.
* **Quantity** must be text, and new stock must start as `IN` with no job.
* **History** can only be added to, never changed. The user email and the server time are checked.
* **Machines, operators and jobs:** everyone signed in can read; **only the owner** can write (staff may only close or cancel a job when they roll or delete its stock).
* **Operators** can read only machines, operators and jobs. They cannot read any stock.
* **Everything else is blocked.**

Each request that needs your role reads one `users` document, so the free daily limit counts a few extra reads. Normal use stays far below it.

---

## 10. Excel and data cleanup

* **Excel:** Settings > Excel downloads (Today's Stocks IN, All Stocks IN, All Stocks OUT; the owner also gets Full History). Files are real `.xlsx`, named like `stocks-in-2026-10-01.xlsx`, with up to 5000 rows (`exportLimit` in config.js).
* **Cleanup:** Owner menu > **Data Management** > choose 30, 60, 90 or 120 days. The app counts the affected records and asks for confirmation before deleting. **Deleted for good:** old history lines, completed stocks that went OUT before the cutoff (with photos), and finished jobs. **Never deleted:** any stock that is currently IN or ROLLED. Download the Excel backup first.

---

## 11. Free-plan limits (Spark plan)

Firestore free: 50,000 reads, 20,000 writes and 1 GiB storage per day/total. A small works with a few users stays inside this. Photos are shrunk before saving to keep storage low. If you ever hit the limit, the app shows "Daily database limit reached" and works again the next day, or you can switch the project to the pay-as-you-go plan.

---

## 12. If you know nothing about coding

All settings are in **`js/config.js`**. Open it on GitHub (click the file, then the pencil icon), change the text, press **Commit changes**, wait a minute.

| I want to... | Do this |
|---|---|
| Add an owner | `js/config.js` > add to `ownerEmails`, **and** add to `ownerList()` in `firestore.rules` and publish the rules in Firebase |
| Add staff | `js/config.js` > add to `staffEmails`, then an owner signs in once |
| Add an operator | Machine Management > Add Operator (with Gmail), or add to `operatorEmails` |
| Change alert days | `js/config.js` > `stockNotRolledDays` and `rolledNotStockedOutDays` |
| Change company title | `js/config.js` > `appName` and `appSubtitle`; also the text on the login screen in `index.html` and the word "Sun - Stock Flow" in `js/app.js` |
| Change colours | `css/style.css` > the section "COLOUR AND SIZE SETTINGS" at the top (light) and "DARK THEME" below it |
| Add or rename machines | Machine Management in the app |
| Remove old data | Data Management in the app |

### Common messages

| You see | Meaning |
|---|---|
| "This website address is not allowed in Firebase yet" | Add your `github.io` domain to Authorized domains (step 4.5) |
| "Your account is listed but not activated yet" | An owner must sign in once |
| "You do not have permission to do this" | The rules refused it. Check the role and that the rules were published |
| Page looks old after an update | Press Ctrl+F5 |
| Login pop-up does nothing | Allow pop-ups for the site |
