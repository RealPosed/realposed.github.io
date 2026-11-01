/* ═══════════════════════════════════════════════════════════════════════════
   RealPosed — landing page interactions
   ───────────────────────────────────────────────────────────────────────────
   1. Hero: a field of horizontal lines — turbulent on the left, ordered on
      the right, like the mark. A soft lens follows the cursor; a click sends
      a wave through the field (2D wave equation on a coarse grid).
   2. Brand mark: the symbol's wavy bands are generated as SVG paths and
      flow toward the ordered half (CSS animation does the motion).
   3. Pipeline stage: one signal rendered through observe → … → design,
      driven by scroll position or by hovering a step.
   4. Engine cards: paintable 2D heat equation; particles advected along a
      Taylor–Green field that the cursor can stir.
   5. Lab: Tikhonov-regularized deconvolution in the Fourier domain.
   6. Resolve finer: drag-to-compare on a real 32×32 → 256×256 rollout frame.
   7. Scroll reveal, counters, pipeline rail, manifesto reveal, spotlight,
      tilt, magnetic buttons, nav state, Hadamard switches, publication filter.
   ═══════════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOVER   = window.matchMedia('(hover: hover)').matches;
  const clamp   = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth  = (t) => t * t * (3 - 2 * t);

  /* ── Shared: run a rAF loop only while an element is on screen ───────── */
  function visibleLoop(el, tick) {
    let raf = 0, visible = false;
    const loop = (t) => { tick(t); raf = requestAnimationFrame(loop); };
    const start = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop); };
    const stop  = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }, { threshold: 0.02 }).observe(el);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  }

  function fitCanvas(canvas, ctx) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [r.width, r.height];
  }

  /* ── Shared WebGL: a full-canvas fragment shader. Draws one triangle that
        covers the viewport and runs the shader once per pixel. Returns the
        program and its uniform locations, or null if it doesn't compile. ── */
  const GL_VS = 'attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';
  function glShaderPass(gl, fsSrc, uniforms) {
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = compile(gl.VERTEX_SHADER, GL_VS), fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    uniforms.forEach((k) => { U[k] = gl.getUniformLocation(prog, k); });
    return U;
  }

  function mulberry32(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ═════════════════════════════════════════════════════════════════════════
     0. Blueprint sheet. The grid is a CSS background on .blueprint, so it
        scrolls natively; this sets its geometry so the major lines frame the
        container and a major line runs along the bottom of the hero.
        Around the cursor the mesh refines the way an adaptive mesh
        refinement solver does: cells split into four, then four again,
        and coarsen once the cursor moves on.
     ═════════════════════════════════════════════════════════════════════════ */
  function initBlueprint() {
    const frameRef = document.querySelector('main .container');
    if (!document.querySelector('.blueprint') || !frameRef) return;
    const hero = document.getElementById('top');
    const css = document.documentElement.style;
    const BASE = 48, MAJOR = 4, FADE = 180;
    const g = { x0: 0, w: 0, cell: BASE, y0: 0 };

    const cards = document.querySelector('.bento');             // the card grids share this column structure
    function layout() {
      // Major lines run down the middle of the gutters between cards and half a gutter outside
      // the content edges, so no line ever sits on a card's border or on the text margin.
      const r = frameRef.getBoundingClientRect(), cs = getComputedStyle(frameRef);
      const left = r.left + parseFloat(cs.paddingLeft);
      const w = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const gs = cards ? getComputedStyle(cards) : null;
      const cols = gs ? gs.gridTemplateColumns.split(' ').filter(Boolean).length : 1;
      const gap = (gs && parseFloat(gs.columnGap)) || 16;
      const period = (w + gap) / cols;                          // one column plus one gutter
      const m = period / Math.max(1, Math.round(period / (BASE * MAJOR))), a = 3;
      g.cell = m / MAJOR;
      g.x0 = left - gap / 2;
      g.w = w + gap;
      g.y0 = hero ? (hero.offsetTop + hero.offsetHeight) % m : 0;
      css.setProperty('--bp-cell', g.cell.toFixed(3) + 'px');
      css.setProperty('--bp-major', m.toFixed(3) + 'px');
      css.setProperty('--bp-x', g.x0.toFixed(3) + 'px');
      css.setProperty('--bp-y', g.y0.toFixed(3) + 'px');
      css.setProperty('--bp-w', g.w.toFixed(3) + 'px');
      // Registration crosses on the major intersections; each tile carries the arms that fall inside it.
      const M = m.toFixed(3), Ma = (m - a).toFixed(3);
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${M}' height='${M}'><path d='M0 .5H${a + 1}M.5 0V${a + 1}M${Ma} .5H${M}M.5 ${Ma}V${M}' stroke='#5eb3f2' stroke-opacity='.32' fill='none'/></svg>`;
      css.setProperty('--bp-plus', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    }
    layout();
    window.addEventListener('resize', layout, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

    const canvas = document.getElementById('amr');
    if (!canvas || !HOVER || REDUCED) return;
    const ctx = canvas.getContext('2d');
    const R1 = 150, R2 = 80, UP = 0.16, DOWN = 0.045;
    const cells = new Map();                      // "i,j" → { i, j, a: level-1 alpha, c: four level-2 alphas }
    let W = 0, H = 0, px = -1e4, py = -1e4, cx = -1e4, cy = -1e4, glow = 0, lastScroll = -1e9, raf = 0;

    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const fadeX = (x) => { const d = Math.max(g.x0 - x, x - (g.x0 + g.w), 0); return d >= FADE ? 0 : 1 - d / FADE; };
    // Does the square at (x, y) with side s come within r of the refinement centre?
    const near = (x, y, s, r) => { const dx = Math.max(x - cx, 0, cx - x - s), dy = Math.max(y - cy, 0, cy - y - s); return dx * dx + dy * dy < r * r; };
    const ease = (v, on) => (on ? Math.min(1, v + UP) : Math.max(0, v - DOWN));

    function frame(now) {
      raf = 0;
      const sy = window.scrollY, still = now - lastScroll > 160, on = px > -1e3 && still;
      const tx = px, ty = py + sy;                 // cursor in document coordinates
      if (on) {
        if (Math.hypot(tx - cx, ty - cy) > R1) { cx = tx; cy = ty; }   // jump, don't streak across the page
        else { cx += (tx - cx) * 0.3; cy += (ty - cy) * 0.3; }
      }
      glow += ((on ? 1 : 0) - glow) * 0.12;
      const s = g.cell, h = s / 2;
      if (on) {
        const i0 = Math.floor((cx - R1 - g.x0) / s), i1 = Math.floor((cx + R1 - g.x0) / s);
        const j0 = Math.floor((cy - R1 - g.y0) / s), j1 = Math.floor((cy + R1 - g.y0) / s);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = i + ',' + j;
          if (!cells.has(k) && near(g.x0 + i * s, g.y0 + j * s, s, R1)) cells.set(k, { i, j, a: 0, c: [0, 0, 0, 0] });
        }
      }
      let busy = !still || Math.abs(glow - (on ? 1 : 0)) > 0.01 || (on && Math.hypot(tx - cx, ty - cy) > 0.5);

      ctx.clearRect(0, 0, W, H);
      if (glow > 0.01) {
        const gx = cx, gy = cy - sy, r = R1 * 1.7, f = fadeX(gx);
        const grd = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
        grd.addColorStop(0, `rgba(94,179,242,${(0.06 * glow * f).toFixed(4)})`);
        grd.addColorStop(1, 'rgba(94,179,242,0)');
        ctx.fillStyle = grd; ctx.fillRect(gx - r, gy - r, 2 * r, 2 * r);
      }
      ctx.lineWidth = 1; ctx.strokeStyle = '#5eb3f2'; ctx.fillStyle = '#5eb3f2';
      for (const [k, c] of cells) {
        const x = g.x0 + c.i * s, y = g.y0 + c.j * s;
        const t = on && near(x, y, s, R1);
        const a = ease(c.a, t); if (a !== c.a) busy = true; c.a = a;
        let alive = a > 0;
        for (let q = 0; q < 4; q++) {
          const v = ease(c.c[q], t && near(x + (q & 1) * h, y + (q >> 1) * h, h, R2));
          if (v !== c.c[q]) busy = true;
          c.c[q] = v; if (v > 0) alive = true;
        }
        if (!alive && !t) { cells.delete(k); continue; }
        const f = fadeX(x + h), yy = y - sy;
        if (f <= 0 || yy > H || yy + s < 0) continue;
        if (a > 0) {                                // level 1: split the cell into four
          ctx.globalAlpha = 0.14 * a * f;
          const lx = Math.floor(x + h) + 0.5, ly = Math.floor(yy + h) + 0.5;
          ctx.beginPath(); ctx.moveTo(lx, yy); ctx.lineTo(lx, yy + s); ctx.moveTo(x, ly); ctx.lineTo(x + s, ly); ctx.stroke();
        }
        for (let q = 0; q < 4; q++) {               // level 2: split each quarter again
          const v = c.c[q]; if (v <= 0) continue;
          const qx = x + (q & 1) * h, qy = yy + (q >> 1) * h, qh = h / 2;
          ctx.globalAlpha = 0.035 * v * f; ctx.fillRect(qx, qy, h, h);
          ctx.globalAlpha = 0.11 * v * f;
          const lx = Math.floor(qx + qh) + 0.5, ly = Math.floor(qy + qh) + 0.5;
          ctx.beginPath(); ctx.moveTo(lx, qy); ctx.lineTo(lx, qy + h); ctx.moveTo(qx, ly); ctx.lineTo(qx + h, ly); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      if (busy) kick();
    }

    const resize = () => { [W, H] = fitCanvas(canvas, ctx); kick(); };
    resize();
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { px = e.clientX; py = e.clientY; kick(); } }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { px = py = -1e4; kick(); });
    window.addEventListener('blur', () => { px = py = -1e4; kick(); });
    window.addEventListener('scroll', () => { lastScroll = performance.now(); kick(); }, { passive: true });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     1. Hero — line field
     ═════════════════════════════════════════════════════════════════════════ */
  function initField() {
    const canvas = document.getElementById('wave');
    const hero   = document.getElementById('top');
    if (!canvas || !hero) return;
    const ctx = canvas.getContext('2d');

    const GAP = 12, STEP = 8, CELL = 6;        // line spacing, sample step, sim cell (px)
    const C2 = 0.45, DAMP = 0.985, SPONGE = 10; // wave equation: c²dt²/dx², damping, absorbing edge
    const RIPPLE = 30, LENS_R = 150, LENS = 22; // px per unit displacement; lens radius and strength

    let W = 0, H = 0, gw = 0, gh = 0;
    let u0, u1, u2, sponge, lines = [], xs = [], env = [], grad;

    const hudGrid = document.getElementById('hud-grid');
    const hudFps  = document.getElementById('hud-fps');
    const hudT    = document.getElementById('hud-t');

    function resize() {
      const r = hero.getBoundingClientRect();
      const nw = Math.max(1, r.width | 0), nh = Math.max(1, r.height | 0);
      if (nw === W && nh === H) return;
      W = nw; H = nh;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      gw = Math.ceil(W / CELL) + 2; gh = Math.ceil(H / CELL) + 2;
      u0 = new Float32Array(gw * gh); u1 = new Float32Array(gw * gh); u2 = new Float32Array(gw * gh);
      sponge = new Float32Array(gw * gh);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const d = Math.min(x, y, gw - 1 - x, gh - 1 - y);
        const t = clamp(d / SPONGE, 0, 1);
        sponge[y * gw + x] = 0.86 + 0.14 * (1 - (1 - t) * (1 - t));
      }

      lines = [];
      for (let y = (H % GAP) / 2; y <= H; y += GAP) lines.push(y);
      // Turbulence envelope: 1 on the left, easing to 0 past ~70% of the width.
      xs = []; env = [];
      for (let x = 0; x <= W + STEP; x += STEP) { xs.push(x); env.push(1 - smooth(clamp((x - W * 0.26) / (W * 0.46), 0, 1))); }

      grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, 'rgba(94,179,242,0.34)');
      grad.addColorStop(0.55, 'rgba(94,179,242,0.42)');
      grad.addColorStop(1, 'rgba(94,179,242,0.58)');
      if (hudGrid) hudGrid.textContent = `${gw}×${gh}`;
    }

    function splash(cx, cy, amp, rad) {
      cx |= 0; cy |= 0;
      const r2 = rad * rad;
      for (let y = -rad; y <= rad; y++) {
        const yy = cy + y; if (yy < 1 || yy >= gh - 1) continue;
        for (let x = -rad; x <= rad; x++) {
          const xx = cx + x; if (xx < 1 || xx >= gw - 1) continue;
          const d2 = x * x + y * y; if (d2 > r2) continue;
          u1[yy * gw + xx] += amp * (1 - d2 / r2);
        }
      }
    }

    function stepSim() {
      for (let y = 1; y < gh - 1; y++) {
        const row = y * gw;
        for (let x = 1; x < gw - 1; x++) {
          const i = row + x;
          const lap = u1[i - 1] + u1[i + 1] + u1[i - gw] + u1[i + gw] - 4 * u1[i];
          u2[i] = (2 * u1[i] - u0[i] + C2 * lap) * DAMP * sponge[i];
        }
      }
      const tmp = u0; u0 = u1; u1 = u2; u2 = tmp;
    }

    function sampleU(x, y) {
      const fx = x / CELL, fy = y / CELL;
      const ix = fx | 0, iy = fy | 0;
      if (ix < 0 || iy < 0 || ix >= gw - 1 || iy >= gh - 1) return 0;
      const tx = fx - ix, ty = fy - iy, i = iy * gw + ix;
      return (u1[i] * (1 - tx) + u1[i + 1] * tx) * (1 - ty) + (u1[i + gw] * (1 - tx) + u1[i + gw + 1] * tx) * ty;
    }

    // ── Pointer: an eased lens, not an injection. Clicks send a wave.
    let px = -1e4, py = -1e4, mx = -1e4, my = -1e4, lens = 0, lensTarget = 0;
    const local = (e) => { const r = hero.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    if (HOVER) {
      hero.addEventListener('pointermove', (e) => { [px, py] = local(e); lensTarget = 1; });
      hero.addEventListener('pointerleave', () => { lensTarget = 0; });
    }
    hero.addEventListener('pointerdown', (e) => {
      if (e.target.closest('a, button')) return;
      const [x, y] = local(e);
      splash(x / CELL, y / CELL, 1.6, 4);
    });

    // Ambient life, as in the first version: two slow coherent emitters plus random drops.
    let t = 0, nextRipple = 90;
    function ambient() {
      if (REDUCED) return;
      const a = 0.045;
      splash(gw * 0.2, gh * 0.72, Math.sin(t * 0.085) * a, 3);
      splash(gw * 0.78, gh * 0.3, Math.sin(t * 0.085 + 2.1) * a, 3);
      if (t >= nextRipple) {
        splash(gw * (0.1 + Math.random() * 0.8), gh * (0.15 + Math.random() * 0.7), 1.2 + Math.random() * 0.8, 4 + ((Math.random() * 2) | 0));
        nextRipple = t + 110 + Math.random() * 160;
      }
    }
    function draw(time) {
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      ctx.strokeStyle = grad;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const R2 = LENS_R * LENS_R, useLens = lens > 0.002;
      for (let li = 0; li < lines.length; li++) {
        const y0 = lines[li];
        const p1 = y0 * 0.012, p2 = y0 * 0.02, p3 = y0 * 0.01;
        for (let k = 0; k < xs.length; k++) {
          const x = xs[k], e = env[k];
          let dy = 0;
          if (e > 0.001) {
            dy = e * (9 * Math.sin(x * 0.011 + time * 0.9 + p1)
                    + 6 * Math.sin(x * 0.021 - time * 0.6 + p2)
                    + 4 * Math.sin(x * 0.034 + time * 0.4 - p3));
          }
          if (useLens) {
            const dx = x - mx, dyy = y0 - my, d2 = dx * dx + dyy * dyy;
            if (d2 < R2 * 5) dy += lens * LENS * (dyy / LENS_R) * Math.exp(-d2 / R2);
          }
          dy += RIPPLE * sampleU(x, y0);
          k === 0 ? ctx.moveTo(x, y0 + dy) : ctx.lineTo(x, y0 + dy);
        }
      }
      ctx.stroke();
    }

    let frames = 0, fpsClock = performance.now(), start = fpsClock;
    function tick(now) {
      if (mx < -1e3) { mx = px; my = py; } else { mx += (px - mx) * 0.12; my += (py - my) * 0.12; }
      lens += (lensTarget - lens) * 0.08;
      ambient();
      stepSim();
      draw(REDUCED ? 0 : now / 1000);
      t++; frames++;
      if (now - fpsClock >= 1000) {
        if (hudFps) hudFps.textContent = String(frames);
        if (hudT)   hudT.textContent = ((now - start) / 1000).toFixed(1);
        frames = 0; fpsClock = now;
      }
    }

    resize();
    window.addEventListener('resize', resize, { passive: true });
    visibleLoop(hero, tick);
  }

  /* ═════════════════════════════════════════════════════════════════════════
     2. Brand mark — generate the wavy bands of the symbol
     ═════════════════════════════════════════════════════════════════════════ */
  function initMark() {
    const g = document.getElementById('mark-waves');
    if (!g) return;
    const L = 68, A = 8.5;
    // Smooth S-curves between alternating extrema read as a sine wave; the path
    // extends two wavelengths past both edges so the CSS translate loops seamlessly.
    const wave = (y0, phase) => {
      const h = L / 2;
      let x = -L * 2 + phase, up = true, d = `M${x} ${(y0 - A).toFixed(2)}`;
      while (x < 256 + L) {
        const nx = x + h, ya = up ? y0 - A : y0 + A, yb = up ? y0 + A : y0 - A;
        d += ` C${(x + h / 2).toFixed(2)} ${ya.toFixed(2)}, ${(x + h / 2).toFixed(2)} ${yb.toFixed(2)}, ${nx.toFixed(2)} ${yb.toFixed(2)}`;
        x = nx; up = !up;
      }
      return d;
    };
    [[77.1, 0], [111, 14], [145, 28], [178.9, 42]].forEach(([y, ph]) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', wave(y, ph));
      g.appendChild(p);
    });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     2b. The mark in 3D: a frosted glass shell around a ball of water. A
         fragment shader intersects each pixel's ray with the two spheres
         (orthographic, so head-on the pattern matches the 2D mark). The
         mark's bands are frosted glass that blurs the water behind; its
         dark lines are open slots through which the water shows sharp,
         rippling and reflecting a small studio. The shell turns slowly from
         left to right; lines on the left half carry waves that straighten as
         they pass under the central split. Falls back to the SVG mark
         without WebGL, and is skipped when motion is reduced.
     ═════════════════════════════════════════════════════════════════════════ */
  function initGlobe() {
    const hero = document.getElementById('top');
    const host = document.querySelector('.hero-mark');
    const mark = host && host.querySelector('.mark');
    if (!hero || !mark || REDUCED) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'mark-gl';
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl || !gl.getExtension('OES_standard_derivatives')) return;

    const FS = `#extension GL_OES_standard_derivatives : enable
      precision highp float;
      uniform vec2 uRes;
      uniform float uTime, uSpin, uScale, uGrain;   // uGrain: the sphere's radius in device pixels
      uniform mat3 uTilt;                 // view space → the globe's own frame
      // Geometry of the 2D mark, in units of its radius.
      const float HW = 0.0521;            // half width of a dark line, now an opening in the glass
      const float SEAM = 0.0383;          // half width of the central split
      const float AMP = 0.0904;           // wave amplitude
      const float CORE = 0.78;            // radius of the water ball inside the shell
      const float RIN = 0.955;            // inner radius of the glass shell, so it is 4.5% thick
      const float DRAFT = 0.028;          // each slot is this much narrower per side at the inner surface
      const vec3 ICE = vec3(0.929, 0.957, 0.980), SKY = vec3(0.369, 0.702, 0.949), BLUE = vec3(0.071, 0.392, 0.643);
      const vec3 KEY = vec3(-0.5, 0.62, 0.6);   // the main light: up, left and in front

      // Distance to one wavy line, measured across the line rather than vertically, so the
      // stroke keeps its width on the steep parts of the wave as the SVG stroke does.
      float wave(float dy, float amp, float w) {
        float slope = amp * 9.0 * cos(w);
        return abs(dy + amp * sin(w)) / sqrt(1.0 + slope * slope) - HW;
      }

      // Signed distance from p (on the unit sphere) to the nearest dark line:
      // negative inside a line, positive on a band.
      float lines(vec3 p) {
        float c = cos(uSpin), s = sin(uSpin);
        float lon = atan(c * p.x - s * p.z, s * p.x + c * p.z);     // longitude on the turning globe
        float amp = AMP * (1.0 - smoothstep(-SEAM, SEAM, p.x));      // waves only left of the split
        float w = 9.0 * lon - 0.4 * uTime;
        float d = wave(p.y - 0.5415, amp, w);
        d = min(d, wave(p.y - 0.1809, amp, w + 1.29));
        d = min(d, wave(p.y + 0.1809, amp, w + 2.59));
        d = min(d, wave(p.y + 0.5415, amp, w + 3.88));
        return min(d, abs(p.x) - SEAM);
      }

      float hash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }

      // What the water reflects: a dark studio with a four-pane window up and to the left, a cool
      // strip light on the right and a faint horizon. soft widens every edge, for the frosted view.
      vec3 env(vec3 d, float soft) {
        vec3 c = mix(vec3(0.012, 0.03, 0.05), vec3(0.05, 0.12, 0.2), smoothstep(-0.5, 0.9, d.y));
        float win = smoothstep(-0.95 - soft, -0.8 + soft, d.x) * (1.0 - smoothstep(-0.2 - soft, -0.05 + soft, d.x))
                  * smoothstep(0.35 - soft, 0.48 + soft, d.y) * (1.0 - smoothstep(0.86 - soft, 0.97 + soft, d.y))
                  * smoothstep(-0.1, 0.1, d.z);
        float bars = max(1.0 - smoothstep(0.0, 0.018, abs(d.x + 0.5)), 1.0 - smoothstep(0.0, 0.018, abs(d.y - 0.66)));
        c += vec3(0.9, 0.95, 1.0) * win * (1.0 - 0.85 * bars * (1.0 - smoothstep(0.0, 0.1, soft))) * (2.4 - 3.2 * soft);
        float strip = smoothstep(0.72 - soft, 0.9 + soft, d.x) * (1.0 - smoothstep(0.25 - soft, 0.45 + soft, abs(d.y - 0.05)));
        c += SKY * strip * 1.1;
        c += SKY * 0.12 * (1.0 - smoothstep(0.0, 0.06 + soft, abs(d.y + 0.15)));
        return c;
      }

      // The water ball: slow ripples bend its normals, Fresnel mixes the reflected studio over a
      // deep blue body that glows where light passes through to the far side, and the key light glints.
      vec3 water(vec3 nb) {
        vec3 k1 = vec3(7.0, 2.0, 1.5), k2 = vec3(-3.0, 8.0, 2.5), k3 = vec3(4.0, -5.0, 9.0);
        vec3 g = 0.02 * k1 * cos(dot(k1, nb) + 1.3 * uTime) + 0.015 * k2 * cos(dot(k2, nb) - 1.1 * uTime)
               + 0.01 * k3 * cos(dot(k3, nb) + 1.7 * uTime);
        vec3 n = normalize(nb - (g - nb * dot(g, nb)));
        vec3 R = reflect(vec3(0.0, 0.0, -1.0), n);
        float F = 0.18 + 0.82 * pow(1.0 - max(n.z, 0.0), 5.0);
        float glow = pow(max(dot(nb, -normalize(KEY)), 0.0), 1.5);
        vec3 body = mix(vec3(0.03, 0.12, 0.22), BLUE, 0.3 + 0.5 * glow);
        return mix(body, env(R, 0.0), F) + vec3(2.5 * pow(max(dot(R, normalize(KEY)), 0.0), 220.0));
      }
      vec3 waterSoft(vec3 nb) {                // the same ball seen through frost: no ripples, no glint
        float F = 0.18 + 0.82 * pow(1.0 - max(nb.z, 0.0), 5.0);
        float glow = pow(max(dot(nb, -normalize(KEY)), 0.0), 1.5);
        vec3 body = mix(vec3(0.03, 0.12, 0.22), BLUE, 0.3 + 0.5 * glow);
        return mix(body, env(reflect(vec3(0.0, 0.0, -1.0), nb), 0.25), F);
      }

      // Inside the glass: between the shell's two surfaces and outside the slots. The slots are cut
      // with a draft, the mark's width at the outer surface and narrower toward the inner one, so
      // this is > 0 in glass and its gradient is the true normal of the glass's surface.
      float glassAt(vec3 p) {
        float rho = length(p);
        return lines(p / rho) + DRAFT * clamp((1.0 - rho) / (1.0 - RIN), 0.0, 1.0);
      }

      void main() {
        vec2 q = (gl_FragCoord.xy / uRes * 2.0 - 1.0) * uScale;
        float r = length(q), px = fwidth(r);
        float cover = 1.0 - smoothstep(1.0 - px, 1.0 + px, r);
        float zf = sqrt(max(0.0, 1.0 - r * r));
        vec3 n = vec3(q, zf), L = normalize(KEY);

        // Where the ray meets the outer surface: glass (the mark's bands) or a slot.
        vec3 ps = uTilt * n;
        float d = lines(ps), dw = fwidth(d) + 1e-4;
        float tOut = smoothstep(-dw, dw, d);

        // Through a slot, trace the ray down through the shell's thickness (to the inner surface,
        // or right through the shell near the rim) for the first point inside glass: a slot wall.
        // The deepest reach into glass along the ray also antialiases where walls give way to
        // clear openings; bisection pins down the hit, and the glass's gradient there is the
        // wall's normal.
        float inner = 1.0 - smoothstep(RIN - px, RIN + px, r);
        float most = -1.0, depth = 0.0;
        vec3 nw = n;
        if (d < 4.0 * dw && r < 1.0 + 4.0 * px) {                       // only pixels in or beside a slot pay for this
          vec3 o = uTilt * vec3(q, 2.0), dir = uTilt * vec3(0.0, 0.0, -1.0);
          float t0 = 2.0 - zf, t1 = r < RIN ? 2.0 - sqrt(RIN * RIN - r * r) : 2.0 + zf;
          float lo = t0, hi = t1, found = 0.0;
          for (int i = 1; i <= 16; i++) {
            float t = t0 + (t1 - t0) * float(i) / 16.0;
            float g = glassAt(o + t * dir);
            most = max(most, g);
            if (found < 0.5 && g > 0.0) { hi = t; found = 1.0; }
            if (found < 0.5) lo = t;
          }
          for (int i = 0; i < 5; i++) {
            float mid = 0.5 * (lo + hi);
            if (glassAt(o + mid * dir) > 0.0) hi = mid; else lo = mid;
          }
          vec3 ph = o + hi * dir;
          float e = 0.0015, g0 = glassAt(ph);
          vec3 gs = vec3(glassAt(ph + vec3(e, 0.0, 0.0)) - g0, glassAt(ph + vec3(0.0, e, 0.0)) - g0, glassAt(ph + vec3(0.0, 0.0, e)) - g0);
          vec3 ns = -normalize(gs + 1e-7);                                 // out of the glass, in the globe's frame
          nw = normalize(vec3(dot(uTilt[0], ns), dot(uTilt[1], ns), dot(uTilt[2], ns)));   // back to view space
          depth = clamp((1.0 - length(ph)) / (1.0 - RIN), 0.0, 1.0);        // 0 at the outer edge, 1 at the inner
        }
        float mw = fwidth(most) + 1e-4;
        float wall = (1.0 - tOut) * smoothstep(-mw, mw, most);
        float open = (1.0 - tOut) - wall;

        float db = lines(uTilt * vec3(q, -zf)), bw = fwidth(db) + 1e-4;
        float farBand = smoothstep(-bw, bw, db);

        // The water ball: sharp through the openings, soft-edged and blurred through the frost.
        vec3 nb = vec3(q, sqrt(max(0.0, CORE * CORE - r * r))) / CORE;
        float ball = 1.0 - smoothstep(CORE - px, CORE + px, r);
        float ballSoft = 1.0 - smoothstep(CORE - 0.07, CORE + 0.05, r);
        vec3 farFrost = vec3(0.3, 0.38, 0.48);                        // the far side of the shell, from inside

        // Through an opening: the ball, else the inside of the far glass, else the page.
        float openA = mix(farBand * 0.6, 1.0, ball) * inner;
        vec3 openCol = mix(farFrost * farBand * 0.6, water(nb), ball) * inner;   // premultiplied

        // Through the frost: what lies behind, blurred, under milky, grainy glass with a soft sheen.
        float behindA = mix(0.45, 1.0, ballSoft);
        vec3 behind = mix(farFrost * 0.45, waterSoft(nb), ballSoft);
        float c = cos(uSpin), s = sin(uSpin);
        float grain = hash(floor(vec3(c * ps.x - s * ps.z, ps.y, s * ps.x + c * ps.z) * uGrain)) - 0.5;   // about one device pixel per grain
        float fres = pow(1.0 - zf, 3.0);
        float op = mix(0.95, 0.4 + 0.35 * fres, inner);               // frost thickens toward the rim, and at the edge
        vec3 frost = vec3(0.8, 0.87, 0.94) * (0.78 + 0.22 * max(dot(n, L), 0.0)) + grain * 0.05;
        vec3 glassCol = frost * op + behind * (1.0 - op) + SKY * fres * 0.45
                      + 0.25 * pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 10.0)
                      + ICE * 0.25 * exp(-max(d, 0.0) / 0.01);        // light catching the slot's edge
        float glassA = op + behindA * (1.0 - op);

        // A slot's wall: the face of the glass's thickness, lit through its true normal, with a
        // polished glint, a bright lip along its top edge and a contact shadow toward the bottom.
        float glint = pow(max(dot(reflect(-L, nw), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
        float lip = exp(-depth / 0.15), ao = 1.0 - 0.45 * smoothstep(0.55, 1.0, depth);
        vec3 wallCol = ((vec3(0.78, 0.86, 0.93) * (0.25 + 0.75 * max(dot(nw, L), 0.0)) + SKY * 0.1 + glint * 0.45) * ao + ICE * 0.35 * lip) * 0.94;

        gl_FragColor = vec4(glassCol * tOut + wallCol * wall + openCol * open,
                            glassA * tOut + 0.94 * wall + openA * open) * cover;
      }`;
    const U = glShaderPass(gl, FS, ['uRes', 'uTime', 'uSpin', 'uScale', 'uGrain', 'uTilt']);
    if (!U) return;
    gl.uniform1f(U.uScale, 256 / 188);                       // the 2D mark's circle: r = 94 in a 256 box
    gl.clearColor(0, 0, 0, 0);

    mark.appendChild(canvas);
    host.classList.add('gl');
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); canvas.remove(); host.classList.remove('gl'); });

    // The cursor tilts the globe towards itself; without one, a slow wobble shows the depth,
    // easing in after the first few seconds so the page opens on the flat mark.
    let yaw = 0, pitch = 0, tYaw = 0, tPitch = 0, steer = false, time = 0, last = 0;
    if (HOVER) {
      hero.addEventListener('pointermove', (e) => {
        const r = hero.getBoundingClientRect();
        tYaw = ((e.clientX - r.left) / r.width - 0.5) * 0.6;
        tPitch = ((e.clientY - r.top) / r.height - 0.5) * 0.44;
        steer = true;
      });
      hero.addEventListener('pointerleave', () => { steer = false; });
    }
    const tilt = new Float32Array(9);

    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uGrain, canvas.width * 0.5 * 188 / 256);
    }

    function tick(now) {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now; time += dt;
      const idle = steer ? 0 : smooth(clamp((time - 2.5) / 3, 0, 1));
      yaw += ((steer ? tYaw : 0.16 * Math.sin(time * 0.23) * idle) - yaw) * 0.05;
      pitch += ((steer ? tPitch : -0.09 * Math.sin(time * 0.17 + 1.2) * idle) - pitch) * 0.05;
      // uTilt = (Rx(pitch) · Ry(yaw))ᵀ, column-major: its columns are the rows of the rotation.
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      tilt.set([cy, 0, sy, sp * sy, cp, -sp * cy, -cp * sy, sp, cp * cy]);
      gl.uniformMatrix3fv(U.uTilt, false, tilt);
      gl.uniform1f(U.uTime, time);
      gl.uniform1f(U.uSpin, time * 0.12);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    resize();
    new ResizeObserver(resize).observe(canvas);
    visibleLoop(hero, tick);
  }

  /* ═════════════════════════════════════════════════════════════════════════
     3. Pipeline stage — one signal through six steps
     ═════════════════════════════════════════════════════════════════════════ */
  function initStage() {
    const canvas = document.getElementById('stage');
    if (!canvas) return { setScroll() {} };
    const ctx = canvas.getContext('2d');
    const label = document.getElementById('stage-label');
    const NAMES = ['Observe and encode', 'Infer the hidden state', 'Discover the dynamics', 'Verify', 'Simulate', 'Design and control'];
    const TARGETS = [
      { dots: 1,    curve: 0, band: 0,    eq: 0,   checks: 0,   evolve: 0, futures: 0, design: 0 },
      { dots: 1,    curve: 1, band: 1,    eq: 0,   checks: 0,   evolve: 0, futures: 0, design: 0 },
      { dots: 0.35, curve: 1, band: 0.6,  eq: 1,   checks: 0,   evolve: 0, futures: 0, design: 0 },
      { dots: 0,    curve: 1, band: 0.22, eq: 0.5, checks: 1,   evolve: 0, futures: 0, design: 0 },
      { dots: 0,    curve: 1, band: 0.4,  eq: 0,   checks: 0,   evolve: 1, futures: 1, design: 0 },
      { dots: 0,    curve: 1, band: 0.22, eq: 0,   checks: 0.5, evolve: 0, futures: 0, design: 1 },
    ];
    const P = { ...TARGETS[0], curve: 0 };
    const N = 140, PAD = 22;
    const truth = (x, ph) => 0.5 + 0.26 * Math.sin(6.283 * (x * 1.25 - ph) + 0.6) + 0.1 * Math.sin(6.283 * (x * 3.1 - ph * 1.7));
    const bump  = (x) => Math.exp(-(((x - 0.6) / 0.11) ** 2));
    const rnd = mulberry32(7);
    const S = []; for (let i = 0; i < 20; i++) S.push([0.03 + 0.94 * rnd(), (rnd() - 0.5) * 0.14]);
    const FUT = [[0.32, 2.1], [-0.28, 2.9], [0.2, 3.7]];

    let W = 0, H = 0, phase = 0, active = -1, scrollActive = 0, hover = -1;
    const X = (x) => PAD + x * (W - 2 * PAD);
    const Y = (v) => H - PAD - v * (H - 2 * PAD);
    const curveV = (x) => truth(x, phase) + P.design * bump(x) * 0.2;

    function set(i) { if (i === active) return; active = i; if (label) label.textContent = `${i + 1}. ${NAMES[i]}`; }

    function path(fn, close) {
      ctx.beginPath();
      for (let i = 0; i <= N; i++) { const x = i / N; const y = Y(fn(x)); i ? ctx.lineTo(X(x), y) : ctx.moveTo(X(x), y); }
      if (close) close();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(140,190,240,0.07)'; ctx.lineWidth = 1;
      for (let k = 0; k <= 4; k++) { const y = PAD + (k / 4) * (H - 2 * PAD); ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke(); }
      for (let k = 0; k <= 6; k++) { const x = PAD + (k / 6) * (W - 2 * PAD); ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, H - PAD); ctx.stroke(); }

      if (P.band > 0.01 && P.curve > 0.01) {
        const w = 0.09 * P.band;
        ctx.beginPath();
        for (let i = 0; i <= N; i++) { const x = i / N; i ? ctx.lineTo(X(x), Y(curveV(x) + w)) : ctx.moveTo(X(x), Y(curveV(x) + w)); }
        for (let i = N; i >= 0; i--) { const x = i / N; ctx.lineTo(X(x), Y(curveV(x) - w)); }
        ctx.closePath();
        ctx.fillStyle = `rgba(94,179,242,${0.12 * P.curve})`;
        ctx.fill();
      }
      if (P.futures > 0.01) {
        for (const [s, f] of FUT) {
          path((x) => curveV(x) + s * 0.1 * x * Math.sin(6.283 * (x * f - phase * 0.8)));
          ctx.strokeStyle = `rgba(201,230,255,${0.3 * P.futures})`; ctx.lineWidth = 1; ctx.stroke();
        }
      }
      if (P.design > 0.01) {
        path((x) => truth(x, phase) + bump(x) * 0.2);
        ctx.setLineDash([4, 5]); ctx.strokeStyle = `rgba(237,244,250,${0.5 * P.design})`; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      }
      if (P.curve > 0.01) {
        path(curveV);
        ctx.shadowColor = 'rgba(201,230,255,0.6)'; ctx.shadowBlur = 8;
        ctx.strokeStyle = `rgba(201,230,255,${P.curve})`; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.shadowBlur = 0;
      }
      if (P.dots > 0.01) {
        ctx.fillStyle = `rgba(94,179,242,${P.dots})`; ctx.strokeStyle = `rgba(94,179,242,${0.35 * P.dots})`; ctx.lineWidth = 1;
        for (const [x, n] of S) {
          const cx = X(x), cy = Y(truth(x, 0) + n);
          ctx.beginPath(); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx, cy, 2.4, 0, 6.283); ctx.fill();
        }
      }
      ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
      ctx.textBaseline = 'top';
      if (P.eq > 0.01) {
        ctx.textAlign = 'right'; ctx.fillStyle = `rgba(237,244,250,${0.85 * P.eq})`;
        ctx.fillText('∂ₜu = −u ∂ₓu + ν ∂ₓₓu + ε(x)', W - PAD, PAD + 2);
      }
      if (P.checks > 0.01) {
        ctx.textAlign = 'left';
        let x = PAD;
        for (const s of ['conservation ✓', 'stability ✓', 'calibrated ✓']) {
          const w = ctx.measureText(s).width + 16;
          ctx.fillStyle = `rgba(94,179,242,${0.12 * P.checks})`; ctx.strokeStyle = `rgba(94,179,242,${0.45 * P.checks})`;
          ctx.beginPath(); ctx.roundRect(x, H - PAD - 22, w, 20, 10); ctx.fill(); ctx.stroke();
          ctx.fillStyle = `rgba(201,230,255,${P.checks})`; ctx.fillText(s, x + 8, H - PAD - 18);
          x += w + 8;
        }
      }
    }

    function tick() {
      if (!W) return;
      const T = TARGETS[active < 0 ? 0 : active];
      for (const k in P) P[k] += (T[k] - P[k]) * 0.07;
      if (P.evolve > 0.01 && !REDUCED) phase += 0.0025 * P.evolve;
      draw();
    }

    const resize = () => { [W, H] = fitCanvas(canvas, ctx); };
    resize();
    new ResizeObserver(resize).observe(canvas);
    visibleLoop(canvas, tick);

    const steps = [...document.querySelectorAll('#steps .step')];
    if (HOVER) steps.forEach((s, i) => {
      s.addEventListener('pointerenter', () => { hover = i; set(i); });
      s.addEventListener('pointerleave', () => { hover = -1; set(scrollActive); });
    });
    steps.forEach((s, i) => s.addEventListener('click', () => { scrollActive = i; set(i); }));
    set(0);
    return { setScroll(i) { scrollActive = i; if (hover < 0) set(i); } };
  }

  /* ═════════════════════════════════════════════════════════════════════════
     4a. Engine card — paintable 2D heat equation
     ═════════════════════════════════════════════════════════════════════════ */
  function initHeat() {
    const canvas = document.getElementById('heat');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    const CELL = 4, ALPHA = 0.21, DECAY = 0.996;
    let W = 0, H = 0, gw = 0, gh = 0, u, v, img, buf;

    // navy → brand blue → sky → ice → white
    const stops = [[7, 19, 31], [18, 100, 164], [94, 179, 242], [201, 230, 255], [255, 255, 255]];
    const lut = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * 4, s = Math.min(3, t | 0), f = t - s;
      const a = stops[s], b = stops[s + 1];
      const r = a[0] + (b[0] - a[0]) * f, g = a[1] + (b[1] - a[1]) * f, bl = a[2] + (b[2] - a[2]) * f;
      lut[i] = 0xff000000 | (bl << 16) | (g << 8) | r;
    }

    function resize() {
      [W, H] = fitCanvas(canvas, ctx);
      gw = Math.ceil(W / CELL); gh = Math.ceil(H / CELL);
      off.width = gw; off.height = gh;
      u = new Float32Array(gw * gh); v = new Float32Array(gw * gh);
      img = octx.createImageData(gw, gh); buf = new Uint32Array(img.data.buffer);
      for (let k = 0; k < 4; k++) paint(gw * (0.15 + Math.random() * 0.7), gh * (0.2 + Math.random() * 0.6), 1.1, 7);
    }

    function paint(cx, cy, amp, rad) {
      cx |= 0; cy |= 0;
      const r2 = rad * rad;
      for (let y = -rad; y <= rad; y++) {
        const yy = cy + y; if (yy < 0 || yy >= gh) continue;
        for (let x = -rad; x <= rad; x++) {
          const xx = cx + x; if (xx < 0 || xx >= gw) continue;
          const d2 = x * x + y * y; if (d2 > r2) continue;
          const i = yy * gw + xx;
          u[i] = Math.min(1.4, u[i] + amp * (1 - d2 / r2));
        }
      }
    }

    let lastInput = -1e9, px = -1, py = -1;
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / CELL, (e.clientY - r.top) / CELL]; };
    canvas.addEventListener('pointermove', (e) => {
      const [x, y] = local(e);
      const strong = e.buttons > 0 || e.pointerType !== 'mouse';
      if (px >= 0) {
        const n = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / 1.5));
        for (let i = 1; i <= n; i++) paint(px + (x - px) * i / n, py + (y - py) * i / n, (strong ? 0.5 : 0.16) / Math.sqrt(n), strong ? 5 : 3);
      } else paint(x, y, strong ? 0.5 : 0.16, 3);
      px = x; py = y; lastInput = performance.now();
    });
    canvas.addEventListener('pointerdown', (e) => { const [x, y] = local(e); paint(x, y, 1, 6); px = x; py = y; lastInput = performance.now(); });
    canvas.addEventListener('pointerleave', () => { px = py = -1; });

    let nextBlob = 0;
    function tick(now) {
      if (!W) return;
      if (!REDUCED && now - lastInput > 2500 && now > nextBlob) {
        paint(gw * (0.1 + Math.random() * 0.8), gh * (0.2 + Math.random() * 0.6), 0.9 + Math.random() * 0.5, 5);
        nextBlob = now + 700 + Math.random() * 900;
      }
      for (let k = 0; k < 2; k++) {
        for (let y = 0; y < gh; y++) {
          const row = y * gw, up = y > 0 ? row - gw : row, dn = y < gh - 1 ? row + gw : row;
          for (let x = 0; x < gw; x++) {
            const i = row + x, l = x > 0 ? i - 1 : i, r = x < gw - 1 ? i + 1 : i;
            v[i] = (u[i] + ALPHA * (u[l] + u[r] + u[up + x] + u[dn + x] - 4 * u[i])) * DECAY;
          }
        }
        const tmp = u; u = v; v = tmp;
      }
      for (let i = 0; i < gw * gh; i++) { let c = (u[i] * 255) | 0; buf[i] = lut[c > 255 ? 255 : c]; }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);
    }

    resize();
    new ResizeObserver(resize).observe(canvas);
    visibleLoop(canvas, tick);
  }

  /* ═════════════════════════════════════════════════════════════════════════
     4b. Engine card — particles in a Taylor–Green field, stirred by the cursor
     ═════════════════════════════════════════════════════════════════════════ */
  function initFlow() {
    const canvas = document.getElementById('flow');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const N = 520;
    const P = new Float32Array(N * 3);   // x, y, life (normalized coords)
    let W = 0, H = 0, mx = 0.5, my = 0.5, stir = 0, stirTarget = 0;

    const seed = (i) => { P[i * 3] = Math.random(); P[i * 3 + 1] = Math.random(); P[i * 3 + 2] = Math.random() * 200; };
    for (let i = 0; i < N; i++) seed(i);

    if (HOVER) {
      canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width; my = (e.clientY - r.top) / r.height; stirTarget = 1; });
      canvas.addEventListener('pointerleave', () => { stirTarget = 0; });
    }

    function tick() {
      if (!W) return;
      stir += (stirTarget - stir) * 0.08;
      ctx.fillStyle = 'rgba(7,19,31,0.14)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(94,179,242,0.85)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      const k = Math.PI * 2, G = 0.0007 * stir;
      for (let i = 0; i < N; i++) {
        const x = P[i * 3], y = P[i * 3 + 1];
        // Taylor–Green: u = sin(kx)cos(ky), v = −cos(kx)sin(ky) — plus a point vortex at the cursor
        let u = Math.sin(k * x) * Math.cos(k * y) * 0.0022, v = -Math.cos(k * x) * Math.sin(k * y) * 0.0022;
        if (G > 1e-6) {
          const dx = x - mx, dy = y - my, d2 = dx * dx + dy * dy + 0.004;
          const s = G * Math.exp(-d2 / 0.08) / d2;
          u += -dy * s; v += dx * s;
        }
        const nx = x + u, ny = y + v * (W / H);
        ctx.moveTo(x * W, y * H); ctx.lineTo(nx * W, ny * H);
        P[i * 3] = nx; P[i * 3 + 1] = ny;
        if (--P[i * 3 + 2] < 0 || nx < 0 || nx > 1 || ny < 0 || ny > 1) seed(i);
      }
      ctx.stroke();
    }

    const resize = () => { [W, H] = fitCanvas(canvas, ctx); ctx.fillStyle = '#07131f'; ctx.fillRect(0, 0, W, H); };
    resize();
    new ResizeObserver(resize).observe(canvas);
    visibleLoop(canvas, tick);
  }

  /* ═════════════════════════════════════════════════════════════════════════
     5. Lab — Tikhonov deconvolution
     ═════════════════════════════════════════════════════════════════════════ */
  function fft(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {           // bit-reversal permutation
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = 2 * Math.PI / len * (inverse ? 1 : -1);
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci;
          const ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr;        im[a] += ti;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  function initLab() {
    const canvas = document.getElementById('lab-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const noiseIn   = document.getElementById('noise');
    const lambdaIn  = document.getElementById('lambda');
    const noiseOut  = document.getElementById('noise-out');
    const lambdaOut = document.getElementById('lambda-out');
    const errEl     = document.getElementById('lab-err');
    const condEl    = document.getElementById('lab-cond');
    const statusEl  = document.getElementById('lab-status');

    const N = 256, TAU_K = 5;

    // Ground truth: smooth bump + box + narrow spike — features of three different scales.
    const truth = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / N;
      truth[i] =
        0.85 * Math.exp(-(((t - 0.24) / 0.05) ** 2)) +
        (t > 0.45 && t < 0.62 ? 0.7 : 0) +
        1.1 * Math.exp(-(((t - 0.8) / 0.018) ** 2));
    }

    // Periodic blur kernel: a two-sided exponential, e^(−|x|/τ). Its spectrum decays like 1/ω²,
    // so the inverse problem is badly conditioned (the naive inverse amplifies noise about 100×
    // at the highest frequency) but finite: it degrades in proportion to the noise instead of
    // overflowing, as a Gaussian blur's inverse would.
    const kRe = new Float64Array(N), kIm = new Float64Array(N);
    let ksum = 0;
    for (let i = 0; i < N; i++) { kRe[i] = Math.exp(-Math.min(i, N - i) / TAU_K); ksum += kRe[i]; }
    for (let i = 0; i < N; i++) kRe[i] /= ksum;
    fft(kRe, kIm, false);
    const kPow = new Float64Array(N);
    let kMax = 0, kMin = Infinity;
    for (let i = 0; i < N; i++) {
      kPow[i] = kRe[i] * kRe[i] + kIm[i] * kIm[i];
      if (kPow[i] > kMax) kMax = kPow[i];
      if (kPow[i] < kMin) kMin = kPow[i];
    }

    // Blurred truth (clean data), computed once.
    const bRe = Float64Array.from(truth), bIm = new Float64Array(N);
    fft(bRe, bIm, false);
    for (let i = 0; i < N; i++) {
      const r = bRe[i] * kRe[i] - bIm[i] * kIm[i];
      const m = bRe[i] * kIm[i] + bIm[i] * kRe[i];
      bRe[i] = r; bIm[i] = m;
    }
    fft(bRe, bIm, true);
    const blurred = Float64Array.from(bRe);

    // Fixed unit-variance noise vector so the sliders feel continuous.
    let seed = 1337;
    const noise = new Float64Array(N);
    function reroll() {
      const rnd = mulberry32(seed++);
      for (let i = 0; i < N; i += 2) {
        const u = rnd() || 1e-12, v = rnd();
        const m = Math.sqrt(-2 * Math.log(u));
        noise[i] = m * Math.cos(2 * Math.PI * v);
        if (i + 1 < N) noise[i + 1] = m * Math.sin(2 * Math.PI * v);
      }
    }
    reroll();

    const data = new Float64Array(N), rec = new Float64Array(N);
    const yRe = new Float64Array(N), yIm = new Float64Array(N);
    // Kᵀy in the Fourier domain, shared by every method.
    const fyRe = new Float64Array(N), fyIm = new Float64Array(N);
    // Difference operator (Dx)ₙ = xₙ₊₁ − xₙ, periodic: D̂ = e^{iω} − 1.
    const dRe = new Float64Array(N), dIm = new Float64Array(N), dPow = new Float64Array(N);
    for (let k = 0; k < N; k++) { const w = 2 * Math.PI * k / N; dRe[k] = Math.cos(w) - 1; dIm[k] = Math.sin(w); dPow[k] = 2 - 2 * Math.cos(w); }
    // Wiener's prior on the signal spectrum: power falling off above about 10 cycles, so the
    // penalty λ/S(ω) grows with frequency instead of being flat like Tikhonov's.
    const prior = new Float64Array(N);
    for (let k = 0; k < N; k++) { const f = Math.min(k, N - k) / 10; prior[k] = 1 / (1 + f * f); }

    const sigmaOf  = (v) => (v / 100) * 0.12;
    const lambdaOf = (v) => (v === 0 ? 0 : Math.pow(10, -6 + 6 * (v / 100)));
    const FORMULA = {
      naive:    'x̂ = K⁻¹ y',
      tikhonov: 'x̂ = (KᵀK + λI)⁻¹ Kᵀ y',
      wiener:   'x̂ = (KᵀK + λS⁻¹)⁻¹ Kᵀ y,  S = prior spectrum',
      tv:       'x̂ = argmin ½‖Kx − y‖² + λ‖∇x‖₁',
      l1:       'x̂ = argmin ½‖Kx − y‖² + λ‖x‖₁',
    };
    let method = 'tikhonov';
    const formulaEl = document.getElementById('lab-formula');

    // Linear methods: X̂ = conj(K̂)·Ŷ / (|K̂|² + reg(ω)).
    function solveLinear(reg) {
      let cMax = 0, cMin = Infinity;
      for (let i = 0; i < N; i++) {
        const den = kPow[i] + reg[i];
        yRe[i] = fyRe[i] / den; yIm[i] = fyIm[i] / den;
        if (den > cMax) cMax = den; if (den < cMin) cMin = den;
      }
      fft(yRe, yIm, true);
      for (let i = 0; i < N; i++) rec[i] = yRe[i];
      return cMax / cMin;
    }

    // TV and L1 by ADMM (split Bregman), ρ = 1: the x-update is a Fourier-domain solve with the
    // circulant K and D, the z-update is soft thresholding, u carries the running residual.
    const z = new Float64Array(N), u = new Float64Array(N), v = new Float64Array(N), x = new Float64Array(N);
    const vRe = new Float64Array(N), vIm = new Float64Array(N);
    function solveADMM(kind, lambda) {
      const tv = kind === 'tv';
      z.fill(0); u.fill(0); x.fill(0);
      for (let it = 0; it < 150; it++) {
        for (let i = 0; i < N; i++) { vRe[i] = z[i] - u[i]; vIm[i] = 0; }
        fft(vRe, vIm, false);
        for (let i = 0; i < N; i++) {
          // rhs = Kᵀy + Dᵀ(z − u) for TV, Kᵀy + (z − u) for L1; divide by |K̂|² + |D̂|² or |K̂|² + 1
          let rr = vRe[i], ri = vIm[i];
          if (tv) { const a = vRe[i], b = vIm[i]; rr = dRe[i] * a + dIm[i] * b; ri = dRe[i] * b - dIm[i] * a; }   // conj(D̂)·V̂
          const den = kPow[i] + (tv ? dPow[i] : 1);
          yRe[i] = (fyRe[i] + rr) / den; yIm[i] = (fyIm[i] + ri) / den;
        }
        fft(yRe, yIm, true);
        for (let i = 0; i < N; i++) x[i] = yRe[i];
        for (let i = 0; i < N; i++) {
          const dx = tv ? x[(i + 1) % N] - x[i] : x[i];
          const w = dx + u[i];
          z[i] = w > lambda ? w - lambda : w < -lambda ? w + lambda : 0;
          u[i] = w - z[i];
        }
      }
      for (let i = 0; i < N; i++) rec[i] = x[i];
    }

    function solve() {
      const sigma = sigmaOf(+noiseIn.value);
      const lambda = method === 'naive' ? 0 : lambdaOf(+lambdaIn.value);

      for (let i = 0; i < N; i++) { data[i] = blurred[i] + sigma * noise[i]; yRe[i] = data[i]; yIm[i] = 0; }
      fft(yRe, yIm, false);
      for (let i = 0; i < N; i++) { fyRe[i] = kRe[i] * yRe[i] + kIm[i] * yIm[i]; fyIm[i] = kRe[i] * yIm[i] - kIm[i] * yRe[i]; }

      let cond = NaN;
      if (method === 'tv' || method === 'l1') solveADMM(method, lambda);
      else cond = solveLinear(method === 'wiener' ? prior.map((s) => lambda / s) : new Float64Array(N).fill(lambda));

      let num = 0, den = 0;
      for (let i = 0; i < N; i++) { num += (rec[i] - truth[i]) ** 2; den += truth[i] ** 2; }
      const err = Math.sqrt(num / den);

      noiseOut.textContent = sigma.toFixed(3);
      lambdaOut.textContent = lambda === 0 ? '0' : lambda.toExponential(0);
      errEl.textContent = !isFinite(err) ? '∞' : err < 100 ? err.toFixed(2) : err.toExponential(1);
      condEl.textContent = isNaN(cond) ? '—' : cond > 1e30 ? '∞' : cond.toExponential(0);
      formulaEl.textContent = FORMULA[method];

      const state = err < 0.4 ? 'stable' : err < 1.5 ? 'unstable' : 'blowup';
      if (statusEl.dataset.state !== state) {
        statusEl.dataset.state = state;
        statusEl.textContent = state === 'stable' ? 'well-posed' : state === 'unstable' ? 'ill-conditioned' : 'ill-posed';
      }
      noiseIn.style.setProperty('--fill', noiseIn.value + '%');
      lambdaIn.style.setProperty('--fill', lambdaIn.value + '%');
      draw();
    }

    let W = 0, H = 0;
    function resize() { [W, H] = fitCanvas(canvas, ctx); draw(); }

    const Y_MIN = -0.55, Y_MAX = 1.65;
    const PAD = { l: 18, r: 18, t: 22, b: 22 };
    const X = (i) => PAD.l + (i / (N - 1)) * (W - PAD.l - PAD.r);
    const Y = (v) => PAD.t + (1 - (v - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD.t - PAD.b);

    function line(arr, color, width, dash) {
      ctx.beginPath();
      ctx.setLineDash(dash || []);
      for (let i = 0; i < N; i++) {
        const y = clamp(Y(arr[i]), -40, H + 40);     // keep blow-ups drawable
        i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function draw() {
      if (!W) return;
      ctx.clearRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(140,190,240,0.07)';
      ctx.lineWidth = 1;
      for (let k = 0; k <= 4; k++) {
        const y = PAD.t + (k / 4) * (H - PAD.t - PAD.b);
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
      }
      for (let k = 0; k <= 8; k++) {
        const x = PAD.l + (k / 8) * (W - PAD.l - PAD.r);
        ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(140,190,240,0.16)';
      ctx.beginPath(); ctx.moveTo(PAD.l, Y(0)); ctx.lineTo(W - PAD.r, Y(0)); ctx.stroke();

      ctx.save();
      ctx.beginPath(); ctx.rect(PAD.l, PAD.t, W - PAD.l - PAD.r, H - PAD.t - PAD.b); ctx.clip();

      line(truth, 'rgba(237,244,250,0.42)', 1.5, [5, 5]);
      line(data, 'rgba(27,127,209,0.95)', 1.5);
      ctx.fillStyle = 'rgba(27,127,209,0.95)';
      for (let i = 0; i < N; i += 6) { ctx.beginPath(); ctx.arc(X(i), Y(data[i]), 1.8, 0, Math.PI * 2); ctx.fill(); }

      ctx.shadowColor = 'rgba(201,230,255,0.7)';
      ctx.shadowBlur = 10;
      line(rec, '#c9e6ff', 2.2);
      ctx.restore();
    }

    noiseIn.addEventListener('input', solve);
    lambdaIn.addEventListener('input', solve);
    document.getElementById('reroll').addEventListener('click', () => { reroll(); solve(); });
    const chips = [...document.querySelectorAll('[data-method]')];
    chips.forEach((b) => b.addEventListener('click', () => {
      chips.forEach((o) => o.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      method = b.dataset.method;
      lambdaIn.disabled = method === 'naive';
      solve();
    }));

    new ResizeObserver(resize).observe(canvas);
    solve();
  }

  /* ═════════════════════════════════════════════════════════════════════════
     6. Resolve finer — drag-to-compare
     ═════════════════════════════════════════════════════════════════════════ */
  function initCompare() {
    const el = document.getElementById('compare');
    if (!el) return;
    const posOut = document.getElementById('cmp-pos');
    let dragging = false, touched = false;
    const set = (p) => {
      el.style.setProperty('--pos', (p * 100).toFixed(1) + '%');
      if (posOut) posOut.textContent = Math.round(p * 100) + '%';
    };
    const fromX = (clientX) => { const r = el.getBoundingClientRect(); set(clamp((clientX - r.left) / r.width, 0.02, 0.98)); };
    el.addEventListener('pointerdown', (e) => { dragging = true; touched = true; el.setPointerCapture(e.pointerId); fromX(e.clientX); });
    el.addEventListener('pointermove', (e) => { if (dragging) fromX(e.clientX); });
    el.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('pointercancel', () => { dragging = false; });
    // Idle sweep so the effect is visible before anyone touches it.
    if (!REDUCED) {
      let t0 = null;
      visibleLoop(el, (now) => {
        if (touched) return;
        if (t0 === null) t0 = now;
        set(0.5 + 0.32 * Math.sin((now - t0) / 1400));
      });
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     7. Scroll + hover interactions
     ═════════════════════════════════════════════════════════════════════════ */
  function initCounters() {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const el = e.target;
        const target = parseFloat(el.dataset.count);
        const dec = +(el.dataset.decimals || 0);
        const suffix = el.dataset.suffix || '', prefix = el.dataset.prefix || '';
        const fmt = (v) => prefix + v.toFixed(dec) + suffix;
        if (REDUCED) { el.textContent = fmt(target); continue; }
        const t0 = performance.now(), dur = 1600;
        const frame = (now) => {
          const p = clamp((now - t0) / dur, 0, 1);
          const eased = 1 - Math.pow(2, -10 * p);
          el.textContent = fmt(target * eased);
          if (p < 1) requestAnimationFrame(frame); else el.textContent = fmt(target);
        };
        requestAnimationFrame(frame);
      }
    }, { threshold: 0.6 });
    document.querySelectorAll('[data-count]').forEach((el) => io.observe(el));
  }

  function initScrollDriven(stage) {
    const nav = document.getElementById('nav');
    const steps = document.getElementById('steps');
    const stepEls = steps ? [...steps.querySelectorAll('.step')] : [];
    const manifesto = document.getElementById('manifesto');
    const words = manifesto ? [...manifesto.querySelectorAll('.manifesto-text span')] : [];

    let ticking = false;
    function update() {
      ticking = false;
      const vh = window.innerHeight;
      nav.classList.toggle('scrolled', window.scrollY > 24);

      if (steps) {
        const r = steps.getBoundingClientRect();
        const line = vh * 0.62;
        steps.style.setProperty('--progress', clamp((line - r.top) / r.height * 100, 0, 100) + '%');
        let last = 0;
        stepEls.forEach((s, i) => { const on = s.getBoundingClientRect().top + 24 < line; s.classList.toggle('active', on); if (on) last = i; });
        stage.setScroll(last);
      }
      if (manifesto && words.length && !REDUCED) {
        const r = manifesto.getBoundingClientRect();
        const p = clamp(-r.top / (r.height - vh), 0, 1);
        const n = Math.round(p * (words.length + 2)) - 1;
        words.forEach((w, i) => w.classList.toggle('on', i < n));
      }
    }
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  function initNav() {
    const nav = document.getElementById('nav');
    const toggle = document.getElementById('nav-toggle');
    const links = [...document.querySelectorAll('[data-nav]')];
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    links.forEach((a) => a.addEventListener('click', () => { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }));

    const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => a.classList.remove('active'));
        byId.get(e.target.id)?.classList.add('active');
      }
    }, { rootMargin: '-40% 0px -55% 0px' });
    byId.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* ── Written headings (Manim-style): trace each glyph's outline, then fill.
        The heading's text stays in the DOM for accessibility; an SVG overlay
        with one <tspan> per character is laid over it, word by word, at the
        positions the browser already chose, and removed when done. ──────── */
  function initWrite() {
    const heads = [...document.querySelectorAll('[data-write]')];
    if (!heads.length || REDUCED) return;
    const NS = 'http://www.w3.org/2000/svg';
    const LAG = 0.028, TRACE = 0.85, INK = 0.45, TAIL = 0.55;
    let clipId = 0;

    // Each heading is idle (text hidden, waiting), writing, or done. It writes once enough of it
    // is on screen, and resets after scrolling fully out of view so it writes again on return.
    const phase = new Map(), timers = new Map();
    const clear = (h) => { timers.get(h).forEach(clearTimeout); timers.set(h, []); h.querySelector('.write')?.remove(); };
    const restore = (h) => { clear(h); h.classList.remove('writing'); phase.set(h, 'done'); };
    const reset = (h) => { clear(h); h.classList.add('writing'); phase.set(h, 'idle'); };

    // Wrap words right away so the text can be hidden before the fonts arrive.
    for (const h of heads) {
      const words = h.textContent.trim().split(/\s+/);
      h.textContent = '';
      words.forEach((w, i) => {
        const s = document.createElement('span'); s.textContent = w; h.appendChild(s);
        if (i < words.length - 1) h.appendChild(document.createTextNode(' '));
      });
      timers.set(h, []);
      reset(h);
    }

    function write(h) {
      phase.set(h, 'writing');
      try {
        const hb = h.getBoundingClientRect();
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'write');
        svg.setAttribute('width', Math.ceil(hb.width)); svg.setAttribute('height', Math.ceil(hb.height));
        svg.setAttribute('aria-hidden', 'true');
        // Ascent of this heading's font, measured once off-flow. The baseline comes from a
        // zero-height inline-block; the top comes from a Range over a character, the same kind
        // of box the letters below are measured with, so the two share a reference. (The span's
        // own box is a line box, offset from the glyph box by the half-leading.)
        const probe = document.createElement('span');
        probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
        const meter = document.createElement('span');
        meter.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap';
        meter.textContent = 'x';
        meter.appendChild(probe);
        h.appendChild(meter);
        const range = document.createRange();
        range.selectNodeContents(meter.firstChild);
        const ascent = probe.getBoundingClientRect().top - range.getBoundingClientRect().top;
        meter.remove();
        let i = 0;
        for (const s of h.querySelectorAll(':scope > span')) {
          const node = s.firstChild, str = s.textContent;
          const t = document.createElementNS(NS, 'text');
          // One <tspan> per letter, each pinned to where the browser actually drew that letter
          // in the real text (a Range over the DOM text node), so kerning is preserved and a
          // word that breaks across lines (at a hyphen, say) still lands on the right line.
          for (let k = 0; k < str.length; k++) {
            range.setStart(node, k); range.setEnd(node, k + 1);
            const cr = range.getBoundingClientRect();
            const ts = document.createElementNS(NS, 'tspan');
            ts.textContent = str[k];
            ts.setAttribute('x', (cr.left - hb.left).toFixed(2));
            ts.setAttribute('y', (cr.top - hb.top + ascent).toFixed(2));
            ts.style.animationDelay = `${(i * LAG).toFixed(3)}s, ${(i * LAG + INK).toFixed(3)}s`;
            t.appendChild(ts); i++;
          }
          // The word is its own clip path, so the stroke stays inside the glyph edge and the
          // finished overlay matches the filled text exactly.
          const clip = document.createElementNS(NS, 'clipPath');
          clip.setAttribute('id', `write-clip-${++clipId}`);
          clip.appendChild(t.cloneNode(true));
          t.setAttribute('clip-path', `url(#write-clip-${clipId})`);
          svg.appendChild(clip);
          svg.appendChild(t);
        }
        h.appendChild(svg);
        timers.get(h).push(setTimeout(() => {
          h.classList.remove('writing');
          svg.classList.add('done');
          phase.set(h, 'done');
          timers.get(h).push(setTimeout(() => svg.remove(), 300));
        }, (i * LAG + INK + TRACE + TAIL) * 1000));
      } catch (err) { restore(h); }
    }

    const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    ready.then(() => {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const h = e.target, p = phase.get(h);
          if (!e.isIntersecting) { if (p !== 'idle') reset(h); }
          else if (e.intersectionRatio >= 0.34 && p === 'idle') write(h);
        }
      }, { threshold: [0, 0.35] });
      heads.forEach((h) => io.observe(h));
    });
    // A reflow mid-animation would leave the overlay misaligned; just show the text.
    window.addEventListener('resize', () => heads.forEach((h) => { if (phase.get(h) === 'writing') restore(h); }), { passive: true });
  }

  function initHadamard() {
    const badge = document.getElementById('hadamard-badge');
    const switches = [...document.querySelectorAll('[data-cond]')];
    if (!badge || !switches.length) return;
    const sync = () => {
      const ok = switches.every((s) => s.getAttribute('aria-pressed') === 'true');
      badge.dataset.ok = String(ok);
      badge.querySelector('b').textContent = ok ? 'well-posed' : 'ill-posed';
    };
    switches.forEach((s) => s.addEventListener('click', () => {
      s.setAttribute('aria-pressed', s.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      sync();
    }));
  }

  /* ── Contact links: the address is stored reversed and assembled here, so it never
        appears as a mailto: or user@domain pattern in the page source for harvesters. ── */
  function initContact() {
    document.querySelectorAll('[data-contact]').forEach((a) => {
      const addr = [...a.dataset.contact].reverse().join('');
      a.href = 'mailto:' + addr;
      if ('contactText' in a.dataset) a.textContent = addr;
    });
  }

  function initPubFilter() {
    const chips = [...document.querySelectorAll('[data-filter]')];
    const pubs = [...document.querySelectorAll('.pub[data-domain]')];
    if (!chips.length) return;
    chips.forEach((c) => c.addEventListener('click', () => {
      chips.forEach((o) => o.setAttribute('aria-pressed', 'false'));
      c.setAttribute('aria-pressed', 'true');
      const f = c.dataset.filter;
      pubs.forEach((p) => p.classList.toggle('hide', f !== 'all' && p.dataset.domain !== f));
    }));
  }

  /* ═════════════════════════════════════════════════════════════════════════
     8. Engine card — gradient descent on a design landscape
     ═════════════════════════════════════════════════════════════════════════ */
  function initOptim() {
    const canvas = document.getElementById('optim');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    const CELL = 2;
    let W = 0, H = 0, gw = 0, gh = 0;

    // Objective J(x, y) on the unit square: a curved Rosenbrock-style valley (fast to fall into,
    // slow to walk along) with ripples that leave shallow local minima on the valley floor.
    const J = (x, y) => {
      const u = x - 0.55, v = y - 0.45;
      const valley = 1.3 * (v - 1.5 * u * u) ** 2 + 0.4 * (x - 0.68) ** 2;
      const ripple = 0.0025 * Math.sin(17 * x + 2.2 * Math.sin(5 * y)) * Math.cos(12 * y - 3 * Math.sin(6 * x))
                   + 0.002 * Math.cos(9 * x + 4 * y);
      return valley + ripple;
    };
    const grad = (x, y) => { const h = 1e-3; return [(J(x + h, y) - J(x - h, y)) / (2 * h), (J(x, y + h) - J(x, y - h)) / (2 * h)]; };

    // Marching squares: corners a (top-left, bit 8), b (top-right, 4), c (bottom-right, 2), d (bottom-left, 1);
    // edges 0 top, 1 right, 2 bottom, 3 left. Each case lists the edge pairs a contour crosses.
    const CASES = { 1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[0, 3], [2, 1]], 6: [[0, 2]], 7: [[0, 3]],
                    8: [[0, 3]], 9: [[0, 2]], 10: [[0, 1], [3, 2]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]] };
    let contours = [];   // [{ level, segs: Float32Array of x1,y1,x2,y2 in canvas px }]

    function resize() {
      [W, H] = fitCanvas(canvas, ctx);
      // Soft shaded fill, upscaled with smoothing.
      gw = Math.ceil(W / CELL); gh = Math.ceil(H / CELL);
      off.width = gw; off.height = gh;
      const img = octx.createImageData(gw, gh), buf = new Uint32Array(img.data.buffer);
      let lo = Infinity, hi = -Infinity;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const v = J(x / gw, y / gh); if (v < lo) lo = v; if (v > hi) hi = v; }
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const t = 1 - (J(x / gw, y / gh) - lo) / (hi - lo);
        buf[y * gw + x] = 0xff000000 | ((31 + 58 * t) << 16) | ((19 + 36 * t) << 8) | (7 + 12 * t);
      }
      octx.putImageData(img, 0, 0);

      // Crisp vector contours from a finer sample grid.
      const nx = 300, ny = Math.max(40, Math.round(300 * H / W));
      const vals = new Float32Array(nx * ny);
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) vals[y * nx + x] = J(x / (nx - 1), y / (ny - 1));
      const sx = W / (nx - 1), sy = H / (ny - 1);
      contours = [];
      for (let k = 1; k <= 17; k++) {
        const lv = lo + (hi - lo) * Math.pow(k / 18, 1.6), segs = [];   // denser near the valley floor
        for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
          const a = vals[y * nx + x], b = vals[y * nx + x + 1], c = vals[(y + 1) * nx + x + 1], d = vals[(y + 1) * nx + x];
          const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
          if (!CASES[idx]) continue;
          const pt = (e) => e === 0 ? [x + (lv - a) / (b - a), y] : e === 1 ? [x + 1, y + (lv - b) / (c - b)]
                        : e === 2 ? [x + (lv - d) / (c - d), y + 1] : [x, y + (lv - a) / (d - a)];
          for (const [e1, e2] of CASES[idx]) { const p = pt(e1), q = pt(e2); segs.push(p[0] * sx, p[1] * sy, q[0] * sx, q[1] * sy); }
        }
        contours.push({ strong: k % 4 === 0, segs });
      }
    }

    let path = [], pos = null, vel = [0, 0], idleAt = 0;
    const start = (x, y) => { pos = [x, y]; vel = [0, 0]; path = [[x, y]]; };
    canvas.addEventListener('pointerdown', (e) => { const r = canvas.getBoundingClientRect(); start((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); idleAt = performance.now() + 14000; });

    function tick(now) {
      if (!W) return;
      // Start on an arm of the valley, far from the minimum, so the walk along the floor is visible.
      if (!pos || now > idleAt) { start(Math.random() < 0.5 ? 0.05 + Math.random() * 0.22 : 0.86 + Math.random() * 0.1, 0.06 + Math.random() * 0.35); idleAt = now + 12000; }
      if (!REDUCED || path.length < 2) {
        // Gradient descent with momentum, small steps: it drops into the valley quickly, then creeps.
        const [gx, gy] = grad(pos[0], pos[1]);
        vel[0] = vel[0] * 0.9 - gx * 0.0011; vel[1] = vel[1] * 0.9 - gy * 0.0011;
        pos[0] = clamp(pos[0] + vel[0], 0.01, 0.99); pos[1] = clamp(pos[1] + vel[1], 0.01, 0.99);
        const last = path[path.length - 1];
        if (Math.hypot(pos[0] - last[0], pos[1] - last[1]) > 0.003) path.push([pos[0], pos[1]]);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);
      ctx.lineWidth = 1;
      for (const { strong, segs } of contours) {
        ctx.strokeStyle = strong ? 'rgba(94,179,242,0.55)' : 'rgba(94,179,242,0.22)';
        ctx.beginPath();
        for (let i = 0; i < segs.length; i += 4) { ctx.moveTo(segs[i], segs[i + 1]); ctx.lineTo(segs[i + 2], segs[i + 3]); }
        ctx.stroke();
      }
      ctx.beginPath();
      path.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      ctx.strokeStyle = 'rgba(201,230,255,0.9)'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = 'rgba(94,179,242,0.9)';
      for (let i = 0; i < path.length; i += 6) { ctx.beginPath(); ctx.arc(path[i][0] * W, path[i][1] * H, 1.6, 0, 6.283); ctx.fill(); }
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(pos[0] * W, pos[1] * H, 3.5, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(pos[0] * W, pos[1] * H, 8, 0, 6.283); ctx.stroke();
    }

    resize();
    new ResizeObserver(resize).observe(canvas);
    visibleLoop(canvas, tick);
  }

  /* ═════════════════════════════════════════════════════════════════════════
     8a. Engine card — Fourier epicycles: one basis, many systems
         The outline of each "system" (airfoil, droplet, crystal, vortex lobe)
         is a closed curve z(t); its DFT gives the coefficients cₙ. A chain of
         rotating circles with radii |cₙ| draws the curve, the coefficients
         morph from one system to the next, and the cursor sets how many modes
         are kept.
     ═════════════════════════════════════════════════════════════════════════ */
  function initFourier() {
    const canvas = document.getElementById('fourier');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const M = 256, K = 48;                                  // samples per curve, modes kept (n = −24 … 23)
    let W = 0, H = 0, S = 1, phase = 0, modes = 14, modesT = 14;

    // Each shape: M points in [-1, 1]², resampled by arc length so the DFT is well behaved.
    function resample(raw) {
      const seg = [0];
      for (let i = 1; i <= raw.length; i++) { const a = raw[i - 1], b = raw[i % raw.length]; seg.push(seg[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
      const total = seg[raw.length], out = [];
      for (let k = 0, j = 0; k < M; k++) {
        const s = k / M * total;
        while (seg[j + 1] < s) j++;
        const a = raw[j], b = raw[(j + 1) % raw.length], f = (s - seg[j]) / (seg[j + 1] - seg[j] || 1);
        out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      }
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of out) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const sc = 2 / Math.max(maxX - minX, maxY - minY), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const pts = out.map(([x, y]) => [(x - cx) * sc, (y - cy) * sc]);
      // Same chirality and start point for every system, so the dominant mode is always n = +1
      // and the pen always begins at the rightmost point: morphs stay smooth, drawings read alike.
      let area = 0;
      for (let i = 0; i < M; i++) { const a = pts[i], b = pts[(i + 1) % M]; area += a[0] * b[1] - b[0] * a[1]; }
      if (area < 0) pts.reverse();
      let s = 0;
      for (let i = 1; i < M; i++) if (pts[i][0] > pts[s][0]) s = i;
      return pts.slice(s).concat(pts.slice(0, s));
    }
    const poly = (n, f) => { const p = []; for (let i = 0; i < n; i++) p.push(f(i / n * 6.2832)); return p; };
    const shapes = [
      // airfoil (Joukowski), droplet, hexagonal crystal, five-lobed vortex
      resample(poly(240, (th) => { const mu = [-0.09, 0.07], R = Math.hypot(1 - mu[0], mu[1]); const zr = mu[0] + R * Math.cos(th), zi = mu[1] + R * Math.sin(th), m2 = zr * zr + zi * zi; return [zr + zr / m2, -(zi - zi / m2) * 2.2]; })),
      resample(poly(240, (th) => [0.75 * Math.sin(th) * Math.pow(Math.max(0, Math.sin(th / 2)), 0.9), Math.cos(th)])),
      resample(poly(6, (th) => [Math.cos(th + 0.52), Math.sin(th + 0.52)])),
      resample(poly(240, (th) => { const r = 0.78 + 0.2 * Math.sin(5 * th) + 0.05 * Math.sin(10 * th + 1); return [r * Math.cos(th), r * Math.sin(th)]; })),
    ];
    // DFT: c_n = (1/M) Σ z_k e^{−2πi n k / M}, stored for n = −K/2 … K/2−1.
    const dft = (pts) => {
      const c = [];
      for (let n = -K / 2; n < K / 2; n++) {
        let re = 0, im = 0;
        for (let k = 0; k < M; k++) { const a = -6.2832 * n * k / M, [x, y] = pts[k]; re += x * Math.cos(a) - y * Math.sin(a); im += x * Math.sin(a) + y * Math.cos(a); }
        c.push({ n, re: re / M, im: im / M });
      }
      return c;
    };
    const coeffs = shapes.map(dft);
    const blended = coeffs[0].map((c) => ({ ...c }));
    let shape = 0, morph = 1, revs = 0, prevP = 0;

    if (HOVER) {
      canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); modesT = 2 + Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * 44); });
      canvas.addEventListener('pointerleave', () => { modesT = 14; });
    }

    const X = (x) => W / 2 + x * S, Y = (y) => H / 2 + y * S;
    function evalCurve(order, N, th) {
      let x = 0, y = 0;
      for (let i = 0; i < N; i++) { const c = order[i], a = c.n * th; x += c.re * Math.cos(a) - c.im * Math.sin(a); y += c.re * Math.sin(a) + c.im * Math.cos(a); }
      return [x, y];
    }

    function tick() {
      if (!W) return;
      if (!REDUCED) phase += 0.022;
      const p = phase % 6.2832;
      // Switch systems only when a drawing is complete: every second full revolution, at the
      // moment the pen returns to the start, then cross-fade the coefficients quickly.
      if (p < prevP && ++revs >= 2) { revs = 0; shape = (shape + 1) % shapes.length; morph = 0; }
      prevP = p;
      if (morph < 1) morph = Math.min(1, morph + 1 / 40);
      const from = coeffs[(shape + shapes.length - 1) % shapes.length], to = coeffs[shape], f = smooth(morph);
      for (let i = 0; i < K; i++) { blended[i].re = from[i].re + (to[i].re - from[i].re) * f; blended[i].im = from[i].im + (to[i].im - from[i].im) * f; }
      const order = [...blended].sort((a, b) => Math.hypot(b.re, b.im) - Math.hypot(a.re, a.im));
      modes += (modesT - modes) * 0.1;
      const N = Math.round(modes);

      ctx.fillStyle = '#07131f'; ctx.fillRect(0, 0, W, H);
      // The full curve the kept modes can represent, faint.
      ctx.beginPath();
      for (let k = 0; k <= 160; k++) { const [x, y] = evalCurve(order, N, k / 160 * 6.2832); k ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)); }
      ctx.strokeStyle = 'rgba(94,179,242,0.22)'; ctx.lineWidth = 1; ctx.stroke();
      // The part drawn so far in this revolution, bright.
      const steps = Math.max(2, Math.round(p / 6.2832 * 160));
      ctx.beginPath();
      for (let k = 0; k <= steps; k++) { const [x, y] = evalCurve(order, N, k / steps * p); k ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)); }
      ctx.strokeStyle = 'rgba(201,230,255,0.95)'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();
      // The epicycles.
      let x = 0, y = 0;
      for (let i = 0; i < N; i++) {
        const c = order[i], a = c.n * p, r = Math.hypot(c.re, c.im);
        const nx = x + c.re * Math.cos(a) - c.im * Math.sin(a), ny = y + c.re * Math.sin(a) + c.im * Math.cos(a);
        if (c.n !== 0 && r * S > 0.8) {
          ctx.beginPath(); ctx.arc(X(x), Y(y), r * S, 0, 6.2832); ctx.strokeStyle = 'rgba(94,179,242,0.36)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(nx), Y(ny)); ctx.strokeStyle = 'rgba(94,179,242,0.75)'; ctx.stroke();
        }
        x = nx; y = ny;
      }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(x), Y(y), 2.6, 0, 6.2832); ctx.fill();
      ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(167,187,207,0.8)'; ctx.fillText(`${N} modes`, W - 14, H - 12);
    }

    const resize = () => { [W, H] = fitCanvas(canvas, ctx); S = Math.min(W, H) * 0.39; };
    resize(); new ResizeObserver(resize).observe(canvas); visibleLoop(canvas, tick);
  }

  /* ═════════════════════════════════════════════════════════════════════════
     8b. Resolve finer — a stylized field: 32×32 blocks on the left, the
         smooth field on the right. A fragment shader computes both halves on
         the GPU, every frame at screen resolution, splitting where the
         handle is. Without WebGL the same field is drawn on the CPU, at half
         resolution and every third frame.
     ═════════════════════════════════════════════════════════════════════════ */
  const SR_FS = `precision highp float;
    uniform vec2 uRes;
    uniform float uTime, uSplit;
    // A smooth, vortical-looking field that drifts slowly in time; p spans [0, 2π]².
    float field(vec2 p, float t) {
      return sin(3.1 * p.x + 1.6 * sin(2.2 * p.y + 0.7 * t)) + 0.6 * cos(4.3 * p.y - 1.4 * sin(2.7 * p.x - 0.5 * t));
    }
    void main() {
      vec2 uv = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
      if (uv.x < uSplit) uv = (floor(uv * 32.0) + 0.5) / 32.0;       // the coarse input: 32×32 cells
      // Gamma pushes the mid-range toward navy and blue so white only appears at the peaks.
      float s = pow(clamp((field(uv * 6.2832, uTime) / 1.6 + 1.0) * 0.5, 0.0, 1.0), 1.9) * 4.0;
      vec3 c = mix(vec3(7.0, 19.0, 31.0), vec3(18.0, 100.0, 164.0), clamp(s, 0.0, 1.0));
      c = mix(c, vec3(94.0, 179.0, 242.0), clamp(s - 1.0, 0.0, 1.0));
      c = mix(c, vec3(201.0, 230.0, 255.0), clamp(s - 2.0, 0.0, 1.0));
      c = mix(c, vec3(255.0), clamp(s - 3.0, 0.0, 1.0));
      gl_FragColor = vec4(c / 255.0, 1.0);
    }`;

  function initSRGL(canvas, compare) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return false;
    const U = glShaderPass(gl, SR_FS, ['uRes', 'uTime', 'uSplit']);
    if (!U) return false;
    let t = 0, last = 0;
    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      draw();
    }
    function draw() {
      const pos = parseFloat(compare.style.getPropertyValue('--pos'));   // initCompare keeps the handle's position here
      gl.uniform1f(U.uSplit, isNaN(pos) ? 0.5 : pos / 100);
      gl.uniform1f(U.uTime, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function tick(now) {
      if (!REDUCED) t += Math.min(0.05, last ? (now - last) / 1000 : 0) * 0.6;
      last = now;
      draw();
    }
    resize();
    new ResizeObserver(resize).observe(canvas);
    visibleLoop(canvas, tick);
    return true;
  }

  function initSR() {
    const coarse = document.getElementById('sr-coarse'), fine = document.getElementById('sr-fine');
    const compare = document.getElementById('compare');
    if (!coarse || !fine || !compare) return;
    if (initSRGL(coarse, compare)) { fine.hidden = true; return; }       // one canvas draws both halves
    const cc = coarse.getContext('2d'), fc = fine.getContext('2d');
    const offF = document.createElement('canvas'), ofc = offF.getContext('2d');
    const offC = document.createElement('canvas'), occ = offC.getContext('2d');
    const CELL = 2, NB = 32;
    let W = 0, H = 0, gw = 0, gh = 0, imgF, bufF, imgC, bufC, t = 0, frame = 0;

    const stops = [[7, 19, 31], [18, 100, 164], [94, 179, 242], [201, 230, 255], [255, 255, 255]];
    const lut = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const s = (i / 255) * 4, k = Math.min(3, s | 0), f = s - k, a = stops[k], b = stops[k + 1];
      lut[i] = 0xff000000 | ((a[2] + (b[2] - a[2]) * f) << 16) | ((a[1] + (b[1] - a[1]) * f) << 8) | (a[0] + (b[0] - a[0]) * f);
    }
    // A smooth, vortical-looking field that drifts slowly in time.
    const field = (x, y, tt) => Math.sin(3.1 * x + 1.6 * Math.sin(2.2 * y + 0.7 * tt)) + 0.6 * Math.cos(4.3 * y - 1.4 * Math.sin(2.7 * x - 0.5 * tt));
    // Gamma pushes the mid-range toward navy and blue so white only appears at the peaks.
    const toIdx = (v) => { const i = (Math.pow(clamp((v / 1.6 + 1) * 0.5, 0, 1), 1.9) * 255) | 0; return i > 255 ? 255 : i; };

    function resize() {
      [W, H] = fitCanvas(coarse, cc); fitCanvas(fine, fc);
      gw = Math.ceil(W / CELL); gh = Math.ceil(H / CELL);
      offF.width = gw; offF.height = gh; imgF = ofc.createImageData(gw, gh); bufF = new Uint32Array(imgF.data.buffer);
      offC.width = NB; offC.height = NB; imgC = occ.createImageData(NB, NB); bufC = new Uint32Array(imgC.data.buffer);
      render();
    }

    function render() {
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) bufF[y * gw + x] = lut[toIdx(field(x / gw * 6.283, y / gh * 6.283, t))];
      for (let y = 0; y < NB; y++) for (let x = 0; x < NB; x++) bufC[y * NB + x] = lut[toIdx(field((x + 0.5) / NB * 6.283, (y + 0.5) / NB * 6.283, t))];
      ofc.putImageData(imgF, 0, 0); occ.putImageData(imgC, 0, 0);
      fc.imageSmoothingEnabled = true; fc.drawImage(offF, 0, 0, W, H);
      cc.imageSmoothingEnabled = false; cc.drawImage(offC, 0, 0, W, H);
    }

    function tick() {
      if (!W) return;
      if (++frame % 3) return;
      if (!REDUCED) t += 0.03;
      render();
    }

    resize();
    new ResizeObserver(resize).observe(coarse);
    visibleLoop(coarse, tick);
  }

  /* ═════════════════════════════════════════════════════════════════════════
     9. Industry toys — six small live models
     ═════════════════════════════════════════════════════════════════════════ */
  function pointerNorm(canvas, onMove, onLeave) {
    canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); onMove((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e); });
    canvas.addEventListener('pointerdown', (e) => { const r = canvas.getBoundingClientRect(); onMove((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e); });
    if (onLeave) canvas.addEventListener('pointerleave', onLeave);
  }

  // Aerospace — potential flow around a Joukowski airfoil; cursor height sets angle of attack.
  function toyAirfoil(canvas) {
    const ctx = canvas.getContext('2d');
    const mu = { x: -0.09, y: 0.07 };
    const R = Math.hypot(1 - mu.x, mu.y), beta = Math.asin(mu.y / R);
    const X0 = -3.1, X1 = 3.1;
    let W = 0, H = 0, Y0 = -1.4, Y1 = 1.4, alpha = 0.07, alphaT = 0.07, outline = null;
    const N = 340, P = new Float32Array(N * 2);

    const sx = (x) => (x - X0) / (X1 - X0) * W, sy = (y) => (1 - (y - Y0) / (Y1 - Y0)) * H;
    const seed = (i, anywhere) => { P[i * 2] = anywhere ? X0 + Math.random() * (X1 - X0) : X0; P[i * 2 + 1] = Y0 + Math.random() * (Y1 - Y0); };
    for (let i = 0; i < N; i++) seed(i, true);

    // Velocity in the airfoil plane: w(z) = W'(ζ) / z'(ζ), z = ζ + 1/ζ. Returns null inside the body.
    // The flow is solved in the body frame (freestream at angle α) and rotated so the freestream
    // stays horizontal on screen and the airfoil visibly pitches.
    function vel(xs, ys) {
      const ca = Math.cos(alpha), sa = Math.sin(alpha);
      const x = ca * xs - sa * ys, y = sa * xs + ca * ys;
      const ar = x * x - y * y - 4, ai = 2 * x * y, m = Math.hypot(ar, ai);
      const sr = Math.sqrt((m + ar) / 2); let si = Math.sqrt(Math.max(0, (m - ar) / 2)); if (ai < 0) si = -si;
      let zr = (x + sr) / 2, zi = (y + si) / 2;
      if (Math.hypot(zr - mu.x, zi - mu.y) < R) { zr = (x - sr) / 2; zi = (y - si) / 2; }
      const dr = zr - mu.x, di = zi - mu.y, d2 = dr * dr + di * di;
      if (d2 < R * R * 1.002) return null;
      const R2 = R * R;
      const q4 = d2 * d2, inv2r = (dr * dr - di * di) / q4, inv2i = -2 * dr * di / q4;
      let wr = ca - (R2 * ca * inv2r - R2 * sa * inv2i);
      let wi = -sa - (R2 * ca * inv2i + R2 * sa * inv2r);
      const G = 2 * R * Math.sin(alpha + beta);                   // Kutta condition: Γ / 2π
      wr += G * di / d2; wi += G * dr / d2;
      const z2r = zr * zr - zi * zi, z2i = 2 * zr * zi, zm4 = (zr * zr + zi * zi) ** 2;
      const gr = 1 - z2r / zm4, gi = z2i / zm4, gm = gr * gr + gi * gi + 1e-9;
      const u = (wr * gr + wi * gi) / gm, v = -(wi * gr - wr * gi) / gm;
      return [ca * u + sa * v, -sa * u + ca * v];
    }

    const body = [];
    for (let k = 0; k <= 120; k++) {
      const th = k / 120 * 6.283, zr = mu.x + R * Math.cos(th), zi = mu.y + R * Math.sin(th), m2 = zr * zr + zi * zi;
      body.push([zr + zr / m2, zi - zi / m2]);
    }
    function buildOutline() {
      const ca = Math.cos(alpha), sa = Math.sin(alpha);
      outline = body.map(([x, y]) => [ca * x + sa * y, -sa * x + ca * y]);
    }

    pointerNorm(canvas, (_, ny) => { alphaT = (0.5 - ny) * 0.56; }, () => { alphaT = 0.07; });

    function tick() {
      if (!W) return;
      alpha += (alphaT - alpha) * 0.1;
      buildOutline();
      ctx.fillStyle = 'rgba(7,19,31,0.22)'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(94,179,242,0.75)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = P[i * 2], y = P[i * 2 + 1];
        const v = vel(x, y);
        if (!v) { seed(i, false); continue; }
        let [u, w] = v; const s = Math.hypot(u, w); if (s > 2.5) { u *= 2.5 / s; w *= 2.5 / s; }
        const nx = x + u * 0.028, ny = y + w * 0.028;
        ctx.moveTo(sx(x), sy(y)); ctx.lineTo(sx(nx), sy(ny));
        P[i * 2] = nx; P[i * 2 + 1] = ny;
        if (nx > X1 || ny < Y0 || ny > Y1) seed(i, false);
      }
      ctx.stroke();
      ctx.beginPath();
      outline.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
      ctx.closePath();
      ctx.fillStyle = '#07131f'; ctx.fill();
      ctx.strokeStyle = 'rgba(237,244,250,0.9)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    const resize = () => { [W, H] = fitCanvas(canvas, ctx); const yr = (X1 - X0) / (W / H) / 2; Y0 = -yr; Y1 = yr; ctx.fillStyle = '#07131f'; ctx.fillRect(0, 0, W, H); };
    resize(); new ResizeObserver(resize).observe(canvas); visibleLoop(canvas, tick);
  }

  // Energy — injection through heterogeneous rock toward a producer; cursor moves the injector.
  function toySubsurface(canvas) {
    const ctx = canvas.getContext('2d');
    const off = document.createElement('canvas'), octx = off.getContext('2d');
    const CELL = 4, N = 420;
    const P = new Float32Array(N * 3);
    let W = 0, H = 0, ix = 0.22, iy = 0.5, tx = 0.22, ty = 0.5;
    const prod = [0.8, 0.5];
    const perm = (x, y) => clamp(0.85 + 0.45 * Math.sin(7.1 * x + 1.3) * Math.sin(5.3 * y + 0.4) + 0.3 * Math.sin(11 * x - 6 * y + 2) + 0.2 * Math.cos(9 * y + 3 * x), 0.15, 1.6);
    const seed = (i) => { const a = Math.random() * 6.283, r = 0.01 + Math.random() * 0.03; P[i * 3] = ix + Math.cos(a) * r; P[i * 3 + 1] = iy + Math.sin(a) * r; P[i * 3 + 2] = 60 + Math.random() * 400; };
    for (let i = 0; i < N; i++) seed(i);

    function resize() {
      [W, H] = fitCanvas(canvas, ctx);
      const gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL);
      off.width = gw; off.height = gh;
      const img = octx.createImageData(gw, gh), buf = new Uint32Array(img.data.buffer);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const k = perm(x / gw, y / gh), t = (k - 0.15) / 1.45;
        buf[y * gw + x] = 0xff000000 | ((31 + 70 * t) << 16) | ((19 + 44 * t) << 8) | (7 + 14 * t);
      }
      octx.putImageData(img, 0, 0);
    }
    pointerNorm(canvas, (x, y) => { tx = clamp(x, 0.05, 0.95); ty = clamp(y, 0.08, 0.92); });

    function tick() {
      if (!W) return;
      ix += (tx - ix) * 0.08; iy += (ty - iy) * 0.08;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);
      ctx.strokeStyle = 'rgba(120,195,250,0.95)'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = P[i * 3], y = P[i * 3 + 1];
        const dx1 = x - ix, dy1 = (y - iy) * (H / W), d1 = dx1 * dx1 + dy1 * dy1 + 0.0004;
        const dx2 = x - prod[0], dy2 = (y - prod[1]) * (H / W), d2 = dx2 * dx2 + dy2 * dy2 + 0.0004;
        const k = perm(x, y) * 0.00036;
        const u = k * (dx1 / d1 - dx2 / d2), v = k * (dy1 / d1 - dy2 / d2) * (W / H);
        const nx = x + u, ny = y + v;
        ctx.moveTo(x * W, y * H); ctx.lineTo(nx * W, ny * H);
        P[i * 3] = nx; P[i * 3 + 1] = ny;
        if (--P[i * 3 + 2] < 0 || d2 < 0.0012 || nx < 0 || nx > 1 || ny < 0 || ny > 1) seed(i);
      }
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(ix * W, iy * H, 5, 0, 6.283); ctx.stroke();
      ctx.strokeStyle = 'rgba(237,244,250,0.7)'; ctx.beginPath(); ctx.arc(prod[0] * W, prod[1] * H, 5, 0, 6.283); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(prod[0] * W - 3, prod[1] * H); ctx.lineTo(prod[0] * W + 3, prod[1] * H); ctx.stroke();
    }
    resize(); new ResizeObserver(resize).observe(canvas); visibleLoop(canvas, tick);
  }

  // Semiconductors — an n-channel MOSFET in cross-section. Cursor height sets the gate voltage,
  // cursor x the drain voltage. Above threshold an inversion channel forms under the oxide and
  // electrons stream from source to drain. The channel's depth follows the gradual-channel
  // approximation, q(u) ∝ √(1 − (2r − r²)u) with r = V_D / (V_G − V_th): it thins toward the
  // drain and pinches off once V_D reaches V_G − V_th, after which the current stops growing.
  // Holes in the p-type substrate are pushed out of the depletion regions.
  function toyMosfet(canvas) {
    const ctx = canvas.getContext('2d');
    const eqEl = canvas.parentElement.querySelector('.corner-eq');
    const VTH = 0.7, KP = 0.5;                                   // threshold (V), k (mA/V²)
    const FONT = '500 11px "JetBrains Mono", ui-monospace, monospace', SUB = '500 8px "JetBrains Mono", ui-monospace, monospace';
    const EQ = {
      off: 'I<sub>D</sub> ≈ 0 while V<sub>G</sub> &lt; V<sub>th</sub>',
      linear: 'I<sub>D</sub> = k[(V<sub>G</sub> − V<sub>th</sub>)V<sub>D</sub> − ½V<sub>D</sub>²]',
      saturation: 'I<sub>D</sub> = ½k(V<sub>G</sub> − V<sub>th</sub>)²',
    };
    const REGIME = { off: 'cut off', linear: 'linear region', saturation: 'saturated' };
    const NE = 150, EX = new Float32Array(NE), EY = new Float32Array(NE), EV = new Float32Array(NE), EF = new Float32Array(NE), ES = new Uint8Array(NE);
    const NH = 46, HX = new Float32Array(NH), HY = new Float32Array(NH), HD = new Float32Array(NH), HP = new Float32Array(NH);
    let W = 0, H = 0, ys = 0, dep = 0, rad = 0, sx0 = 0, sx1 = 0, dx0 = 0, dx1 = 0, gx0 = 0, gx1 = 0, gTop = 0, yT = 0;
    let vg = 1.8, vd = 0.9, tvg = 1.8, tvd = 0.9, acc = 0, regime = '', next = 0, t = 0;

    // A well is a tub: flat top at the surface, rounded bottom corners of radius r.
    const inRound = (x, y, a, b, top, bot, r) => {
      if (x < a || x > b || y < top || y > bot) return false;
      if (y < bot - r) return true;
      const cx = clamp(x, a + r, b - r);
      return (x - cx) ** 2 + (y - bot + r) ** 2 <= r * r;
    };
    const inWell = (x, y, a, b, m) => inRound(x, y, a + m, b - m, ys + m, ys + dep - m, Math.max(1, rad - m));
    const nearWell = (x, y, a, b, p) => inRound(x, y, a - p, b + p, ys, ys + dep + p, rad + p);
    const wellPath = (a, b, p) => {                              // outline offset outward by p, surface to surface
      const r = rad + p, bot = ys + dep + p;
      ctx.moveTo(a - p, ys); ctx.lineTo(a - p, bot - r); ctx.quadraticCurveTo(a - p, bot, a - p + r, bot);
      ctx.lineTo(b + p - r, bot); ctx.quadraticCurveTo(b + p, bot, b + p, bot - r); ctx.lineTo(b + p, ys);
    };
    function seat(i, s) {                                        // drop electron i somewhere in the source (0) or drain (2)
      const a = s === 0 ? sx0 : dx0, b = s === 0 ? sx1 : dx1;
      let x = a, y = ys;
      for (let k = 0; k < 60; k++) { x = a + Math.random() * (b - a); y = ys + Math.random() * dep; if (inWell(x, y, a, b, 3)) break; }
      EX[i] = x; EY[i] = y; ES[i] = s;
    }

    function layout() {
      ys = Math.round(H * 0.44); dep = Math.round(H * 0.17); gTop = Math.round(H * 0.31); yT = Math.round(H * 0.22);
      sx0 = W * 0.06; sx1 = W * 0.34; dx0 = W * 0.66; dx1 = W * 0.94; gx0 = W * 0.32; gx1 = W * 0.68;
      rad = Math.min(dep * 0.85, (sx1 - sx0) / 2);
      for (let i = 0; i < NE; i++) seat(i, i % 2 ? 2 : 0);
      for (let i = 0; i < NH; i++) {
        let x = 0, y = 0;
        for (let k = 0; k < 60; k++) {
          x = 8 + Math.random() * (W - 16); y = ys + 8 + Math.random() * (H - ys - 16);
          if (!nearWell(x, y, sx0, sx1, 6) && !nearWell(x, y, dx0, dx1, 6)) break;
        }
        HX[i] = x; HY[i] = y; HD[i] = y; HP[i] = Math.random() * 6.283;
      }
    }

    pointerNorm(canvas, (x, y) => { tvg = (1 - y) * 3; tvd = x * 3; }, () => { tvg = 1.8; tvd = 0.9; });

    function terminal(x, yEnd, letter, value) {
      ctx.strokeStyle = 'rgba(167,187,207,0.5)'; ctx.lineWidth = 1;
      const xx = Math.round(x) + 0.5;
      ctx.beginPath(); ctx.moveTo(xx, yT + 3); ctx.lineTo(xx, yEnd); ctx.stroke();
      ctx.beginPath(); ctx.arc(xx, yT, 3, 0, 6.283); ctx.stroke();
      ctx.fillStyle = '#edf4fa'; ctx.fillText(letter, x + 8, yT);
      if (value) { ctx.fillStyle = 'rgba(167,187,207,0.85)'; ctx.fillText(value, x + 8 + ctx.measureText(letter + ' ').width, yT); }
    }

    function tick() {
      if (!W) return;
      t++;
      vg += (tvg - vg) * 0.1; vd += (tvd - vd) * 0.1;
      const vov = vg - VTH, on = vov > 0.02, r = on ? vd / vov : 0, sat = on && r >= 1;
      const I = !on ? 0 : sat ? KP * vov * vov / 2 : KP * (vov * vd - vd * vd / 2);
      const pin = sat ? 1 - 0.12 * Math.min(1, (vd - vov) / 1.5) : 1;        // where the channel ends, along its length
      const tmax = on ? 1.5 + 5 * Math.min(1, vov / 2.3) : 0;
      const cx0 = sx1, cx1 = dx0, cw = cx1 - cx0;
      const q = (u) => (!on ? 0 : sat ? Math.sqrt(Math.max(0, 1 - u / pin)) : Math.sqrt(Math.max(0, 1 - (2 * r - r * r) * u)));
      const thick = (x) => tmax * q(clamp((x - cx0) / cw, 0, 1));
      const depl = (x) => ys + 6 + 12 * Math.sqrt(Math.max(0, vg) / 3) + 10 * (vd / 3) * clamp((x - cx0) / cw, 0, 1);
      const dOff = 3 + 8 * Math.sqrt(vd / 3);                    // drain junction depletion width
      const reg = !on ? 'off' : sat ? 'saturation' : 'linear';
      if (reg !== regime) { regime = reg; if (eqEl) eqEl.innerHTML = EQ[reg]; }

      // Electrons enter the channel in proportion to the current; continuity sets their speed.
      acc = Math.min(acc + I * 0.9, 4);
      for (let n = 0; n < NE && acc >= 1; n++) {
        next = (next + 1) % NE;
        if (ES[next] !== 0) continue;
        ES[next] = 1; EF[next] = Math.random(); EX[next] = cx0; EY[next] = ys + 1.2 + EF[next] * Math.max(0, thick(cx0) - 1.5); EV[next] = 0; acc -= 1;
      }
      for (let i = 0; i < NE; i++) {
        if (ES[i] === 1) {
          const u = (EX[i] - cx0) / cw, qu = q(u);
          const v = u > pin || qu < 0.05 ? 7 : Math.min(7, 0.6 + 2.6 * I / Math.max(0.2, qu));
          EV[i] = v; EX[i] += v;
          EY[i] += (ys + 1.2 + EF[i] * Math.max(0, thick(EX[i]) - 1.5) - EY[i]) * 0.3;
          if (EX[i] >= cx1 + 2) {                                // into the drain; a drain electron goes round to the source
            seat(i, 2);
            for (let k = 0; k < 20; k++) { const j = Math.floor(Math.random() * NE); if (j !== i && ES[j] === 2) { seat(j, 0); break; } }
          }
        } else {
          const a = ES[i] === 0 ? sx0 : dx0, b = ES[i] === 0 ? sx1 : dx1;
          const nx = EX[i] + (Math.random() - 0.5) * 1.2, ny = EY[i] + (Math.random() - 0.5) * 1.2;
          if (inWell(nx, ny, a, b, 3)) { EX[i] = nx; EY[i] = ny; }
        }
      }
      for (let i = 0; i < NH; i++) {                             // holes keep out of the depleted regions
        const x = HX[i];
        let ty = HY[i];
        if (x > cx0 && x < cx1) ty = Math.max(ty, depl(x) + 5);
        if (nearWell(x, ty, dx0, dx1, dOff + 4)) ty = Math.max(ty, ys + dep + dOff + 6);
        HD[i] += (ty - HD[i]) * 0.08;
      }

      // ── draw ──
      ctx.fillStyle = '#07131f'; ctx.fillRect(0, 0, W, H);
      const subst = ctx.createLinearGradient(0, ys, 0, H);    // p-type substrate
      subst.addColorStop(0, 'rgba(94,179,242,0.09)'); subst.addColorStop(1, 'rgba(94,179,242,0.02)');
      ctx.fillStyle = subst; ctx.fillRect(0, ys, W, H - ys);
      ctx.fillStyle = 'rgba(7,19,31,0.6)';                       // depletion: under the gate, and around the drain junction
      ctx.beginPath(); wellPath(dx0, dx1, dOff); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx0, ys);
      for (let k = 0; k <= 32; k++) { const x = cx0 + cw * k / 32; ctx.lineTo(x, depl(x)); }
      ctx.lineTo(cx1, ys); ctx.closePath(); ctx.fill();
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(94,179,242,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k <= 32; k++) { const x = cx0 + cw * k / 32; k ? ctx.lineTo(x, depl(x)) : ctx.moveTo(x, depl(x)); }
      ctx.stroke();
      ctx.beginPath(); wellPath(dx0, dx1, dOff); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(167,187,207,0.4)';
      for (let i = 0; i < NH; i++) {
        ctx.beginPath(); ctx.arc(HX[i] + Math.sin(t * 0.03 + HP[i]) * 1.2, HD[i] + Math.cos(t * 0.027 + HP[i] * 1.7) * 1.2, 1.7, 0, 6.283); ctx.stroke();
      }
      for (const [a, b] of [[sx0, sx1], [dx0, dx1]]) {           // n+ source and drain
        const gr = ctx.createLinearGradient(0, ys, 0, ys + dep);
        gr.addColorStop(0, 'rgba(27,127,209,0.6)'); gr.addColorStop(1, 'rgba(18,100,164,0.25)');
        ctx.fillStyle = gr; ctx.beginPath(); wellPath(a, b, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(94,179,242,0.6)'; ctx.beginPath(); wellPath(a, b, 0); ctx.stroke();
      }
      if (on) {                                                  // inversion channel
        const xe = cx0 + cw * pin;
        ctx.beginPath(); ctx.moveTo(cx0, ys);
        for (let k = 0; k <= 40; k++) { const x = cx0 + (xe - cx0) * k / 40; ctx.lineTo(x, ys + thick(x)); }
        ctx.lineTo(xe, ys); ctx.closePath();
        const gr = ctx.createLinearGradient(cx0, 0, xe, 0), lit = Math.min(1, I);
        gr.addColorStop(0, `rgba(94,179,242,${(0.4 + 0.4 * lit).toFixed(3)})`); gr.addColorStop(1, `rgba(94,179,242,${(0.2 + 0.3 * lit).toFixed(3)})`);
        ctx.save(); ctx.shadowColor = 'rgba(94,179,242,0.8)'; ctx.shadowBlur = 4 + 6 * lit; ctx.fillStyle = gr; ctx.fill(); ctx.restore();
      }
      ctx.fillStyle = 'rgba(237,244,250,0.8)';                   // electrons in the wells
      for (let i = 0; i < NE; i++) if (ES[i] !== 1) { ctx.beginPath(); ctx.arc(EX[i], EY[i], 1, 0, 6.283); ctx.fill(); }
      ctx.strokeStyle = 'rgba(201,230,255,0.4)'; ctx.beginPath();  // and streaming through the channel
      for (let i = 0; i < NE; i++) if (ES[i] === 1) { ctx.moveTo(EX[i] - EV[i] * 2.2, EY[i]); ctx.lineTo(EX[i], EY[i]); }
      ctx.stroke();
      ctx.fillStyle = '#fff';
      for (let i = 0; i < NE; i++) if (ES[i] === 1) { ctx.beginPath(); ctx.arc(EX[i], EY[i], 1.4, 0, 6.283); ctx.fill(); }

      ctx.strokeStyle = 'rgba(140,190,240,0.3)';                 // surface, oxide, gate
      ctx.beginPath(); ctx.moveTo(0, ys + 0.5); ctx.lineTo(W, ys + 0.5); ctx.stroke();
      ctx.fillStyle = 'rgba(201,230,255,0.75)'; ctx.fillRect(gx0, ys - 3, gx1 - gx0, 3);
      const charge = clamp(vov / 2.3, 0, 1);
      ctx.save(); ctx.shadowColor = 'rgba(94,179,242,0.9)'; ctx.shadowBlur = 14 * charge;
      ctx.fillStyle = `rgba(94,179,242,${(0.08 + 0.3 * charge).toFixed(3)})`; ctx.fillRect(gx0, gTop, gx1 - gx0, ys - 3 - gTop);
      ctx.restore();
      ctx.strokeStyle = 'rgba(237,244,250,0.8)';
      ctx.strokeRect(Math.round(gx0) + 0.5, gTop + 0.5, Math.round(gx1 - gx0) - 1, ys - 4 - gTop);
      const pad = W * 0.1;                                       // metal contacts on the source and drain
      for (const xc of [(sx0 + sx1) / 2, (dx0 + dx1) / 2]) {
        ctx.fillStyle = 'rgba(237,244,250,0.18)'; ctx.fillRect(xc - pad / 2, ys - 5, pad, 5);
        ctx.strokeRect(Math.round(xc - pad / 2) + 0.5, ys - 4.5, Math.round(pad) - 1, 4);
      }

      ctx.font = FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      terminal((sx0 + sx1) / 2, ys - 5, 'S', '');
      terminal((gx0 + gx1) / 2, gTop, 'G', vg.toFixed(1) + ' V');
      terminal((dx0 + dx1) / 2, ys - 5, 'D', vd.toFixed(1) + ' V');
      // drain current, under the device
      const rest = ' = ' + I.toFixed(2) + ' mA', y = ys + dep + 26;
      const wI = ctx.measureText('I').width, wR = ctx.measureText(rest).width;
      ctx.font = SUB; const wD = ctx.measureText('D').width; ctx.font = FONT;
      let x = W / 2 - (wI + wD + wR) / 2;
      ctx.fillStyle = '#edf4fa'; ctx.fillText('I', x, y); x += wI;
      ctx.font = SUB; ctx.fillText('D', x, y + 3); x += wD; ctx.font = FONT;
      ctx.fillText(rest, x, y);
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(167,187,207,0.75)'; ctx.fillText(REGIME[regime], W / 2, y + 15);
    }
    const resize = () => { [W, H] = fitCanvas(canvas, ctx); layout(); };
    resize(); new ResizeObserver(resize).observe(canvas); visibleLoop(canvas, tick);
  }

  // Manufacturing — a two-joint robot arm under PID control, run the way robot controllers do it.
  // The cursor sets where the gripper should go and inverse kinematics turns that into a target
  // angle per joint. A trajectory generator never hands the loop a step: each target passes through
  // a critically damped filter, giving a reference that eases in and never passes the target. Each
  // joint (a damped inertia under gravity) tracks its reference with PID on the tracking error,
  // u = Kp·e + Ki·∫e dt + Kd·ė, plus feedforward for inertia, friction and gravity. With the plant
  // cancelled the error has nothing driving it, so the arm follows the reference and doesn't
  // overshoot; the integral only runs once a joint is nearly there and nearly still. The charts
  // plot each joint's target against its angle. Left alone, the arm moves boxes between two pads
  // along cubic Bézier arcs.
  function toyArm(canvas) {
    const ctx = canvas.getContext('2d');
    const FONT = '500 9px "JetBrains Mono", ui-monospace, monospace';
    const JOINT = [{ I: 1, b: 0.6, kp: 90, ki: 90, kd: 20 }, { I: 0.6, b: 0.4, kp: 60, ki: 60, kd: 13 }];
    const WF = 6;                                                      // trajectory bandwidth (rad/s): ~1 s to settle, within the torque limit
    const G1 = 7, G2 = 3.5, UMAX = 90, BW = 14, BH = 11, KEEP = 180, HOLD = 1500;
    const hist = [0, 1, 2, 3].map(() => new Float32Array(KEEP));   // per joint: target, then angle
    const th = [0, 0], om = [0, 0], integ = [0, 0], sp = [0, 0], ref = [0, 0], rv = [0, 0], stacks = [3, 0], trail = [];
    let W = 0, H = 0, L1 = 0, L2 = 0, sx = 0, sy = 0, floor = 0, padX = [0, 0], branch = 1, head = 0;
    let manual = false, holdUntil = 0, hx = 0, hy = 0;                // the cursor's target, in canvas px
    let source = 0, carrying = false, grip = 0;                        // the cycle takes boxes off pad `source`
    let seg = null, goal = 'grip', phase = 'grip', timer = 0, cur = { x: 0, y: 0 };

    const wrapPi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
    const padTop = () => floor - 4;
    const wristAt = (i, placing) => ({ x: padX[i], y: padTop() - stacks[i] * BH - (placing ? BH : 0) - 6 });
    const fk = () => {                                                 // forward kinematics, canvas px
      const ex = sx + L1 * Math.cos(th[0]), ey = sy - L1 * Math.sin(th[0]);
      return { ex, ey, wx: ex + L2 * Math.cos(th[0] + th[1]), wy: ey - L2 * Math.sin(th[0] + th[1]) };
    };
    const gravity = () => {
      const c12 = Math.cos(th[0] + th[1]);
      return [-G1 * Math.cos(th[0]) - G2 * c12, -G2 * c12];
    };

    // Inverse kinematics for the wrist. Of the two elbow solutions, keep the current one while its
    // elbow stays clear of the floor, and settle on elbow-up only near full stretch, where the two
    // coincide, so the elbow never flips across in mid-air.
    function ik(x, y) {
      let tx = x - sx, ty = sy - y, d = Math.hypot(tx, ty);
      const far = L1 + L2 - 0.5, near = Math.abs(L1 - L2) + 6;
      if (d > far || d < near) { const k = clamp(d, near, far) / (d || 1); tx *= k; ty *= k; d = clamp(d, near, far); }
      const a2 = Math.acos(clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
      const sol = (s) => { const t2 = s * a2; return [Math.atan2(ty, tx) - Math.atan2(L2 * Math.sin(t2), L1 + L2 * Math.cos(t2)), t2]; };
      if (a2 < 0.3) branch = tx >= 0 ? -1 : 1;
      else if (L1 * Math.sin(sol(branch)[0]) < -6) branch = -branch;
      return sol(branch);
    }

    // A cubic Bézier from the current wrist position to the next, lifted so that over the top the
    // target is just out of reach: the arm straightens there, where its elbow can change sides.
    const bez = (s, t) => {
      const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      return { x: a * s.p0.x + b * s.p1.x + c * s.p2.x + d * s.p3.x, y: a * s.p0.y + b * s.p1.y + c * s.p2.y + d * s.p3.y };
    };
    function plan(to, then) {
      goal = then; timer = 0;
      if (Math.hypot(to.x - cur.x, to.y - cur.y) < 2) { seg = null; phase = then; cur = to; return; }
      const apex = sy - (L1 + L2) * 1.03, cy = (8 * apex - cur.y - to.y) / 6;
      seg = { p0: cur, p1: { x: cur.x, y: cy }, p2: { x: to.x, y: cy }, p3: to, t: 0, dur: 0.9 + Math.abs(to.x - cur.x) / W * 1.8 };
      phase = 'travel';
    }
    function next() {                                                  // the next move of the pick-and-place cycle
      if (carrying) plan(wristAt(1 - source, true), 'release');
      else if (stacks[source] > 0) plan(wristAt(source, false), 'grip');
      else { source = 1 - source; next(); }                            // that pad is empty: move them all back
    }

    function layout() {
      floor = Math.round(H * 0.69); sx = W / 2; sy = floor - 14;
      const reach = Math.min((sy - 36) / 1.03, W * 0.26);           // the arc's peak stays clear of the text above
      L1 = reach * 0.52; L2 = reach * 0.48;
      padX = [W / 2 - W * 0.19, W / 2 + W * 0.19];
      stacks[0] = 3; stacks[1] = 0; source = 0; carrying = false; grip = 0; manual = false;
      cur = wristAt(0, false); branch = 1;                             // start at rest over the full stack
      const [a, b] = ik(cur.x, cur.y);
      th[0] = sp[0] = ref[0] = a; th[1] = sp[1] = ref[1] = b;
      om[0] = om[1] = rv[0] = rv[1] = integ[0] = integ[1] = 0;
      for (let k = 0; k < KEEP; k++) { hist[0][k] = hist[1][k] = a; hist[2][k] = hist[3][k] = b; }
      trail.length = 0; seg = null; phase = 'grip'; timer = 0;
    }

    function step(h) {
      const g = gravity();
      for (let j = 0; j < 2; j++) {
        const p = JOINT[j];
        const ra = WF * WF * (sp[j] - ref[j]) - 2 * WF * rv[j];        // the reference eases in, critically damped
        rv[j] += ra * h; ref[j] += rv[j] * h;
        const e = ref[j] - th[j];
        if (Math.abs(e) < 0.08 && Math.abs(om[j]) < 0.6) integ[j] = clamp(integ[j] + e * h, -0.5, 0.5);   // anti-windup: only once nearly there and nearly still
        const u = clamp(p.kp * e + p.ki * integ[j] + p.kd * (rv[j] - om[j])   // PID on the tracking error
                        + p.I * ra + p.b * rv[j] - g[j], -UMAX, UMAX);        // feedforward: inertia, friction, gravity
        om[j] += (u - p.b * om[j] + g[j]) / p.I * h;
        th[j] += om[j] * h;
      }
    }

    function box(x, top) {
      ctx.fillStyle = 'rgba(18,100,164,0.55)'; ctx.fillRect(x - BW / 2, top, BW, BH);
      ctx.strokeStyle = 'rgba(94,179,242,0.85)'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x - BW / 2) + 0.5, Math.round(top) + 0.5, BW - 1, BH - 1);
      ctx.strokeStyle = 'rgba(201,230,255,0.35)';
      ctx.beginPath(); ctx.moveTo(x, top + 1); ctx.lineTo(x, top + BH - 1); ctx.stroke();
    }

    // Joint angles are stored unwrapped (a full spin adds 2π) and plotted modulo 2π, wrapped into
    // the turn [c − π, c + π). A wrap is drawn as a sawtooth: the line leaves through one edge and
    // comes back in at the other. The y-range eases to fit what is on screen, never tighter than
    // the joint's usual range [minLo, minHi], so it opens up for a spin and closes again after.
    const TAU = 2 * Math.PI;
    const wrapAt = (v, c) => v - TAU * Math.floor((v - c + Math.PI) / TAU);
    const view = [{ lo: 0, hi: Math.PI }, { lo: -2.2, hi: 2.2 }];
    function chart(k, x0, x1, y0, y1, set, act, c, minLo, minHi, label) {
      ctx.strokeStyle = 'rgba(140,190,240,0.08)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y0 + 0.5); ctx.lineTo(x1, y0 + 0.5); ctx.moveTo(x0, y1 - 0.5); ctx.lineTo(x1, y1 - 0.5); ctx.stroke();
      let lo = minLo, hi = minHi;
      for (let i = 0; i < KEEP; i++) { const a = wrapAt(set[i], c), b = wrapAt(act[i], c); lo = Math.min(lo, a, b); hi = Math.max(hi, a, b); }
      const v = view[k]; v.lo += (lo - v.lo) * 0.12; v.hi += (hi - v.hi) * 0.12;
      const X = (i) => x0 + (i / (KEEP - 1)) * (x1 - x0), Y = (a) => y1 - 3 - (a - v.lo) / (v.hi - v.lo) * (y1 - y0 - 15);
      const top = c + Math.PI, bot = c - Math.PI;
      const series = (arr, style, width, dash) => {
        ctx.beginPath(); ctx.setLineDash(dash);
        let prevRaw = 0, prev = 0;
        for (let i = 0; i < KEEP; i++) {
          const raw = arr[(head + i) % KEEP], a = wrapAt(raw, c);
          if (!i) ctx.moveTo(X(0), Y(a));
          else {
            const d = raw - prevRaw;
            if (Math.abs(a - prev - d) > 1e-6 && d !== 0) {          // wrapped between these two samples
              const edge = d > 0 ? top : bot, x = X(i - 1 + clamp((edge - prev) / d, 0, 1));
              ctx.lineTo(x, Y(edge)); ctx.moveTo(x, Y(d > 0 ? bot : top));
            }
            ctx.lineTo(X(i), Y(a));
          }
          prevRaw = raw; prev = a;
        }
        ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
      };
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0 + 1, x1 - x0, y1 - y0 - 2); ctx.clip();
      series(set, 'rgba(237,244,250,0.5)', 1, [3, 3]);
      series(act, '#5eb3f2', 1.5, []);
      ctx.restore();
      ctx.fillStyle = 'rgba(167,187,207,0.8)'; ctx.font = FONT; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      ctx.fillText(label, x0, y0 + 3);
    }
    function legend(x, y) {
      ctx.font = FONT; ctx.textBaseline = 'top'; ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(167,187,207,0.8)';
      ctx.fillText('actual', x, y);
      let lx = x - ctx.measureText('actual').width - 4;
      ctx.strokeStyle = '#5eb3f2'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(lx - 10, y + 4.5); ctx.lineTo(lx, y + 4.5); ctx.stroke();
      lx -= 16; ctx.fillText('target', lx, y);
      lx -= ctx.measureText('target').width + 4;
      ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(237,244,250,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx - 10, y + 4.5); ctx.lineTo(lx, y + 4.5); ctx.stroke(); ctx.setLineDash([]);
    }

    function draw(w, tgt) {
      ctx.fillStyle = '#07131f'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(140,190,240,0.28)'; ctx.lineWidth = 1;          // the floor, hatched like a drawing
      ctx.beginPath(); ctx.moveTo(10, floor + 0.5); ctx.lineTo(W - 10, floor + 0.5); ctx.stroke();
      ctx.strokeStyle = 'rgba(140,190,240,0.1)'; ctx.beginPath();
      for (let x = 16; x < W - 10; x += 7) { ctx.moveTo(x, floor + 1); ctx.lineTo(x - 5, floor + 6); }
      ctx.stroke();
      for (let i = 0; i < 2; i++) {                                          // pads and their stacks
        ctx.fillStyle = 'rgba(94,179,242,0.12)'; ctx.fillRect(padX[i] - 17, padTop(), 34, 4);
        ctx.strokeStyle = 'rgba(94,179,242,0.6)'; ctx.strokeRect(Math.round(padX[i] - 17) + 0.5, padTop() + 0.5, 33, 3);
        for (let k = 0; k < stacks[i]; k++) box(padX[i], padTop() - (k + 1) * BH);
      }
      if (!manual && seg && phase === 'travel') {                            // the planned arc
        ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(94,179,242,0.35)'; ctx.beginPath();
        for (let k = 0; k <= 32; k++) { const p = bez(seg, k / 32); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      for (let k = 2; k < trail.length; k += 2) {                            // where the wrist has just been
        ctx.strokeStyle = `rgba(201,230,255,${(0.4 * k / trail.length).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(trail[k - 2], trail[k - 1]); ctx.lineTo(trail[k], trail[k + 1]); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(94,179,242,0.8)';                              // the target
      ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(tgt.x, tgt.y, 6, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(tgt.x - 10, tgt.y); ctx.lineTo(tgt.x - 3, tgt.y); ctx.moveTo(tgt.x + 3, tgt.y); ctx.lineTo(tgt.x + 10, tgt.y);
      ctx.moveTo(tgt.x, tgt.y - 10); ctx.lineTo(tgt.x, tgt.y - 3); ctx.moveTo(tgt.x, tgt.y + 3); ctx.lineTo(tgt.x, tgt.y + 10);
      ctx.stroke();
      ctx.fillStyle = 'rgba(237,244,250,0.06)'; ctx.strokeStyle = 'rgba(237,244,250,0.55)';   // the base
      ctx.beginPath(); ctx.moveTo(sx - 15, floor); ctx.lineTo(sx - 8, sy + 3); ctx.lineTo(sx + 8, sy + 3); ctx.lineTo(sx + 15, floor); ctx.closePath(); ctx.fill(); ctx.stroke();
      const link = (x0, y0, x1, y1) => {                                     // links as outlined capsules
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(94,179,242,0.85)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = '#0b1b2b'; ctx.lineWidth = 5.5; ctx.stroke();
        ctx.lineCap = 'butt'; ctx.lineWidth = 1;
      };
      link(sx, sy, w.ex, w.ey); link(w.ex, w.ey, w.wx, w.wy);
      if (carrying) box(w.wx, w.wy + 6);
      const spread = 11 - (11 - BW / 2 - 1.2) * grip;                        // the gripper hangs level and closes on a box
      ctx.strokeStyle = 'rgba(237,244,250,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(w.wx, w.wy); ctx.lineTo(w.wx, w.wy + 5);
      ctx.moveTo(w.wx - spread, w.wy + 5); ctx.lineTo(w.wx + spread, w.wy + 5);
      ctx.moveTo(w.wx - spread, w.wy + 5); ctx.lineTo(w.wx - spread, w.wy + 14); ctx.lineTo(w.wx - spread + 2, w.wy + 15.5);
      ctx.moveTo(w.wx + spread, w.wy + 5); ctx.lineTo(w.wx + spread, w.wy + 14); ctx.lineTo(w.wx + spread - 2, w.wy + 15.5);
      ctx.stroke(); ctx.lineWidth = 1;
      for (const [x, y] of [[sx, sy], [w.ex, w.ey], [w.wx, w.wy]]) {         // joints
        ctx.fillStyle = '#07131f'; ctx.strokeStyle = 'rgba(237,244,250,0.9)';
        ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#5eb3f2'; ctx.beginPath(); ctx.arc(x, y, 1.4, 0, 6.283); ctx.fill();
      }
      const y0 = floor + 12, y1 = H - 10, mid = W / 2;                       // live PID response, per joint
      chart(0, 14, mid - 8, y0, y1, hist[0], hist[1], Math.PI / 2, 0, Math.PI, 'θ₁ shoulder');
      chart(1, mid + 8, W - 14, y0, y1, hist[2], hist[3], 0, -2.2, 2.2, 'θ₂ elbow');
      legend(W - 14, y0 + 3);
    }

    function tick(now) {
      if (!W) return;
      const dt = 1 / 60;
      if (manual && holdUntil && now > holdUntil) release();
      let tgt = cur;
      if (manual) tgt = { x: hx, y: hy };
      else if (REDUCED) tgt = cur;
      else if (phase === 'travel') {
        seg.t = Math.min(1, seg.t + dt / seg.dur);
        const t = seg.t, e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2;   // ease in and out
        tgt = bez(seg, e);
        if (t >= 1) {
          timer += dt;
          const w = fk();
          if (Math.hypot(w.wx - seg.p3.x, w.wy - seg.p3.y) < 2.5 || timer > 1.3) { cur = seg.p3; phase = goal; timer = 0; }
        }
      } else {
        timer += dt;
        if (phase === 'grip') { grip = Math.min(1, timer / 0.25); if (timer > 0.32) { stacks[source]--; carrying = true; next(); } }
        else { grip = Math.max(0, 1 - timer / 0.25); if (timer > 0.32) { stacks[1 - source]++; carrying = false; next(); } }
      }
      const [a, b] = ik(tgt.x, tgt.y);
      sp[0] += wrapPi(a - sp[0]); sp[1] += wrapPi(b - sp[1]);
      for (let k = 0; k < 4; k++) step(dt / 4);
      hist[0][head] = sp[0]; hist[1][head] = th[0]; hist[2][head] = sp[1]; hist[3][head] = th[1];
      head = (head + 1) % KEEP;
      const w = fk();
      trail.push(w.wx, w.wy); if (trail.length > 90) trail.splice(0, 2);
      draw(w, tgt);
    }

    // The cursor takes over; leaving hands control back to the cycle, which re-plans from wherever
    // the arm is. A tap on a touch screen holds the arm there for a moment first.
    function move(e) {
      const r = canvas.getBoundingClientRect();
      hx = clamp(e.clientX - r.left, 12, W - 12); hy = clamp(e.clientY - r.top, 30, floor - 6);
      if (!manual) { manual = true; grip = carrying ? 1 : 0; }
      holdUntil = 0;
    }
    function release() { manual = false; holdUntil = 0; const w = fk(); cur = { x: w.wx, y: w.wy }; next(); }
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', move);
    canvas.addEventListener('pointerleave', (e) => { if (!manual) return; if (e.pointerType === 'mouse') release(); else holdUntil = performance.now() + HOLD; });

    const resize = () => { [W, H] = fitCanvas(canvas, ctx); layout(); };
    resize(); new ResizeObserver(resize).observe(canvas); visibleLoop(canvas, tick);
  }

  // Materials — a spring lattice. Nodes carry real momentum, so a push sets off a wave that
  // travels through the crystal. The lattice extends PAD hidden rows and columns past each edge
  // of the canvas with damping that ramps up out there, so a wave leaves the picture as it would
  // in an infinite crystal instead of reflecting back. Bonds fracture past a strain limit and heal.
  // Bonds live in flat typed arrays (endpoints, rest lengths, the time a broken bond heals) and are
  // drawn in ten batches by strain, one stroke each; the nodes are drawn in a single fill.
  function toyLattice(canvas) {
    const ctx = canvas.getContext('2d');
    const SP = 22, PAD = 4, K = 0.07, DAMP = 0.997, BREAK = 0.6;
    const BOND = Array.from({ length: 10 }, (_, l) => {                // bond colour by strain, from rest to the fracture limit
      const s = l / 9;
      return `rgba(${Math.round(94 + 107 * s)},${Math.round(179 + 51 * s)},${Math.round(242 + 13 * s)},${(0.16 + 0.7 * s).toFixed(3)})`;
    });
    let W = 0, H = 0, cols = 0, rows = 0, n = 0;
    let X, Y, PX, PY, RX, RY, AX, AY, sponge, BA, BB, rest, healAt, nb = 0;
    let mx = -1e4, my = -1e4, press = 0, tap = null;
    pointerNorm(canvas, (x, y, e) => {
      mx = x * W; my = y * H; press = e.buttons > 0 || e.type === 'pointerdown' ? 1 : 0.45;
      if (e.type === 'pointerdown') tap = [mx, my];           // a tap is an impulse, however briefly the button is held
    }, () => { mx = my = -1e4; });

    function build() {
      cols = Math.ceil(W / SP) + 1 + 2 * PAD; rows = Math.ceil(H / SP) + 1 + 2 * PAD; n = cols * rows;
      X = new Float32Array(n); Y = new Float32Array(n); PX = new Float32Array(n); PY = new Float32Array(n);
      RX = new Float32Array(n); RY = new Float32Array(n); AX = new Float32Array(n); AY = new Float32Array(n); sponge = new Float32Array(n);
      const ox = (W - (cols - 1 - 2 * PAD) * SP) / 2, oy = (H - (rows - 1 - 2 * PAD) * SP) / 2;
      const max = 4 * n;
      BA = new Int32Array(max); BB = new Int32Array(max); rest = new Float32Array(max); healAt = new Float64Array(max); nb = 0;
      const bond = (a, b) => { BA[nb] = a; BB[nb] = b; nb++; };
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        RX[i] = X[i] = PX[i] = ox + (c - PAD) * SP; RY[i] = Y[i] = PY[i] = oy + (r - PAD) * SP;
        const out = Math.max(PAD - c, c - (cols - 1 - PAD), PAD - r, r - (rows - 1 - PAD), 0) / PAD;
        sponge[i] = 1 - 0.4 * out * out;                       // extra damping only in the hidden margin
        if (c < cols - 1) bond(i, i + 1);
        if (r < rows - 1) bond(i, i + cols);
        if (c < cols - 1 && r < rows - 1) bond(i, i + cols + 1);
        if (c > 0 && r < rows - 1) bond(i, i + cols - 1);
      }
      for (let k = 0; k < nb; k++) { const dx = RX[BB[k]] - RX[BA[k]], dy = RY[BB[k]] - RY[BA[k]]; rest[k] = Math.sqrt(dx * dx + dy * dy); }
    }

    function tick(now) {
      if (!W) return;
      AX.fill(0); AY.fill(0);
      for (let k = 0; k < nb; k++) {
        if (healAt[k]) { if (now > healAt[k]) healAt[k] = 0; continue; }
        const a = BA[k], b = BB[k];
        const dx = X[b] - X[a], dy = Y[b] - Y[a], d = Math.sqrt(dx * dx + dy * dy) + 1e-6, s = (d - rest[k]) / rest[k];
        if (s > BREAK && press === 1) { healAt[k] = now + 3500 + Math.random() * 2500; continue; }   // only a held press can fracture
        const f = K * (d - rest[k]) / d;
        AX[a] += dx * f; AY[a] += dy * f; AX[b] -= dx * f; AY[b] -= dy * f;
      }
      const R = 48 * (0.7 + 0.5 * press), TR = 95;
      for (let i = 0; i < n; i++) {
        const dx = X[i] - mx, dy = Y[i] - my, d2 = dx * dx + dy * dy;
        if (d2 < R * R) { const d = Math.sqrt(d2) + 1e-3, f = (1 - d / R) * 1.4 * press; AX[i] += dx / d * f; AY[i] += dy / d * f; }
        if (tap) {
          // Radial velocity kick with a smooth bell profile: neighbors get similar speeds, so the
          // wave is large but the strain between them stays below the fracture limit.
          const tx = X[i] - tap[0], ty = Y[i] - tap[1], t2 = tx * tx + ty * ty;
          if (t2 < TR * TR) { const d = Math.sqrt(t2) + 1e-3, w = 0.5 + 0.5 * Math.cos(Math.PI * d / TR), f = w * w * 5; PX[i] -= tx / d * f; PY[i] -= ty / d * f; }
        }
        AX[i] += (RX[i] - X[i]) * 0.0006; AY[i] += (RY[i] - Y[i]) * 0.0006;   // keeps the lattice from drifting; too weak to reflect
        const damp = DAMP * sponge[i];
        const vx = (X[i] - PX[i]) * damp, vy = (Y[i] - PY[i]) * damp;
        PX[i] = X[i]; PY[i] = Y[i];
        X[i] += vx + AX[i]; Y[i] += vy + AY[i];
      }
      tap = null;
      ctx.fillStyle = '#07131f'; ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 1;
      const paths = BOND.map(() => new Path2D());
      for (let k = 0; k < nb; k++) {
        if (healAt[k]) continue;
        const a = BA[k], b = BB[k];
        if ((X[a] < -SP && X[b] < -SP) || (X[a] > W + SP && X[b] > W + SP) || (Y[a] < -SP && Y[b] < -SP) || (Y[a] > H + SP && Y[b] > H + SP)) continue;
        const dx = X[b] - X[a], dy = Y[b] - Y[a];
        const s = clamp(Math.abs(Math.sqrt(dx * dx + dy * dy) - rest[k]) / rest[k] / 0.05, 0, 1);
        const p = paths[Math.round(s * (BOND.length - 1))];
        p.moveTo(X[a], Y[a]); p.lineTo(X[b], Y[b]);
      }
      paths.forEach((p, l) => { ctx.strokeStyle = BOND[l]; ctx.stroke(p); });
      const dots = new Path2D();
      for (let i = 0; i < n; i++) {
        if (X[i] < -4 || X[i] > W + 4 || Y[i] < -4 || Y[i] > H + 4) continue;
        dots.moveTo(X[i] + 1.4, Y[i]); dots.arc(X[i], Y[i], 1.4, 0, 6.283);
      }
      ctx.fillStyle = 'rgba(201,230,255,0.9)'; ctx.fill(dots);
    }
    const resize = () => { [W, H] = fitCanvas(canvas, ctx); build(); };
    resize(); new ResizeObserver(resize).observe(canvas); visibleLoop(canvas, tick);
  }

  // Earth systems — wind-driven fire spread on a landscape; the cursor direction from the center is the wind.
  // The landscape is drawn into an image buffer, one pixel per CSS pixel, only when the fire advances
  // (every third frame); each frame copies that image to the canvas and draws the wind vane on top.
  function toyFire(canvas) {
    const ctx = canvas.getContext('2d');
    const off = document.createElement('canvas'), octx = off.getContext('2d');
    const CELL = 6;
    // Packed colours (ABGR) of a dot over the card's background: unburnt by fuel level, burning, burnt.
    const BG = [7, 19, 31], over = (a, c) => {
      const m = (k) => Math.round(BG[k] + (c[k] - BG[k]) * a);
      return (0xff000000 | (m(2) << 16) | (m(1) << 8) | m(0)) >>> 0;
    };
    const FUEL = Array.from({ length: 32 }, (_, k) => over(0.12 + 0.3 * k / 31, [94, 179, 242]));
    const BURNING = over(1, [255, 255, 255]), BURNT = over(0.05, [94, 179, 242]), BLANK = over(0, BG);
    let W = 0, H = 0, gw = 0, gh = 0, state, life, fuel, img, buf, wx = 0.6, wy = 0, twx = 0.6, twy = 0, frame = 0, lastBurn = 0;
    pointerNorm(canvas, (x, y) => { const dx = x - 0.5, dy = y - 0.5, m = Math.hypot(dx, dy) + 1e-6; const s = Math.min(1, m * 2.4); twx = dx / m * s; twy = dy / m * s; });
    function resize() {
      [W, H] = fitCanvas(canvas, ctx);
      gw = Math.ceil(W / CELL); gh = Math.ceil(H / CELL);
      state = new Uint8Array(gw * gh); life = new Int16Array(gw * gh); fuel = new Float32Array(gw * gh);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) fuel[y * gw + x] = clamp(0.55 + 0.35 * Math.sin(x * 0.37 + y * 0.21) * Math.cos(y * 0.33 - x * 0.12) + 0.2 * Math.sin(x * 0.9 + y * 0.7), 0.15, 1);
      off.width = Math.max(1, Math.ceil(W)); off.height = Math.max(1, Math.ceil(H));
      img = octx.createImageData(off.width, off.height); buf = new Uint32Array(img.data.buffer);
      paint();
    }
    function square(x0, y0, size, color) {
      const ow = off.width, oh = off.height;
      for (let y = Math.max(0, y0); y < Math.min(oh, y0 + size); y++) buf.fill(color, y * ow + Math.max(0, x0), y * ow + Math.min(ow, x0 + size));
    }
    function paint() {
      buf.fill(BLANK);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const i = y * gw + x, px = x * CELL + CELL / 2, py = y * CELL + CELL / 2;
        if (state[i] === 0) square(px - 1, py - 1, 2, FUEL[Math.round(fuel[i] * 31)]);
        else if (state[i] === 1) square(px - 2, py - 2, 5, BURNING);
        else square(px - 1, py - 1, 2, BURNT);
      }
      octx.putImageData(img, 0, 0);
    }
    const ignite = (i) => { state[i] = 1; life[i] = 5 + ((Math.random() * 4) | 0); };
    function tick(now) {
      if (!W) return;
      wx += (twx - wx) * 0.05; wy += (twy - wy) * 0.05;
      if (++frame % 3 === 0 && !REDUCED) {
        let burning = 0;
        const next = [];
        for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
          const i = y * gw + x;
          if (state[i] === 1) {
            burning++;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
              const j = ny * gw + nx; if (state[j] !== 0) continue;
              const align = (dx * wx + dy * wy) / Math.hypot(dx, dy);
              const p = 0.16 * fuel[j] * (1 + 1.9 * align) / (dx && dy ? 1.4 : 1);
              if (Math.random() < p) next.push(j);
            }
            if (--life[i] <= 0) { state[i] = 2; life[i] = 110 + ((Math.random() * 90) | 0); }
          } else if (state[i] === 2 && --life[i] <= 0) state[i] = 0;
        }
        for (const j of next) ignite(j);
        if (burning) lastBurn = now;
        if (now - lastBurn > 900) { ignite(((Math.random() * gh) | 0) * gw + ((Math.random() * gw) | 0)); lastBurn = now; }
        paint();
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0);
      // Wind vane
      const cx = W - 26, cy = 24, m = Math.hypot(wx, wy);
      ctx.strokeStyle = 'rgba(237,244,250,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, 6.283); ctx.stroke();
      if (m > 0.02) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + wx / m * 11 * Math.min(1, m), cy + wy / m * 11 * Math.min(1, m)); ctx.stroke(); }
    }
    resize(); new ResizeObserver(resize).observe(canvas); visibleLoop(canvas, tick);
  }

  function initToys() {
    const byId = (id) => document.getElementById(id);
    if (byId('toy-aero')) toyAirfoil(byId('toy-aero'));
    if (byId('toy-energy')) toySubsurface(byId('toy-energy'));
    if (byId('toy-semi')) toyMosfet(byId('toy-semi'));
    if (byId('toy-control')) toyArm(byId('toy-control'));
    if (byId('toy-material')) toyLattice(byId('toy-material'));
    if (byId('toy-earth')) toyFire(byId('toy-earth'));
  }

  /* ── Boot ───────────────────────────────────────────────────────────── */
  initBlueprint();
  initField();
  initMark();
  initGlobe();
  const stage = initStage();
  initHeat();
  initFlow();
  initOptim();
  initFourier();
  initToys();
  initLab();
  initCompare();
  initSR();
  initCounters();
  initScrollDriven(stage);
  initNav();
  initWrite();
  initHadamard();
  initPubFilter();
  initContact();
})();
