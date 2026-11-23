import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { QUESTIONNAIRE } from "./questions.js";
import {
  normalizeOptions, normalizeSampleId, sampleIdRegex, sampleIdExample,
  computeVisibility, validateConfig, activeQuestions, firebaseConfigured,
} from "./common.js";

const $ = (s) => document.querySelector(s);
const form = $("#questionnaire");
const sampleInput = $("#sample_id");
const submitBtn = $("#submit-btn");
const statusEl = $("#form-status");
const questions = activeQuestions();

// ---------- tiny DOM helper ----------
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

const todayISO = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time

// ---------- rendering ----------
function renderQuestion(q) {
  const inputId = `q_${q.id}`;
  const labelId = `${inputId}_label`;
  const helpId = `${inputId}_help`;
  const errorId = `${inputId}_error`;
  const describedBy = [q.help ? helpId : null, errorId].filter(Boolean).join(" ");
  const isGroup = q.type === "radio" || q.type === "checkbox";
  const reqMark = q.required ? h("span", { class: "req", "aria-hidden": "true" }, " *") : null;

  const label = isGroup
    ? h("p", { class: "q-label", id: labelId }, q.label, reqMark)
    : h("label", { class: "q-label", id: labelId, for: inputId }, q.label, reqMark);

  const base = { id: inputId, name: q.id, "aria-describedby": describedBy, "aria-required": q.required ? "true" : null };
  let control;
  switch (q.type) {
    case "text":
      control = h("input", { ...base, type: "text", maxlength: q.maxLength || 500, autocomplete: "off" });
      break;
    case "textarea":
      control = h("textarea", { ...base, rows: 4, maxlength: q.maxLength || 2000 });
      break;
    case "number":
      control = h("input", {
        ...base, type: "number", min: q.min, max: q.max, step: q.step ?? "any",
        inputmode: q.step === 1 ? "numeric" : "decimal",
      });
      break;
    case "date":
      control = h("input", { ...base, type: "date", max: q.allowFuture ? null : todayISO() });
      break;
    case "select":
      control = h("select", base,
        h("option", { value: "" }, "Select…"),
        normalizeOptions(q).map((o) => h("option", { value: o.value }, o.label)));
      break;
    case "radio":
    case "checkbox":
      control = h("div", {
        class: "choices",
        role: q.type === "radio" ? "radiogroup" : "group",
        "aria-labelledby": labelId,
        "aria-describedby": describedBy,
        "aria-required": q.type === "radio" && q.required ? "true" : null,
      }, normalizeOptions(q).map((o, i) =>
        h("label", { class: "choice" },
          h("input", { type: q.type, name: q.id, value: o.value, id: `${inputId}_${i}` }),
          h("span", {}, o.label))));
      break;
  }

  return h("div", { class: "question", "data-qid": q.id },
    label,
    q.help ? h("p", { class: "help", id: helpId }, q.help) : null,
    control,
    h("p", { class: "error-msg", id: errorId }));
}

// ---------- reading answers ----------
function readAnswer(q) {
  switch (q.type) {
    case "checkbox":
      return [...form.querySelectorAll(`input[name="${q.id}"]:checked`)].map((i) => i.value);
    case "radio":
      return form.querySelector(`input[name="${q.id}"]:checked`)?.value ?? "";
    case "number": {
      const v = form.querySelector(`[name="${q.id}"]`).value;
      return v === "" ? null : Number(v);
    }
    default:
      return form.querySelector(`[name="${q.id}"]`).value.trim();
  }
}

function updateVisibility() {
  const { visible } = computeVisibility(questions, readAnswer);
  for (const q of questions) {
    form.querySelector(`[data-qid="${q.id}"]`).hidden = !visible[q.id];
  }
}

// ---------- validation ----------
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

function setError(wrapper, msg) {
  const err = wrapper.querySelector(".error-msg");
  err.textContent = msg || "";
  wrapper.classList.toggle("invalid", !!msg);
  wrapper.querySelectorAll("input, select, textarea, [role=radiogroup], [role=group]").forEach((el) => {
    if (msg) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
  });
}

function validateAll() {
  let firstInvalid = null;
  const flag = (wrapper, msg, focusEl) => {
    setError(wrapper, msg);
    if (msg && !firstInvalid) firstInvalid = focusEl;
  };

  const sampleId = normalizeSampleId(sampleInput.value);
  const sampleWrap = sampleInput.closest(".question");
  if (!sampleId) flag(sampleWrap, "Please enter the sample ID from your kit.", sampleInput);
  else if (!sampleIdRegex().test(sampleId)) flag(sampleWrap, `That doesn't look like a valid sample ID. It should look like ${sampleIdExample()}.`, sampleInput);
  else flag(sampleWrap, "");

  const { visible, answers } = computeVisibility(questions, readAnswer);
  for (const q of questions) {
    const wrap = form.querySelector(`[data-qid="${q.id}"]`);
    const focusEl = wrap.querySelector("input, select, textarea");
    if (!visible[q.id]) { setError(wrap, ""); continue; }
    const v = answers[q.id];
    let msg = "";
    if (q.type === "number" && focusEl.validity.badInput) msg = "Please enter a number.";
    else if (q.required && isEmpty(v)) {
      msg = q.type === "checkbox" && normalizeOptions(q).length === 1 ? "Please tick this box to continue." : "This question is required.";
    } else if (q.type === "number" && v != null) {
      if (q.min != null && v < q.min) msg = `Please enter ${q.min} or more.`;
      else if (q.max != null && v > q.max) msg = `Please enter ${q.max} or less.`;
      else if (q.step === 1 && !Number.isInteger(v)) msg = "Please enter a whole number.";
    } else if (q.type === "date" && v && !q.allowFuture && v > todayISO()) {
      msg = "The date can't be in the future.";
    }
    flag(wrap, msg, focusEl);
  }

  const payload = {};
  for (const q of questions) if (visible[q.id]) payload[q.id] = answers[q.id];
  return { ok: !firstInvalid, firstInvalid, sampleId, answers: payload };
}

// ---------- submit ----------
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

let db = null;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!db) return;
  const r = validateAll();
  if (!r.ok) {
    statusEl.textContent = "Please fix the highlighted questions.";
    r.firstInvalid?.focus();
    return;
  }
  submitBtn.disabled = true;
  statusEl.textContent = "Submitting…";
  try {
    await withTimeout(setDoc(doc(db, "responses", r.sampleId), {
      sampleId: r.sampleId,
      questionnaireVersion: QUESTIONNAIRE.version,
      answers: r.answers,
      submittedAt: serverTimestamp(),
    }), 20000);
    showThanks(r.sampleId);
  } catch (err) {
    console.error(err);
    if (err?.code === "permission-denied") {
      setError(sampleInput.closest(".question"),
        `We couldn't accept this sample ID. Either it isn't registered, or a questionnaire was already submitted for it. ` +
        `Please double-check the ID on your kit, or contact ${QUESTIONNAIRE.contactEmail}.`);
      statusEl.textContent = "";
      sampleInput.focus();
    } else if (err?.message === "timeout") {
      statusEl.textContent = "Couldn't reach the server. Check your internet connection and try again. " +
        "(If you then see an \"already submitted\" message, your first attempt went through.)";
    } else {
      statusEl.textContent = `Something went wrong. Please try again, or contact ${QUESTIONNAIRE.contactEmail}.`;
    }
    submitBtn.disabled = false;
  }
});

function showThanks(id) {
  form.hidden = true;
  $("#thanks-id").textContent = id;
  const t = $("#thanks");
  t.hidden = false;
  t.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#another-btn").addEventListener("click", () => {
  location.href = location.pathname; // reload without ?id=
});

// ---------- init ----------
function init() {
  document.title = `${QUESTIONNAIRE.studyName} — Questionnaire`;
  $("#study-name").textContent = QUESTIONNAIRE.studyName;
  $("#lab-name").textContent = QUESTIONNAIRE.labName || "";
  $("#intro").textContent = QUESTIONNAIRE.intro || "";
  $("#id-example").textContent = sampleIdExample();
  $("#footer-text").textContent = [QUESTIONNAIRE.labName, QUESTIONNAIRE.irbNumber,
    QUESTIONNAIRE.contactEmail ? `Questions? ${QUESTIONNAIRE.contactEmail}` : null].filter(Boolean).join(" · ");

  const problems = [];
  const configErrors = validateConfig();
  if (configErrors.length) problems.push("The questionnaire configuration has errors:", ...configErrors.map((x) => "• " + x));
  if (!firebaseConfigured(firebaseConfig)) problems.push("Firebase isn't configured yet — fill in firebase-config.js.");
  if (problems.length) {
    const box = $("#setup-error");
    box.textContent = problems.join("\n");
    box.hidden = false;
    submitBtn.disabled = true;
    if (configErrors.length) return;
  } else {
    db = getFirestore(initializeApp(firebaseConfig));
  }

  const container = $("#questions");
  questions.forEach((q) => container.append(renderQuestion(q)));
  form.addEventListener("input", updateVisibility);
  form.addEventListener("change", updateVisibility);
  updateVisibility();

  const pre = new URLSearchParams(location.search).get("id");
  if (pre) sampleInput.value = normalizeSampleId(pre);
  sampleInput.addEventListener("blur", () => {
    if (sampleInput.value.trim()) sampleInput.value = normalizeSampleId(sampleInput.value);
  });
}

init();
