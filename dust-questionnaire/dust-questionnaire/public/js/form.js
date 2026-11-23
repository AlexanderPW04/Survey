// Participant page: opened from a kit's QR code (…/?k=KITCODE).
// The sample ID is never shown or sent by the participant; the kit code links
// the response to its sample on the admin side.
import { initializeApp, getFirestore, doc, getDoc, writeBatch, serverTimestamp } from "./firebase.js";
import { firebaseConfig } from "../firebase-config.js";
import { renderSurvey, normalizeKitCode, isKitCode, firebaseConfigured } from "./core.js";

const $ = (s) => document.querySelector(s);
const show = (el, on = true) => { el.hidden = !on; };

let db, survey; // survey = settings/public document data

function message(title, text) {
  show($("#loading"), false);
  show($("#code-entry"), false);
  $("#survey-root").replaceChildren();
  $("#message-title").textContent = title;
  $("#message-text").textContent = text;
  show($("#message"));
  $("#message").focus();
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "timeout" })), ms))]);
}

function applySurveyText(def) {
  document.title = def.title || "Questionnaire";
  $("#survey-title").textContent = def.title || "Questionnaire";
  $("#survey-intro").textContent = def.intro || "";
  $("#survey-footer").textContent = def.footer || "";
}

function showCodeEntry(errorText = "") {
  show($("#loading"), false);
  show($("#code-entry"));
  $("#kit-code-error").textContent = errorText;
  if (errorText) $("#kit-code").focus();
}

$("#code-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = normalizeKitCode($("#kit-code").value);
  if (!isKitCode(code)) {
    $("#kit-code-error").textContent = "That doesn't look like a kit code. Please check it — it has 10 letters and numbers.";
    $("#kit-code").focus();
    return;
  }
  history.replaceState(null, "", `?k=${code}`);
  start(code);
});

async function start(code) {
  show($("#code-entry"), false);
  show($("#loading"));
  let token;
  try {
    token = await withTimeout(getDoc(doc(db, "tokens", code)), 15000);
  } catch (e) {
    console.error(e);
    return message("Couldn't connect", "Please check your internet connection and reload the page.");
  }
  if (!token.exists() || token.data().active !== true) {
    return showCodeEntry("We don't recognise this kit code. Please check it, or contact the research team.");
  }
  if (token.data().used) {
    return message("Already submitted", "A questionnaire has already been submitted for this sample kit. Thank you! If you think this is a mistake, please contact the research team.");
  }
  if (survey.status !== "open") {
    return message("Not accepting responses", "This questionnaire isn't accepting responses right now. Please try again later or contact the research team.");
  }

  show($("#loading"), false);
  renderSurvey($("#survey-root"), survey.definition, {
    submitLabel: "Submit questionnaire",
    onSubmit: (payload) => submit(code, payload),
  });
}

async function submit(code, { answers, specify }) {
  const batch = writeBatch(db);
  batch.set(doc(db, "responses", code), {
    version: survey.version,
    answers,
    specify,
    submittedAt: serverTimestamp(),
  });
  batch.update(doc(db, "tokens", code), { used: true });
  try {
    await withTimeout(batch.commit(), 20000);
  } catch (err) {
    if (err?.code === "timeout") {
      throw Object.assign(err, { userMessage: "Couldn't reach the server. Check your connection and press Submit again." });
    }
    if (err?.code === "permission-denied") {
      // Work out why, so the participant gets a useful message.
      const [tok, pub] = await Promise.all([getDoc(doc(db, "tokens", code)), getDoc(doc(db, "settings", "public"))]).catch(() => []);
      if (tok?.data()?.used) return showThanks(); // an earlier attempt already went through
      if (pub?.data()?.status !== "open") return message("Not accepting responses", "This questionnaire stopped accepting responses while you were filling it in. Please contact the research team.");
      if (pub?.data()?.version !== survey.version) {
        throw Object.assign(err, { userMessage: "The questionnaire was updated while you were filling it in. Please reload the page and answer again — sorry about that!" });
      }
    }
    throw err;
  }
  showThanks();
}

function showThanks() {
  $("#survey-root").replaceChildren();
  $("#thanks-text").textContent = survey.definition.thankYou || "Your answers have been recorded. You can close this page.";
  show($("#thanks"));
  $("#thanks").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function init() {
  if (!firebaseConfigured(firebaseConfig)) {
    return message("Not set up yet", "This site's Firebase settings haven't been filled in (firebase-config.js).");
  }
  db = getFirestore(initializeApp(firebaseConfig));
  try {
    const snap = await withTimeout(getDoc(doc(db, "settings", "public")), 15000);
    if (!snap.exists() || !snap.data().definition) {
      return message("Coming soon", "This questionnaire hasn't been published yet. Please check back later.");
    }
    survey = snap.data();
  } catch (e) {
    console.error(e);
    return message("Couldn't connect", "Please check your internet connection and reload the page.");
  }
  applySurveyText(survey.definition);

  const raw = new URLSearchParams(location.search).get("k");
  if (!raw) return showCodeEntry();
  const code = normalizeKitCode(raw);
  if (!isKitCode(code)) return showCodeEntry("This link doesn't contain a valid kit code. Please scan the QR code again, or type the code from your kit.");
  start(code);
}

init();
