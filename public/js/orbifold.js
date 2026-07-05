/* ===================================================================
   hermit — live reactive 3D field: a REAL strange attractor.

   The background is no longer a fixed decorative raymarch. It is a live
   integration of Thomas' cyclically-symmetric attractor

        dx/dt = sin(y) − b·x
        dy/dt = sin(z) − b·y
        dz/dt = sin(x) − b·z

   run over a few thousand particles on the GPU. The single dissipation
   parameter b spans the system's behaviour: small b → a space-filling
   strange attractor (chaos); larger b → it tightens toward order. And b —
   plus the colour and energy — is DRIVEN BY THE SITE'S REAL STATE: inject
   chaos and the field genuinely becomes chaotic; recover and it settles;
   elevate and it warms. What you see is the system, not an illustration.

   It is also far cheaper than the old raymarch (points, not 128-step
   sphere tracing), and it is robust: it recovers from WebGL context loss,
   pauses behind full-screen labs and when the tab is hidden, and adapts
   its particle count to hold a smooth frame rate.
   =================================================================== */

import * as THREE from 'three';

const N_MAX = 6000;                    // particle budget
const B_BASE = 0.19;                   // Thomas dissipation at idle: the full, structured attractor

const PVERT = /* glsl */`
  attribute float aSpeed;
  varying float vSpeed;
  uniform float uSize;
  void main() {
    vSpeed = aSpeed;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize / max(0.6, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const PFRAG = /* glsl */`
  precision highp float;
  varying float vSpeed;
  uniform vec3 uColA, uColB, uTint;
  uniform float uTintAmt, uBright;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float a = smoothstep(0.25, 0.0, r2);           // soft round point
    vec3 col = mix(uColA, uColB, clamp(vSpeed, 0.0, 1.0));
    col = mix(col, uTint, uTintAmt);
    gl_FragColor = vec4(col * uBright, a);
  }
`;

export class Orbifold {
  constructor(canvas, bus, state) {
    this.bus = bus;
    this.state = state;
    this.canvas = canvas;
    this.t0 = performance.now();
    this.last = this.t0;
    this.frames = 0; this.fps = 60; this.lastFps = this.t0;
    this.lost = false;
    this.active = N_MAX;               // adaptive draw count
    this.lowFrames = 0; this.highFrames = 0;

    // smoothed reactive signals (targets set by bus events)
    this.cur = { turb: 0, chaos: 0, recover: 0, elevated: 0, pulse: 0 };
    this.tgt = { turb: 0, chaos: 0, recover: 0, elevated: 0, pulse: 0 };
    this.cam = { yaw: 0, pitch: 0.25, dragging: false, lx: 0, ly: 0, vyaw: 0.06 };
    this.tapJitter = 0;          // brief ripple on each command the user runs
    this.wasStressed = false;    // for the auto-recover-after-chaos settle

    // particle state (integrated on the CPU, drawn on the GPU)
    this.pos = new Float32Array(N_MAX * 3);
    this.spd = new Float32Array(N_MAX);
    for (let i = 0; i < N_MAX; i++) this.spawn(i);

    this.initRenderer();
    this.wireEvents();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  spawn(i) {                            // seed near the core; the flow carries it onto the attractor
    this.pos[i * 3] = (Math.random() - 0.5) * 3;
    this.pos[i * 3 + 1] = (Math.random() - 0.5) * 3;
    this.pos[i * 3 + 2] = (Math.random() - 0.5) * 3;
    this.spd[i] = 0.3;
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);

    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.spdAttr = new THREE.BufferAttribute(this.spd, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aSpeed', this.spdAttr);

    this.uniforms = {
      uSize:    { value: 190 * Math.min(window.devicePixelRatio, 1.5) },
      uColA:    { value: new THREE.Color(0.16, 0.72, 0.80) },   // slow → cyan
      uColB:    { value: new THREE.Color(1.0, 0.72, 0.15) },    // fast → amber
      uTint:    { value: new THREE.Color(0, 0, 0) },
      uTintAmt: { value: 0 },
      uBright:  { value: 0.9 },
    };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVERT, fragmentShader: PFRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    this.resize();
    window.addEventListener('resize', () => this.resize());

    // ── robustness: recover from WebGL context loss instead of dying ──
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; }, false);
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.posAttr.needsUpdate = true; this.spdAttr.needsUpdate = true;
    }, false);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100vw';
    this.canvas.style.height = '100vh';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.uniforms.uSize.value = (w < 700 ? 150 : 190) * Math.min(window.devicePixelRatio, 1.5);
  }

  wireEvents() {
    const b = this.bus;
    b.on('turbulence', ({ on }) => { this.tgt.turb = on ? 1 : 0; });
    b.on('elevate', ({ on }) => { this.tgt.elevated = on ? 1 : 0; this.pulse(); });
    b.on('orbifold:pulse', () => this.pulse());
    // a reactive tap on EVERY command the user runs — the field answers activity
    b.on('orbifold:cmd', ({ weight }) => {
      const w = Math.max(0.2, Math.min(1, weight || 0.4));
      this.cur.pulse = Math.max(this.cur.pulse, w);
      this.tapJitter = Math.max(this.tapJitter, 0.006 * w);
    });
    b.on('orbifold:mode', ({ mode }) => {
      if (mode === 'calm') { this.tgt.turb = 0; }
      if (mode === 'wild') { this.tgt.turb = 0.7; }
      if (mode === 'reset') { this.tgt.turb = 0; this.cam.yaw = 0; this.cam.pitch = 0.25; }
      if (mode === 'spin') { this.cam.vyaw = 0.7; }
    });
    b.on('chaos:fail', () => { this.tgt.chaos = 1; this.cur.chaos = 1; });
    b.on('chaos:recover', () => { this.tgt.chaos = 0; this.cur.recover = 1; this.tgt.recover = 0; });
    // honest: field turbulence ∝ REAL injected-fault severity
    b.on('orbifold:stress', ({ v }) => {
      this.tgt.turb = Math.max(0, Math.min(1, v));
      if (v <= 0.001) { this.tgt.chaos = 0; this.cur.recover = 1; }
    });

    const onChrome = (t) => t && (t.id === 'topbar' || t.closest?.('#topbar') || t.id === 'hint' || t.closest?.('#hint') || t.id === 'orbifold' || t.id === 'crt-overlay' || t.closest?.('#crt-overlay'));
    window.addEventListener('pointerdown', (e) => {
      const orbit = e.button === 2 || (e.button === 0 && onChrome(e.target));
      if (!orbit) return;
      this.cam.dragging = true; this.cam.lx = e.clientX; this.cam.ly = e.clientY; this.cam.vyaw = 0;
    });
    window.addEventListener('pointerup', () => { this.cam.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.cam.dragging) return;
      this.cam.yaw += (e.clientX - this.cam.lx) * 0.005;
      this.cam.pitch += (e.clientY - this.cam.ly) * 0.005;
      this.cam.lx = e.clientX; this.cam.ly = e.clientY;
    });
    window.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    window.addEventListener('wheel', (e) => { this.cam.pitch += e.deltaY * 0.0008; }, { passive: true });
  }

  pulse() { this.cur.pulse = 1; }

  // is a full-screen lab covering the field? then don't waste the GPU on it
  occluded() {
    if (document.hidden) return true;
    // a *backgrounded* (display:none) overlay must NOT keep the field paused —
    // this is what made the background stop after `linux` → Ctrl-] → agent.
    return [...document.querySelectorAll('#km-overlay,#ly-overlay,#nn-overlay,#vm-overlay')]
      .some(el => el.style.display !== 'none');
  }

  integrate(dt, b, jitter) {
    const n = this.active, pos = this.pos, spd = this.spd;
    const h = Math.min(0.06, dt) * 0.9;            // stable, framerate-independent step
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      let x = pos[j], y = pos[j + 1], z = pos[j + 2];
      const dx = Math.sin(y) - b * x;
      const dy = Math.sin(z) - b * y;
      const dz = Math.sin(x) - b * z;
      x += dx * h; y += dy * h; z += dz * h;
      if (jitter) { x += (Math.random() - 0.5) * jitter; y += (Math.random() - 0.5) * jitter; z += (Math.random() - 0.5) * jitter; }
      pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
      // normalized speed → colour (slow cyan, fast amber)
      spd[i] = Math.min(1, Math.hypot(dx, dy, dz) * 0.32);
    }
    // trickle of respawns keeps the cloud alive and full
    const r = (n * 0.0015) | 0;
    for (let k = 0; k < r; k++) this.spawn((Math.random() * n) | 0);
  }

  adapt() {                                       // hold a smooth frame rate
    if (this.fps < 38) { this.lowFrames++; this.highFrames = 0; }
    else if (this.fps > 55) { this.highFrames++; this.lowFrames = 0; }
    else { this.lowFrames = this.highFrames = 0; }
    if (this.lowFrames > 6 && this.active > 1500) { this.active = Math.max(1500, this.active - 1000); this.lowFrames = 0; }
    else if (this.highFrames > 20 && this.active < N_MAX) { this.active = Math.min(N_MAX, this.active + 500); this.highFrames = 0; }
  }

  animate(now) {
    requestAnimationFrame(this.animate);
    if (this.lost) { this.last = now; return; }

    // measure fps regardless (topbar + telemetry rely on it)
    this.frames++;
    if (now - this.lastFps > 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastFps));
      this.frames = 0; this.lastFps = now;
      this.bus.emit('fps', { fps: this.fps });
      this.adapt();
    }

    // pause the heavy work behind full-screen labs / hidden tabs
    if (this.occluded()) { this.last = now; return; }

    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;

    // perturbations self-heal: targets relax to baseline so the field always
    // recovers to calm after chaos, unless something is actively re-driving it.
    const relax = Math.pow(0.72, dt);                     // ~2s half-life
    if (this.tgt.turb > 0.25) this.wasStressed = true;
    this.tgt.turb *= relax; this.tgt.chaos *= relax;
    if (this.wasStressed && this.tgt.turb < 0.05) { this.wasStressed = false; this.cur.recover = 1; }

    // smooth the reactive signals
    const L = (a, t, k) => a + (t - a) * k;
    this.cur.turb = L(this.cur.turb, this.tgt.turb, 0.04);
    this.cur.chaos = L(this.cur.chaos, this.tgt.chaos, 0.06);
    this.cur.recover = L(this.cur.recover, this.tgt.recover, 0.04);
    this.cur.elevated = L(this.cur.elevated, this.tgt.elevated, 0.04);
    this.cur.pulse = L(this.cur.pulse, 0, 0.03);

    // REAL state → the attractor's dissipation and appearance.
    // Idle = the full structured attractor (b≈0.19). Stress makes it more
    // violent; a recover briefly raises dissipation so the field visibly
    // settles (a green "healing") before relaxing back to baseline.
    const stress = Math.max(0, Math.min(1, this.cur.turb + this.cur.chaos * 0.5));
    const b = B_BASE - 0.03 * stress + this.cur.recover * 0.13;
    const jitter = stress * 0.008 + this.tapJitter;       // turbulence + per-command ripple
    this.tapJitter *= Math.pow(0.05, dt);                 // the command ripple fades fast
    this.integrate(dt, b, jitter);
    this.posAttr.needsUpdate = true;
    this.spdAttr.needsUpdate = true;
    this.geo.setDrawRange(0, this.active);

    // colour: state tint (chaos→red, recover→green, elevated→amber) + pulse brightness
    const u = this.uniforms;
    const tintAmt = Math.min(0.85, this.cur.chaos + this.cur.recover + this.cur.elevated * 0.6);
    const tr = this.cur.chaos, tg = this.cur.recover, ta = this.cur.elevated * 0.6;
    const sum = tr + tg + ta || 1;
    u.uTint.value.setRGB(
      (tr * 1.0 + tg * 0.28 + ta * 1.0) / sum,
      (tr * 0.30 + tg * 1.0 + ta * 0.72) / sum,
      (tr * 0.30 + tg * 0.42 + ta * 0.15) / sum,
    );
    u.uTintAmt.value = tintAmt;
    u.uBright.value = 0.85 + this.cur.pulse * 0.9 + stress * 0.15;

    // camera orbit (idle auto-rotate + drag inertia)
    this.cam.yaw += this.cam.vyaw * 0.016 + 0.0016;
    this.cam.vyaw *= 0.97;
    const pit = Math.max(-1.2, Math.min(1.2, this.cam.pitch));
    const R = 15;
    this.camera.position.set(
      R * Math.cos(pit) * Math.sin(this.cam.yaw),
      R * Math.sin(pit),
      R * Math.cos(pit) * Math.cos(this.cam.yaw),
    );
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  }
}
