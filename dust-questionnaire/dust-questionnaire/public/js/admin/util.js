// Small helpers shared by the dashboard modules.
import { h } from "../core.js";
export { h };

export const $ = (s, root = document) => root.querySelector(s);
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const ms = (t) => t?.toMillis?.() ?? (t instanceof Date ? t.valueOf() : 0);
export const isoUtc = (t) => (t?.toDate ? t.toDate().toISOString() : t instanceof Date ? t.toISOString() : "");
export const localTime = (t) => (t?.toDate ? t.toDate().toLocaleString() : t instanceof Date ? t.toLocaleString() : "—");
export const localDate = (t) => (t?.toDate ? t.toDate().toLocaleDateString() : "—");
export const today = () => new Date().toLocaleDateString("en-CA");
export const fileSlug = (v) => String(v || "survey").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "survey";
export const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;

// ---------------------------------------------------------------- toasts
export function toast(msg, kind = "ok") {
  let box = $("#toasts");
  if (!box) { box = h("div", { id: "toasts", class: "toasts", role: "status", "aria-live": "polite" }); document.body.append(box); }
  const t = h("div", { class: `toast ${kind}` }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === "error" ? 9000 : 4500);
}

export function errorText(e) {
  if (e?.code === "permission-denied") return "Permission denied — are you still signed in as an admin?";
  return e?.message || String(e);
}

// ---------------------------------------------------------------- modal dialog
export function openModal(title, body, { wide = false, onClose } = {}) {
  const dlg = h("dialog", { class: "modal" + (wide ? " wide" : ""), "aria-labelledby": "modal-title" },
    h("div", { class: "modal-head" },
      h("h2", { id: "modal-title" }, title),
      h("button", { class: "btn ghost", type: "button", "aria-label": "Close", onclick: () => dlg.close() }, "✕")),
    h("div", { class: "modal-body" }, body));
  dlg.addEventListener("close", () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // click backdrop
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export function confirmBox(title, text, okLabel = "OK", { danger = false } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const dlg = openModal(title, [
      h("p", {}, text),
      h("div", { class: "row end" },
        h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Cancel"),
        h("button", { class: "btn " + (danger ? "danger" : "primary"), type: "button", onclick: () => { ok = true; dlg.close(); } }, okLabel)),
    ], { onClose: () => resolve(ok) });
  });
}

// ---------------------------------------------------------------- downloads
export function downloadBlob(blob, filename) {
  const a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/** Prevents spreadsheet apps from treating text like "=SUM(...)" as a formula. */
export function safeCell(v) {
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

export function toCsv(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(safeCell(v) ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n");
}

export function downloadCsv(rows, filename) {
  downloadBlob(new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" }), filename);
}

// ---------------------------------------------------------------- QR codes
export function qrAvailable() { return typeof window.QRCode === "function"; }

/** Returns a canvas with the QR code plus a white quiet zone. */
export function qrCanvas(text, size = 480) {
  if (!qrAvailable()) throw new Error("The QR code library didn't load. Check your connection and reload.");
  const tmp = document.createElement("div");
  new window.QRCode(tmp, { text, width: size, height: size, correctLevel: window.QRCode.CorrectLevel.M });
  const src = tmp.querySelector("canvas");
  const pad = Math.round(size / 8);
  const out = document.createElement("canvas");
  out.width = out.height = size + pad * 2;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, pad, pad);
  return out;
}

export function qrImg(text, { size = 480, alt = "QR code", cls = "qr-img" } = {}) {
  const img = h("img", { class: cls, alt, src: qrCanvas(text, size).toDataURL("image/png") });
  return img;
}

export function downloadQrPng(text, filename, caption = "") {
  const qr = qrCanvas(text, 720);
  let out = qr;
  if (caption) {
    out = document.createElement("canvas");
    out.width = qr.width;
    out.height = qr.height + 90;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(qr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.font = "bold 44px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(caption, out.width / 2, qr.height + 40);
  }
  out.toBlob((b) => downloadBlob(b, filename), "image/png");
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard."); }
  catch { prompt("Copy this:", text); }
}

/** Puts `nodes` in the print area and opens the browser's print dialog. */
export function printNodes(nodes, layoutClass = "") {
  let area = $("#print-area");
  if (!area) { area = h("div", { id: "print-area" }); document.body.append(area); }
  area.className = layoutClass;
  area.replaceChildren(...nodes);
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); area.replaceChildren(); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  // give images a moment to decode before printing
  setTimeout(() => window.print(), 150);
}
