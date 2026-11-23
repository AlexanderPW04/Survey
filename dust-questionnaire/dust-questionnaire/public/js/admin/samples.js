// Samples tab: sequential sample IDs (e.g. AZAS_001), each with its own QR code.
// The QR code contains a random kit code — never the sample ID — so participants
// never see the ID and can't submit for someone else's kit by guessing numbers.
import { doc, setDoc, writeBatch, runTransaction, serverTimestamp } from "../firebase.js";
import { newKitCode, formatKitCode, h } from "../core.js";
import { state, kitUrl, refresh, DEFAULT_IDS } from "./main.js";
import {
  $, toast, errorText, openModal, confirmBox, downloadCsv, isoUtc, localDate, localTime,
  qrImg, qrAvailable, downloadQrPng, copyText, printNodes, today, plural,
} from "./util.js";

const filter = { status: "all", q: "" };
const selected = new Set();
let lastCreated = [];
let printLayout = "sheet";
let printId = true; // print the sample ID on labels (for the lab to match physical samples)
let panelEl;

export const sampleIdFor = (n, ids) => `${ids.prefix}${String(n).padStart(Number(ids.digits) || 1, "0")}`;

export function sampleStatus(s, submitted = submittedMap()) {
  if (submitted.has(s.token)) return "submitted";
  return s.active === false ? "void" : "waiting";
}
const STATUS_BADGE = {
  waiting: ["Waiting", "muted"], submitted: ["Submitted", "ok"], void: ["Void", "warn"],
};
function submittedMap() {
  return new Map(state.responses.map((r) => [r.id, r]));
}

export function render(panel) {
  panelEl = panel;
  const real = state.samples.filter((s) => s.token);
  const submitted = submittedMap();
  const counts = { waiting: 0, submitted: 0, void: 0 };
  real.forEach((s) => counts[sampleStatus(s, submitted)]++);
  panel.replaceChildren(
    h("div", { class: "stats" },
      stat("Sample IDs", real.length), stat("Waiting", counts.waiting), stat("Submitted", counts.submitted), stat("Void", counts.void)),
    h("div", { class: "grid-2 align-start" }, createCard(), formatCard()),
    tableCard(real, submitted),
  );
}

const stat = (label, n) => h("div", { class: "stat-card" }, h("span", { class: "stat-n" }, String(n)), h("span", { class: "stat-l" }, label));

// ----------------------------------------------------------------- create
function createCard() {
  const count = h("input", { id: "gen-count", type: "number", min: 1, max: 500, value: 10, required: true, class: "num" });
  const label = h("input", { id: "gen-label", maxlength: 60, placeholder: "e.g. Kits mailed Dec 2026" });
  const btn = h("button", { class: "btn primary", type: "submit" }, "Create sample IDs");
  const form = h("form", { class: "stack" },
    h("div", { class: "row align-end" },
      h("label", { class: "mini" }, "How many", count),
      h("label", { class: "mini grow" }, "Batch label (optional)", label)),
    h("p", { class: "help" }, `Next: ${sampleIdFor(Number(state.ids.next) || 1, state.ids)}${Number(count.value) > 1 ? " onward" : ""}. Each ID gets its own QR code.`),
    btn);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = Math.floor(Number(count.value));
    if (!(n >= 1 && n <= 500)) return toast("Choose between 1 and 500.", "error");
    btn.disabled = true;
    btn.textContent = "Creating…";
    try {
      lastCreated = await generate(n, label.value.trim());
      toast(`Created ${plural(lastCreated.length, "sample ID")}: ${lastCreated[0]} – ${lastCreated[lastCreated.length - 1]}.`);
      selected.clear();
      lastCreated.forEach((id) => selected.add(id));
      await refresh("samples");
    } catch (err) {
      console.error(err);
      toast("Couldn't create IDs: " + errorText(err), "error");
      btn.disabled = false;
      btn.textContent = "Create sample IDs";
    }
  });
  return h("section", { class: "card" }, h("h2", {}, "Create sample IDs"), form,
    lastCreated.length ? h("div", { class: "notice ok-notice" },
      `Just created ${lastCreated[0]} – ${lastCreated[lastCreated.length - 1]} (selected below). `,
      h("button", { type: "button", class: "btn primary", onclick: () => printLabels(lastCreated) }, "Print their QR labels")) : null);
}

async function generate(count, batchLabel) {
  const db = state.db;
  const existing = new Set(state.samples.map((s) => s.id));
  const ref = doc(db, "settings", "ids");
  const planned = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const ids = { ...DEFAULT_IDS, ...(snap.exists() ? snap.data() : {}) };
    let n = Math.max(1, Math.floor(Number(ids.next) || 1));
    const out = [];
    while (out.length < count) {
      const id = sampleIdFor(n, ids);
      if (!existing.has(id)) out.push({ id, number: n });
      n++;
    }
    tx.set(ref, { ...ids, next: n });
    return out;
  });
  for (let i = 0; i < planned.length; i += 200) {
    const batch = writeBatch(db);
    for (const { id, number } of planned.slice(i, i + 200)) {
      const token = newKitCode();
      batch.set(doc(db, "samples", id), { number, token, batch: batchLabel, active: true, createdAt: serverTimestamp(), createdBy: state.user.email });
      batch.set(doc(db, "tokens", token), { active: true, used: false, createdAt: serverTimestamp() });
    }
    await batch.commit();
  }
  return planned.map((p) => p.id);
}

// ----------------------------------------------------------------- ID format
function formatCard() {
  const ids = state.ids;
  const prefix = h("input", { id: "id-prefix", maxlength: 12, class: "mono", value: ids.prefix });
  const digits = h("select", { id: "id-digits" }, [1, 2, 3, 4, 5, 6].map((d) => h("option", { value: d }, String(d))));
  digits.value = String(ids.digits);
  const next = h("input", { id: "id-next", type: "number", min: 1, step: 1, class: "num", value: ids.next });
  const example = h("p", { class: "help" });
  const upd = () => {
    const n = Math.max(1, Math.floor(Number(next.value) || 1));
    example.textContent = `Next new ID will be ${sampleIdFor(n, { prefix: prefix.value, digits: digits.value })}`;
  };
  [prefix, digits, next].forEach((el) => el.addEventListener("input", upd));
  upd();
  const save = h("button", { class: "btn", type: "submit" }, "Save format");
  const form = h("form", { class: "stack" },
    h("div", { class: "row align-end" },
      h("label", { class: "mini" }, "Prefix", prefix),
      h("label", { class: "mini" }, "Digits", digits),
      h("label", { class: "mini" }, "Next number", next)),
    example,
    h("p", { class: "help" }, "Changing the format only affects new IDs. Existing IDs and their QR codes keep working."),
    save);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const p = prefix.value.trim();
    if (!/^[A-Za-z0-9_-]{0,12}$/.test(p)) return toast("The prefix can only use letters, numbers, _ and - (max 12).", "error");
    const n = Math.floor(Number(next.value));
    if (!(n >= 1)) return toast("Next number must be 1 or more.", "error");
    save.disabled = true;
    try {
      await setDoc(doc(state.db, "settings", "ids"), { ...state.ids, prefix: p, digits: Number(digits.value), next: n });
      await refresh("samples");
      toast("Sample ID format saved.");
    } catch (err) { toast(errorText(err), "error"); save.disabled = false; }
  });
  return h("section", { class: "card" }, h("h2", {}, "Sample ID format"), form);
}

// ----------------------------------------------------------------- table
function tableCard(real, submitted) {
  const q = filter.q.trim().toUpperCase();
  const shown = real.filter((s) =>
    (filter.status === "all" || sampleStatus(s, submitted) === filter.status) &&
    (!q || s.id.toUpperCase().includes(q) || (s.batch || "").toUpperCase().includes(q)));
  for (const id of [...selected]) if (!real.some((s) => s.id === id)) selected.delete(id);

  const statusSel = h("select", { "aria-label": "Filter by status" },
    [["all", "All"], ["waiting", "Waiting"], ["submitted", "Submitted"], ["void", "Void"]].map(([v, t]) => h("option", { value: v }, t)));
  statusSel.value = filter.status;
  statusSel.addEventListener("change", () => { filter.status = statusSel.value; render(panelEl); });
  const search = h("input", { type: "search", placeholder: "Search ID or batch", "aria-label": "Search samples", value: filter.q });
  search.addEventListener("input", () => {
    filter.q = search.value;
    const pos = search.selectionStart;
    render(panelEl);
    const s = panelEl.querySelector('input[type="search"]');
    s.focus();
    s.setSelectionRange(pos, pos);
  });

  const allShownSelected = shown.length > 0 && shown.every((s) => selected.has(s.id));
  const selAll = h("input", { type: "checkbox", "aria-label": "Select all shown" });
  selAll.checked = allShownSelected;
  selAll.addEventListener("change", () => {
    shown.forEach((s) => (selAll.checked ? selected.add(s.id) : selected.delete(s.id)));
    render(panelEl);
  });

  const layout = h("select", { "aria-label": "Label layout" },
    h("option", { value: "sheet" }, "Label sheet (3 across)"), h("option", { value: "single" }, "One per page"));
  layout.value = printLayout;
  layout.addEventListener("change", () => { printLayout = layout.value; });
  const showId = h("input", { type: "checkbox" });
  showId.checked = printId;
  showId.addEventListener("change", () => { printId = showId.checked; });

  const nSel = selected.size;
  const rows = shown.slice(0, 500).map((s) => {
    const st = sampleStatus(s, submitted);
    const c = h("input", { type: "checkbox", "aria-label": `Select ${s.id}` });
    c.checked = selected.has(s.id);
    c.addEventListener("change", () => { c.checked ? selected.add(s.id) : selected.delete(s.id); render(panelEl); });
    return h("tr", {},
      h("td", {}, c),
      h("td", {}, h("button", { type: "button", class: "linklike mono strong", onclick: () => openSample(s.id) }, s.id)),
      h("td", { class: "mono" }, formatKitCode(s.token)),
      h("td", {}, s.batch || ""),
      h("td", {}, localDate(s.createdAt)),
      h("td", {}, h("span", { class: `badge ${STATUS_BADGE[st][1]}` }, STATUS_BADGE[st][0])));
  });

  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, "Sample IDs"),
      h("div", { class: "row" }, statusSel, search)),
    h("div", { class: "row" },
      h("button", { type: "button", class: "btn primary", disabled: !nSel, onclick: () => printLabels([...selected]) }, `Print QR labels${nSel ? ` (${nSel})` : ""}`),
      layout,
      h("label", { class: "check small", title: "Untick if participants shouldn't see the sample ID on their kit" }, showId, " Sample ID on label"),
      h("button", { type: "button", class: "btn", disabled: !real.length, onclick: () => exportCsv(nSel ? real.filter((s) => selected.has(s.id)) : shown, submitted) },
        nSel ? `Download CSV (${nSel} selected)` : "Download CSV"),
      nSel ? h("button", { type: "button", class: "btn ghost", onclick: () => { selected.clear(); render(panelEl); } }, "Clear selection") : null),
    h("p", { class: "help" }, "Click a sample ID to see, print or download its QR code. Tick several to print a sheet of labels."),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, selAll), h("th", {}, "Sample ID"), h("th", {}, "Kit code"), h("th", {}, "Batch"), h("th", {}, "Created"), h("th", {}, "Status"))),
      h("tbody", {}, rows.length ? rows : h("tr", {}, h("td", { colspan: 6, class: "meta" }, real.length ? "No samples match." : "No sample IDs yet — create some above."))))),
    shown.length > 500 ? h("p", { class: "help" }, `Showing 500 of ${shown.length}. Use search or the CSV for the rest.`) : null);
}

function exportCsv(list, submitted) {
  downloadCsv([
    ["sample_id", "kit_code", "questionnaire_link", "batch", "status", "created_at_utc", "submitted_at_utc"],
    ...list.map((s) => [s.id, formatKitCode(s.token), kitUrl(s.token), s.batch || "", sampleStatus(s, submitted), isoUtc(s.createdAt), isoUtc(submitted.get(s.token)?.submittedAt)]),
  ], `sample-ids_${today()}.csv`);
}

// ----------------------------------------------------------------- one sample
function openSample(id) {
  const s = state.samples.find((x) => x.id === id);
  if (!s) return;
  const submitted = submittedMap();
  const st = sampleStatus(s, submitted);
  const url = kitUrl(s.token);
  let qr;
  try { qr = qrImg(url, { alt: `QR code for sample ${s.id}`, cls: "qr-big" }); }
  catch (e) { qr = h("p", { class: "notice error" }, e.message); }
  const dlg = openModal(s.id, [
    h("div", { class: "sample-detail" },
      qr,
      h("div", { class: "stack" },
        h("p", {}, h("span", { class: `badge ${STATUS_BADGE[st][1]}` }, STATUS_BADGE[st][0]),
          st === "submitted" ? ` on ${localTime(submitted.get(s.token).submittedAt)}` : ""),
        h("dl", { class: "kv" },
          h("dt", {}, "Sample ID"), h("dd", { class: "mono strong" }, s.id),
          h("dt", {}, "Kit code"), h("dd", { class: "mono" }, formatKitCode(s.token)),
          h("dt", {}, "Batch"), h("dd", {}, s.batch || "—"),
          h("dt", {}, "Created"), h("dd", {}, `${localTime(s.createdAt)}${s.createdBy ? ` by ${s.createdBy}` : ""}`)),
        h("p", { class: "help" }, "The QR code opens the questionnaire for this sample. Participants never see the sample ID."),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn primary", onclick: () => printLabels([s.id]) }, "Print label"),
          h("button", { type: "button", class: "btn", onclick: () => downloadQrPng(url, `${s.id}_qr.png`, s.id) }, "Download PNG"),
          h("button", { type: "button", class: "btn", onclick: () => copyText(url) }, "Copy link")),
        st !== "submitted" ? h("div", { class: "row" },
          h("button", { type: "button", class: "btn ghost" + (st === "void" ? "" : " danger-ghost"), onclick: () => setActive(s, st === "void", dlg) },
            st === "void" ? "Restore this QR code" : "Void this QR code (lost/damaged kit)")) : null)),
  ], { wide: true });
}

async function setActive(s, active, dlg) {
  if (!active && !(await confirmBox(`Void ${s.id}?`, "Its QR code will stop working. You can restore it later.", "Void", { danger: true }))) return;
  try {
    const batch = writeBatch(state.db);
    batch.update(doc(state.db, "samples", s.id), { active });
    batch.update(doc(state.db, "tokens", s.token), { active });
    await batch.commit();
    dlg.close();
    await refresh("samples");
    toast(active ? `${s.id} restored.` : `${s.id} voided.`);
  } catch (e) { toast(errorText(e), "error"); }
}

// ----------------------------------------------------------------- printing
export function printLabels(ids) {
  if (!qrAvailable()) return toast("The QR code library didn't load. Check your connection and reload.", "error");
  const list = ids.map((id) => state.samples.find((s) => s.id === id)).filter((s) => s?.token).sort((a, b) => a.id.localeCompare(b.id));
  if (!list.length) return toast("Nothing to print.", "error");
  const labels = list.map((s) => h("div", { class: "label" },
    qrImg(kitUrl(s.token), { size: 360, alt: "", cls: "label-qr" }),
    h("div", { class: "label-text" },
      printId ? h("div", { class: "label-id" }, s.id) : null,
      h("div", { class: "label-hint" }, "Scan with your phone camera to answer the dust sample questionnaire."),
      h("div", { class: "label-code" }, "Kit code: ", h("strong", {}, formatKitCode(s.token))))));
  printNodes(labels, `layout-${printLayout}`);
}
