import { api } from "../components/api.js";
import { $, $$ } from "../components/dom.js";
import { mountNav } from "../components/nav.js";

mountNav("login");

const msg = $("[data-msg]");
const forms = { login: $('[data-form="login"]'), signup: $('[data-form="signup"]') };
const tabs = { login: $('[data-tab="login"]'), signup: $('[data-tab="signup"]') };

function show(text, ok = false) {
  msg.innerHTML = `<div class="notice ${ok ? "ok" : "err"}" style="margin-bottom:14px">${text}</div>`;
}

function setTab(which) {
  for (const k of Object.keys(forms)) {
    forms[k].hidden = k !== which;
    tabs[k].classList.toggle("ghost", k !== which);
  }
  msg.innerHTML = "";
}
$$("[data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

async function submit(e, url) {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  const { ok, data } = await api.post(url, body);
  if (!ok) return show(data.error || "Something went wrong.");
  if (data.user.status === "pending") return void (location.href = "/pending.html");
  location.href = data.user.role === "kid" ? "/dashboard.html" : "/admin.html";
}
forms.login.addEventListener("submit", (e) => submit(e, "/api/auth/login"));
forms.signup.addEventListener("submit", (e) => submit(e, "/api/auth/signup"));
