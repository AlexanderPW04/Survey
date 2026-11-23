# Dust Collection Questionnaire

A free web app for collecting an anonymous questionnaire with each household dust sample.
Everything is managed from a dashboard — no code edits needed for day-to-day work.

- **Participant form** (`/`) — opened by scanning the QR code on a sample kit. The sample ID is never shown or typed.
- **Dashboard** (`/admin`) — Google sign-in for listed admins, with five tabs:
  | Tab | What it does |
  |---|---|
  | **Survey** | Build the questionnaire: add, edit, reorder (drag or ↑↓), duplicate or delete questions; choices with optional "please specify" boxes; skip logic; date and number checks. **Preview**, **Save draft**, **Publish** new versions, **Open/Close** responses. |
  | **Samples & QR codes** | Create sequential sample IDs (`AZAS_001`, …) with an adjustable prefix and number of digits. Click any ID for its QR code (print, PNG, link). Tick several to **print a sheet of QR labels**. Void lost kits. CSV of all IDs. |
  | **Results** | Summaries per question (bar charts, min/median/mean/max, date ranges, written-in answers), individual responses, and downloads: **Excel**, **Results CSV**, **Codebook CSV**. Delete test responses. |
  | **Lab website QR** | One static QR code for the lab website/posters (opens a start page that asks people to scan their kit). |
  | **Admins** | Add or remove admin Google accounts. |
- **Storage:** Cloud Firestore. **Hosting:** Firebase Hosting. Both on Firebase's free *Spark* plan.

The approved questionnaire (`Dust Collection Questionnaire Approved.txt`) is pre-loaded as the first draft.

---

## How sample IDs and QR codes work

Each sample ID (e.g. `AZAS_007`) gets a random 10-character **kit code** (e.g. `F7WEX-D8QKP`). The kit's QR code
links to `…/?k=F7WEXD8QKP`, so:

- participants never see or type the sample ID,
- nobody can submit for someone else's kit by guessing the next number (sequential IDs are easy to guess; kit codes aren't),
- each kit can be submitted **once**. Deleting a response on the Results tab re-opens that kit (useful for test runs).

Labels show the QR code, the kit code (for people who can't scan) and, optionally, the sample ID for the lab
(untick **Sample ID on label** if participants shouldn't see it).

---

## Updating your existing Firebase project (`dustbustah26-a38d7`)

Your Firebase settings are already in `public/firebase-config.js` and `.firebaserc`, so no new setup is needed.

1. **Clear the old test data:** Firebase console → **Firestore Database** → delete the `samples` and `responses`
   collections (they use the old `HD-` format). Keep the `admins` collection — existing admins keep working.
2. **Deploy the new version and its security rules** from this folder:
   ```bash
   firebase deploy
   ```
   (Use plain `firebase deploy`, not `--only hosting`, so the new database rules go live too.)
3. Open `https://dustbustah26-a38d7.web.app/admin`, sign in, then on the **Survey** tab click **Preview** and **Publish**.
4. **Samples** tab → create a few test IDs → scan one with your phone and submit → check the **Results** tab and
   download the Excel file → delete the test responses (Results tab) before real collection starts.

### Fresh setup (new Firebase project)
1. Create a project at <https://console.firebase.google.com> (free Spark plan).
2. **Firestore Database → Create database** (production mode, location near you — it can't be changed later).
3. **Authentication → Sign-in method → Google → Enable.**
4. **Project settings → Your apps → Web app**: copy the config into `public/firebase-config.js`; put the project ID in `.firebaserc`.
5. **The first admin** is added once by hand: Firestore → *Start collection* `admins` → Document ID = the Google
   email in **lowercase** → any field (e.g. `role: admin`). After that, add admins from the dashboard.
6. `npm install -g firebase-tools`, `firebase login`, then `firebase deploy`.

---

## Editing the survey after an ethics amendment

1. **Survey** tab → click a question → change it in the settings panel. Changes stay in a **draft** until you publish.
2. **Preview** to try it (nothing is saved; it shows exactly which columns the answers would fill).
3. **Publish** → a new version goes live immediately. Every response records the version it answered, and the
   **Versions** sheet in the Excel file lists when each version was published and by whom.

Rules that keep your data consistent:
- Once a question has been published, its **column name** and **type** are locked (🔒). Wording changes are fine.
  If the *meaning* changes, add a new question and delete the old one.
- Deleting a published question only removes it from future versions; its old answers stay in every export.
- Choice codes (the short code next to each choice) are locked once published, for the same reason.

---

## The downloads

| File | Contents |
|---|---|
| **Excel** | *Responses* (one row per sample), *Data dictionary*, *Samples* (status of every kit), *Versions*, *Export info*. |
| **Results CSV** | The Responses sheet as CSV. |
| **Codebook CSV** | The Data dictionary as CSV. |

- Columns: `sample_id`, `submitted_at_utc`, `survey_version`, then one column per question (retired ones at the end).
- Single-choice answers are short codes (`robotic`), or answer text if you tick **Answer text instead of codes**.
- "Tick all" questions become one 0/1 column per choice (`pet_types__cats`).
- "Please specify" text goes in its own column (`vacuum_type__robotic_text`).
- Dates are `YYYY-MM-DD`. Blank means not shown (skip logic), not answered, or not in that version.
- Column names never change between exports, so analysis scripts keep working.
- Text that starts with `=`, `+`, `-` or `@` is prefixed with `'` in CSVs so spreadsheet apps don't run it as a formula.

---

## Security and privacy

- **Participants** can only: read the published survey, check whether their own kit code is valid or used, and
  submit **one** response for an active, unused kit while responses are open. They can't read any responses or IDs.
- **Admins** are Google accounts listed in `admins`. Nobody can remove themselves, so there is always at least one admin.
- All of this is enforced by `firestore.rules` on Google's servers, not just in the web page.
- The form asks for no names, emails or addresses, and stores no IP addresses or device information.
- Firebase web config values are not secrets; access is controlled by the rules.
- Free tier limits (≈20,000 writes and 50,000 reads per day, 1 GB stored) are far beyond what this study needs.
  Each dashboard refresh reads every document once, which is fine for thousands of samples.

Known limits: answer *contents* are validated in the browser, and the server rules check structure and the
single-use kit code — a determined person holding a valid kit code could submit malformed answers for that one kit.
Check with your ethics board/IT whether Google hosting is acceptable for this anonymous data.

---

## Files

```
dust-questionnaire/
├── firebase.json, .firebaserc   hosting config + project ID
├── firestore.rules              who can read/write what
└── public/
    ├── index.html               participant page
    ├── admin.html               dashboard
    ├── firebase-config.js       your Firebase web config
    ├── style.css                look and feel (change --accent for your lab color)
    └── js/
        ├── core.js              survey engine shared by the form and the preview
        ├── form.js              participant page logic
        ├── seed-survey.js       the approved questionnaire, loaded once as the first draft
        ├── firebase.js, firebase-auth.js
        └── admin/               dashboard: main, builder, samples, results, exports, share, team, util
```

## How this version combines the two prototypes

| From the Firebase version (CLAUUUUDE) | From the FastAPI/React version (Chat) | New from the wishlist |
|---|---|---|
| Firestore + free Firebase Hosting | Survey builder with drag-and-drop and settings panel | Dashboard replaces editing JS files |
| Google sign-in, admin list | Draft → publish versions, results per version | Sequential `AZAS_` IDs, adjustable format |
| Single-use, registered sample IDs | Preview before publishing | Per-sample QR codes + printable label sheets |
| Excel export with data dictionary | Question types: yes/no, whole/decimal number, section headings, units | Participants never see sample IDs |
| Static QR code | Question summaries (bars, min/max/mean) | Admin accounts managed in the dashboard |
| | Codebook CSV, CSV formula protection, open/close responses | "Please specify" boxes per choice, date order checks |

The Chat version's server (Render + PostgreSQL) wasn't carried over: Render's free database expires after 30 days,
and the wishlist asks for Firestore hosting.
