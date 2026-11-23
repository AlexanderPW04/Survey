// "Lab website QR" tab: one static QR code for the lab website / posters.
// It opens the questionnaire's start page, which asks people to scan their kit's
// own QR code (or type its kit code) — so it works for everyone without
// revealing any sample IDs.
import { h } from "../core.js";
import { doc, setDoc } from "../firebase.js";
import { state, formUrl, refresh } from "./main.js";
import { qrImg, downloadQrPng, copyText, printNodes, toast, errorText } from "./util.js";

export function render(panel) {
  const url = formUrl();
  let qr;
  try { qr = qrImg(url, { alt: "QR code for the questionnaire start page", cls: "qr-big" }); }
  catch (e) { qr = h("p", { class: "notice error" }, e.message); }

  const custom = h("input", { id: "site-url", type: "url", placeholder: new URL("./", location.href).href, value: state.ids.siteUrl || "" });
  const save = h("button", { type: "submit", class: "btn" }, "Save link");
  const form = h("form", { class: "stack" },
    h("label", { for: "site-url", class: "strong" }, "Questionnaire address (optional)"),
    h("p", { class: "help" }, "Leave blank to use this site's address. Only change it if you set up a custom domain. This address is also used inside every sample's QR code."),
    h("div", { class: "row" }, custom, save));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = custom.value.trim();
    if (v && !/^https:\/\/[^\s]+$/.test(v)) return toast("Enter a full https:// address, or leave it blank.", "error");
    save.disabled = true;
    try {
      await setDoc(doc(state.db, "settings", "ids"), { ...state.ids, siteUrl: v });
      await refresh("share");
      toast("Saved. Re-download any QR codes you printed with the old address.");
    } catch (err) { toast(errorText(err), "error"); save.disabled = false; }
  });

  panel.replaceChildren(
    h("section", { class: "card share-card" },
      h("div", { class: "share-qr" }, qr),
      h("div", { class: "stack" },
        h("h2", {}, "QR code for the lab website"),
        h("p", {}, "Put this on the lab website or a poster. It opens the questionnaire's start page, which asks participants to scan the QR code on their own kit (or type its kit code). It never shows sample IDs."),
        h("p", { class: "mono break" }, url),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn primary", onclick: () => downloadQrPng(url, "questionnaire-qr-code.png") }, "Download PNG"),
          h("button", { type: "button", class: "btn", onclick: () => printNodes([h("div", { class: "poster" }, qrImg(url, { size: 720, alt: "" }), h("p", {}, url))], "layout-single") }, "Print"),
          h("button", { type: "button", class: "btn", onclick: () => copyText(url) }, "Copy link"),
          h("a", { class: "btn ghost", href: url, target: "_blank", rel: "noopener" }, "Open start page")))),
    h("section", { class: "card" }, form),
  );
}
