# Household Dust Virome — Sample Questionnaire

A small, free web app for collecting an anonymous questionnaire with each dust sample.

- **Public form** (`/`) — participant enters the anonymous sample ID from their kit and answers the questions.
- **Admin page** (`/admin`) — Google sign-in; generate/register sample IDs, see who has submitted, download a standardized **Excel** file, and download the **QR code** for the lab website.
- **Questions live in one file** — `public/questions.js` — so they're easy to add, change, or retire as the ethics board approves amendments.
- **Storage:** Google Cloud Firestore. **Hosting:** Firebase Hosting. Both are on Firebase's free *Spark* plan (no credit card).

```
dust-questionnaire/
├── firebase.json          Hosting + rules config
├── .firebaserc            your project ID
├── firestore.rules        who can read/write what
└── public/
    ├── questions.js       ← EDIT THIS to change the questionnaire
    ├── firebase-config.js ← paste your Firebase web config here (once)
    ├── index.html, form.js    participant form
    ├── admin.html, admin.js   admin page
    ├── common.js, style.css
```

---

## One-time setup (~20 minutes)

1. **Create a Firebase project** at <https://console.firebase.google.com> → *Add project*. Analytics can be turned off. Stay on the free Spark plan.
2. **Create the database:** *Build → Firestore Database → Create database* → choose **production mode** and a location near you (e.g. `us-west`/`nam5`). The location can't be changed later.
3. **Turn on Google sign-in (for admins only):** *Build → Authentication → Get started → Sign-in method → Google → Enable*.
4. **Register a web app:** *Project settings (gear) → General → Your apps → Web (`</>`)*. Copy the `firebaseConfig` values into `public/firebase-config.js`.
5. **Put your project ID** in `.firebaserc` (replace `YOUR-PROJECT-ID`).
6. **Add the professor (and any other admins):** *Firestore Database → Start collection* → collection ID `admins` → Document ID = the Google email address **in lowercase** (e.g. `prof.smith@gmail.com` or a university Google Workspace address) → add any field, e.g. `role` = `admin` → Save. Repeat for each admin.
7. **Install the Firebase CLI and deploy** (needs [Node.js](https://nodejs.org)):
   ```bash
   npm install -g firebase-tools
   firebase login
   cd dust-questionnaire
   firebase deploy
   ```
   The site will be at `https://YOUR-PROJECT-ID.web.app` and the admin page at `https://YOUR-PROJECT-ID.web.app/admin`.
8. **Test it:** open `/admin`, sign in, generate 2–3 IDs, submit the form with one of them, then download the Excel file. Delete test data in the Firestore console before launch.

> If `/admin` says *Not authorized*, check step 6 — the document ID must exactly match the signed-in email, lowercase.

---

## Everyday workflow

1. **Before mailing kits:** `/admin` → *Generate new IDs* (with a batch label). A CSV downloads with every ID plus a personal pre-filled link (`…/?id=HD-7K3M9Q`) — useful if you want to print a QR label per kit. Already have kit IDs? Use *Register IDs you already have* and set a matching `sampleId.pattern` in `questions.js`.
2. **Participants** scan the QR code (or visit the link), type the ID on their kit, and submit. Each ID works **once**; unregistered IDs are rejected.
3. **For analysis:** `/admin` → *Download Excel*.

### The Excel file
| Sheet | Contents |
|---|---|
| **Responses** | One row per sample. Columns: `sample_id`, `submitted_at_utc`, `questionnaire_version`, then one column per question in `questions.js` order (retired questions included). |
| **Data dictionary** | Every column with question text, type, coding (e.g. `yes = Yes; no = No`), required, active/retired, skip logic, version added/retired. |
| **Export info** | Export time, current version, response count. |

Coding conventions: single-choice answers are stored as their short `value` (e.g. `hard_floor`); "select all that apply" questions become one 0/1 column per option (e.g. `pet_types__dog`); numbers stay numeric; dates are `YYYY-MM-DD`; a blank cell means the question wasn't shown (skip logic), was skipped, or didn't exist yet when that response was submitted. Column names never change between exports, so analysis scripts keep working.

### QR code for the lab website
`/admin` → *QR code* → *Download PNG*. It points to your form URL with a white border for reliable scanning. If you later use a custom domain, change the link and re-download.

---

## Changing the questionnaire (after ethics approval)

Edit **`public/questions.js`**, bump `version` (e.g. `1.0.0` → `1.1.0`), and redeploy:

```bash
firebase deploy --only hosting
```

Then open `/admin` — it shows a red box if anything in `questions.js` is wrong (duplicate id, missing options, etc.).

**Add a question** — add an object with a new, unique `id`:
```js
{ id: "air_purifier", type: "radio", label: "Is an air purifier used in the home?",
  options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }], addedIn: "1.1.0" },
```

**Change wording** — edit `label`, `help`, or an option's `label`. Keep the `id` and option `value`s the same *only if the meaning is unchanged*; otherwise retire the old question and add a new one so old and new answers aren't mixed in one column.

**Remove a question** — don't delete it; retire it so earlier answers still export:
```js
{ id: "children_under_5", retired: true, retiredIn: "1.1.0", type: "radio", ... }
```

**Skip logic** — show a question only for certain earlier answers:
```js
showIf: { question: "has_pets", in: ["yes"] }
```

**Question types:** `text`, `textarea`, `number` (`min`, `max`, `step: 1` for whole numbers), `date`, `radio` (one choice), `select` (dropdown), `checkbox` (select all that apply; a single-option required checkbox works as a consent box).

Every response records the `questionnaire_version` the participant saw, so you can always tell which wording applied.

---

## Privacy and security notes

- The app never asks for names, emails, or addresses, and doesn't store IP addresses or device info. Only the sample ID links a response to a physical sample — keep any key linking IDs to people (if one exists) offline, per your protocol.
- Free-text boxes can still receive identifying info; the form warns against it, but review text answers before sharing data.
- Only admins can read data (enforced in `firestore.rules`, deployed with `firebase deploy`). The Firebase config in `firebase-config.js` is not a secret.
- Sample IDs are 6 random characters from a 31-character set (~887 million combinations), so guessing a registered ID is impractical. For extra spam protection you can enable **Firebase App Check** (reCAPTCHA) later.
- Free-tier limits (≈20,000 writes and 50,000 reads per day, 1 GB stored) are far beyond what a questionnaire needs. Each admin page load reads every document once, so it's fine for thousands of samples.
- Check with your ethics board/IT whether a Google-hosted database is acceptable for this (anonymous) data, and pick the Firestore location they prefer.

## Optional: custom domain
*Hosting → Add custom domain* in the Firebase console (e.g. `survey.yourlab.edu`). Free SSL is included. Then also add the domain under *Authentication → Settings → Authorized domains* so admin sign-in works there.
