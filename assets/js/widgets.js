/* ============================================================
   EE Knowledge Base — interactive widget library
   Canvas-based, dependency-free, theme-aware (re-renders on the
   ee-theme event), HiDPI-scaled, with hover crosshair readouts.

   Public API (window.EE):
     EE.functionPlot(spec)  — x/y function plotter with sliders
     EE.bodePlot(spec)      — log-f magnitude + phase, stacked
     EE.phasor(spec)        — animated rotating phasors + waveform
     EE.custom(spec)        — sliders/readouts + your own draw()
   All mount into an element: spec.mount = "#id" of an empty div
   inside a .widget .w-body.
   ============================================================ */
(function () {
  "use strict";
  const EE = (window.EE = window.EE || {});

  /* ------- validated categorical palette (see dataviz skill) ------- */
  const PAL = {
    light: ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"],
    dark:  ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"]
  };
  function theme() { return document.documentElement.dataset.theme === "dark" ? "dark" : "light"; }
  function seriesColor(i) { return PAL[theme()][i % 8]; }
  function ink() {
    const dark = theme() === "dark";
    return {
      primary: dark ? "#e6ebf4" : "#1c2330",
      muted:   dark ? "#7c88a0" : "#7a8699",
      grid:    dark ? "#26303f" : "#e7ebf2",
      axis:    dark ? "#35415a" : "#c3cbd8",
      surface: dark ? "#161c2b" : "#ffffff",
      accentSoft: dark ? "rgba(92,141,255,.14)" : "rgba(47,109,246,.08)"
    };
  }
  EE.seriesColor = seriesColor;
  EE.ink = ink;

  /* ---------------- number formatting ---------------- */
  function fmt(v, digits) {
    if (!isFinite(v)) return "∞";
    if (v === 0) return "0";
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-3) return v.toExponential(digits ?? 2);
    return +v.toFixed(digits ?? (a < 1 ? 3 : a < 100 ? 2 : 1)) + "";
  }
  EE.fmt = fmt;
  EE.si = function (v, unit) {
    if (!isFinite(v)) return "∞ " + (unit || "");
    const a = Math.abs(v);
    const P = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
    for (const [f, p] of P) if (a >= f * 0.9999) return fmt(v / f) + " " + p + (unit || "");
    return fmt(v) + " " + (unit || "");
  };

  /* ---------------- tick generation ---------------- */
  function niceTicks(min, max, n) {
    const span = max - min || 1;
    const step0 = span / Math.max(2, n);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
    const ticks = [];
    for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step)
      ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
    return ticks;
  }
  function logTicks(min, max) {
    const t = [], lo = Math.floor(Math.log10(min)), hi = Math.ceil(Math.log10(max));
    for (let e = lo; e <= hi; e++) {
      const d = Math.pow(10, e);
      if (d >= min && d <= max) t.push(d);
    }
    return t;
  }

  /* ---------------- canvas scaffolding ---------------- */
  function makeCanvas(parent, cssHeight) {
    const c = document.createElement("canvas");
    c.style.height = cssHeight + "px";
    parent.appendChild(c);
    return c;
  }
  function fitCanvas(c) {
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 600, h = parseFloat(c.style.height) || 300;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* view: maps data coords -> pixels, draws frame */
  function makeView(ctx, w, h, xAxis, yAxis) {
    const padL = 54, padR = 16, padT = 14, padB = 40;
    const iw = w - padL - padR, ih = h - padT - padB;
    const xlog = !!xAxis.log;
    const xmin = xlog ? Math.log10(xAxis.min) : xAxis.min;
    const xmax = xlog ? Math.log10(xAxis.max) : xAxis.max;
    const X = v => padL + ((xlog ? Math.log10(Math.max(v, 1e-30)) : v) - xmin) / (xmax - xmin) * iw;
    const Y = v => padT + (1 - (v - yAxis.min) / (yAxis.max - yAxis.min)) * ih;
    const XI = px => {
      const t = (px - padL) / iw * (xmax - xmin) + xmin;
      return xlog ? Math.pow(10, t) : t;
    };
    return { ctx, w, h, padL, padR, padT, padB, iw, ih, X, Y, XI, xAxis, yAxis };
  }

  function drawFrame(v) {
    const { ctx, xAxis, yAxis } = v, k = ink();
    ctx.clearRect(0, 0, v.w, v.h);
    ctx.font = "11.5px system-ui, sans-serif";
    ctx.lineWidth = 1;

    /* gridlines + ticks */
    const xt = xAxis.log ? logTicks(xAxis.min, xAxis.max) : niceTicks(xAxis.min, xAxis.max, 7);
    const yt = niceTicks(yAxis.min, yAxis.max, 5);
    ctx.strokeStyle = k.grid; ctx.fillStyle = k.muted;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (const t of xt) {
      const x = v.X(t);
      ctx.beginPath(); ctx.moveTo(x, v.padT); ctx.lineTo(x, v.padT + v.ih); ctx.stroke();
      ctx.fillText(xAxis.log ? EE.si(t, "") : fmt(t), x, v.padT + v.ih + 6);
    }
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const t of yt) {
      const y = v.Y(t);
      ctx.beginPath(); ctx.moveTo(v.padL, y); ctx.lineTo(v.padL + v.iw, y); ctx.stroke();
      ctx.fillText(fmt(t), v.padL - 8, y);
    }
    /* zero line slightly stronger */
    if (yAxis.min < 0 && yAxis.max > 0) {
      ctx.strokeStyle = k.axis;
      ctx.beginPath(); ctx.moveTo(v.padL, v.Y(0)); ctx.lineTo(v.padL + v.iw, v.Y(0)); ctx.stroke();
    }
    /* frame */
    ctx.strokeStyle = k.axis;
    ctx.strokeRect(v.padL, v.padT, v.iw, v.ih);
    /* axis labels */
    ctx.fillStyle = k.primary; ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    if (xAxis.label) ctx.fillText(xAxis.label, v.padL + v.iw / 2, v.h - 4);
    if (yAxis.label) {
      ctx.save();
      ctx.translate(13, v.padT + v.ih / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillText(yAxis.label, 0, 0); ctx.restore();
    }
  }

  function drawCurve(v, fn, color, opts) {
    const { ctx } = v;
    const N = 480;
    ctx.save();
    ctx.beginPath();
    ctx.rect(v.padL, v.padT, v.iw, v.ih); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = opts?.width || 2.2;
    if (opts?.dash) ctx.setLineDash(opts.dash);
    ctx.beginPath();
    let pen = false, lastY = null;
    for (let i = 0; i <= N; i++) {
      const x = v.XI(v.padL + (i / N) * v.iw);
      const y = fn(x);
      if (!isFinite(y)) { pen = false; continue; }
      const px = v.X(x), py = v.Y(y);
      /* break the path across huge jumps (poles) */
      if (pen && lastY !== null && Math.abs(py - lastY) > v.ih * 0.9) pen = false;
      if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
      lastY = py;
    }
    ctx.stroke();
    if (opts?.fill) {
      ctx.lineTo(v.X(v.xAxis.max), v.Y(0)); ctx.lineTo(v.X(v.xAxis.min), v.Y(0));
      ctx.globalAlpha = 0.10; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* direct label at the curve's right end (dataviz: selective direct labels) */
  function labelCurve(v, fn, text, color, slot) {
    const { ctx } = v;
    let x = v.xAxis.max, y = fn(x), tries = 0;
    while (!isFinite(y) && tries++ < 20) { x -= (v.xAxis.max - v.xAxis.min) / 40; y = fn(x); }
    if (!isFinite(y)) return;
    const py = Math.min(Math.max(v.Y(y), v.padT + 8 + slot * 14), v.padT + v.ih - 6);
    ctx.font = "600 11.5px system-ui, sans-serif";
    ctx.fillStyle = color; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
    ctx.fillText(text, v.padL + v.iw - 6, py - 3);
  }

  function drawAnnotations(v, anns) {
    if (!anns) return;
    const { ctx } = v, k = ink();
    for (const a of anns) {
      ctx.save();
      ctx.strokeStyle = a.color || k.muted; ctx.fillStyle = a.color || k.muted;
      ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4;
      ctx.font = "600 11px system-ui, sans-serif";
      if (a.type === "vline" && a.x >= v.xAxis.min && a.x <= v.xAxis.max) {
        const x = v.X(a.x);
        ctx.beginPath(); ctx.moveTo(x, v.padT); ctx.lineTo(x, v.padT + v.ih); ctx.stroke();
        if (a.label) { ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(a.label, x + 5, v.padT + 4); }
      } else if (a.type === "hline" && a.y >= v.yAxis.min && a.y <= v.yAxis.max) {
        const y = v.Y(a.y);
        ctx.beginPath(); ctx.moveTo(v.padL, y); ctx.lineTo(v.padL + v.iw, y); ctx.stroke();
        if (a.label) { ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(a.label, v.padL + 6, y - 3); }
      } else if (a.type === "point") {
        const x = v.X(a.x), y = v.Y(a.y);
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fill();
        ctx.strokeStyle = ink().surface; ctx.lineWidth = 2; ctx.stroke();
        if (a.label) { ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(a.label, x + 7, y - 5); }
      }
      ctx.restore();
    }
  }

  /* ---------------- controls (sliders / segmented / readouts) ---------------- */
  function buildControls(mount, spec, onChange) {
    const params = {};
    let wrap = null;
    if (spec.params && spec.params.length) {
      wrap = document.createElement("div");
      wrap.className = "w-controls";
      for (const p of spec.params) {
        params[p.key] = p.value;
        if (p.type === "select") {
          const ctrl = document.createElement("div");
          ctrl.className = "w-ctrl";
          ctrl.innerHTML = `<label>${p.label}</label>`;
          const seg = document.createElement("div");
          seg.className = "w-seg";
          p.options.forEach((o, oi) => {
            const b = document.createElement("button");
            b.textContent = o.label; b.type = "button";
            if (o.value === p.value) b.classList.add("active");
            b.addEventListener("click", () => {
              params[p.key] = o.value;
              seg.querySelectorAll("button").forEach(x => x.classList.remove("active"));
              b.classList.add("active");
              onChange();
            });
            seg.appendChild(b);
          });
          ctrl.appendChild(seg); wrap.appendChild(ctrl);
        } else {
          const ctrl = document.createElement("div");
          ctrl.className = "w-ctrl";
          const id = "s" + Math.floor(performance.now() * 1000 + wrap.childElementCount);
          ctrl.innerHTML = `<label for="${id}">${p.label}<span class="val"></span></label>
            <input id="${id}" type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.value}">`;
          const inp = ctrl.querySelector("input"), val = ctrl.querySelector(".val");
          const show = () => (val.textContent = (p.fmt ? p.fmt(+inp.value) : fmt(+inp.value)) + (p.unit ? " " + p.unit : ""));
          show();
          inp.addEventListener("input", () => { params[p.key] = +inp.value; show(); onChange(); });
          wrap.appendChild(ctrl);
        }
      }
      mount.appendChild(wrap);
    }
    let roWrap = null, roEls = [];
    if (spec.readouts && spec.readouts.length) {
      roWrap = document.createElement("div");
      roWrap.className = "w-readout";
      for (const r of spec.readouts) {
        const d = document.createElement("div");
        d.className = "ro";
        d.innerHTML = `<span class="k">${r.label}</span><span class="v"></span>`;
        roWrap.appendChild(d); roEls.push(d.querySelector(".v"));
      }
      mount.appendChild(roWrap);
    }
    const updateReadouts = () => {
      if (spec.readouts) spec.readouts.forEach((r, i) => (roEls[i].textContent = r.fn(params)));
    };
    return { params, updateReadouts };
  }

  /* hover crosshair for function plots */
  function attachCrosshair(canvas, getView, getCurves, getParams) {
    let hoverX = null;
    canvas.addEventListener("pointermove", e => {
      const r = canvas.getBoundingClientRect();
      hoverX = e.clientX - r.left;
      canvas.dispatchEvent(new CustomEvent("ee-redraw"));
    });
    canvas.addEventListener("pointerleave", () => {
      hoverX = null;
      canvas.dispatchEvent(new CustomEvent("ee-redraw"));
    });
    return function drawHover() {
      if (hoverX == null) return;
      const v = getView();
      if (hoverX < v.padL || hoverX > v.padL + v.iw) return;
      const { ctx } = v, k = ink();
      const x = v.XI(hoverX);
      ctx.save();
      ctx.strokeStyle = k.axis; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(hoverX, v.padT); ctx.lineTo(hoverX, v.padT + v.ih); ctx.stroke();
      ctx.setLineDash([]);
      const p = getParams();
      const lines = [ (v.xAxis.hoverFmt ? v.xAxis.hoverFmt(x) : (v.xAxis.label || "x") + " = " + fmt(x)) ];
      getCurves().forEach((c, i) => {
        const y = c.fn(x, p);
        if (!isFinite(y)) return;
        const py = v.Y(y);
        if (py >= v.padT && py <= v.padT + v.ih) {
          ctx.fillStyle = seriesColor(c.color ?? i);
          ctx.beginPath(); ctx.arc(hoverX, py, 4, 0, 7); ctx.fill();
          ctx.strokeStyle = k.surface; ctx.lineWidth = 2; ctx.stroke();
        }
        lines.push(c.label + " = " + fmt(y));
      });
      /* tooltip box */
      ctx.font = "11.5px system-ui, sans-serif";
      const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 18;
      const th = lines.length * 16 + 10;
      let bx = hoverX + 12;
      if (bx + tw > v.w - 4) bx = hoverX - tw - 12;
      const by = v.padT + 8;
      ctx.fillStyle = k.surface; ctx.strokeStyle = k.axis; ctx.lineWidth = 1;
      ctx.globalAlpha = 0.96;
      ctx.beginPath(); ctx.roundRect(bx, by, tw, th, 7); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      lines.forEach((l, i) => {
        ctx.fillStyle = i === 0 ? k.muted : seriesColor(getCurves()[i - 1].color ?? (i - 1));
        ctx.fillText(l, bx + 9, by + 6 + i * 16);
      });
      ctx.restore();
    };
  }

  /* ---------------- EE.functionPlot ---------------- */
  EE.functionPlot = function (spec) {
    const mount = document.querySelector(spec.mount);
    if (!mount) return console.warn("functionPlot: mount not found", spec.mount);
    const canvas = makeCanvas(mount, spec.height || 300);
    const { params, updateReadouts } = buildControls(mount, spec, draw);

    let view = null;
    const xa = () => (typeof spec.x === "function" ? spec.x(params) : spec.x);
    const ya = () => (typeof spec.y === "function" ? spec.y(params) : spec.y);

    const hover = attachCrosshair(canvas, () => view, () => spec.curves, () => params);

    function draw() {
      const { ctx, w, h } = fitCanvas(canvas);
      view = makeView(ctx, w, h, xa(), ya());
      drawFrame(view);
      drawAnnotations(view, spec.annotations ? spec.annotations(params) : null);
      spec.curves.forEach((c, i) => {
        const col = seriesColor(c.color ?? i);
        drawCurve(view, x => c.fn(x, params), col, c);
      });
      spec.curves.forEach((c, i) => {
        if (c.label) labelCurve(view, x => c.fn(x, params), c.label, seriesColor(c.color ?? i), i);
      });
      hover();
      updateReadouts();
    }
    canvas.addEventListener("ee-redraw", draw);
    window.addEventListener("ee-theme", draw);
    new ResizeObserver(() => draw()).observe(canvas);
    draw();
    return { redraw: draw, params };
  };

  /* ---------------- EE.bodePlot ---------------- */
  EE.bodePlot = function (spec) {
    /* spec: {mount, fmin, fmax, H: (f, params) => {mag(dB), phase(deg)} via
       spec.mag(f,p), spec.phase(f,p); params, readouts, annotations(p)} */
    const mount = document.querySelector(spec.mount);
    if (!mount) return console.warn("bodePlot: mount not found", spec.mount);
    const cMag = makeCanvas(mount, spec.height || 220);
    const cPh = makeCanvas(mount, spec.heightPhase || 170);
    cPh.style.marginTop = "6px";
    const { params, updateReadouts } = buildControls(mount, spec, draw);

    let vM = null, vP = null;
    const magCurves = [{ label: spec.magLabel || "|H| in dB", fn: spec.mag, color: 0 }];
    const phCurves = [{ label: spec.phaseLabel || "∠H in °", fn: spec.phase, color: 4 }];
    const hovM = attachCrosshair(cMag, () => vM, () => magCurves, () => params);
    const hovP = attachCrosshair(cPh, () => vP, () => phCurves, () => params);

    function draw() {
      const ym = typeof spec.magRange === "function" ? spec.magRange(params) : (spec.magRange || { min: -60, max: 20 });
      const yp = spec.phaseRange || { min: -180, max: 90 };
      {
        const { ctx, w, h } = fitCanvas(cMag);
        vM = makeView(ctx, w, h, { min: spec.fmin, max: spec.fmax, log: true, label: "", hoverFmt: f => "f = " + EE.si(f, "Hz") }, { ...ym, label: spec.magLabel || "|H| in dB" });
        drawFrame(vM);
        drawAnnotations(vM, spec.annotations ? spec.annotations(params, "mag") : null);
        drawCurve(vM, f => spec.mag(f, params), seriesColor(0));
        hovM();
      }
      {
        const { ctx, w, h } = fitCanvas(cPh);
        vP = makeView(ctx, w, h, { min: spec.fmin, max: spec.fmax, log: true, label: spec.fLabel || "f in Hz (log)", hoverFmt: f => "f = " + EE.si(f, "Hz") }, { ...yp, label: spec.phaseLabel || "∠H in °" });
        drawFrame(vP);
        drawAnnotations(vP, spec.annotations ? spec.annotations(params, "phase") : null);
        drawCurve(vP, f => spec.phase(f, params), seriesColor(4));
        hovP();
      }
      updateReadouts();
    }
    cMag.addEventListener("ee-redraw", draw);
    cPh.addEventListener("ee-redraw", draw);
    window.addEventListener("ee-theme", draw);
    new ResizeObserver(() => draw()).observe(cMag);
    draw();
    return { redraw: draw, params };
  };

  /* ---------------- EE.phasor ---------------- */
  EE.phasor = function (spec) {
    /* spec: {mount, height, phasors: (p,t)=>[{mag (0..1 rel), phase(rad), label, color}],
       omegaVisual, params, readouts, showSum} — draws rotating phasors on the left,
       projected time waveforms on the right. */
    const mount = document.querySelector(spec.mount);
    if (!mount) return console.warn("phasor: mount not found", spec.mount);
    const canvas = makeCanvas(mount, spec.height || 300);

    /* play/pause row */
    const rowBtn = document.createElement("div");
    rowBtn.style.marginTop = "10px";
    rowBtn.innerHTML = `<button class="w-btn primary" data-act="play">⏸ Pause</button>`;
    mount.appendChild(rowBtn);
    const { params, updateReadouts } = buildControls(mount, spec, () => {});

    let t = 0, playing = true, raf = null, last = null;
    const btn = rowBtn.querySelector("button");
    btn.addEventListener("click", () => {
      playing = !playing;
      btn.textContent = playing ? "⏸ Pause" : "▶ Play";
      if (playing) { last = null; tick(); }
    });

    function draw() {
      const { ctx, w, h } = fitCanvas(canvas);
      const k = ink();
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(h / 2 - 26, w * 0.18);
      const cx = R + 30, cy = h / 2;
      const ph = spec.phasors(params, t);

      /* circle + axes */
      ctx.strokeStyle = k.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - R - 12, cy); ctx.lineTo(cx + R + 12, cy);
      ctx.moveTo(cx, cy - R - 12); ctx.lineTo(cx, cy + R + 12); ctx.stroke();

      /* waveform area */
      const wx0 = cx + R + 40, wx1 = w - 14, wSpan = wx1 - wx0;
      const periods = spec.periods || 2;
      ctx.strokeStyle = k.grid;
      ctx.beginPath(); ctx.moveTo(wx0, cy); ctx.lineTo(wx1, cy); ctx.stroke();

      const omega = spec.omegaVisual || 1.4;
      const all = spec.showSum
        ? [...ph, { mag: null, label: spec.sumLabel || "sum", color: ph.length, isSum: true }]
        : ph;

      all.forEach((p, i) => {
        const col = seriesColor(p.color ?? i);
        const val = ang => p.isSum
          ? ph.reduce((s, q) => s + q.mag * Math.sin(ang + q.phase), 0)
          : p.mag * Math.sin(ang + p.phase);
        /* phasor arrow (skip for sum) */
        if (!p.isSum) {
          const a = omega * t + p.phase;
          const px = cx + R * p.mag * Math.cos(a), py = cy - R * p.mag * Math.sin(a);
          ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
          const aa = Math.atan2(cy - py, px - cx);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - 9 * Math.cos(aa - 0.4), py + 9 * Math.sin(aa - 0.4));
          ctx.lineTo(px - 9 * Math.cos(aa + 0.4), py + 9 * Math.sin(aa + 0.4));
          ctx.closePath(); ctx.fill();
          /* projection dashes to waveform start */
          ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.globalAlpha = .6;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(wx0, cy - R * val(omega * t)); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
        /* waveform: history to the right */
        ctx.strokeStyle = col; ctx.lineWidth = p.isSum ? 2.6 : 1.9;
        if (p.isSum) ctx.setLineDash([]);
        ctx.beginPath();
        const N = 220;
        for (let s = 0; s <= N; s++) {
          const ang = omega * t - (s / N) * periods * 2 * Math.PI;
          const x = wx0 + (s / N) * wSpan, y = cy - R * val(ang);
          s ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
        /* direct label */
        ctx.font = "600 11.5px system-ui, sans-serif";
        ctx.fillStyle = col; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(p.label || "", wx0 + 4, cy - R * val(omega * t) - 10 - i * 3);
      });
      ctx.fillStyle = k.muted; ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText("phasor (rotating)", cx, h - 16);
      ctx.fillText("time domain  ← t", wx0 + wSpan / 2, h - 16);
      updateReadouts();
    }

    function tick(ts) {
      if (!playing) return;
      if (last == null) last = ts || performance.now();
      const now = ts || performance.now();
      t += Math.min(0.05, (now - last) / 1000);
      last = now;
      draw();
      raf = requestAnimationFrame(tick);
    }
    window.addEventListener("ee-theme", draw);
    new ResizeObserver(() => draw()).observe(canvas);
    /* pause animation when off-screen */
    new IntersectionObserver(en => {
      const vis = en[0].isIntersecting;
      if (!vis && raf) { cancelAnimationFrame(raf); raf = null; last = null; }
      else if (vis && playing && !raf) tick();
    }).observe(canvas);
    tick();
    return { redraw: draw, params };
  };

  /* ---------------- EE.custom ---------------- */
  EE.custom = function (spec) {
    /* spec: {mount, height, params, readouts, draw(ctx, w, h, params, helpers), animate?} */
    const mount = document.querySelector(spec.mount);
    if (!mount) return console.warn("custom: mount not found", spec.mount);
    const canvas = makeCanvas(mount, spec.height || 300);
    const { params, updateReadouts } = buildControls(mount, spec, draw);
    let t = 0, raf = null;

    function draw() {
      const { ctx, w, h } = fitCanvas(canvas);
      ctx.clearRect(0, 0, w, h);
      /* ink usable both as helpers.ink() and helpers.ink.grid */
      const k = ink();
      const inkHelper = Object.assign(() => k, k);
      spec.draw(ctx, w, h, params, { ink: inkHelper, color: seriesColor, fmt, si: EE.si, t,
        niceTicks, makeView: (xa, ya) => makeView(ctx, w, h, xa, ya), drawFrame, drawCurve, drawAnnotations });
      updateReadouts();
    }
    if (spec.animate) {
      const tick = () => { t += 0.016; draw(); raf = requestAnimationFrame(tick); };
      new IntersectionObserver(en => {
        if (!en[0].isIntersecting && raf) { cancelAnimationFrame(raf); raf = null; }
        else if (en[0].isIntersecting && !raf) tick();
      }).observe(canvas);
      tick();
    } else draw();
    canvas.addEventListener("pointermove", e => {
      if (!spec.onPointer) return;
      const r = canvas.getBoundingClientRect();
      spec.onPointer(e.clientX - r.left, e.clientY - r.top, params);
      draw();
    });
    window.addEventListener("ee-theme", draw);
    new ResizeObserver(() => draw()).observe(canvas);
    return { redraw: draw, params, canvas };
  };
})();
