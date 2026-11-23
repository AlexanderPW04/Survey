// Builds the standardized export columns used by the Excel file, the results CSV
// and the codebook. Column names never change between exports, so analysis
// scripts keep working as the survey evolves.
import { isAnswerable, optionsOf, isNumberType } from "../core.js";
import { state, sampleByToken } from "./main.js";
import { sampleStatus } from "./samples.js";
import { isoUtc, today, fileSlug, downloadCsv, toast, safeCell } from "./util.js";

/**
 * Every question that has ever been published (plus the live draft order),
 * newest wording first. Returns [{ key, q, versions:[n], retired, options:[...] }]
 */
export function questionCatalog(versionNumbers = null) {
  const versions = state.versions.filter((v) => !versionNumbers || versionNumbers.includes(v.number));
  const byKey = new Map();
  const order = [];
  // walk newest -> oldest so the latest wording wins
  for (const v of [...versions].reverse()) {
    for (const q of v.definition?.questions || []) {
      if (!isAnswerable(q)) continue;
      let e = byKey.get(q.key);
      if (!e) {
        e = { key: q.key, q, versions: [], options: [], optionSeen: new Set() };
        byKey.set(q.key, e);
        order.push(e);
      }
      e.versions.push(v.number);
      for (const o of optionsOf(q)) {
        if (e.optionSeen.has(o.value)) continue;
        e.optionSeen.add(o.value);
        e.options.push({ ...o, removed: e.versions.length > 1 });
      }
    }
  }
  // order: as in the latest version that contains each question
  const latest = versions[versions.length - 1];
  const pos = new Map((latest?.definition?.questions || []).map((q, i) => [q.key, i]));
  const live = order.filter((e) => pos.has(e.key)).sort((a, b) => pos.get(a.key) - pos.get(b.key));
  const retired = order.filter((e) => !pos.has(e.key));
  const latestNumber = latest?.number;
  return [...live, ...retired].map((e) => ({ ...e, retired: !e.versions.includes(latestNumber) }));
}

function conditionText(q, catalog) {
  const c = q.showIf;
  if (!c?.key) return "";
  const parent = catalog.find((e) => e.key === c.key);
  if (parent && isNumberType(parent.q)) return `${c.key} ${{ gt: ">", lt: "<", eq: "=" }[c.op] || ">"} ${c.number}`;
  return `${c.key} in [${(c.values || []).join(", ")}]`;
}

/** Column definitions: [{ name, get(response, sample), dict:{...} }] */
export function buildColumns(catalog, { labels = false } = {}) {
  const cols = [
    { name: "sample_id", get: (r, s) => s?.id || "", dict: { wording: "Sample ID (from the kit's QR code)", type: "id" } },
    { name: "submitted_at_utc", get: (r) => isoUtc(r.submittedAt), dict: { wording: "Time the questionnaire was submitted", type: "datetime", coding: "ISO 8601, UTC" } },
    { name: "survey_version", get: (r) => r.version ?? "", dict: { wording: "Published survey version the participant answered", type: "integer", coding: "See the Versions sheet" } },
  ];
  for (const e of catalog) {
    const q = e.q;
    const base = {
      question_key: e.key, wording: q.label, type: q.type, required: q.required ? "yes" : "no",
      shown_if: conditionText(q, catalog), in_versions: e.versions.slice().sort((a, b) => a - b).join(", "),
      status: e.retired ? "retired" : "active",
    };
    const specifyCols = e.options.filter((o) => o.specify).map((o) => ({
      name: `${e.key}__${o.value}_text`,
      get: (r) => r.specify?.[e.key]?.[o.value] ?? "",
      dict: { ...base, required: "", wording: `${q.label} — ${o.label}: ${o.specifyLabel || "specify"}`, type: "text", coding: `free text, only when “${o.label}” chosen` },
    }));
    if (q.type === "multiple") {
      for (const o of e.options) {
        cols.push({
          name: `${e.key}__${o.value}`,
          get: (r) => { const v = r.answers?.[e.key]; return Array.isArray(v) ? (v.includes(o.value) ? 1 : 0) : ""; },
          dict: { ...base, wording: `${q.label} — ${o.label}${o.removed ? " (choice no longer offered)" : ""}`, type: "multiple (one column per choice)", coding: "1 = ticked, 0 = not ticked, blank = question not shown/answered" },
        });
      }
      cols.push(...specifyCols);
    } else if (["single", "dropdown", "yesno"].includes(q.type)) {
      const labelOf = new Map(e.options.map((o) => [o.value, o.label]));
      cols.push({
        name: e.key,
        get: (r) => { const v = r.answers?.[e.key]; return v == null ? "" : labels ? (labelOf.get(v) ?? v) : v; },
        dict: { ...base, coding: e.options.map((o) => `${o.value} = ${o.label}${o.removed ? " (no longer offered)" : ""}`).join("; ") },
      });
      cols.push(...specifyCols);
    } else {
      const coding = isNumberType(q)
        ? [q.type === "integer" ? "whole number" : "number", q.unit ? `unit: ${q.unit}` : "", q.min != null && q.min !== "" ? `min ${q.min}` : "", q.max != null && q.max !== "" ? `max ${q.max}` : ""].filter(Boolean).join(", ")
        : q.type === "date" ? "YYYY-MM-DD" : "free text";
      cols.push({ name: e.key, get: (r) => r.answers?.[e.key] ?? "", dict: { ...base, coding } });
    }
  }
  return cols;
}

function dictionaryRows(cols) {
  return [
    ["column", "question_key", "question_wording", "type", "coding", "required", "shown_if", "in_versions", "status"],
    ...cols.map((c) => [c.name, c.dict.question_key ?? c.name, c.dict.wording ?? "", c.dict.type ?? "", c.dict.coding ?? "",
      c.dict.required ?? "", c.dict.shown_if ?? "", c.dict.in_versions ?? "", c.dict.status ?? ""]),
  ];
}

function exportRows(responses, versionNumbers, labels) {
  const catalog = questionCatalog(versionNumbers);
  const cols = buildColumns(catalog, { labels });
  const samples = sampleByToken();
  const rows = [...responses].filter((r) => typeof r.version === "number")
    .sort((a, b) => (samples.get(a.id)?.id || "").localeCompare(samples.get(b.id)?.id || "") || 0);
  const aoa = [cols.map((c) => c.name), ...rows.map((r) => cols.map((c) => c.get(r, samples.get(r.id))))];
  return { cols, aoa, rows };
}

const baseName = (versionNumbers) =>
  `${fileSlug(state.pub?.definition?.title || state.draft?.definition?.title)}_${versionNumbers?.length === 1 ? `v${versionNumbers[0]}_` : ""}${today()}`;

export function downloadExcel(responses, versionNumbers, { labels = false } = {}) {
  if (!window.XLSX) return toast("The Excel library didn't load. Check your connection and reload.", "error");
  const XLSX = window.XLSX;
  const { cols, aoa, rows } = exportRows(responses, versionNumbers, labels);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((c) => ({ wch: Math.min(40, Math.max(12, c.name.length + 2)) }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoa.length - 1, 1), c: cols.length - 1 } }) };
  ws["!freeze"] = { xSplit: 1, ySplit: 1 };

  const dict = XLSX.utils.aoa_to_sheet(dictionaryRows(cols));
  dict["!cols"] = [{ wch: 34 }, { wch: 24 }, { wch: 70 }, { wch: 14 }, { wch: 60 }, { wch: 9 }, { wch: 26 }, { wch: 12 }, { wch: 9 }];

  const submitted = new Map(state.responses.map((r) => [r.id, r]));
  const sampleSheet = XLSX.utils.aoa_to_sheet([
    ["sample_id", "batch", "status", "created_at_utc", "submitted_at_utc"],
    ...state.samples.filter((s) => s.token).map((s) => [s.id, s.batch || "", sampleStatus(s), isoUtc(s.createdAt), isoUtc(submitted.get(s.token)?.submittedAt)]),
  ]);
  sampleSheet["!cols"] = [{ wch: 14 }, { wch: 28 }, { wch: 11 }, { wch: 26 }, { wch: 26 }];

  const versionSheet = XLSX.utils.aoa_to_sheet([
    ["survey_version", "published_at_utc", "published_by", "questions"],
    ...state.versions.map((v) => [v.number, isoUtc(v.publishedAt), v.publishedBy || "", (v.definition?.questions || []).filter(isAnswerable).map((q) => q.key).join(", ")]),
  ]);
  versionSheet["!cols"] = [{ wch: 15 }, { wch: 26 }, { wch: 30 }, { wch: 100 }];

  const info = XLSX.utils.aoa_to_sheet([
    ["Survey", state.pub?.definition?.title || state.draft?.definition?.title || ""],
    ["Exported at (UTC)", new Date().toISOString()],
    ["Exported by", state.user?.email || ""],
    ["Versions included", versionNumbers?.length ? versionNumbers.join(", ") : "all"],
    ["Responses", rows.length],
    ["Choice answers", labels ? "answer text" : "codes (see Data dictionary)"],
    ["Blank cells", "Question not shown (skip logic), not answered, or not in the version that participant answered"],
  ]);
  info["!cols"] = [{ wch: 22 }, { wch: 90 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Responses");
  XLSX.utils.book_append_sheet(wb, dict, "Data dictionary");
  XLSX.utils.book_append_sheet(wb, sampleSheet, "Samples");
  XLSX.utils.book_append_sheet(wb, versionSheet, "Versions");
  XLSX.utils.book_append_sheet(wb, info, "Export info");
  XLSX.writeFile(wb, `${baseName(versionNumbers)}.xlsx`);
  toast(`Downloaded ${rows.length} responses.`);
}

export function downloadResultsCsv(responses, versionNumbers, { labels = false } = {}) {
  const { aoa, rows } = exportRows(responses, versionNumbers, labels);
  downloadCsv(aoa, `${baseName(versionNumbers)}_responses.csv`);
  toast(`Downloaded ${rows.length} responses.`);
}

export function downloadCodebookCsv(versionNumbers) {
  const cols = buildColumns(questionCatalog(versionNumbers));
  downloadCsv(dictionaryRows(cols), `${baseName(versionNumbers)}_codebook.csv`);
}

export { safeCell };
