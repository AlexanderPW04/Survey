// Shared helpers used by the form (form.js) and the admin page (admin.js).
// You shouldn't need to edit this file — edit questions.js instead.
import { QUESTIONNAIRE } from "./questions.js";

// Characters used in generated sample IDs (no 0/O, 1/I/L to avoid mix-ups).
export const SAMPLE_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const QUESTION_TYPES = ["text", "textarea", "number", "date", "radio", "select", "checkbox"];
const CHOICE_TYPES = ["radio", "select", "checkbox"];
const RESERVED_IDS = ["sample_id", "submitted_at_utc", "questionnaire_version"];

export function normalizeOptions(q) {
  return (q.options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

export function activeQuestions() {
  return QUESTIONNAIRE.questions.filter((q) => !q.retired);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sampleIdRegex() {
  const cfg = QUESTIONNAIRE.sampleId || {};
  if (cfg.pattern) return new RegExp(cfg.pattern);
  return new RegExp(`^${escapeRegex(cfg.prefix || "")}[${SAMPLE_ID_ALPHABET}]{${cfg.length || 6}}$`);
}

export function sampleIdExample() {
  const cfg = QUESTIONNAIRE.sampleId || {};
  if (cfg.example) return cfg.example;
  return (cfg.prefix || "") + "7K3M9QX4PZ".slice(0, cfg.length || 6);
}

/** Uppercases, removes spaces, and adds the prefix if the participant left it off. */
export function normalizeSampleId(raw) {
  const cfg = QUESTIONNAIRE.sampleId || {};
  let id = String(raw || "").toUpperCase().replace(/\s+/g, "");
  if (!id || cfg.pattern || !cfg.prefix) return id;
  const prefix = cfg.prefix.toUpperCase();
  const len = cfg.length || 6;
  if (id.startsWith(prefix)) return id;
  const bare = prefix.replace(/[^A-Z0-9]/g, ""); // "HD-" -> "HD"
  if (bare && id.startsWith(bare) && id.length === bare.length + len) id = id.slice(bare.length);
  return prefix + id;
}

export function generateSampleId() {
  const cfg = QUESTIONNAIRE.sampleId || {};
  const len = cfg.length || 6;
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += SAMPLE_ID_ALPHABET[b % SAMPLE_ID_ALPHABET.length];
  return (cfg.prefix || "") + s;
}

/**
 * Works out which questions are visible given current answers (showIf logic).
 * getAnswer(q) returns the current answer for a question.
 */
export function computeVisibility(questions, getAnswer) {
  const visible = {};
  const answers = {};
  for (const q of questions) {
    let show = true;
    if (q.showIf) {
      const parent = q.showIf.question;
      const parentShown = visible[parent] === true;
      const v = parentShown ? answers[parent] : undefined;
      const allowed = q.showIf.in || [];
      show = parentShown && (Array.isArray(v) ? v.some((x) => allowed.includes(x)) : allowed.includes(v));
    }
    visible[q.id] = show;
    answers[q.id] = show ? getAnswer(q) : undefined;
  }
  return { visible, answers };
}

/** Returns a list of human-readable problems in questions.js (empty = all good). */
export function validateConfig() {
  const errors = [];
  const qs = QUESTIONNAIRE.questions || [];
  if (!QUESTIONNAIRE.version) errors.push("questions.js is missing a `version`.");
  const ids = qs.map((q) => q.id);
  const seen = new Set();
  qs.forEach((q, i) => {
    const where = `Question #${i + 1}${q.id ? ` ("${q.id}")` : ""}`;
    if (!q.id || !/^[a-z][a-z0-9_]*$/.test(q.id)) {
      errors.push(`${where}: id must use lowercase letters, numbers and underscores, starting with a letter.`);
    } else if (q.id.includes("__")) {
      errors.push(`${where}: id can't contain a double underscore.`);
    }
    if (q.id && seen.has(q.id)) errors.push(`${where}: duplicate id — every id must be unique, including retired ones.`);
    seen.add(q.id);
    if (RESERVED_IDS.includes(q.id)) errors.push(`${where}: "${q.id}" is reserved; choose another id.`);
    if (!QUESTION_TYPES.includes(q.type)) errors.push(`${where}: unknown type "${q.type}". Use one of: ${QUESTION_TYPES.join(", ")}.`);
    if (!q.label) errors.push(`${where}: missing label.`);
    if (CHOICE_TYPES.includes(q.type)) {
      const opts = normalizeOptions(q);
      if (!opts.length) errors.push(`${where}: ${q.type} questions need options.`);
      const vals = opts.map((o) => o.value);
      if (vals.some((v) => v === undefined || v === "")) errors.push(`${where}: every option needs a value.`);
      if (new Set(vals).size !== vals.length) errors.push(`${where}: two options share the same value.`);
    }
    if (q.showIf) {
      const pIdx = ids.indexOf(q.showIf.question);
      if (pIdx === -1) errors.push(`${where}: showIf refers to unknown question "${q.showIf.question}".`);
      else if (pIdx >= i) errors.push(`${where}: showIf question "${q.showIf.question}" must come earlier in the list.`);
      if (!Array.isArray(q.showIf.in)) errors.push(`${where}: showIf needs an "in" list, e.g. in: ["yes"].`);
    }
  });
  return errors;
}

export function firebaseConfigured(cfg) {
  return cfg && cfg.projectId && !String(cfg.apiKey || "").includes("REPLACE");
}
