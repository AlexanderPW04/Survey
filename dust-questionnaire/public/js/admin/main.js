// Dashboard entry point: sign-in, data loading and tab switching.
import { initializeApp, getFirestore, doc, getDoc, getDocs, setDoc, collection, serverTimestamp } from "../firebase.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "../firebase-auth.js";
import { firebaseConfig } from "../../firebase-config.js";
import { firebaseConfigured } from "../core.js";
import { SEED_SURVEY } from "../seed-survey.js";
import { $, clone, ms, toast, errorText } from "./util.js";
import * as builder from "./builder.js";
import * as samples from "./samples.js";
import * as results from "./results.js";
import * as share from "./share.js";
import * as team from "./team.js";

export const DEFAULT_IDS = { prefix: "AZAS_", digits: 3, next: 1, siteUrl: "" };

/** Everything the dashboard knows, loaded from Firestore. */
export const state = {
  db: null, user: null,
  draft: null,     // settings/draft   { definition, updatedAt, updatedBy }
  pub: null,       // settings/public  { version, status, definition, publishedAt }
  versions: [],    // versions/*       { number, definition, publishedAt, publishedBy }
  samples: [],     // samples/*        { id, number, token, batch, active, createdAt }
  responses: [],   // responses/*      { id (= kit code), version, answers, specify, submittedAt }
  ids: { ...DEFAULT_IDS }, // settings/ids
  admins: [],      // admins/*         { id (= email), addedBy, addedAt }
};

const TABS = { survey: builder, samples, results, share, team };
let currentTab = "survey";

export const formUrl = () => {
  const custom = (state.ids.siteUrl || "").trim();
  return custom || new URL("./", location.href).href;
};
export const kitUrl = (token) => `${formUrl().replace(/\/?$/, "/")}?k=${token}`;

export function sampleByToken() {
  return new Map(state.samples.filter((s) => s.token).map((s) => [s.token, s]));
}

/** Questions keys (and their option codes) that exist in any published version — these can't be renamed. */
export function lockedKeys() {
  const map = new Map(); // key -> { type, options:Set }
  for (const v of state.versions) {
    for (const q of v.definition?.questions || []) {
      const e = map.get(q.key) || { type: q.type, options: new Set() };
      (q.options || []).forEach((o) => e.options.add(o.value));
      map.set(q.key, e);
    }
  }
  return map;
}

export async function loadAll() {
  const db = state.db;
  const [draft, pub, ids, versions, samplesSnap, responses, admins] = await Promise.all([
    getDoc(doc(db, "settings", "draft")),
    getDoc(doc(db, "settings", "public")),
    getDoc(doc(db, "settings", "ids")),
    getDocs(collection(db, "versions")),
    getDocs(collection(db, "samples")),
    getDocs(collection(db, "responses")),
    getDocs(collection(db, "admins")),
  ]);
  state.pub = pub.exists() ? pub.data() : null;
  state.versions = versions.docs.map((d) => d.data()).sort((a, b) => a.number - b.number);
  state.samples = samplesSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.id.localeCompare(b.id));
  state.responses = responses.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.submittedAt) - ms(a.submittedAt));
  state.admins = admins.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id));
  state.ids = { ...DEFAULT_IDS, ...(ids.exists() ? ids.data() : {}) };

  // First run: start the draft from the published survey, or from the approved questionnaire.
  if (draft.exists()) {
    state.draft = draft.data();
  } else {
    const definition = clone(state.pub?.definition || SEED_SURVEY);
    state.draft = { definition, updatedAt: null, updatedBy: state.user.email };
    await setDoc(doc(db, "settings", "draft"), { ...state.draft, updatedAt: serverTimestamp() });
  }
  if (!ids.exists()) await setDoc(doc(db, "settings", "ids"), state.ids);

  const legacy = state.samples.filter((s) => !s.token).length + state.responses.filter((r) => typeof r.version !== "number").length;
  const note = $("#legacy-note");
  note.hidden = !legacy;
  note.textContent = legacy
    ? `Found ${legacy} record(s) from the previous version of the app (sample IDs without QR kit codes, or old-style responses). ` +
      `They're ignored by the dashboard. Delete the old documents in the Firebase console (Firestore → samples / responses) to tidy up.`
    : "";
}

export function rerender(tab = currentTab) {
  const panel = $(`#panel-${tab}`);
  if (panel && !panel.hidden) TABS[tab].render(panel);
}

export async function refresh(tab = currentTab) {
  await loadAll();
  rerender(tab);
}

function selectTab(tab, { focus = false } = {}) {
  if (!TABS[tab]) tab = "survey";
  if (currentTab === "survey" && tab !== "survey" && builder.isDirty()) {
    toast("You have unsaved survey changes — they're kept while you look around, but remember to save.", "warn");
  }
  currentTab = tab;
  for (const name of Object.keys(TABS)) {
    const btn = $(`#tab-${name}`);
    const on = name === tab;
    btn.setAttribute("aria-selected", on ? "true" : "false");
    btn.tabIndex = on ? 0 : -1;
    $(`#panel-${name}`).hidden = !on;
  }
  if (focus) $(`#tab-${tab}`).focus();
  history.replaceState(null, "", `#${tab}`);
  rerender(tab);
  backgroundRefresh(tab);
}

/** A cheap fingerprint of the loaded data, to tell whether anything changed. */
function signature() {
  return JSON.stringify([
    state.responses.length, ms(state.responses[0]?.submittedAt), state.samples.length,
    state.samples.filter((s) => s.active === false).length, state.versions.length, state.admins.length,
    state.ids, state.pub?.version, state.pub?.status, ms(state.draft?.updatedAt),
  ]);
}

/** Fetches fresh data (e.g. new responses) when a tab is opened, without disturbing typing. */
async function backgroundRefresh(tab, { manual = false } = {}) {
  const before = signature();
  try { await loadAll(); } catch (e) { toast("Couldn't refresh: " + errorText(e), "error"); return; }
  if (currentTab !== tab) return;
  const panel = $(`#panel-${tab}`);
  const typing = panel.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (signature() === before && !manual) return;
  if (typing && !manual) { toast("New data is available — click Refresh at the top to update this view.", "warn"); return; }
  rerender(tab);
  if (manual) toast("Up to date.");
}

function setupTabs() {
  const names = Object.keys(TABS);
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) selectTab(b.dataset.tab);
  });
  $("#tabs").addEventListener("keydown", (e) => {
    const i = names.indexOf(currentTab);
    if (e.key === "ArrowRight") selectTab(names[(i + 1) % names.length], { focus: true });
    else if (e.key === "ArrowLeft") selectTab(names[(i - 1 + names.length) % names.length], { focus: true });
  });
}

function showOnly(id) {
  for (const s of ["#signin-card", "#denied-card", "#tabs", "#loading"]) $(s).hidden = true;
  for (const name of Object.keys(TABS)) $(`#panel-${name}`).hidden = true;
  if (id) $(id).hidden = false;
}

function init() {
  if (!firebaseConfigured(firebaseConfig)) {
    const box = $("#setup-error");
    box.textContent = "Firebase isn't configured yet — fill in public/firebase-config.js and redeploy.";
    box.hidden = false;
    return;
  }
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  state.db = getFirestore(app);
  setupTabs();

  $("#signin").addEventListener("click", () =>
    signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => { if (e.code !== "auth/popup-closed-by-user") toast(errorText(e), "error"); }));
  $("#refresh").addEventListener("click", () => backgroundRefresh(currentTab, { manual: true }));
  $("#signout").addEventListener("click", async () => {
    if (builder.isDirty() && !confirm("You have unsaved survey changes. Sign out anyway?")) return;
    signOut(auth);
  });
  window.addEventListener("beforeunload", (e) => { if (builder.isDirty()) { e.preventDefault(); e.returnValue = ""; } });

  onAuthStateChanged(auth, async (user) => {
    state.user = user;
    $("#user-box").hidden = !user;
    if (!user) return showOnly("#signin-card");
    $("#user-email").textContent = user.email;
    showOnly("#loading");
    try {
      await loadAll();
    } catch (e) {
      if (e?.code === "permission-denied") {
        $("#denied-email").textContent = user.email;
        return showOnly("#denied-card");
      }
      console.error(e);
      showOnly(null);
      const box = $("#setup-error");
      box.textContent = "Couldn't load the dashboard: " + errorText(e);
      box.hidden = false;
      return;
    }
    showOnly("#tabs");
    $("#brand-title").textContent = state.draft?.definition?.title || "Survey dashboard";
    selectTab(location.hash.slice(1) || "survey");
  });
}

init();
