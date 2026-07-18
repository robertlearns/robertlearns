/* ============================================================
   EE Knowledge Base — app shell
   Injects topbar + sidebar from the curriculum registry, handles
   theme, mobile nav, TOC scroll-spy, KaTeX rendering, the quiz
   engine and localStorage progress. Module pages only author
   their <main class="article"> content.
   ============================================================ */
(function () {
  "use strict";

  const IS_MODULE = /\/modules\//.test(location.pathname);
  const ROOT = IS_MODULE ? "../" : "./";
  const SITE_ROOT = IS_MODULE ? "../../" : "../";
  const STORE_KEY = "ee-kb-progress-v1";

  /* ---------------- progress store ---------------- */
  const Store = {
    data: (() => {
      try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
      catch { return {}; }
    })(),
    save() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch {}
      document.dispatchEvent(new CustomEvent("ee-progress-changed"));
    },
    /* overwrite without dispatching ee-progress-changed (used by sync merge) */
    replaceData(d) {
      this.data = d || {};
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch {}
    },
    get completed() { return this.data.completed || (this.data.completed = {}); },
    get quiz() { return this.data.quiz || (this.data.quiz = {}); },
    isDone(id) { return !!this.completed[id]; },
    setDone(id, v) { if (v) this.completed[id] = true; else delete this.completed[id]; this.save(); },
    quizBest(id) { return this.quiz[id] || null; },
    setQuiz(id, score, total) {
      const prev = this.quiz[id];
      if (!prev || score / total >= prev.score / prev.total) { this.quiz[id] = { score, total }; this.save(); }
    }
  };
  window.EEStore = Store;

  /* ---------------- theme ---------------- */
  function currentTheme() {
    const saved = localStorage.getItem("ee-kb-theme");
    if (saved) return saved;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const btn = document.getElementById("theme-btn");
    if (btn) btn.textContent = t === "dark" ? "☀️" : "🌙";
    window.dispatchEvent(new CustomEvent("ee-theme", { detail: t }));
  }
  window.EETheme = { current: currentTheme };

  /* ---------------- shell construction ---------------- */
  const modId = document.body.dataset.module || null;
  const mod = modId ? eeModuleById(modId) : null;

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (html != null) e.innerHTML = html;
    return e;
  }

  function buildTopbar() {
    const tb = el("header", { class: "topbar" });
    tb.innerHTML = `
      ${modId ? '<button class="tb-btn menu-toggle" id="menu-btn" aria-label="Menu">☰</button>' : ""}
      <a class="tb-btn" href="${SITE_ROOT}" aria-label="All courses" title="All courses" style="font-size:1.2rem;text-decoration:none">🏠</a>
      <a class="brand" href="${ROOT}index.html"><span class="logo">EE</span><span>EE Knowledge Base <span class="muted" style="font-weight:400">· Elektrotechnik</span></span></a>
      <span class="spacer"></span>
      <button class="tb-btn" id="account-btn" aria-label="Account" hidden>👤</button>
      <button class="tb-btn" id="theme-btn" aria-label="Toggle theme">🌙</button>`;
    document.body.prepend(tb);
    document.getElementById("theme-btn").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem("ee-kb-theme", next);
      applyTheme(next);
    });
  }

  function buildSidebar() {
    const layout = document.querySelector(".layout");
    if (!layout) return;
    const sb = el("nav", { class: "sidebar", id: "sidebar", "aria-label": "Curriculum" });
    let html = "";
    for (const part of EE_CURRICULUM.parts) {
      html += `<div class="nav-group"><div class="nav-cat">${part.icon} ${part.title}</div>`;
      for (const m of part.modules) {
        const cls = ["nav-link", m.id === modId ? "active" : "", Store.isDone(m.id) ? "done" : ""].join(" ").trim();
        html += `<a class="${cls}" href="${ROOT}modules/${m.file}" data-mod="${m.id}">
          <span class="nl-num">${m.num}</span><span>${m.title}</span></a>`;
      }
      html += `</div>`;
    }
    /* on-page TOC (filled after DOM scan) */
    html += `<div class="toc-mini" id="toc-mini" hidden><div class="toc-head">On this page</div><div id="toc-links"></div></div>`;
    sb.innerHTML = html;
    layout.prepend(sb);

    /* mobile scrim + toggle */
    const scrim = el("div", { class: "scrim", id: "scrim" });
    document.body.appendChild(scrim);
    const menuBtn = document.getElementById("menu-btn");
    const close = () => { sb.classList.remove("open"); scrim.classList.remove("show"); };
    if (menuBtn) menuBtn.addEventListener("click", () => {
      sb.classList.toggle("open"); scrim.classList.toggle("show");
    });
    scrim.addEventListener("click", close);

    /* scroll the active link into view */
    const act = sb.querySelector(".nav-link.active");
    if (act) act.scrollIntoView({ block: "center" });
  }

  function buildTOC() {
    const heads = document.querySelectorAll(".article h2[id], .article h3[id]");
    const tocWrap = document.getElementById("toc-mini");
    const toc = document.getElementById("toc-links");
    if (!toc || heads.length < 2) return;
    tocWrap.hidden = false;
    heads.forEach(h => {
      const a = el("a", { href: "#" + h.id, class: h.tagName === "H3" ? "lvl-3" : "" });
      a.textContent = h.textContent.replace(/\s*[§#]\s*$/, "");
      toc.appendChild(a);
    });
    /* scroll-spy */
    const links = [...toc.querySelectorAll("a")];
    const spy = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) {
          links.forEach(l => l.classList.toggle("active", l.getAttribute("href") === "#" + e.target.id));
        }
      }
    }, { rootMargin: "-70px 0px -70% 0px" });
    heads.forEach(h => spy.observe(h));
  }

  function buildPager() {
    if (!mod) return;
    const art = document.querySelector(".article");
    if (!art) return;

    /* mark-complete bar */
    const bar = el("div", { class: "complete-bar" });
    const renderBar = () => {
      const done = Store.isDone(mod.id);
      bar.innerHTML = `
        <span class="cb-text">${done
          ? "Module marked as completed. It shows a ✓ in the curriculum."
          : "Finished studying this module? Mark it complete to track your progress."}</span>
        <button class="btn ${done ? "done" : ""}" id="complete-btn">${done ? "✓ Completed" : "Mark as complete"}</button>`;
      bar.querySelector("#complete-btn").addEventListener("click", () => {
        Store.setDone(mod.id, !Store.isDone(mod.id));
        renderBar();
        document.querySelectorAll(`.nav-link[data-mod="${mod.id}"]`)
          .forEach(l => l.classList.toggle("done", Store.isDone(mod.id)));
      });
    };
    renderBar();
    art.appendChild(bar);

    /* prev / next */
    const prev = EE_MODULES[mod.index - 1], next = EE_MODULES[mod.index + 1];
    const pager = el("div", { class: "pager" });
    pager.innerHTML = `
      <a class="prev ${prev ? "" : "disabled"}" href="${prev ? ROOT + "modules/" + prev.file : "#"}">
        <span class="dir">← Previous</span><span class="ttl">${prev ? prev.num + " · " + prev.title : ""}</span></a>
      <a class="next ${next ? "" : "disabled"}" href="${next ? ROOT + "modules/" + next.file : "#"}">
        <span class="dir">Next →</span><span class="ttl">${next ? next.num + " · " + next.title : ""}</span></a>`;
    art.appendChild(pager);
  }

  /* ---------------- quiz engine ----------------
     Usage in a page:
       <div class="quiz" data-quiz-title="Self-assessment">
         <script type="application/json">[ {"q":"...", "opts":["a","b"], "a":0, "explain":"..."} ]<\/script>
       </div>
  */
  function buildQuizzes() {
    document.querySelectorAll(".quiz[data-quiz-title]").forEach((q, qi) => {
      let items;
      try { items = JSON.parse(q.querySelector('script[type="application/json"]').textContent); }
      catch (e) { console.error("Quiz JSON parse error", e); return; }

      const title = q.dataset.quizTitle || "Self-assessment";
      const best = mod ? Store.quizBest(mod.id) : null;
      let html = `<div class="quiz-head"><h3>🎓 ${title}</h3>
        <p>${items.length} questions · answers are graded instantly · best score is saved locally${
          best ? ` · <b>best so far: ${best.score}/${best.total}</b>` : ""}</p></div><div class="quiz-body">`;

      items.forEach((it, i) => {
        html += `<div class="q-item" data-a="${it.a}"><div class="q-stem"><span class="q-idx">${i + 1}.</span>${it.q}</div><div class="q-options">`;
        it.opts.forEach((opt, oi) => {
          html += `<label class="q-opt"><input type="radio" name="q${qi}_${i}" value="${oi}"><span>${opt}</span></label>`;
        });
        html += `</div><div class="q-explain">${it.explain || ""}</div></div>`;
      });
      html += `</div><div class="quiz-foot">
        <button class="btn" data-act="grade">Check answers</button>
        <button class="btn ghost" data-act="reset">Reset</button>
        <span class="spacer"></span><span class="quiz-score" hidden></span></div>`;
      q.innerHTML = html;

      const grade = () => {
        let score = 0;
        q.querySelectorAll(".q-item").forEach(item => {
          const a = +item.dataset.a;
          const opts = [...item.querySelectorAll(".q-opt")];
          const sel = opts.findIndex(o => o.querySelector("input").checked);
          opts.forEach((o, oi) => {
            o.classList.remove("correct", "wrong");
            if (oi === a) o.classList.add("correct");
            else if (oi === sel) o.classList.add("wrong");
          });
          item.querySelector(".q-explain").classList.add("show");
          if (sel === a) score++;
        });
        const sc = q.querySelector(".quiz-score");
        sc.hidden = false;
        const pct = Math.round(100 * score / items.length);
        sc.innerHTML = `Score: ${score}/${items.length} <span class="pct">(${pct}%)</span> ${pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "📚 review & retry"}`;
        if (mod) Store.setQuiz(mod.id, score, items.length);
        if (window.EEMath) window.EEMath(q);
      };
      const reset = () => {
        q.querySelectorAll("input[type=radio]").forEach(r => (r.checked = false));
        q.querySelectorAll(".q-opt").forEach(o => o.classList.remove("correct", "wrong"));
        q.querySelectorAll(".q-explain").forEach(e => e.classList.remove("show"));
        q.querySelector(".quiz-score").hidden = true;
      };
      q.querySelector('[data-act="grade"]').addEventListener("click", grade);
      q.querySelector('[data-act="reset"]').addEventListener("click", reset);
    });
  }

  function buildFooter() {
    /* pages with a hand-written footer (the two landing pages) keep theirs */
    if (document.querySelector(".site-footer, .site-foot")) return;
    const f = el("footer", { class: "site-footer" }, `
      Built with Claude Code · educational use only — no guarantee of correctness ·
      © Robert Scholz · <a href="${SITE_ROOT}legal.html">Legal &amp; Privacy</a>`);
    document.body.appendChild(f);
  }

  /* ---------------- KaTeX ---------------- */
  function renderMath(root) {
    if (typeof renderMathInElement !== "function") return;
    renderMathInElement(root || document.body, {
      delimiters: [
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false }
      ],
      throwOnError: false
    });
  }
  window.EEMath = renderMath;

  /* ---------------- boot ---------------- */
  applyTheme(currentTheme());
  document.addEventListener("DOMContentLoaded", () => {
    buildTopbar();
    if (modId) buildSidebar();
    buildQuizzes();
    renderMath(document.body);
    buildTOC();
    buildPager();
    buildFooter();
    document.dispatchEvent(new CustomEvent("ee-ready"));
  });
})();
