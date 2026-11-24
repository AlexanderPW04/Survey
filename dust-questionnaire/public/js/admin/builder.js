// Survey tab: edit the draft questionnaire, preview it, and publish new versions.
import {
  TYPES, isChoice, isNumberType, isAnswerable, optionsOf, slugify, uniqueSlug, randomId,
  definitionProblems, renderSurvey, h, TEXT_DEFAULT_MAX, formatDateISO,
} from "../core.js";
import { doc, setDoc, updateDoc, writeBatch, serverTimestamp } from "../firebase.js";
import { state, lockedKeys, refresh } from "./main.js";
import { clone, toast, errorText, openModal, confirmBox, localTime } from "./util.js";

let work = null;        // the working copy of the draft definition
let savedJson = "";     // JSON of the draft as last saved
let selectedId = null;
let busy = "";
let panelEl, toolbarEl, problemsEl, listEl, settingsEl;

export const isDirty = () => !!work && JSON.stringify(work) !== savedJson;

/** Removes builder-only fields (those starting with "_") before publishing. */
export function stripped(def) {
  const out = clone(def);
  for (const q of out.questions || []) {
    for (const k of Object.keys(q)) if (k.startsWith("_")) delete q[k];
    for (const o of q.options || []) for (const k of Object.keys(o)) if (k.startsWith("_")) delete o[k];
  }
  return out;
}

function syncFromState() {
  const incoming = JSON.stringify(state.draft.definition);
  if (!work || (!isDirty() && incoming !== savedJson)) {
    work = clone(state.draft.definition);
    work.questions ||= [];
    savedJson = JSON.stringify(work);
    if (!work.questions.some((q) => q.id === selectedId)) selectedId = work.questions[0]?.id || null;
  }
}

const sel = () => work.questions.find((q) => q.id === selectedId);
const idx = (q) => work.questions.indexOf(q);
const isLocked = (q, locked = lockedKeys()) => locked.has(q.key);

// ======================================================================= render
export function render(panel) {
  panelEl = panel;
  syncFromState();
  toolbarEl = h("div", { class: "card toolbar" });
  problemsEl = h("div", { class: "problems", "aria-live": "polite" });
  listEl = h("div", { class: "q-list", "aria-label": "Questions" });
  settingsEl = h("div", { class: "card settings" });

  panel.replaceChildren(
    toolbarEl,
    problemsEl,
    detailsCard(),
    h("div", { class: "builder-grid" },
      h("div", { class: "list-col" },
        h("div", { class: "card list-card" }, h("h2", {}, "Questions"), listEl, addBar())),
      settingsEl),
  );
  renderToolbar();
  renderList();
  renderSettings();
}

function changed({ list = true, settings = false } = {}) {
  renderToolbar();
  if (list) renderList();
  if (settings) renderSettings();
}

// ----------------------------------------------------------------- toolbar
function renderToolbar() {
  const pub = state.pub;
  const publishedJson = pub ? JSON.stringify(pub.definition) : null;
  const differsFromPublished = JSON.stringify(stripped(work)) !== publishedJson;
  const status = !pub
    ? h("span", { class: "badge muted" }, "Not published yet")
    : pub.status === "open"
      ? h("span", { class: "badge ok" }, "Open · collecting responses")
      : h("span", { class: "badge warn" }, "Closed · not accepting responses");

  const draftNote = isDirty() ? "Unsaved changes"
    : !pub ? "Draft saved — publish to make it live"
    : differsFromPublished ? "Draft saved · has changes not yet published" : "Live survey matches this draft";

  const b = (label, onclick, cls = "btn", extra = {}) =>
    h("button", { type: "button", class: cls, onclick, disabled: !!busy || extra.disabled, title: extra.title }, busy === label ? "Working…" : label);

  toolbarEl.replaceChildren(
    h("div", { class: "toolbar-info" },
      h("div", { class: "row tight" }, status, pub ? h("span", { class: "meta" }, `Live: version ${pub.version}`) : null),
      h("p", { class: "meta" + (isDirty() ? " unsaved" : "") }, draftNote,
        state.draft.updatedAt && !isDirty() ? ` · saved ${localTime(state.draft.updatedAt)}${state.draft.updatedBy ? ` by ${state.draft.updatedBy}` : ""}` : "")),
    h("div", { class: "row toolbar-actions" },
      b("Preview", preview),
      isDirty() ? b("Discard changes", discard, "btn ghost") : null,
      b("Save draft", save, "btn", { disabled: !isDirty() }),
      b("Publish", publish, "btn primary", { disabled: pub && !isDirty() && !differsFromPublished, title: "Make this draft the live survey" }),
      pub ? b(pub.status === "open" ? "Close responses" : "Open responses", toggleStatus, "btn ghost") : null),
  );
  renderProblems();
}

function renderProblems() {
  const problems = definitionProblems(work, { forPublish: true });
  problemsEl.replaceChildren(problems.length ? h("div", { class: "notice warn" },
    h("strong", {}, "To publish, fix:"),
    h("ul", {}, problems.map((p) => h("li", {},
      p.qid ? h("button", { type: "button", class: "linklike", onclick: () => { selectedId = p.qid; changed({ settings: true }); } }, p.msg) : p.msg)))) : "");
}

// ----------------------------------------------------------------- survey details
function detailsCard() {
  const field = (label, key, { area = false, help = "", max = 2000 } = {}) => {
    const id = `def-${key}`;
    const input = h(area ? "textarea" : "input", { id, maxlength: max, rows: area ? 2 : null });
    input.value = work[key] || "";
    input.addEventListener("input", () => { work[key] = input.value; renderToolbar(); });
    return h("div", { class: "field" }, h("label", { for: id }, label), help ? h("p", { class: "help" }, help) : null, input);
  };
  return h("details", { class: "card details-card" },
    h("summary", {}, h("strong", {}, "Survey title & messages"), h("span", { class: "meta" }, " — title, introduction, thank-you text, footer")),
    h("div", { class: "grid-2" },
      field("Survey title", "title", { max: 160 }),
      field("Footer", "footer", { max: 300, help: "Optional — e.g. lab name, contact email, ethics approval number." }),
      field("Introduction", "intro", { area: true }),
      field("Thank-you message", "thankYou", { area: true })));
}

// ----------------------------------------------------------------- question list
function renderList() {
  const locked = lockedKeys();
  let n = 0;
  const items = work.questions.map((q, i) => {
    const number = isAnswerable(q) ? ++n : null;
    const conditional = q.showIf?.key ? describeCondition(q) : "";
    const card = h("div", {
      class: "q-card" + (q.id === selectedId ? " selected" : "") + (q.type === "section" ? " section" : ""),
      "data-id": q.id,
    },
      h("span", { class: "grip", draggable: "true", title: "Drag to reorder", "aria-hidden": "true" }, "⠿"),
      h("button", { type: "button", class: "q-select", "aria-pressed": q.id === selectedId ? "true" : "false", onclick: () => select(q.id) },
        h("span", { class: "q-title" }, number ? h("span", { class: "q-num" }, `${number}.`) : null, q.label || h("em", {}, "Untitled")),
        h("span", { class: "q-meta" },
          TYPES[q.type]?.label || q.type,
          q.required ? " · Required" : "",
          conditional ? ` · Shown if ${conditional}` : "",
          isLocked(q, locked) ? " · 🔒 published" : "")),
      h("span", { class: "move" },
        h("button", { type: "button", class: "icon-btn", "aria-label": `Move up: ${q.label || "question"}`, disabled: i === 0, onclick: () => move(i, i - 1) }, "↑"),
        h("button", { type: "button", class: "icon-btn", "aria-label": `Move down: ${q.label || "question"}`, disabled: i === work.questions.length - 1, onclick: () => move(i, i + 1) }, "↓")));
    // drag & drop reordering
    card.querySelector(".grip").addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/x-question", q.id);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("text/x-question")) return;
      e.preventDefault();
      const after = e.clientY > card.getBoundingClientRect().top + card.offsetHeight / 2;
      card.classList.toggle("drop-before", !after);
      card.classList.toggle("drop-after", after);
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-before", "drop-after"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drop-before", "drop-after");
      const from = work.questions.findIndex((x) => x.id === e.dataTransfer.getData("text/x-question"));
      if (from < 0) return;
      const after = e.clientY > card.getBoundingClientRect().top + card.offsetHeight / 2;
      let to = i + (after ? 1 : 0);
      if (from < to) to--;
      move(from, to);
    });
    return card;
  });
  listEl.replaceChildren(...(items.length ? items : [h("p", { class: "meta" }, "No questions yet — add one below.")]));
}

function describeCondition(q) {
  const parent = work.questions.find((x) => x.key === q.showIf.key);
  if (!parent) return "(missing question)";
  const name = parent.label ? `“${parent.label.slice(0, 28)}${parent.label.length > 28 ? "…" : ""}”` : parent.key;
  if (isNumberType(parent)) return `${name} ${{ gt: ">", lt: "<", eq: "=" }[q.showIf.op] || ">"} ${q.showIf.number}`;
  const labels = optionsOf(parent).filter((o) => (q.showIf.values || []).includes(o.value)).map((o) => o.label);
  return `${name} is ${labels.join(" or ") || "…"}`;
}

function select(id) {
  selectedId = id;
  renderList();
  renderSettings();
  settingsEl.querySelector("textarea, input")?.focus({ preventScroll: true });
  if (window.matchMedia("(max-width: 900px)").matches) settingsEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function move(from, to) {
  if (to < 0 || to >= work.questions.length || from === to) return;
  const [q] = work.questions.splice(from, 1);
  work.questions.splice(to, 0, q);
  changed({ settings: true });
}

function addBar() {
  const typeSel = h("select", { "aria-label": "Question type" },
    Object.entries(TYPES).map(([k, t]) => h("option", { value: k }, t.label)));
  typeSel.value = "single";
  return h("div", { class: "add-bar" },
    typeSel,
    h("button", { type: "button", class: "btn primary", onclick: () => addQuestion(typeSel.value) }, "+ Add question"));
}

function newOption(label, taken) {
  return { value: uniqueSlug(slugify(label, 3, 24), taken), label, _autoCode: true };
}

function addQuestion(type) {
  const keys = new Set(work.questions.map((q) => q.key));
  const q = { id: randomId(8), key: uniqueSlug(type === "section" ? "section" : "question", keys), _autoKey: true, type, label: "", help: "", required: type !== "section" && type !== "short" && type !== "long" };
  applyTypeDefaults(q);
  const at = sel() ? idx(sel()) + 1 : work.questions.length;
  work.questions.splice(at, 0, q);
  selectedId = q.id;
  changed({ settings: true });
  settingsEl.querySelector("textarea")?.focus();
}

function applyTypeDefaults(q) {
  if (isChoice(q) && q.type !== "yesno") {
    if (!q.options?.length) { q.options = []; q.options.push(newOption("Option 1", new Set())); q.options.push(newOption("Option 2", new Set(["option_1"]))); }
  } else delete q.options;
  if (!isNumberType(q)) { delete q.min; delete q.max; delete q.unit; }
  if (q.type !== "date") { delete q.dateOrder; delete q.noFuture; delete q.notAfter; }
  else { q.dateOrder ||= "DMY"; if (q.noFuture === undefined) q.noFuture = true; }
  if (q.type === "short" || q.type === "long") q.maxLength ||= TEXT_DEFAULT_MAX[q.type];
  else delete q.maxLength;
  if (q.type === "section") { q.required = false; delete q.showIf; }
}

// ----------------------------------------------------------------- key/code renames keep references intact
function renameKey(q, newKey) {
  const old = q.key;
  if (old === newKey) return;
  q.key = newKey;
  for (const other of work.questions) {
    if (other.showIf?.key === old) other.showIf.key = newKey;
    if (other.notAfter === old) other.notAfter = newKey;
  }
}

function renameOptionCode(q, opt, newCode) {
  const old = opt.value;
  opt.value = newCode;
  for (const other of work.questions) {
    if (other.showIf?.key === q.key && other.showIf.values) {
      other.showIf.values = other.showIf.values.map((v) => (v === old ? newCode : v));
    }
  }
}

function dependents(q) {
  return work.questions.filter((o) => o !== q && (o.showIf?.key === q.key || o.notAfter === q.key));
}

// ----------------------------------------------------------------- settings panel
function renderSettings() {
  const q = sel();
  if (!q) {
    settingsEl.replaceChildren(h("h2", {}, "Question settings"), h("p", { class: "meta" }, "Select a question on the left, or add one."));
    return;
  }
  const locked = lockedKeys();
  const lockInfo = locked.get(q.key);
  const uid = (s) => `qs-${s}`;

  const typeSel = h("select", { id: uid("type"), disabled: !!lockInfo },
    Object.entries(TYPES).map(([k, t]) => h("option", { value: k }, t.label)));
  typeSel.value = q.type;
  typeSel.addEventListener("change", () => {
    const wasChoice = isChoice(q);
    q.type = typeSel.value;
    if (wasChoice !== isChoice(q)) delete q.options;
    applyTypeDefaults(q);
    // conditions that depended on this question may no longer make sense
    for (const d of dependents(q)) if (d.showIf?.key === q.key && !(isChoice(q) || isNumberType(q))) delete d.showIf;
    changed({ settings: true });
  });

  const label = h("textarea", { id: uid("label"), rows: 3, maxlength: 400 });
  label.value = q.label || "";
  label.addEventListener("input", () => {
    q.label = label.value;
    if (q._autoKey && !lockInfo) {
      const taken = new Set(work.questions.filter((x) => x !== q).map((x) => x.key));
      renameKey(q, uniqueSlug(slugify(q.label) || "question", taken));
      keyInput.value = q.key;
    }
    changed();
  });

  const help = h("input", { id: uid("help"), maxlength: 300 });
  help.value = q.help || "";
  help.addEventListener("input", () => { q.help = help.value; changed({ list: false }); });

  const keyInput = h("input", { id: uid("key"), class: "mono", maxlength: 40, disabled: !!lockInfo });
  keyInput.value = q.key;
  keyInput.addEventListener("change", () => {
    const taken = new Set(work.questions.filter((x) => x !== q).map((x) => x.key));
    const v = keyInput.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    if (!v || !/^[a-z]/.test(v)) { toast("Column names must start with a letter.", "error"); keyInput.value = q.key; return; }
    if (taken.has(v)) { toast(`“${v}” is already used by another question.`, "error"); keyInput.value = q.key; return; }
    q._autoKey = false;
    renameKey(q, v);
    keyInput.value = v;
    changed();
  });

  const required = h("input", { type: "checkbox", id: uid("req") });
  required.checked = !!q.required;
  required.addEventListener("change", () => { q.required = required.checked; changed(); });

  const isSection = q.type === "section";
  settingsEl.replaceChildren(...[
    h("div", { class: "settings-head" }, h("h2", {}, isSection ? "Section heading" : "Question settings"),
      lockInfo ? h("span", { class: "badge muted", title: "This question is in a published version" }, "🔒 Published") : null),
    field("Type", typeSel, uid("type"), lockInfo ? "Can't change after publishing. To ask it differently, add a new question and delete this one." : ""),
    field(isSection ? "Heading" : "Question wording", label, uid("label")),
    field(isSection ? "Text under the heading (optional)" : "Help text (optional)", help, uid("help")),
    isSection ? null : h("label", { class: "check" }, required, " Required"),
    isChoice(q) && q.type !== "yesno" ? choicesEditor(q, lockInfo) : null,
    isNumberType(q) ? numberSettings(q) : null,
    q.type === "date" ? dateSettings(q) : null,
    q.type === "short" || q.type === "long" ? textSettings(q) : null,
    isSection ? null : conditionEditor(q),
    isSection ? null : field("Column name in exports", keyInput, uid("key"),
      lockInfo ? "Locked because responses may already use it. Wording changes are fine; if the meaning changes, add a new question instead."
        : "Short, stable name for this question in Excel/CSV (made automatically from the wording)."),
    h("div", { class: "row settings-actions" },
      h("button", { type: "button", class: "btn", onclick: () => duplicate(q) }, "Duplicate"),
      h("button", { type: "button", class: "btn danger-ghost", onclick: () => remove(q) }, "Delete")),
  ].filter(Boolean));
}

function field(labelText, control, id, help = "") {
  return h("div", { class: "field" }, h("label", { for: id }, labelText), control, help ? h("p", { class: "help" }, help) : null);
}

function numInput(value, onChange, attrs = {}) {
  const i = h("input", { type: "text", inputmode: "decimal", class: "num", ...attrs });
  i.value = value ?? "";
  i.addEventListener("input", () => {
    const v = i.value.trim();
    onChange(v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : v);
    changed({ list: false });
  });
  return i;
}

function choicesEditor(q, lockInfo) {
  const rows = q.options.map((o, i) => {
    const codeLocked = lockInfo?.options.has(o.value);
    const lab = h("input", { "aria-label": `Choice ${i + 1} text`, maxlength: 160 });
    lab.value = o.label;
    const code = h("input", { class: "mono code", "aria-label": `Choice ${i + 1} code`, maxlength: 30, disabled: !!codeLocked, title: codeLocked ? "Locked: used in a published version" : "Code stored in the data" });
    code.value = o.value;
    lab.addEventListener("input", () => {
      o.label = lab.value;
      if (o._autoCode && !codeLocked) {
        const taken = new Set(q.options.filter((x) => x !== o).map((x) => x.value));
        renameOptionCode(q, o, uniqueSlug(slugify(o.label, 3, 24) || "option", taken));
        code.value = o.value;
      }
      changed();
    });
    code.addEventListener("change", () => {
      const v = code.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      if (!v || q.options.some((x) => x !== o && x.value === v)) { toast("Each choice needs a different code.", "error"); code.value = o.value; return; }
      o._autoCode = false;
      renameOptionCode(q, o, v);
      code.value = v;
      changed();
    });
    const spec = h("input", { type: "checkbox", "aria-label": `Ask to specify for ${o.label || "choice " + (i + 1)}` });
    spec.checked = !!o.specify;
    spec.addEventListener("change", () => {
      o.specify = spec.checked;
      if (o.specify) o.specifyLabel ||= "please specify"; else delete o.specifyLabel;
      changed({ list: false, settings: true });
    });
    const specLabel = o.specify ? h("input", { class: "spec-label", "aria-label": "Prompt for the text box", maxlength: 60, placeholder: "please specify" }) : null;
    if (specLabel) {
      specLabel.value = o.specifyLabel || "";
      specLabel.addEventListener("input", () => { o.specifyLabel = specLabel.value; changed({ list: false }); });
    }
    return h("li", { class: "choice-row" },
      h("div", { class: "choice-main" }, lab, code,
        h("button", { type: "button", class: "icon-btn", "aria-label": "Move choice up", disabled: i === 0, onclick: () => { q.options.splice(i - 1, 0, q.options.splice(i, 1)[0]); changed({ settings: true }); } }, "↑"),
        h("button", { type: "button", class: "icon-btn", "aria-label": "Move choice down", disabled: i === q.options.length - 1, onclick: () => { q.options.splice(i + 1, 0, q.options.splice(i, 1)[0]); changed({ settings: true }); } }, "↓"),
        h("button", { type: "button", class: "icon-btn danger-ghost", "aria-label": `Delete choice ${o.label}`, onclick: () => removeOption(q, i) }, "✕")),
      h("label", { class: "check small" }, spec, " Show a text box when chosen"),
      specLabel ? h("div", { class: "spec-wrap" }, h("span", { class: "meta" }, "Text box prompt:"), specLabel) : null);
  });
  return h("fieldset", { class: "sub" },
    h("legend", {}, "Choices"),
    h("p", { class: "help" }, "Left: what participants see. Right: the short code saved in the data. Tick “text box” for choices like “Other (specify)”. Keep text boxes to a minimum."),
    h("ol", { class: "choice-list" }, rows),
    h("button", { type: "button", class: "btn", onclick: () => {
      const taken = new Set(q.options.map((o) => o.value));
      q.options.push(newOption(`Option ${q.options.length + 1}`, taken));
      changed({ settings: true });
      const last = [...settingsEl.querySelectorAll(".choice-main input:first-child")].pop();
      last?.focus(); last?.select();
    } }, "+ Add choice"));
}

async function removeOption(q, i) {
  const o = q.options[i];
  const deps = work.questions.filter((d) => d.showIf?.key === q.key && (d.showIf.values || []).includes(o.value));
  if (deps.length && !(await confirmBox("Delete choice?", `${deps.length} question(s) are only shown when “${o.label}” is chosen. Their condition will be updated.`, "Delete"))) return;
  q.options.splice(i, 1);
  for (const d of deps) d.showIf.values = d.showIf.values.filter((v) => v !== o.value);
  changed({ settings: true });
}

function numberSettings(q) {
  return h("fieldset", { class: "sub" },
    h("legend", {}, "Number limits"),
    h("div", { class: "row" },
      h("label", { class: "mini" }, "Minimum", numInput(q.min, (v) => { q.min = v; })),
      h("label", { class: "mini" }, "Maximum", numInput(q.max, (v) => { q.max = v; })),
      h("label", { class: "mini" }, "Unit (optional)", (() => {
        const u = h("input", { maxlength: 20, placeholder: "e.g. m²", class: "num" });
        u.value = q.unit || "";
        u.addEventListener("input", () => { q.unit = u.value; changed({ list: false }); });
        return u;
      })())));
}

function dateSettings(q) {
  const order = h("select", { id: "qs-dateorder" },
    [["DMY", "DD / MM / YYYY"], ["MDY", "MM / DD / YYYY"], ["YMD", "YYYY - MM - DD"]].map(([v, t]) => h("option", { value: v }, t)));
  order.value = q.dateOrder || "DMY";
  order.addEventListener("change", () => { q.dateOrder = order.value; changed({ list: false }); });
  const noFuture = h("input", { type: "checkbox" });
  noFuture.checked = q.noFuture !== false;
  noFuture.addEventListener("change", () => { q.noFuture = noFuture.checked; changed({ list: false }); });
  const others = work.questions.filter((x) => x.type === "date" && x !== q);
  const notAfter = h("select", { id: "qs-notafter" }, h("option", { value: "" }, "— no limit —"),
    others.map((x) => h("option", { value: x.key }, x.label || x.key)));
  notAfter.value = q.notAfter || "";
  notAfter.addEventListener("change", () => { if (notAfter.value) q.notAfter = notAfter.value; else delete q.notAfter; changed({ list: false }); });
  return h("fieldset", { class: "sub" },
    h("legend", {}, "Date"),
    field("Order of the boxes", order, "qs-dateorder", "Exports always use YYYY-MM-DD."),
    h("label", { class: "check" }, noFuture, " Don't allow future dates"),
    others.length ? field("Must be on or before", notAfter, "qs-notafter") : null);
}

function textSettings(q) {
  const max = numInput(q.maxLength, (v) => { q.maxLength = Number.isInteger(v) && v > 0 ? Math.min(v, 2000) : TEXT_DEFAULT_MAX[q.type]; }, { id: "qs-maxlen" });
  return h("fieldset", { class: "sub" },
    h("legend", {}, "Text answer"),
    field("Maximum characters", max, "qs-maxlen", "Free-text answers are harder to analyse — prefer choice questions where possible."));
}

function conditionEditor(q) {
  const i = idx(q);
  const candidates = work.questions.slice(0, i).filter((x) => isChoice(x) || isNumberType(x));
  const parentSel = h("select", { id: "qs-showif" }, h("option", { value: "" }, "Always show this question"),
    candidates.map((x) => h("option", { value: x.key }, `Only if: ${x.label ? x.label.slice(0, 60) : x.key}`)));
  parentSel.value = q.showIf?.key || "";
  parentSel.addEventListener("change", () => {
    const p = candidates.find((x) => x.key === parentSel.value);
    if (!p) delete q.showIf;
    else q.showIf = isNumberType(p) ? { key: p.key, op: "gt", number: 0 } : { key: p.key, op: "any", values: [] };
    changed({ settings: true });
  });

  let detail = null;
  const parent = candidates.find((x) => x.key === q.showIf?.key);
  if (parent && isChoice(parent)) {
    detail = h("div", { class: "cond-detail" }, h("p", { class: "help" }, "…is answered with any of:"),
      optionsOf(parent).map((o) => {
        const c = h("input", { type: "checkbox" });
        c.checked = (q.showIf.values || []).includes(o.value);
        c.addEventListener("change", () => {
          const set = new Set(q.showIf.values || []);
          c.checked ? set.add(o.value) : set.delete(o.value);
          q.showIf.values = optionsOf(parent).map((x) => x.value).filter((v) => set.has(v));
          changed();
        });
        return h("label", { class: "check" }, c, " ", o.label);
      }));
  } else if (parent && isNumberType(parent)) {
    const op = h("select", { "aria-label": "Comparison" }, [["gt", "is more than"], ["lt", "is less than"], ["eq", "equals"]].map(([v, t]) => h("option", { value: v }, t)));
    op.value = q.showIf.op || "gt";
    op.addEventListener("change", () => { q.showIf.op = op.value; changed(); });
    detail = h("div", { class: "row cond-detail" }, h("span", { class: "meta" }, "…the answer"), op,
      numInput(q.showIf.number, (v) => { q.showIf.number = v; renderList(); }, { "aria-label": "Number" }));
  }
  return h("fieldset", { class: "sub" }, h("legend", {}, "Show only if (skip logic)"),
    parentSel, detail,
    !candidates.length ? h("p", { class: "help" }, "Conditions can use earlier choice, yes/no or number questions.") : null);
}

function duplicate(q) {
  const copy = clone(q);
  copy.id = randomId(8);
  copy.key = uniqueSlug(`${q.key}_copy`.slice(0, 36), new Set(work.questions.map((x) => x.key)));
  copy._autoKey = false;
  work.questions.splice(idx(q) + 1, 0, copy);
  selectedId = copy.id;
  changed({ settings: true });
}

async function remove(q) {
  const deps = dependents(q);
  const msg = (lockedKeys().has(q.key) ? "Answers already collected for it stay in the exports. " : "") +
    (deps.length ? `${deps.length} other question(s) refer to it; those conditions will be removed.` : "");
  if (!(await confirmBox(`Delete “${q.label || "this question"}”?`, msg || "You can undo this with “Discard changes” until you save.", "Delete", { danger: true }))) return;
  for (const d of deps) { if (d.showIf?.key === q.key) delete d.showIf; if (d.notAfter === q.key) delete d.notAfter; }
  const i = idx(q);
  work.questions.splice(i, 1);
  selectedId = work.questions[Math.min(i, work.questions.length - 1)]?.id || null;
  changed({ settings: true });
}

// ======================================================================= actions
async function run(label, fn) {
  if (busy) return;
  busy = label;
  renderToolbar();
  try { await fn(); } catch (e) { console.error(e); toast(errorText(e), "error"); }
  finally { busy = ""; if (panelEl?.isConnected) renderToolbar(); }
}

function blockingProblems() {
  return definitionProblems(work).filter((p) => !/enter the question wording|Add at least one|Give the survey a title/.test(p.msg));
}

function save() {
  const problems = blockingProblems();
  if (problems.length) { toast("Fix the problems listed at the top before saving.", "error"); return; }
  return run("Save draft", async () => {
    await setDoc(doc(state.db, "settings", "draft"), { definition: work, updatedAt: serverTimestamp(), updatedBy: state.user.email });
    savedJson = JSON.stringify(work);
    await refresh("survey");
    toast("Draft saved. Participants still see the published version until you publish.");
  });
}

async function discard() {
  if (!(await confirmBox("Discard changes?", "This reverts to the last saved draft.", "Discard", { danger: true }))) return;
  work = clone(state.draft.definition);
  savedJson = JSON.stringify(work);
  if (!sel()) selectedId = work.questions[0]?.id || null;
  render(panelEl);
}

async function publish() {
  const problems = definitionProblems(work, { forPublish: true });
  if (problems.length) {
    toast("Fix the problems listed at the top before publishing.", "error");
    if (problems[0].qid) { selectedId = problems[0].qid; changed({ settings: true }); }
    return;
  }
  const next = (state.pub?.version || 0) + 1;
  const ok = await confirmBox(`Publish version ${next}?`,
    `Participants will see this version immediately. ` +
    (state.pub ? "Anyone part-way through the old version will be asked to reload. " : "Responses will open for kits you've created. ") +
    "Every response records which version it answered.", "Publish");
  if (!ok) return;
  await run("Publish", async () => {
    const definition = stripped(work);
    const batch = writeBatch(state.db);
    batch.set(doc(state.db, "versions", String(next)), { number: next, definition, publishedAt: serverTimestamp(), publishedBy: state.user.email });
    batch.set(doc(state.db, "settings", "public"), { version: next, status: state.pub?.status || "open", definition, publishedAt: serverTimestamp() });
    batch.set(doc(state.db, "settings", "draft"), { definition: work, updatedAt: serverTimestamp(), updatedBy: state.user.email });
    try {
      await batch.commit();
    } catch (e) {
      if (e?.code === "permission-denied") throw new Error(`Couldn't publish — version ${next} may have just been published by another admin. Reload the page and try again.`);
      throw e;
    }
    savedJson = JSON.stringify(work);
    await refresh("survey");
    toast(`Version ${next} is live.`);
  });
}

async function toggleStatus() {
  const open = state.pub.status !== "open";
  if (!open && !(await confirmBox("Close responses?", "Participants will see “not accepting responses” until you open it again. Nothing is deleted.", "Close responses"))) return;
  await run(open ? "Open responses" : "Close responses", async () => {
    await updateDoc(doc(state.db, "settings", "public"), { status: open ? "open" : "closed" });
    await refresh("survey");
    toast(open ? "Responses are open." : "Responses are closed.");
  });
}

// ======================================================================= preview
function preview() {
  const def = stripped(work);
  const holder = h("div", { class: "preview-body" });
  const start = () => renderSurvey(holder, def, {
    preview: true,
    submitLabel: "Submit (preview)",
    onSubmit: async ({ answers, specify }) => {
      const rows = [];
      for (const q of def.questions.filter(isAnswerable)) {
        if (!(q.key in answers)) continue;
        let v = answers[q.key];
        if (q.type === "date") v = `${v}  (shown as ${formatDateISO(v, q.dateOrder)})`;
        else if (Array.isArray(v)) v = v.join(", ");
        rows.push([q.key, String(v)]);
        for (const [opt, text] of Object.entries(specify[q.key] || {})) rows.push([`${q.key}__${opt}_text`, text]);
      }
      holder.replaceChildren(h("div", { class: "card" },
        h("h3", {}, "Preview complete — nothing was saved"),
        h("p", { class: "meta" }, "This is what would be stored (columns in the Excel export):"),
        h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Column"), h("th", {}, "Value"))),
          h("tbody", {}, rows.length ? rows.map(([k, v]) => h("tr", {}, h("td", { class: "mono" }, k), h("td", {}, v))) : h("tr", {}, h("td", { colspan: 2 }, "No answers"))))),
        h("div", { class: "row" }, h("button", { type: "button", class: "btn primary", onclick: start }, "Try again"))));
    },
  });
  openModal("Preview", [
    h("p", { class: "notice" }, "This preview shows your current draft, including unsaved changes. Answers are not saved."),
    h("div", { class: "preview-frame" },
      h("h1", {}, def.title || "Untitled survey"),
      def.intro ? h("p", { class: "lede" }, def.intro) : null,
      holder,
      def.footer ? h("p", { class: "site-footer" }, def.footer) : null),
  ], { wide: true });
  start();
}
