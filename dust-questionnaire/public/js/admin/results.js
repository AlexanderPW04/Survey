// Results tab: per-question summaries, individual responses, and downloads.
import { isAnswerable, isChoice, isNumberType, optionsOf, formatDateISO, h } from "../core.js";
import { doc, writeBatch } from "../firebase.js";
import { state, sampleByToken, refresh } from "./main.js";
import { questionCatalog, downloadExcel, downloadResultsCsv, downloadCodebookCsv } from "./exports.js";
import { openModal, confirmBox, toast, errorText, localTime, plural } from "./util.js";

const view = { version: "all", labels: false, q: "" };
let panelEl;

const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function render(panel) {
  panelEl = panel;
  if (view.version !== "all" && !state.versions.some((v) => String(v.number) === view.version)) view.version = "all";
  const versionNumbers = view.version === "all" ? null : [Number(view.version)];
  const responses = state.responses.filter((r) => typeof r.version === "number" && (!versionNumbers || versionNumbers.includes(r.version)));

  if (!state.versions.length) {
    panel.replaceChildren(h("section", { class: "card empty" }, h("h2", {}, "No results yet"),
      h("p", {}, "Publish the survey on the Survey tab, create sample IDs, and responses will appear here.")));
    return;
  }

  const verSel = h("select", { id: "res-version" },
    h("option", { value: "all" }, `All versions (${state.responses.filter((r) => typeof r.version === "number").length})`),
    [...state.versions].reverse().map((v) => h("option", { value: String(v.number) },
      `Version ${v.number}${v.number === state.pub?.version ? " (live)" : ""} — ${state.responses.filter((r) => r.version === v.number).length}`)));
  verSel.value = view.version;
  verSel.addEventListener("change", () => { view.version = verSel.value; render(panelEl); });

  const labels = h("input", { type: "checkbox" });
  labels.checked = view.labels;
  labels.addEventListener("change", () => { view.labels = labels.checked; });

  const activeSamples = state.samples.filter((s) => s.token && s.active !== false).length;
  const catalog = questionCatalog(versionNumbers);

  panel.replaceChildren(
    h("section", { class: "card toolbar" },
      h("div", { class: "row" }, h("label", { for: "res-version", class: "strong" }, "Show"), verSel),
      h("div", { class: "row toolbar-actions" },
        h("button", { type: "button", class: "btn primary", onclick: () => downloadExcel(responses, versionNumbers, { labels: view.labels }) }, "Download Excel"),
        h("button", { type: "button", class: "btn", onclick: () => downloadResultsCsv(responses, versionNumbers, { labels: view.labels }) }, "Results CSV"),
        h("button", { type: "button", class: "btn", onclick: () => downloadCodebookCsv(versionNumbers) }, "Codebook CSV"),
        h("label", { class: "check small", title: "Otherwise short codes are used (see the Data dictionary / codebook)" }, labels, " Answer text instead of codes"))),
    h("div", { class: "stats" },
      h("div", { class: "stat-card" }, h("span", { class: "stat-n" }, String(responses.length)), h("span", { class: "stat-l" }, "Responses")),
      h("div", { class: "stat-card" }, h("span", { class: "stat-n" }, String(activeSamples)), h("span", { class: "stat-l" }, "Active sample IDs")),
      h("div", { class: "stat-card" }, h("span", { class: "stat-n" }, activeSamples ? `${Math.round((state.responses.length / activeSamples) * 100)}%` : "—"), h("span", { class: "stat-l" }, "Kits returned (all versions)"))),
    h("h2", { class: "section-heading" }, "Question summaries"),
    responses.length
      ? h("div", { class: "summary-grid" }, catalog.map((e) => summaryCard(e, responses)))
      : h("p", { class: "card meta" }, "No responses for this selection yet."),
    responsesCard(responses),
  );
}

// ----------------------------------------------------------------- summaries
function summaryCard(e, rows) {
  const q = e.q;
  const answered = rows.filter((r) => r.answers?.[e.key] != null);
  const n = answered.length;
  const head = [
    h("h3", {}, q.label || e.key),
    h("p", { class: "meta" }, `${n} answered · ${rows.length - n} no answer${q.showIf?.key ? " (includes people this question wasn't shown to)" : ""}`,
      e.retired ? " · retired question" : ""),
  ];
  let body;
  if (isChoice(q)) {
    const counts = new Map(e.options.map((o) => [o.value, 0]));
    for (const r of answered) {
      const v = r.answers[e.key];
      for (const x of Array.isArray(v) ? v : [v]) counts.set(x, (counts.get(x) || 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    const labelOf = new Map(e.options.map((o) => [o.value, o.label]));
    body = [
      q.type === "multiple" ? h("p", { class: "meta" }, "People who ticked each option (they could tick several).") : null,
      h("ul", { class: "bars" }, [...counts].map(([v, c]) => h("li", {},
        h("span", { class: "bar-label" }, labelOf.get(v) ?? v),
        h("span", { class: "bar-track", "aria-hidden": "true" }, h("span", { class: "bar-fill", style: `width:${(c / max) * 100}%` })),
        h("span", { class: "bar-n" }, `${c}`, h("span", { class: "meta" }, n ? ` ${Math.round((c / n) * 100)}%` : ""))))),
      specifyList(e, answered),
    ];
  } else if (isNumberType(q)) {
    const vals = answered.map((r) => r.answers[e.key]).filter((v) => typeof v === "number").sort((a, b) => a - b);
    const unit = q.unit ? ` ${q.unit}` : "";
    const median = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : null;
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const cell = (label, v) => h("div", {}, h("dt", {}, label), h("dd", {}, v == null ? "—" : fmt.format(v) + unit));
    body = h("dl", { class: "num-summary" }, cell("Min", vals[0]), cell("Median", median), cell("Mean", mean), cell("Max", vals[vals.length - 1]));
  } else if (q.type === "date") {
    const vals = answered.map((r) => r.answers[e.key]).filter(Boolean).sort();
    body = h("dl", { class: "num-summary" },
      h("div", {}, h("dt", {}, "Earliest"), h("dd", {}, vals.length ? formatDateISO(vals[0], q.dateOrder) : "—")),
      h("div", {}, h("dt", {}, "Latest"), h("dd", {}, vals.length ? formatDateISO(vals[vals.length - 1], q.dateOrder) : "—")));
  } else {
    body = textList(answered.map((r) => r.answers[e.key]), "Show answers");
  }
  return h("article", { class: "card summary-card" }, head, body);
}

function specifyList(e, answered) {
  const texts = [];
  const labelOf = new Map(e.options.map((o) => [o.value, o.label]));
  for (const r of answered) for (const [opt, t] of Object.entries(r.specify?.[e.key] || {})) texts.push(`${labelOf.get(opt) ?? opt}: ${t}`);
  return texts.length ? textList(texts, `Written-in answers (${texts.length})`) : null;
}

function textList(texts, summary) {
  const list = texts.filter((t) => t != null && t !== "");
  if (!list.length) return h("p", { class: "meta" }, "No written answers.");
  return h("details", { class: "text-answers" }, h("summary", {}, summary),
    h("ul", {}, list.slice(0, 200).map((t) => h("li", {}, String(t)))),
    list.length > 200 ? h("p", { class: "meta" }, `…and ${list.length - 200} more in the export.`) : null);
}

// ----------------------------------------------------------------- responses table
function responsesCard(responses) {
  const samples = sampleByToken();
  const q = view.q.trim().toUpperCase();
  const shown = responses.filter((r) => !q || (samples.get(r.id)?.id || "").toUpperCase().includes(q));
  const search = h("input", { type: "search", placeholder: "Find sample ID", "aria-label": "Find sample ID", value: view.q });
  search.addEventListener("input", () => {
    view.q = search.value;
    const pos = search.selectionStart;
    render(panelEl);
    const s = panelEl.querySelector('input[type="search"]');
    s.focus(); s.setSelectionRange(pos, pos);
  });
  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, "Individual responses"), search),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Sample ID"), h("th", {}, "Submitted"), h("th", {}, "Version"), h("th", {}, h("span", { class: "sr-only" }, "Actions")))),
      h("tbody", {}, shown.length ? shown.slice(0, 300).map((r) => h("tr", {},
        h("td", { class: "mono strong" }, samples.get(r.id)?.id || "(unknown kit)"),
        h("td", {}, localTime(r.submittedAt)),
        h("td", {}, String(r.version)),
        h("td", { class: "row tight" },
          h("button", { type: "button", class: "btn small", onclick: () => openResponse(r) }, "View"),
          h("button", { type: "button", class: "btn small danger-ghost", onclick: () => deleteResponse(r) }, "Delete"))))
        : h("tr", {}, h("td", { colspan: 4, class: "meta" }, "No responses."))))),
    shown.length > 300 ? h("p", { class: "help" }, `Showing 300 of ${shown.length}. The export has all of them.`) : null);
}

function openResponse(r) {
  const s = sampleByToken().get(r.id);
  const v = state.versions.find((x) => x.number === r.version);
  const items = (v?.definition?.questions || []).filter(isAnswerable).map((q) => {
    const a = r.answers?.[q.key];
    let text;
    if (a == null) text = h("span", { class: "meta" }, q.showIf?.key ? "Not shown / no answer" : "No answer");
    else if (isChoice(q)) {
      const labelOf = new Map(optionsOf(q).map((o) => [o.value, o.label]));
      text = (Array.isArray(a) ? a : [a]).map((x) => {
        const sp = r.specify?.[q.key]?.[x];
        return h("div", {}, labelOf.get(x) ?? x, sp ? h("span", { class: "meta" }, ` — ${sp}`) : "");
      });
    } else if (q.type === "date") text = formatDateISO(a, q.dateOrder);
    else text = `${a}${q.unit ? " " + q.unit : ""}`;
    return [h("dt", {}, q.label || q.key), h("dd", {}, text)];
  });
  openModal(`Response — ${s?.id || "unknown kit"}`, [
    h("p", { class: "meta" }, `Submitted ${localTime(r.submittedAt)} · survey version ${r.version}`),
    h("dl", { class: "answers" }, items),
  ], { wide: true });
}

async function deleteResponse(r) {
  const s = sampleByToken().get(r.id);
  const ok = await confirmBox(`Delete the response for ${s?.id || "this kit"}?`,
    "This permanently deletes the answers and lets this kit's QR code be used again. Use it for test submissions or mistakes.", "Delete response", { danger: true });
  if (!ok) return;
  try {
    const batch = writeBatch(state.db);
    batch.delete(doc(state.db, "responses", r.id));
    batch.update(doc(state.db, "tokens", r.id), { used: false });
    await batch.commit();
    await refresh("results");
    toast("Response deleted.");
  } catch (e) { toast(errorText(e), "error"); }
}

export { plural };
