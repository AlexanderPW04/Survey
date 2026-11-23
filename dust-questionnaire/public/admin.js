import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { QUESTIONNAIRE } from "./questions.js";
import {
  normalizeOptions, validateConfig, generateSampleId, sampleIdRegex,
  normalizeSampleId, firebaseConfigured,
} from "./common.js";

const $ = (s) => document.querySelector(s);
const show = (el, on) => { el.hidden = !on; };
const formUrl = new URL("./", location.href).href; // the questionnaire lives at the site root

let responses = [];
let samples = [];
let currentUser = null;

// ---------- helpers ----------
const ms = (t) => t?.toMillis?.() ?? 0;
const isoUtc = (t) => (t?.toDate ? t.toDate().toISOString() : "");
const localTime = (t) => (t?.toDate ? t.toDate().toLocaleString() : "—");
const today = () => new Date().toLocaleDateString("en-CA");
const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "blank";
const fmtVal = (v) => (v == null ? "" : Array.isArray(v) ? v.join("; ") : v);

function row(cells) {
  const tr = document.createElement("tr");
  for (const c of cells) {
    const td = document.createElement("td");
    if (c instanceof Node) td.append(c); else td.textContent = c;
    tr.append(td);
  }
  return tr;
}

function badge(text, kind) {
  const s = document.createElement("span");
  s.className = `badge ${kind}`;
  s.textContent = text;
  return s;
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function downloadCsv(rows, filename) {
  const csv = rows.map((r) => r.map((v) => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n");
  downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), filename);
}

// ---------- Firebase ----------
if (!firebaseConfigured(firebaseConfig)) {
  const box = $("#setup-error");
  box.textContent = "Firebase isn't configured yet — fill in public/firebase-config.js and redeploy.";
  box.hidden = false;
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  window.__db = db; // handy for debugging in the browser console

  $("#signin").addEventListener("click", () => signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => alert(e.message)));
  $("#signout").addEventListener("click", () => signOut(auth));

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    show($("#signin-card"), !user);
    show($("#user-box"), !!user);
    show($("#app"), false);
    show($("#denied-card"), false);
    if (!user) return;
    $("#user-email").textContent = user.email;
    try {
      await loadAll(db);
      show($("#app"), true);
    } catch (e) {
      if (e?.code === "permission-denied") {
        $("#denied-email").textContent = user.email;
        show($("#denied-card"), true);
      } else {
        console.error(e);
        alert("Couldn't load data: " + e.message);
      }
    }
  });

  $("#refresh").addEventListener("click", () => loadAll(db).then(() => flash("#resp-msg", "Refreshed.")));
  $("#gen-form").addEventListener("submit", (e) => { e.preventDefault(); generateIds(db); });
  $("#import-form").addEventListener("submit", (e) => { e.preventDefault(); importIds(db); });
}

async function loadAll(db) {
  const [rs, ss] = await Promise.all([getDocs(collection(db, "responses")), getDocs(collection(db, "samples"))]);
  responses = rs.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.submittedAt) - ms(a.submittedAt));
  samples = ss.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.createdAt) - ms(a.createdAt) || a.id.localeCompare(b.id));
  render();
}

function flash(sel, msg) {
  const el = $(sel);
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 6000);
}

// ---------- rendering ----------
function render() {
  $("#study-name").textContent = `${QUESTIONNAIRE.studyName} — admin`;

  $("#resp-count").textContent = responses.length;
  const rb = $("#resp-body");
  rb.replaceChildren(...responses.slice(0, 25).map((r) => row([r.sampleId || r.id, localTime(r.submittedAt), r.questionnaireVersion || ""])));
  if (!responses.length) rb.replaceChildren(row(["No responses yet.", "", ""]));
  $("#resp-more").textContent = responses.length > 25 ? `Showing the 25 most recent of ${responses.length}. The Excel file has all of them.` : "";

  const used = new Set(responses.map((r) => r.id));
  $("#sample-count").textContent = samples.length;
  $("#sample-used").textContent = samples.filter((s) => used.has(s.id)).length;
  const sb = $("#sample-body");
  sb.replaceChildren(...samples.slice(0, 100).map((s) => row([
    s.id, s.batchLabel || "", localTime(s.createdAt),
    used.has(s.id) ? badge("Submitted", "ok") : badge("Waiting", "muted"),
  ])));
  if (!samples.length) sb.replaceChildren(row(["No IDs registered yet — generate some above.", "", "", ""]));
  $("#sample-more").textContent = samples.length > 100 ? `Showing 100 of ${samples.length}. Download the CSV for the full list.` : "";

  const errs = validateConfig();
  const ce = $("#config-errors");
  ce.textContent = errs.length ? "Problems in questions.js:\n" + errs.map((e) => "• " + e).join("\n") : "";
  show(ce, errs.length > 0);
  const active = QUESTIONNAIRE.questions.filter((q) => !q.retired).length;
  const retired = QUESTIONNAIRE.questions.length - active;
  $("#config-summary").textContent = `Version ${QUESTIONNAIRE.version}: ${active} active question${active === 1 ? "" : "s"}` +
    (retired ? `, ${retired} retired (still included in exports).` : ".");

  const genOk = sampleIdRegex().test(generateSampleId());
  $("#gen-btn").disabled = !genOk;
  if (!genOk) flash("#sample-msg", "You use a custom ID pattern, so use “Register IDs you already have” instead of generating.");
}

// ---------- sample IDs ----------
async function commitIds(db, ids, label) {
  for (let i = 0; i < ids.length; i += 450) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + 450)) {
      batch.set(doc(db, "samples", id), { createdAt: serverTimestamp(), batchLabel: label || "" });
    }
    await batch.commit();
  }
}

function sampleCsvRows(list) {
  const used = new Set(responses.map((r) => r.id));
  return [["sample_id", "batch_label", "created_at_utc", "status", "prefilled_form_link"],
    ...list.map((s) => [s.id, s.batchLabel || "", isoUtc(s.createdAt), used.has(s.id) ? "submitted" : "waiting",
      `${formUrl}?id=${encodeURIComponent(s.id)}`])];
}

async function generateIds(db) {
  const n = Math.max(1, Math.min(500, parseInt($("#gen-count").value, 10) || 0));
  const label = $("#gen-label").value.trim();
  const existing = new Set(samples.map((s) => s.id));
  const ids = new Set();
  while (ids.size < n) {
    const id = generateSampleId();
    if (!existing.has(id)) ids.add(id);
  }
  const list = [...ids].sort();
  $("#gen-btn").disabled = true;
  try {
    await commitIds(db, list, label);
    await loadAll(db);
    downloadCsv(sampleCsvRows(samples.filter((s) => ids.has(s.id))), `sample-ids_${slug(label || "batch")}_${today()}.csv`);
    flash("#sample-msg", `Created ${list.length} IDs — CSV downloaded.`);
  } catch (e) {
    alert("Couldn't create IDs: " + e.message);
  } finally {
    $("#gen-btn").disabled = false;
  }
}

async function importIds(db) {
  const re = sampleIdRegex();
  const existing = new Set(samples.map((s) => s.id));
  const lines = $("#import-text").value.split(/[\r\n,;]+/).map((l) => normalizeSampleId(l)).filter(Boolean);
  const invalid = lines.filter((id) => !re.test(id));
  const fresh = [...new Set(lines.filter((id) => re.test(id) && !existing.has(id)))];
  if (invalid.length) {
    alert(`These don't match the sample ID format in questions.js and were not registered:\n${invalid.slice(0, 20).join("\n")}${invalid.length > 20 ? "\n…" : ""}`);
  }
  if (!fresh.length) { flash("#sample-msg", "No new IDs to register."); return; }
  try {
    await commitIds(db, fresh, $("#import-label").value.trim());
    await loadAll(db);
    $("#import-text").value = "";
    flash("#sample-msg", `Registered ${fresh.length} ID${fresh.length === 1 ? "" : "s"}.`);
  } catch (e) {
    alert("Couldn't register IDs: " + e.message);
  }
}

$("#export-samples").addEventListener("click", () => {
  downloadCsv(sampleCsvRows([...samples].sort((a, b) => a.id.localeCompare(b.id))), `sample-ids_all_${today()}.csv`);
});

// ---------- Excel export ----------
function buildColumns() {
  const cols = [
    { key: "sample_id", get: (r) => r.sampleId || r.id, dict: { label: "Anonymous sample collection ID", type: "id" } },
    { key: "submitted_at_utc", get: (r) => isoUtc(r.submittedAt), dict: { label: "Server time of submission", type: "datetime", coding: "ISO 8601, UTC" } },
    { key: "questionnaire_version", get: (r) => r.questionnaireVersion ?? "", dict: { label: "Version of questions.js the participant saw", type: "text" } },
  ];
  const known = new Set();
  for (const q of QUESTIONNAIRE.questions) {
    known.add(q.id);
    const base = {
      questionId: q.id, type: q.type, required: q.required ? "yes" : "no",
      status: q.retired ? "retired" : "active", addedIn: q.addedIn || "", retiredIn: q.retiredIn || "",
      showIf: q.showIf ? `${q.showIf.question} in [${q.showIf.in.join(", ")}]` : "",
    };
    if (q.type === "checkbox") {
      const opts = normalizeOptions(q);
      const values = opts.map((o) => o.value);
      for (const r of responses) {
        const v = r.answers?.[q.id];
        if (Array.isArray(v)) for (const x of v) if (!values.includes(x)) values.push(x);
      }
      for (const val of values) {
        const opt = opts.find((o) => o.value === val);
        cols.push({
          key: `${q.id}__${slug(val)}`,
          get: (r) => { const v = r.answers?.[q.id]; return Array.isArray(v) ? (v.includes(val) ? 1 : 0) : ""; },
          dict: { ...base, label: `${q.label} — ${opt ? opt.label : val}${opt ? "" : " (option no longer in questions.js)"}`,
            coding: "1 = selected, 0 = not selected, blank = question not shown" },
        });
      }
    } else {
      let coding = "free text";
      if (q.type === "radio" || q.type === "select") coding = normalizeOptions(q).map((o) => `${o.value} = ${o.label}`).join("; ");
      else if (q.type === "number") coding = ["number", q.min != null ? `min ${q.min}` : null, q.max != null ? `max ${q.max}` : null].filter(Boolean).join(", ");
      else if (q.type === "date") coding = "YYYY-MM-DD";
      cols.push({ key: q.id, get: (r) => fmtVal(r.answers?.[q.id]), dict: { ...base, label: q.label, coding } });
    }
  }
  // Answers stored in the database for questions that were deleted from questions.js instead of retired.
  const extras = new Set();
  for (const r of responses) for (const k of Object.keys(r.answers || {})) if (!known.has(k)) extras.add(k);
  for (const k of [...extras].sort()) {
    cols.push({ key: k, get: (r) => fmtVal(r.answers?.[k]),
      dict: { questionId: k, label: "(not in questions.js — deleted instead of retired)", type: "unknown", status: "unlisted" } });
  }
  return cols;
}

$("#export-xlsx").addEventListener("click", () => {
  if (!window.XLSX) { alert("The Excel library didn't load. Check your connection and reload."); return; }
  const cols = buildColumns();
  const rows = [...responses].sort((a, b) => ms(a.submittedAt) - ms(b.submittedAt));
  const aoa = [cols.map((c) => c.key), ...rows.map((r) => cols.map((c) => c.get(r)))];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((c) => ({ wch: Math.min(40, Math.max(12, c.key.length + 2)) }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: cols.length - 1 } }) };

  const dictAoa = [["column", "question_id", "question_text", "type", "coding", "required", "status", "shown_if", "added_in", "retired_in"],
    ...cols.map((c) => [c.key, c.dict.questionId ?? c.key, c.dict.label ?? "", c.dict.type ?? "", c.dict.coding ?? "",
      c.dict.required ?? "", c.dict.status ?? "", c.dict.showIf ?? "", c.dict.addedIn ?? "", c.dict.retiredIn ?? ""])];
  const dictWs = XLSX.utils.aoa_to_sheet(dictAoa);
  dictWs["!cols"] = [{ wch: 30 }, { wch: 24 }, { wch: 60 }, { wch: 10 }, { wch: 60 }, { wch: 9 }, { wch: 9 }, { wch: 28 }, { wch: 9 }, { wch: 10 }];

  const infoWs = XLSX.utils.aoa_to_sheet([
    ["Study", QUESTIONNAIRE.studyName],
    ["Exported at (UTC)", new Date().toISOString()],
    ["Current questionnaire version", QUESTIONNAIRE.version],
    ["Responses", rows.length],
    ["Blank cells", "Question not shown (skip logic), not answered, or added after this response was submitted"],
  ]);
  infoWs["!cols"] = [{ wch: 30 }, { wch: 80 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Responses");
  XLSX.utils.book_append_sheet(wb, dictWs, "Data dictionary");
  XLSX.utils.book_append_sheet(wb, infoWs, "Export info");
  XLSX.writeFile(wb, `${slug(QUESTIONNAIRE.studyName)}_responses_${today()}.xlsx`);
  flash("#resp-msg", `Exported ${rows.length} responses.`);
});

// ---------- QR code ----------
const qrUrl = $("#qr-url");
const qrBox = $("#qr");
qrUrl.value = formUrl;

function makeQr() {
  qrBox.replaceChildren();
  if (!window.QRCode) { qrBox.textContent = "QR library didn't load — check your connection and reload."; return; }
  new QRCode(qrBox, { text: qrUrl.value.trim() || formUrl, width: 512, height: 512, correctLevel: QRCode.CorrectLevel.M });
}

$("#qr-make").addEventListener("click", makeQr);
$("#qr-download").addEventListener("click", () => {
  const c = qrBox.querySelector("canvas");
  if (!c) { makeQr(); return; }
  const pad = 64; // white "quiet zone" so phones can scan it reliably
  const out = document.createElement("canvas");
  out.width = c.width + pad * 2;
  out.height = c.height + pad * 2;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(c, pad, pad);
  out.toBlob((b) => downloadBlob(b, "questionnaire-qr-code.png"), "image/png");
});
makeQr();
