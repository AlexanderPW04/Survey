// Survey engine shared by the participant form and the admin preview.
// A survey "definition" is plain data edited in the dashboard:
//   { title, intro, thankYou, questions: [Question] }
// Question:
//   { id, key, type, label, help, required,
//     options: [{ value, label, specify, specifyLabel }],   // choice types
//     min, max, unit,                                      // number types
//     maxLength,                                           // text types
//     dateOrder ("DMY"|"MDY"|"YMD"), noFuture, notAfter,   // date type
//     showIf: { key, op: "any"|"gt"|"lt"|"eq", values: [], number } }

export const TYPES = {
  section: { label: "Section heading", answer: false },
  single: { label: "Single choice (list)", choice: true },
  dropdown: { label: "Single choice (dropdown)", choice: true },
  multiple: { label: "Multiple choice (tick all)", choice: true, multi: true },
  yesno: { label: "Yes / No", choice: true, fixed: true },
  integer: { label: "Whole number", number: true },
  decimal: { label: "Decimal number", number: true },
  date: { label: "Date" },
  short: { label: "Short text" },
  long: { label: "Long text" },
};
export const TEXT_DEFAULT_MAX = { short: 100, long: 500 };
export const SPECIFY_MAX = 100;
export const YESNO_OPTIONS = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const isAnswerable = (q) => TYPES[q.type]?.answer !== false;
export const isChoice = (q) => !!TYPES[q.type]?.choice;
export const isNumberType = (q) => !!TYPES[q.type]?.number;
export const optionsOf = (q) => (q.type === "yesno" ? YESNO_OPTIONS : q.options || []);

export function randomId(n = 10) {
  const bytes = new Uint32Array(n);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join("");
}

/** "Type of vacuum used for dust collection:" -> "type_of_vacuum_used" */
export function slugify(text, maxWords = 4, maxLen = 30) {
  const words = String(text || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter((w) => w && !["the", "a", "an", "of", "for", "this", "in", "to", "e", "g", "i"].includes(w));
  let s = words.slice(0, maxWords).join("_").slice(0, maxLen).replace(/_+$/g, "");
  if (!s) s = "q";
  if (!/^[a-z]/.test(s)) s = "q_" + s;
  return s;
}

export function uniqueSlug(base, taken) {
  let s = base, n = 2;
  while (taken.has(s)) s = `${base}_${n++}`;
  return s;
}

export function todayISO() {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
}

export function formatDateISO(iso, order = "DMY") {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "";
  const [y, m, d] = iso.split("-");
  return order === "MDY" ? `${m}/${d}/${y}` : order === "YMD" ? `${y}-${m}-${d}` : `${d}/${m}/${y}`;
}

// --------------------------------------------------------------------------
// Visibility (skip logic)
// --------------------------------------------------------------------------
export function conditionMet(cond, value) {
  if (!cond) return true;
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return false;
  switch (cond.op) {
    case "gt": return typeof value === "number" && value > Number(cond.number);
    case "lt": return typeof value === "number" && value < Number(cond.number);
    case "eq": return typeof value === "number" && value === Number(cond.number);
    case "any":
    default: {
      const allowed = cond.values || [];
      return Array.isArray(value) ? value.some((v) => allowed.includes(v)) : allowed.includes(value);
    }
  }
}

/** answerOf(q) -> parsed answer (or undefined). Returns {visible:{key:bool}, answers:{key:value}} */
export function computeVisibility(questions, answerOf) {
  const visible = {}, answers = {};
  for (const q of questions) {
    let show = true;
    if (q.showIf && q.showIf.key) {
      show = visible[q.showIf.key] === true && conditionMet(q.showIf, answers[q.showIf.key]);
    }
    visible[q.key] = show;
    if (show && isAnswerable(q)) answers[q.key] = answerOf(q);
  }
  return { visible, answers };
}

// --------------------------------------------------------------------------
// Definition validation (used by the builder before saving/publishing)
// --------------------------------------------------------------------------
export function definitionProblems(def, { forPublish = false } = {}) {
  const problems = []; // {qid|null, msg}
  const add = (q, msg) => problems.push({ qid: q ? q.id : null, msg: q ? `${q.label ? `“${trunc(q.label, 50)}”` : "Untitled question"}: ${msg}` : msg });
  if (!String(def.title || "").trim()) add(null, "Give the survey a title.");
  const qs = def.questions || [];
  if (forPublish && !qs.some(isAnswerable)) add(null, "Add at least one question.");
  const keys = new Map();
  qs.forEach((q, i) => {
    if (!TYPES[q.type]) { add(q, `unknown question type “${q.type}”.`); return; }
    if (!q.key || !/^[a-z][a-z0-9_]{0,39}$/.test(q.key) || q.key.includes("__")) add(q, "column name must be lowercase letters, numbers and single underscores, starting with a letter (max 40).");
    if (keys.has(q.key)) add(q, `column name “${q.key}” is used twice.`);
    keys.set(q.key, i);
    if (forPublish && !String(q.label || "").trim()) add(q, "enter the question wording.");
    if (isChoice(q) && q.type !== "yesno") {
      const opts = q.options || [];
      if (opts.length < 2) add(q, "add at least two choices.");
      if (opts.some((o) => !String(o.label || "").trim())) add(q, "a choice is missing its text.");
      const vals = opts.map((o) => o.value);
      if (new Set(vals).size !== vals.length) add(q, "two choices have the same code.");
      if (vals.some((v) => !/^[a-z0-9][a-z0-9_]{0,29}$/.test(v || ""))) add(q, "choice codes must be lowercase letters, numbers and underscores.");
    }
    if (isNumberType(q)) {
      const nums = [q.min, q.max].filter((v) => v !== null && v !== undefined && v !== "");
      if (nums.some((v) => !Number.isFinite(Number(v)))) add(q, "minimum/maximum must be numbers.");
      if (q.type === "integer" && nums.some((v) => !Number.isInteger(Number(v)))) add(q, "limits for a whole-number question must be whole numbers.");
      if (nums.length === 2 && Number(q.min) > Number(q.max)) add(q, "minimum is larger than maximum.");
    }
    if (q.type === "date" && q.notAfter) {
      const other = qs.find((x) => x.key === q.notAfter);
      if (!other || other.type !== "date" || other.key === q.key) add(q, "the “must be on or before” question must be another date question.");
    }
    if (q.showIf && q.showIf.key) {
      const pIdx = qs.findIndex((x) => x.key === q.showIf.key);
      const parent = qs[pIdx];
      if (pIdx === -1) add(q, "“show only if” refers to a question that no longer exists.");
      else if (pIdx >= i) add(q, "“show only if” must depend on an earlier question.");
      else if (isChoice(parent) && !(q.showIf.values || []).length) add(q, "“show only if” needs at least one answer ticked.");
      else if (isNumberType(parent) && !Number.isFinite(Number(q.showIf.number))) add(q, "“show only if” needs a number.");
      else if (!isChoice(parent) && !isNumberType(parent)) add(q, "“show only if” can only depend on a choice, yes/no or number question.");
    }
  });
  return problems;
}

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) node.append(c);
  return node;
}

const DATE_PARTS = {
  D: { label: "Day", ph: "DD", len: 2, cls: "dd" },
  M: { label: "Month", ph: "MM", len: 2, cls: "mm" },
  Y: { label: "Year", ph: "YYYY", len: 4, cls: "yyyy" },
};

/**
 * Renders a survey into `root`.
 * opts.onSubmit(payload) -> Promise  (payload = { answers, specify })
 * opts.submitLabel, opts.preview (bool)
 * Returns { reset() }.
 */
export function renderSurvey(root, def, opts = {}) {
  const questions = (def.questions || []).filter((q) => TYPES[q.type]);
  const uid = "s" + randomId(5);
  const form = h("form", { class: "survey-form", novalidate: true });
  const card = h("div", { class: "card questions" });
  form.append(card);

  for (const q of questions) card.append(renderQuestion(q, uid));

  const status = h("p", { class: "status", role: "status", "aria-live": "polite" });
  const submitBtn = h("button", { type: "submit", class: "btn primary" }, opts.submitLabel || "Submit");
  form.append(h("div", { class: "actions" }, submitBtn, status));
  root.replaceChildren(form);

  const wrapOf = (q) => form.querySelector(`[data-qkey="${q.key}"]`);

  // ---- reading answers ----
  function readRaw(q) {
    const w = wrapOf(q);
    switch (q.type) {
      case "multiple":
        return [...w.querySelectorAll('input[type=checkbox][data-opt]:checked')].map((i) => i.value);
      case "single": case "yesno":
        return w.querySelector('input[type=radio][data-opt]:checked')?.value ?? "";
      case "dropdown":
        return w.querySelector("select").value;
      case "integer": case "decimal":
        return w.querySelector("input").value.trim();
      case "date": {
        const get = (p) => w.querySelector(`[data-part="${p}"]`).value.trim();
        return { d: get("D"), m: get("M"), y: get("Y") };
      }
      case "short": case "long":
        return w.querySelector("input, textarea").value.trim();
    }
    return undefined;
  }

  function parse(q) {
    const raw = readRaw(q);
    if (q.type === "integer" || q.type === "decimal") {
      if (raw === "") return { value: null };
      if (!/^[-+]?(\d+([.,]\d*)?|[.,]\d+)$/.test(raw)) return { value: null, error: q.type === "integer" ? "Enter a whole number." : "Enter a number." };
      const n = Number(raw.replace(",", "."));
      if (q.type === "integer" && !Number.isInteger(n)) return { value: null, error: "Enter a whole number." };
      return { value: n };
    }
    if (q.type === "date") {
      const { d, m, y } = raw;
      if (!d && !m && !y) return { value: null };
      if (!d || !m || !y || y.length !== 4) return { value: null, error: "Enter the full date (day, month and 4-digit year)." };
      if (![d, m, y].every((x) => /^\d+$/.test(x))) return { value: null, error: "Use numbers only." };
      const iso = `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      const dt = new Date(iso + "T00:00:00Z");
      if (!Number.isFinite(dt.valueOf()) || dt.toISOString().slice(0, 10) !== iso || Number(y) < 1900) return { value: null, error: "That date doesn't exist — please check it." };
      return { value: iso };
    }
    if (q.type === "multiple") return { value: raw.length ? raw : null };
    return { value: raw === "" ? null : raw };
  }

  function update() {
    const { visible } = computeVisibility(questions, (q) => parse(q).value);
    for (const q of questions) {
      const w = wrapOf(q);
      w.hidden = !visible[q.key];
      // reveal "please specify" boxes for selected options
      w.querySelectorAll("[data-specify-for]").forEach((box) => {
        const opt = box.dataset.specifyFor;
        const selected = q.type === "dropdown"
          ? w.querySelector("select").value === opt
          : !!w.querySelector(`input[data-opt][value="${CSS.escape(opt)}"]:checked`);
        box.hidden = !selected;
      });
    }
  }

  function setError(w, msg) {
    const err = w.querySelector(":scope > .error-msg");
    err.textContent = msg || "";
    w.classList.toggle("invalid", !!msg);
    w.querySelectorAll(":scope > .control input, :scope > .control select, :scope > .control textarea, :scope > .control [role=radiogroup], :scope > .control [role=group]").forEach((el) => {
      if (msg) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
    });
  }

  function collect() {
    const parsed = {};
    for (const q of questions) if (isAnswerable(q)) parsed[q.key] = parse(q);
    const { visible } = computeVisibility(questions, (q) => parsed[q.key]?.value);
    const answers = {}, specify = {};
    let first = null;
    for (const q of questions) {
      const w = wrapOf(q);
      if (!isAnswerable(q)) continue;
      if (!visible[q.key]) { setError(w, ""); continue; }
      const { value, error } = parsed[q.key];
      let msg = error || "";
      const empty = value == null;
      if (!msg && empty && q.required) {
        msg = isChoice(q) ? (q.type === "multiple" ? "Tick at least one option." : "Choose an option.") : "This question is required.";
      }
      if (!msg && !empty && isNumberType(q)) {
        if (q.min !== "" && q.min != null && value < Number(q.min)) msg = `Enter ${q.min} or more.`;
        else if (q.max !== "" && q.max != null && value > Number(q.max)) msg = `Enter ${q.max} or less.`;
      }
      if (!msg && !empty && q.type === "date") {
        if (q.noFuture !== false && value > todayISO()) msg = "The date can't be in the future.";
        else if (q.notAfter && visible[q.notAfter] && parsed[q.notAfter]?.value && value > parsed[q.notAfter].value) {
          const other = questions.find((x) => x.key === q.notAfter);
          msg = `This date must be on or before ${formatDateISO(parsed[q.notAfter].value, q.dateOrder)}${other ? ` (“${trunc(other.label, 40)}”)` : ""}.`;
        }
      }
      // "please specify" text for selected options
      if (!msg && !empty && isChoice(q)) {
        const sel = Array.isArray(value) ? value : [value];
        for (const opt of optionsOf(q).filter((o) => o.specify && sel.includes(o.value))) {
          const input = w.querySelector(`[data-specify-for="${CSS.escape(opt.value)}"] input`);
          const text = input.value.trim();
          if (!text) { msg = `Please fill in “${opt.specifyLabel || "please specify"}” for ${opt.label}.`; if (!first) first = input; break; }
          (specify[q.key] ||= {})[opt.value] = text.slice(0, SPECIFY_MAX);
        }
      }
      setError(w, msg);
      if (msg && !first) first = w.querySelector("input, select, textarea");
      if (!msg && !empty) answers[q.key] = value;
    }
    return { ok: !first, first, answers, specify };
  }

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  update();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = collect();
    if (!r.ok) {
      status.textContent = "Please check the highlighted questions.";
      r.first?.focus();
      return;
    }
    submitBtn.disabled = true;
    status.textContent = opts.preview ? "" : "Submitting…";
    try {
      await opts.onSubmit?.({ answers: r.answers, specify: r.specify });
      status.textContent = "";
    } catch (err) {
      status.textContent = err?.userMessage || "Something went wrong. Please try again.";
      console.error(err);
    } finally {
      submitBtn.disabled = false;
    }
  });

  return { reset() { form.reset(); form.querySelectorAll(".invalid").forEach((w) => setError(w, "")); status.textContent = ""; update(); } };
}

function renderQuestion(q, uid) {
  const id = `${uid}_${q.key}`;
  const helpId = `${id}_help`, errId = `${id}_err`, labelId = `${id}_label`;
  const describedBy = [q.help ? helpId : null, errId].filter(Boolean).join(" ");

  if (q.type === "section") {
    return h("div", { class: "section-block", "data-qkey": q.key },
      q.label ? h("h2", { class: "section-title" }, q.label) : null,
      q.help ? h("p", { class: "help" }, q.help) : null);
  }

  const group = ["single", "multiple", "yesno", "date"].includes(q.type);
  const req = q.required ? h("span", { class: "req", "aria-hidden": "true" }, " *") : null;
  const label = group
    ? h("p", { class: "q-label", id: labelId }, q.label, req)
    : h("label", { class: "q-label", id: labelId, for: id }, q.label, req);
  const base = { id, "aria-describedby": describedBy, "aria-required": q.required ? "true" : null };

  let control;
  switch (q.type) {
    case "short":
      control = h("input", { ...base, type: "text", maxlength: q.maxLength || TEXT_DEFAULT_MAX.short, autocomplete: "off" });
      break;
    case "long":
      control = h("textarea", { ...base, rows: 3, maxlength: q.maxLength || TEXT_DEFAULT_MAX.long });
      break;
    case "integer": case "decimal":
      control = h("div", { class: "with-unit" },
        h("input", { ...base, type: "text", inputmode: q.type === "integer" ? "numeric" : "decimal", autocomplete: "off", class: "num" }),
        q.unit ? h("span", { class: "unit" }, q.unit) : null);
      break;
    case "date": {
      const order = (q.dateOrder || "DMY").split("");
      control = h("div", { class: "date-input", role: "group", "aria-labelledby": labelId, "aria-describedby": describedBy },
        order.map((p, i) => [
          i ? h("span", { class: "date-sep", "aria-hidden": "true" }, order.join("") === "YMD" ? "-" : "/") : null,
          h("label", { class: `date-part ${DATE_PARTS[p].cls}` },
            h("span", { class: "date-part-label" }, DATE_PARTS[p].label),
            h("input", { type: "text", inputmode: "numeric", maxlength: DATE_PARTS[p].len, placeholder: DATE_PARTS[p].ph, "data-part": p, autocomplete: "off", id: i === 0 ? id : null })),
        ]));
      // auto-advance between parts
      control.addEventListener("input", (e) => {
        const t = e.target;
        if (t.dataset.part && t.value.length >= Number(t.maxLength)) {
          const inputs = [...control.querySelectorAll("input")];
          inputs[inputs.indexOf(t) + 1]?.focus();
        }
      });
      break;
    }
    case "dropdown":
      control = h("select", base, h("option", { value: "" }, "Select…"),
        optionsOf(q).map((o) => h("option", { value: o.value }, o.label)));
      break;
    case "single": case "multiple": case "yesno": {
      const kind = q.type === "multiple" ? "checkbox" : "radio";
      control = h("div", {
        class: "choices" + (q.type === "yesno" ? " inline" : ""), role: kind === "radio" ? "radiogroup" : "group",
        "aria-labelledby": labelId, "aria-describedby": describedBy,
        "aria-required": kind === "radio" && q.required ? "true" : null,
      }, optionsOf(q).map((o, i) => h("label", { class: "choice" },
        h("input", { type: kind, name: id, value: o.value, id: `${id}_${i}`, "data-opt": o.value }),
        h("span", {}, o.label))));
      break;
    }
  }

  const specifyBoxes = isChoice(q) ? optionsOf(q).filter((o) => o.specify).map((o) =>
    h("div", { class: "specify", "data-specify-for": o.value, hidden: true },
      h("label", {}, h("span", { class: "specify-label" }, `${o.label} — ${o.specifyLabel || "please specify"}`),
        h("input", { type: "text", maxlength: SPECIFY_MAX, autocomplete: "off" })))) : [];

  return h("div", { class: "question", "data-qkey": q.key },
    label,
    q.help ? h("p", { class: "help", id: helpId }, q.help) : null,
    h("div", { class: "control" }, control, specifyBoxes),
    h("p", { class: "error-msg", id: errId }));
}

// --------------------------------------------------------------------------
// Kit codes: the random code inside each sample's QR link (?k=…).
// 10 characters from an alphabet without look-alikes (no 0/O, 1/I/L, U/V).
// --------------------------------------------------------------------------
export const KIT_ALPHABET = "ABCDEFGHJKMNPQRSTWXYZ23456789";
export const KIT_LENGTH = 10;

export function newKitCode() {
  const bytes = new Uint32Array(KIT_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => KIT_ALPHABET[b % KIT_ALPHABET.length]).join("");
}
export function normalizeKitCode(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export const isKitCode = (s) => new RegExp(`^[${KIT_ALPHABET}]{${KIT_LENGTH}}$`).test(s);
export const formatKitCode = (s) => (s && s.length === KIT_LENGTH ? `${s.slice(0, 5)}-${s.slice(5)}` : s || "");

export function firebaseConfigured(cfg) {
  return !!(cfg && cfg.projectId && !String(cfg.apiKey || "").includes("REPLACE"));
}
