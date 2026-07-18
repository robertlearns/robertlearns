/* ============================================================
   EE Knowledge Base — optional account & progress sync client.
   Loaded after app.js. Without it (or with the API unreachable)
   the site works exactly as before: localStorage only.

   localStorage keys:
     ee-kb-auth-v1  {token, username, exp}
     ee-kb-sync-v1  {rev, dirty, lastSync}
   ============================================================ */
(function () {
  "use strict";

  /* Progress store: the app shell's EEStore where present (course pages);
     otherwise a minimal localStorage-backed shim so pages without the
     shell (the portal) can still offer accounts and sync progress. */
  const Store = window.EEStore || (() => {
    const KEY = "ee-kb-progress-v1";
    return {
      get data() {
        try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
      },
      replaceData(d) { try { localStorage.setItem(KEY, JSON.stringify(d || {})); } catch {} },
      get completed() { return this.data.completed || {}; },
      get quiz() { return this.data.quiz || {}; },
      isDone(id) { return !!(this.data.completed || {})[id]; },
    };
  })();

  /* After `wrangler deploy`, replace with the printed workers.dev URL. */
  const PROD_API = "https://ee-sync.robertetudie.workers.dev";
  const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? "http://127.0.0.1:8787" : PROD_API;

  /* Course slug this page's progress is stored under on the server.
     A future course sets window.EE_COURSE (and its own store/meta keys)
     before loading sync.js; the account is shared across courses. */
  const COURSE = window.EE_COURSE || "ee";
  const AUTH_KEY = "ee-kb-auth-v1";
  const META_KEY = "ee-kb-sync-v1";

  /* ---------------- state ---------------- */
  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
  }
  function writeJSON(key, v) {
    try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v)); } catch {}
  }
  function getAuth() {
    const a = readJSON(AUTH_KEY);
    if (a && a.exp && a.exp * 1000 < Date.now()) { writeJSON(AUTH_KEY, null); return null; }
    return a;
  }
  function setAuth(token, username) {
    let exp = null;
    try { exp = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).exp; } catch {}
    writeJSON(AUTH_KEY, { token, username, exp });
  }
  function getMeta() { return readJSON(META_KEY) || { rev: 0, dirty: false, lastSync: 0 }; }
  function setMeta(patch) { writeJSON(META_KEY, { ...getMeta(), ...patch }); }
  function clearAuth() { writeJSON(AUTH_KEY, null); writeJSON(META_KEY, null); updateButton(); }

  /* ---------------- merge ---------------- */
  function mergeProgress(a, b) {
    a = a || {}; b = b || {};
    const out = { completed: {}, quiz: {} };
    for (const src of [a.completed, b.completed]) {
      for (const id of Object.keys(src || {})) out.completed[id] = true;
    }
    const ids = new Set([...Object.keys(a.quiz || {}), ...Object.keys(b.quiz || {})]);
    for (const id of ids) {
      const qa = (a.quiz || {})[id], qb = (b.quiz || {})[id];
      if (!qa) { out.quiz[id] = qb; continue; }
      if (!qb) { out.quiz[id] = qa; continue; }
      const ra = qa.score / qa.total, rb = qb.score / qb.total;
      out.quiz[id] = rb > ra || (rb === ra && qb.total > qa.total) ? qb : qa;
    }
    return out;
  }
  function canon(p) {
    p = p || {};
    const sort = o => Object.fromEntries(Object.keys(o || {}).sort().map(k => [k, o[k]]));
    return JSON.stringify({ completed: sort(p.completed), quiz: sort(p.quiz) });
  }

  /* ---------------- API ---------------- */
  async function api(method, path, body, opts) {
    const auth = getAuth();
    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(auth ? { "Authorization": "Bearer " + auth.token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      ...(opts || {}),
    });
    if (res.status === 204) return { status: 204, data: null };
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }

  /* ---------------- UI refresh after a merge ---------------- */
  function applyMergedUI() {
    document.querySelectorAll(".nav-link[data-mod]").forEach(l =>
      l.classList.toggle("done", Store.isDone(l.dataset.mod)));
    const btn = document.getElementById("complete-btn");
    const modId = document.body.dataset.module;
    if (btn && modId) {
      const done = Store.isDone(modId);
      btn.textContent = done ? "✓ Completed" : "Mark as complete";
      btn.classList.toggle("done", done);
      const bar = btn.closest(".complete-bar");
      const txt = bar && bar.querySelector(".cb-text");
      if (txt) txt.textContent = done
        ? "Module marked as completed. It shows a ✓ in the curriculum."
        : "Finished studying this module? Mark it complete to track your progress.";
    }
    document.dispatchEvent(new CustomEvent("ee-progress-merged"));
  }

  /* ---------------- sync engine ---------------- */
  let pushTimer = null;

  /* forceMerge: true on login (local progress may predate the account).
     Otherwise merge only if this device has unpushed (dirty) changes —
     a clean device must adopt the server state as-is, or a module
     un-completed elsewhere would be resurrected by the union merge. */
  function adoptServerState(progress, rev, forceMerge) {
    const next = (forceMerge || getMeta().dirty) ? mergeProgress(progress, Store.data) : progress;
    setMeta({ rev, lastSync: Date.now() });
    const changed = canon(next) !== canon(Store.data);
    Store.replaceData(next);
    if (changed) applyMergedUI();
    if (canon(next) !== canon(progress)) doPush();
    else setMeta({ dirty: false });
    updateButton();
  }

  async function pull(forceMerge) {
    if (!getAuth()) return;
    try {
      const { status, data } = await api("GET", "/api/progress?course=" + COURSE);
      if (status === 401) { clearAuth(); return; }
      if (status !== 200 || !data) return;
      adoptServerState(data.progress, data.rev, !!forceMerge);
    } catch { /* offline — keep local */ }
  }

  async function doPush(retrying) {
    if (!getAuth()) return;
    try {
      const { status, data } = await api("PUT", "/api/progress",
        { course: COURSE, progress: { completed: Store.completed, quiz: Store.quiz }, baseRev: getMeta().rev });
      if (status === 200) { setMeta({ rev: data.rev, dirty: false, lastSync: Date.now() }); statusRefresh(); return; }
      if (status === 401) { clearAuth(); return; }
      if (status === 409 && data && !retrying) {
        const merged = mergeProgress(data.progress, Store.data);
        setMeta({ rev: data.rev });
        if (canon(merged) !== canon(Store.data)) { Store.replaceData(merged); applyMergedUI(); }
        return doPush(true);
      }
      setMeta({ dirty: true });
    } catch { setMeta({ dirty: true }); }
    statusRefresh();
  }

  function schedulePush() {
    if (!getAuth()) return;
    setMeta({ dirty: true });
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => doPush(), 2000);
  }

  document.addEventListener("ee-progress-changed", schedulePush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && getAuth() && getMeta().dirty) {
      clearTimeout(pushTimer);
      try {
        fetch(API_BASE + "/api/progress", {
          method: "PUT", keepalive: true,
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getAuth().token },
          body: JSON.stringify({ course: COURSE, progress: { completed: Store.completed, quiz: Store.quiz }, baseRev: getMeta().rev }),
        });
      } catch {}
    }
  });

  /* ---------------- account dialog ---------------- */
  let dlg = null;

  /* Dialog styles are injected here (not in style.css) so the dialog works
     on any page, including ones with their own design system (the portal).
     The --ad-* fallback chains pick up whichever theme variables exist. */
  const DIALOG_CSS = `
.account-dialog {
  --ad-bg: var(--bg-elev, var(--bg-card, #fff));
  --ad-panel: var(--bg-panel, var(--bg-card, #fff));
  --ad-sunken: var(--bg-sunken, var(--bg, #eef1f6));
  --ad-text: var(--text, #1c2330);
  --ad-soft: var(--text-soft, var(--text-mid, #4a5568));
  --ad-faint: var(--text-faint, #7a8699);
  --ad-border: var(--border, #e2e7ef);
  --ad-border-strong: var(--border-strong, #cbd3e0);
  --ad-accent: var(--accent, #2f6df6);
  --ad-accent-soft: var(--accent-soft, rgba(47,109,246,.14));
  --ad-bad: var(--bad, #d8452b);
  --ad-bad-soft: var(--bad-soft, rgba(216,69,43,.14));
  margin: auto; /* re-center: page CSS resets may zero the UA dialog margins */
  border: 1px solid var(--ad-border); border-radius: 12px;
  background: var(--ad-bg); color: var(--ad-text);
  box-shadow: 0 8px 32px rgba(10,14,22,.28);
  padding: 22px 24px; width: min(420px, 92vw);
}
.account-dialog::backdrop { background: rgba(10,14,22,.55); }
.account-dialog .ad-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 12px; font-size: 1.05rem; }
.account-dialog .ad-tabs { display: flex; gap: 6px; }
.account-dialog .ad-tab { border: 1px solid var(--ad-border); background: transparent; color: var(--ad-soft); border-radius: 8px; padding: 6px 12px; cursor: pointer; font-weight: 650; font-size: .9rem; }
.account-dialog .ad-tab.on { background: var(--ad-accent-soft); color: var(--ad-accent); border-color: var(--ad-accent); }
.account-dialog .ad-close { border: 0; background: none; color: var(--ad-faint); font-size: 1rem; cursor: pointer; }
.account-dialog .ad-sub { color: var(--ad-soft); font-size: .92rem; margin: 0 0 14px; }
.account-dialog .ad-field { display: block; margin: 0 0 12px; }
.account-dialog .ad-field span { display: block; font-size: .82rem; font-weight: 650; color: var(--ad-soft); margin: 0 0 4px; }
.account-dialog .ad-field input { width: 100%; box-sizing: border-box; padding: 9px 12px; border: 1px solid var(--ad-border-strong); border-radius: 8px; background: var(--ad-panel); color: var(--ad-text); font-size: .95rem; }
.account-dialog .ad-field input:focus { outline: 2px solid var(--ad-accent); outline-offset: 1px; border-color: var(--ad-accent); }
.account-dialog .ad-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
.account-dialog .ad-error { color: var(--ad-bad); background: var(--ad-bad-soft); border-radius: 8px; padding: 8px 12px; font-size: .88rem; margin: 10px 0 0; }
.account-dialog .ad-privacy { color: var(--ad-faint); font-size: .8rem; margin: 16px 0 0; border-top: 1px solid var(--ad-border); padding-top: 10px; }
.account-dialog .ad-privacy a { color: var(--ad-soft); }
.account-dialog .ad-code { display: flex; align-items: center; gap: 10px; background: var(--ad-sunken); border: 1px dashed var(--ad-border-strong); border-radius: 8px; padding: 12px 14px; margin: 0 0 12px; }
.account-dialog .ad-code code { font-family: var(--font-mono, ui-monospace, Menlo, Consolas, monospace); font-size: 1.02rem; letter-spacing: .04em; flex: 1; word-break: break-all; }
.account-dialog .ad-check { display: flex; gap: 8px; align-items: center; font-size: .9rem; color: var(--ad-soft); }
.account-dialog .btn { border: 1px solid var(--ad-accent); background: var(--ad-accent); color: #fff; border-radius: 9px; padding: 9px 16px; cursor: pointer; font-weight: 650; font-size: .92rem; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; font-family: inherit; }
.account-dialog .btn:hover { filter: brightness(1.06); }
.account-dialog .btn.ghost { background: transparent; color: var(--ad-accent); }
.account-dialog .btn.danger { background: var(--ad-bad); border-color: var(--ad-bad); color: #fff; }
.account-dialog .btn[disabled] { opacity: .5; cursor: not-allowed; filter: none; }`;

  function ensureDialog() {
    if (dlg) return dlg;
    const style = document.createElement("style");
    style.textContent = DIALOG_CSS;
    document.head.appendChild(style);
    dlg = document.createElement("dialog");
    dlg.className = "account-dialog";
    document.body.appendChild(dlg);
    dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
    return dlg;
  }
  function open(html) {
    ensureDialog().innerHTML = html;
    if (!dlg.open) dlg.showModal();
  }
  function field(id, label, type, extra) {
    return `<label class="ad-field"><span>${label}</span>
      <input id="${id}" type="${type}" ${extra || ""} required></label>`;
  }
  function errBox() { return `<p class="ad-error" id="ad-error" hidden></p>`; }
  function showErr(msg) {
    const e = dlg.querySelector("#ad-error");
    if (e) { e.textContent = msg; e.hidden = false; }
  }
  function privacyNote() {
    return `<p class="ad-privacy">Stores only your username, a salted password hash and your
      learning progress — no email, no personal data. <a href="${siteRoot()}legal.html">Legal &amp; Privacy</a></p>`;
  }
  function siteRoot() {
    if (/\/modules\//.test(location.pathname)) return "../../";
    if (/\/electrical-engineering\//.test(location.pathname)) return "../";
    return "./";
  }

  function viewLoggedOut(tab) {
    const login = tab !== "register";
    open(`
      <div class="ad-head">
        <div class="ad-tabs">
          <button class="ad-tab ${login ? "on" : ""}" data-v="login">Log in</button>
          <button class="ad-tab ${login ? "" : "on"}" data-v="register">Create account</button>
        </div>
        <button class="ad-close" data-v="close" aria-label="Close">✕</button>
      </div>
      <form id="ad-form">
        <p class="ad-sub">${login
          ? "Sync your progress across devices."
          : "Just a username and a password — no email, no personal data."}</p>
        ${field("ad-user", "Username", "text", 'autocomplete="username" pattern="[A-Za-z0-9_\\-]{3,32}" title="3–32 characters: letters, digits, _ or -"')}
        ${field("ad-pass", "Password", "password", `autocomplete="${login ? "current-password" : "new-password"}" minlength="8"`)}
        ${errBox()}
        <div class="ad-actions">
          <button class="btn" type="submit">${login ? "Log in" : "Create account"}</button>
          ${login ? '<button class="btn ghost" type="button" data-v="recover">Forgot password?</button>' : ""}
        </div>
      </form>
      ${privacyNote()}`);
    dlg.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", onNav));
    dlg.querySelector("#ad-form").addEventListener("submit", async e => {
      e.preventDefault();
      const username = dlg.querySelector("#ad-user").value.toLowerCase().trim();
      const password = dlg.querySelector("#ad-pass").value;
      try {
        if (login) {
          const { status, data } = await api("POST", "/api/login", { username, password });
          if (status !== 200) return showErr(data && data.error || "Login failed.");
          setAuth(data.token, data.username);
          setMeta({ rev: 0 });
          await pull(true); // merge pre-account local progress with the server's
          viewLoggedIn();
        } else {
          const { status, data } = await api("POST", "/api/register", { username, password });
          if (status !== 201) return showErr(data && data.error || "Registration failed.");
          setAuth(data.token, data.username);
          setMeta({ rev: 0, dirty: true });
          doPush();
          viewRecoveryCode(data.recoveryCode, "Account created");
        }
        updateButton();
      } catch { showErr("Could not reach the sync server. Try again later."); }
    });
  }

  function viewRecoveryCode(code, title) {
    open(`
      <div class="ad-head"><b>${title}</b></div>
      <p class="ad-sub">This is your <b>recovery code</b> — the <u>only</u> way to reset a
        forgotten password (there is no email reset). It is shown <b>only once</b>:</p>
      <div class="ad-code"><code>${code}</code>
        <button class="btn ghost" id="ad-copy" type="button">Copy</button></div>
      <label class="ad-check"><input type="checkbox" id="ad-saved">
        <span>I have saved this code somewhere safe.</span></label>
      <div class="ad-actions"><button class="btn" id="ad-done" disabled>Done</button></div>`);
    dlg.querySelector("#ad-copy").addEventListener("click", () => {
      navigator.clipboard && navigator.clipboard.writeText(code);
      dlg.querySelector("#ad-copy").textContent = "Copied ✓";
    });
    dlg.querySelector("#ad-saved").addEventListener("change", e => {
      dlg.querySelector("#ad-done").disabled = !e.target.checked;
    });
    dlg.querySelector("#ad-done").addEventListener("click", () => viewLoggedIn());
  }

  function viewRecover() {
    open(`
      <div class="ad-head"><b>Reset password</b>
        <button class="ad-close" data-v="close" aria-label="Close">✕</button></div>
      <form id="ad-form">
        <p class="ad-sub">Enter your username, your recovery code and a new password.</p>
        ${field("ad-user", "Username", "text", 'autocomplete="username"')}
        ${field("ad-code", "Recovery code", "text", 'autocomplete="off" spellcheck="false"')}
        ${field("ad-pass", "New password", "password", 'autocomplete="new-password" minlength="8"')}
        ${errBox()}
        <div class="ad-actions">
          <button class="btn" type="submit">Reset password</button>
          <button class="btn ghost" type="button" data-v="login">Back</button>
        </div>
      </form>`);
    dlg.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", onNav));
    dlg.querySelector("#ad-form").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        const { status, data } = await api("POST", "/api/recover", {
          username: dlg.querySelector("#ad-user").value.toLowerCase().trim(),
          recoveryCode: dlg.querySelector("#ad-code").value,
          newPassword: dlg.querySelector("#ad-pass").value,
        });
        if (status !== 200) return showErr(data && data.error || "Recovery failed.");
        setAuth(data.token, data.username);
        setMeta({ rev: 0 });
        pull(true);
        updateButton();
        viewRecoveryCode(data.recoveryCode, "Password reset — new recovery code");
      } catch { showErr("Could not reach the sync server. Try again later."); }
    });
  }

  function syncStatusText() {
    const m = getMeta();
    if (m.dirty) return "Offline or not yet synced — changes are saved locally.";
    if (!m.lastSync) return "Synced.";
    const mins = Math.round((Date.now() - m.lastSync) / 60000);
    return "Synced · " + (mins < 1 ? "just now" : mins + " min ago");
  }
  function statusRefresh() {
    const s = dlg && dlg.querySelector("#ad-status");
    if (s) s.textContent = syncStatusText();
  }

  function viewLoggedIn() {
    const auth = getAuth();
    if (!auth) return viewLoggedOut("login");
    open(`
      <div class="ad-head"><b>👤 ${auth.username}</b>
        <button class="ad-close" data-v="close" aria-label="Close">✕</button></div>
      <p class="ad-sub" id="ad-status">${syncStatusText()}</p>
      ${errBox()}
      <div class="ad-actions">
        <button class="btn ghost" id="ad-logout" type="button">Log out</button>
        <button class="btn danger" id="ad-delete" type="button">Delete account…</button>
      </div>
      ${privacyNote()}`);
    dlg.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", onNav));
    dlg.querySelector("#ad-logout").addEventListener("click", () => {
      clearAuth();
      dlg.close();
    });
    dlg.querySelector("#ad-delete").addEventListener("click", () => viewDelete());
  }

  function viewDelete() {
    const auth = getAuth();
    open(`
      <div class="ad-head"><b>Delete account</b>
        <button class="ad-close" data-v="close" aria-label="Close">✕</button></div>
      <form id="ad-form">
        <p class="ad-sub">Permanently deletes <b>${auth.username}</b> and all synced data from the
          server. Progress stored in this browser is kept. Confirm with your password:</p>
        ${field("ad-pass", "Password", "password", 'autocomplete="current-password"')}
        ${errBox()}
        <div class="ad-actions">
          <button class="btn danger" type="submit">Delete permanently</button>
          <button class="btn ghost" type="button" data-v="account">Cancel</button>
        </div>
      </form>`);
    dlg.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", onNav));
    dlg.querySelector("#ad-form").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        const { status, data } = await api("DELETE", "/api/account",
          { password: dlg.querySelector("#ad-pass").value });
        if (status !== 204) return showErr(data && data.error || "Deletion failed.");
        clearAuth();
        open(`<div class="ad-head"><b>Account deleted</b></div>
          <p class="ad-sub">Your account and all synced data were removed from the server.
          Your progress remains in this browser.</p>
          <div class="ad-actions"><button class="btn" data-v="close">Close</button></div>`);
        dlg.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", onNav));
      } catch { showErr("Could not reach the sync server. Try again later."); }
    });
  }

  function onNav(e) {
    const v = e.currentTarget.dataset.v;
    if (v === "close") dlg.close();
    else if (v === "login") viewLoggedOut("login");
    else if (v === "register") viewLoggedOut("register");
    else if (v === "recover") viewRecover();
    else if (v === "account") viewLoggedIn();
  }

  /* ---------------- topbar button ---------------- */
  function updateButton() {
    const btn = document.getElementById("account-btn");
    if (!btn) return;
    const auth = getAuth();
    btn.hidden = false;
    btn.innerHTML = auth ? `👤 <span class="ab-name">${auth.username}</span>` : "👤";
    btn.title = auth ? `Account: ${auth.username}` : "Account & sync";
  }

  function boot() {
    updateButton();
    const btn = document.getElementById("account-btn");
    if (btn) btn.addEventListener("click", () => (getAuth() ? viewLoggedIn() : viewLoggedOut("login")));
    pull();
  }

  /* Pages with the app shell get #account-btn injected by app.js on
     DOMContentLoaded (then ee-ready fires); pages with a hardcoded
     button (the portal) have it in the DOM already when this runs. */
  if (document.getElementById("account-btn")) boot();
  else document.addEventListener("ee-ready", boot, { once: true });
})();
