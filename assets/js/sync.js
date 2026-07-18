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
  if (!window.EEStore) return;

  /* After `wrangler deploy`, replace with the printed workers.dev URL. */
  const PROD_API = "https://ee-sync.robertetudie.workers.dev";
  const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? "http://127.0.0.1:8787" : PROD_API;

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
      l.classList.toggle("done", EEStore.isDone(l.dataset.mod)));
    const btn = document.getElementById("complete-btn");
    const modId = document.body.dataset.module;
    if (btn && modId) {
      const done = EEStore.isDone(modId);
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
    const next = (forceMerge || getMeta().dirty) ? mergeProgress(progress, EEStore.data) : progress;
    setMeta({ rev, lastSync: Date.now() });
    const changed = canon(next) !== canon(EEStore.data);
    EEStore.replaceData(next);
    if (changed) applyMergedUI();
    if (canon(next) !== canon(progress)) doPush();
    else setMeta({ dirty: false });
    updateButton();
  }

  async function pull() {
    if (!getAuth()) return;
    try {
      const { status, data } = await api("GET", "/api/progress");
      if (status === 401) { clearAuth(); return; }
      if (status !== 200 || !data) return;
      adoptServerState(data.progress, data.rev, false);
    } catch { /* offline — keep local */ }
  }

  async function doPush(retrying) {
    if (!getAuth()) return;
    try {
      const { status, data } = await api("PUT", "/api/progress",
        { progress: { completed: EEStore.completed, quiz: EEStore.quiz }, baseRev: getMeta().rev });
      if (status === 200) { setMeta({ rev: data.rev, dirty: false, lastSync: Date.now() }); statusRefresh(); return; }
      if (status === 401) { clearAuth(); return; }
      if (status === 409 && data && !retrying) {
        const merged = mergeProgress(data.progress, EEStore.data);
        setMeta({ rev: data.rev });
        if (canon(merged) !== canon(EEStore.data)) { EEStore.replaceData(merged); applyMergedUI(); }
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
          body: JSON.stringify({ progress: { completed: EEStore.completed, quiz: EEStore.quiz }, baseRev: getMeta().rev }),
        });
      } catch {}
    }
  });

  /* ---------------- account dialog ---------------- */
  let dlg = null;

  function ensureDialog() {
    if (dlg) return dlg;
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
    return /\/modules\//.test(location.pathname) ? "../../" : "../";
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
          adoptServerState(data.progress, data.rev, true);
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
        pull();
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

  /* app.js builds the topbar on DOMContentLoaded and then fires ee-ready;
     if the shell is already up (dynamic load), boot immediately. */
  if (document.querySelector(".topbar")) boot();
  else document.addEventListener("ee-ready", boot, { once: true });
})();
