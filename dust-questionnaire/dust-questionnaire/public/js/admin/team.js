// Admins tab: add or remove people who can use this dashboard.
import { h } from "../core.js";
import { doc, setDoc, deleteDoc, serverTimestamp } from "../firebase.js";
import { state, refresh } from "./main.js";
import { confirmBox, toast, errorText, localDate } from "./util.js";

export function render(panel) {
  const me = state.user.email.toLowerCase();
  const email = h("input", { id: "admin-email", type: "email", required: true, placeholder: "name@gmail.com or university Google account", autocomplete: "off" });
  const add = h("button", { type: "submit", class: "btn primary" }, "Add admin");
  const form = h("form", { class: "row align-end" },
    h("label", { class: "mini grow" }, "Google account email", email), add);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast("Enter a valid email address.", "error");
    if (state.admins.some((a) => a.id === v)) return toast(`${v} is already an admin.`, "error");
    add.disabled = true;
    try {
      await setDoc(doc(state.db, "admins", v), { addedBy: me, addedAt: serverTimestamp() });
      await refresh("team");
      toast(`${v} can now sign in to the dashboard.`);
    } catch (err) { toast(errorText(err), "error"); add.disabled = false; }
  });

  panel.replaceChildren(
    h("section", { class: "card" },
      h("h2", {}, "Admins"),
      h("p", { class: "help" }, "Admins can edit and publish the survey, create sample IDs, see all responses and download data. They sign in with Google, so the email must be a Google account (Gmail or a Google Workspace university account)."),
      form,
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Email"), h("th", {}, "Added by"), h("th", {}, "Added"), h("th", {}, h("span", { class: "sr-only" }, "Actions")))),
        h("tbody", {}, state.admins.map((a) => h("tr", {},
          h("td", { class: "strong" }, a.id, a.id === me ? h("span", { class: "meta" }, " (you)") : ""),
          h("td", {}, a.addedBy || "Firebase console"),
          h("td", {}, a.addedAt ? localDate(a.addedAt) : "—"),
          h("td", {}, a.id === me ? h("span", { class: "meta" }, "—") : h("button", {
            type: "button", class: "btn small danger-ghost", onclick: async () => {
              if (!(await confirmBox(`Remove ${a.id}?`, "They will lose access to the dashboard immediately.", "Remove", { danger: true }))) return;
              try { await deleteDoc(doc(state.db, "admins", a.id)); await refresh("team"); toast(`${a.id} removed.`); }
              catch (err) { toast(errorText(err), "error"); }
            },
          }, "Remove")))))))),
  );
}
