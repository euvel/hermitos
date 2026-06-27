/* ===================================================================
   HERMIT-OS — live reactive 3D orbifold
   A raymarched GLSL dynamical system in a black void: SOLID nested
   KAM tori around a singular gyroid core, with real lighting, rim
   light and ambient occlusion. Reacts to terminal commands.
   =================================================================== */

import * as THREE from 'three';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;

uniform vec2  uRes;
uniform float uTime;
uniform float uTurb;       // turbulence 0..1
uniform float uMetric;     // metric degeneracy 0..1
uniform float uKam;        // number of perturbations
uniform float uChaos;      // failure flash 0..1 (red)
uniform float uRecover;    // recovery flash 0..1 (green)
uniform float uElevated;   // kernel mode 0..1
uniform float uPulse;      // generic command pulse 0..1
uniform vec2  uCam;        // yaw, pitch

const vec3 AMBER = vec3(1.0, 0.69, 0.0);
const vec3 CYAN  = vec3(0.21, 0.88, 0.84);
const vec3 GREEN = vec3(0.49, 1.0, 0.42);
const vec3 RED   = vec3(1.0, 0.30, 0.30);

mat2 rot(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }

float hash(vec3 p){ p=fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }

float sdTorus(vec3 p, vec2 t){ vec2 q=vec2(length(p.xz)-t.x, p.y); return length(q)-t.y; }
float smin(float a,float b,float k){ float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(b,a,h)-k*h*(1.0-h); }
float gyroid(vec3 p){ return dot(sin(p), cos(p.yzx)); }

// material id written by map(): tori = 1..5, gyroid core = 10
float gMat;

float map(vec3 p){
  // slow self-rotation so the object always reads as 3D
  p.xz *= rot(uTime*0.13);
  p.xy *= rot(uTime*0.05 + 0.4);

  // inhomogeneous metric degeneracy: squash along a position-dependent
  // null direction — the shape folds where you push, smooth elsewhere.
  p.y *= mix(1.0, 0.42 + 0.30*sin(p.x*0.8 + uTime*0.2), uMetric*0.6);

  // turbulent interior warp (kept gentle so the form survives)
  if(uTurb > 0.001){
    p += uTurb*0.28*vec3(fbm(p*1.1+uTime*0.30), fbm(p*1.1+5.0), fbm(p*1.1-uTime*0.20-7.0));
  }

  float d = 1e9; gMat = 0.0;

  // ── KAM tori: nested, tilted, RIPPLED (knotted) rings ──
  int extra = int(min(uKam, 2.0));
  for(int i=0;i<5;i++){
    if(i >= 3 + extra) break;
    float fi = float(i);
    vec3 q = p;
    q.yz *= rot(1.15*fi + 0.25*uKam*sin(uTime*0.3+fi));
    q.xy *= rot(0.7*fi + uTime*0.04*fi);
    float aa = atan(q.z, q.x);
    q.y += 0.13*sin(aa*5.0 + uTime*0.8 + fi*1.7);          // ripple the tube
    float t = sdTorus(q, vec2(1.5 + fi*0.52, 0.11 + 0.02*sin(aa*9.0)));
    if(t < d){ d = t; gMat = 1.0 + fi; }
  }

  // ── singular core: kaleidoscopic ORBIFOLD fold + double-gyroid TPMS ──
  // an orbifold is a quotient by a symmetry group; we realize that literally
  // by folding space through a mirror group, then carving a triply-periodic
  // minimal surface lattice and subtracting a finer one (intricate, "weird").
  vec3 fp = p;
  fp.x = abs(fp.x);                                  // mirror folds = the quotient
  fp.z = abs(fp.z);
  fp.xz *= rot(0.5 + 0.10*sin(uTime*0.2));
  fp.xy *= rot(0.3);
  float freq = 3.0 + 0.6*sin(uTime*0.22);
  vec3 gp = fp * freq;
  float g1 = abs(gyroid(gp)) / freq - 0.05;                                  // primary shell
  float g2 = abs(dot(sin(gp*1.6 + 1.3), cos(gp.zxy*1.6))) / (freq*1.7) - 0.12; // finer lattice
  float ball = length(p) - (1.02 + 0.05*sin(uTime*0.4));
  float core = max(ball, g1);                         // gyroid shell within the sphere
  core = max(core, -g2);                              // carve holes → intricate
  float cusp = length(p) - 0.22;                      // tiny central singular cusp
  core = smin(core, cusp, 0.18);
  if(core < d){ d = core; gMat = 10.0; }

  return d;
}

vec3 calcNormal(vec3 p){
  vec2 e = vec2(0.0012, 0.0);
  return normalize(vec3(
    map(p+e.xyy)-map(p-e.xyy),
    map(p+e.yxy)-map(p-e.yxy),
    map(p+e.yyx)-map(p-e.yyx)));
}

// cheap ambient occlusion
float calcAO(vec3 p, vec3 n){
  float occ = 0.0, sca = 1.0;
  for(int i=0;i<5;i++){
    float h = 0.02 + 0.12*float(i);
    float d = map(p + n*h);
    occ += (h - d)*sca;
    sca *= 0.7;
  }
  return clamp(1.0 - 1.4*occ, 0.0, 1.0);
}

vec3 matColor(float id, float t){
  if(id > 9.0){
    // gyroid core: amber→green shimmer
    return mix(AMBER, GREEN, 0.5 + 0.5*sin(t*4.0 + uTime*0.5));
  }
  // tori: cyan→amber by ring index
  float f = fract(id * 0.27);
  return mix(CYAN, AMBER, f);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;

  // camera orbit
  float yaw = uCam.x + uTime*0.02;
  float pit = clamp(uCam.y, -1.25, 1.25);
  vec3 ro = vec3(0.0, 0.0, 6.0);
  ro.yz *= rot(pit); ro.xz *= rot(yaw);
  vec3 fwd = normalize(-ro);
  vec3 rgt = normalize(cross(vec3(0.0,1.0,0.0), fwd));
  vec3 up  = cross(fwd, rgt);
  vec3 rd  = normalize(uv.x*rgt + uv.y*up + 1.6*fwd);

  // ── background: very deep void + faint nebula + a few stars ──
  float neb = fbm(rd*2.2 + vec3(0.0,0.0,uTime*0.02));
  vec3 col = mix(vec3(0.0015,0.003,0.006), vec3(0.004,0.011,0.016), neb*0.5);
  col += CYAN  * 0.010 * pow(neb, 3.0);
  col += AMBER * 0.005 * pow(neb, 6.0);
  float star = pow(hash(floor(rd*240.0)), 80.0);
  col += vec3(star) * 0.45;

  // ── raymarch the solid object ──
  float t = 0.0;
  float hit = -1.0;
  float glow = 0.0;
  for(int i=0;i<128;i++){
    vec3 p = ro + rd*t;
    float d = map(p);
    glow += 0.004 / (0.06 + abs(d));     // SUBTLE rim haze, not the main event
    if(d < 0.0015){ hit = t; break; }
    if(t > 22.0) break;
    t += d * 0.48;                        // conservative step (TPMS isn't a true SDF)
  }

  if(hit > 0.0){
    vec3 p = ro + rd*hit;
    vec3 n = calcNormal(p);
    float ao = calcAO(p, n);

    vec3 base = matColor(gMat, hit);

    // lighting
    vec3 lpos = vec3(2.5, 3.5, 2.0);
    vec3 l = normalize(lpos);
    vec3 l2 = normalize(vec3(-2.0, -1.0, 1.5));   // cool fill
    float diff  = clamp(dot(n, l), 0.0, 1.0);
    float diff2 = clamp(dot(n, l2), 0.0, 1.0);
    vec3 h = normalize(l - rd);
    float spec = pow(clamp(dot(n, h), 0.0, 1.0), 48.0);
    float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);

    vec3 lit = base * (0.08 + 0.70*diff) * ao;     // key (darker, moodier)
    lit += CYAN * 0.09 * diff2 * ao;               // cool fill
    lit += vec3(0.75,0.85,0.85) * spec * 0.45;     // highlight
    lit += base * fres * 0.75;                      // rim glow

    // state tints
    lit = mix(lit, RED   * (0.4 + lit), clamp(uChaos + uTurb*0.45, 0.0, 1.0)*0.6);
    lit = mix(lit, GREEN * (0.4 + lit), uRecover*0.5);
    lit = mix(lit, mix(lit, AMBER, 0.4), uElevated*0.4);

    col = lit;
    col += base * glow * 0.16 * (1.0 + uPulse);
  } else {
    // faint glow halo from grazing the object's silhouette
    vec3 gcol = mix(CYAN, AMBER, 0.5 + 0.5*sin(uTime*0.3));
    gcol = mix(gcol, RED, clamp(uChaos + uTurb*0.6, 0.0, 1.0));
    gcol = mix(gcol, GREEN, uRecover*0.7);
    col += gcol * glow * 0.30 * (1.0 + uPulse*0.8);
  }

  // tonemap + grade (pulled darker)
  col = col / (1.0 + col);
  col = pow(col, vec3(0.95));
  col *= 0.85;
  float vig = smoothstep(1.35, 0.20, length(uv));
  col *= vig;
  col *= 0.95 + 0.05*sin(gl_FragCoord.y*0.5);   // sync with CSS scanlines

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Orbifold {
  constructor(canvas, bus, state) {
    this.bus = bus;
    this.state = state;
    this.canvas = canvas;
    this.t0 = performance.now();
    this.frames = 0; this.fps = 0; this.lastFps = performance.now();

    this.cur = { turb: 0, metric: 0.45, kam: 0, chaos: 0, recover: 0, elevated: 0, pulse: 0 };
    this.tgt = { turb: 0, metric: 0.45, kam: 0, chaos: 0, recover: 0, elevated: 0, pulse: 0 };
    this.cam = { yaw: 0, pitch: 0.2, dragging: false, lx: 0, ly: 0, vyaw: 0.05 };

    this.initRenderer();
    this.wireEvents();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.uniforms = {
      uRes:      { value: new THREE.Vector2() },
      uTime:     { value: 0 },
      uTurb:     { value: 0 },
      uMetric:   { value: 0.45 },
      uKam:      { value: 0 },
      uChaos:    { value: 0 },
      uRecover:  { value: 0 },
      uElevated: { value: 0 },
      uPulse:    { value: 0 },
      uCam:      { value: new THREE.Vector2(0, 0.2) },
    };
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms });
    this.scene.add(new THREE.Mesh(geo, mat));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    // render at reduced resolution for performance; CSS upscales to fullscreen
    const scale = window.innerWidth > 1600 ? 0.7 : 0.85;
    const w = Math.floor(window.innerWidth * scale);
    const h = Math.floor(window.innerHeight * scale);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100vw';
    this.canvas.style.height = '100vh';
    this.uniforms.uRes.value.set(w, h);
  }

  wireEvents() {
    const b = this.bus;
    b.on('turbulence', ({ on }) => { this.tgt.turb = on ? 1 : 0; });
    b.on('metric', ({ degeneracy }) => { this.tgt.metric = degeneracy; });
    b.on('kam', ({ perturb }) => { this.tgt.kam = perturb; this.pulse(); });
    b.on('elevate', ({ on }) => { this.tgt.elevated = on ? 1 : 0; this.pulse(); });
    b.on('orbifold:pulse', () => this.pulse());
    b.on('orbifold:mode', ({ mode }) => {
      if (mode === 'calm') { this.tgt.turb = 0; this.tgt.metric = 0.2; }
      if (mode === 'wild') { this.tgt.turb = 0.6; }
      if (mode === 'reset') { this.tgt.turb = 0; this.tgt.metric = 0.45; this.tgt.kam = 0; this.cam.yaw = 0; this.cam.pitch = 0.2; }
      if (mode === 'spin') { this.cam.vyaw = 0.6; }
    });
    b.on('chaos:fail', () => { this.tgt.chaos = 1; this.cur.chaos = 1; });
    b.on('chaos:recover', () => { this.tgt.chaos = 0; this.cur.recover = 1; this.tgt.recover = 0; });
    // honest visualization of a REAL injected fault: turbulence ∝ real severity
    b.on('orbifold:stress', ({ v }) => {
      this.tgt.turb = Math.max(0, Math.min(1, v));
      if (v <= 0.001) { this.tgt.chaos = 0; this.cur.recover = 1; }
    });

    // mouse orbit — the 3D canvas lives *behind* the full-screen shell, so we
    // listen on window. Right-drag orbits anywhere; left-drag orbits when it
    // starts on the chrome (topbar / footer / void), leaving the terminal free
    // for text selection.
    const onChrome = (t) => t && (t.id === 'topbar' || t.closest?.('#topbar') || t.id === 'hint' || t.closest?.('#hint') || t.id === 'orbifold' || t.id === 'crt-overlay' || t.closest?.('#crt-overlay'));
    window.addEventListener('pointerdown', (e) => {
      const orbit = e.button === 2 || (e.button === 0 && onChrome(e.target));
      if (!orbit) return;
      this.cam.dragging = true; this.cam.lx = e.clientX; this.cam.ly = e.clientY; this.cam.vyaw = 0;
    });
    window.addEventListener('pointerup', () => { this.cam.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.cam.dragging) return;
      this.cam.yaw   += (e.clientX - this.cam.lx) * 0.005;
      this.cam.pitch += (e.clientY - this.cam.ly) * 0.005;
      this.cam.lx = e.clientX; this.cam.ly = e.clientY;
    });
    window.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    window.addEventListener('wheel', (e) => { this.cam.pitch += e.deltaY * 0.0008; }, { passive: true });
  }

  pulse() { this.cur.pulse = 1; }

  animate(now) {
    requestAnimationFrame(this.animate);
    const u = this.uniforms;
    u.uTime.value = (now - this.t0) / 1000;

    const L = (a, b, k) => a + (b - a) * k;
    this.cur.turb     = L(this.cur.turb,     this.tgt.turb,     0.04);
    this.cur.metric   = L(this.cur.metric,   this.tgt.metric,   0.05);
    this.cur.kam      = L(this.cur.kam,      this.tgt.kam,      0.05);
    this.cur.chaos    = L(this.cur.chaos,    this.tgt.chaos,    0.06);
    this.cur.recover  = L(this.cur.recover,  this.tgt.recover,  0.04);
    this.cur.elevated = L(this.cur.elevated, this.tgt.elevated, 0.04);
    this.cur.pulse    = L(this.cur.pulse,    0,                 0.03);

    // gentle idle auto-rotate + drag inertia
    this.cam.yaw += this.cam.vyaw * 0.016;
    this.cam.vyaw *= 0.97;

    u.uTurb.value = this.cur.turb;
    u.uMetric.value = this.cur.metric;
    u.uKam.value = this.cur.kam;
    u.uChaos.value = this.cur.chaos;
    u.uRecover.value = this.cur.recover;
    u.uElevated.value = this.cur.elevated;
    u.uPulse.value = this.cur.pulse;
    u.uCam.value.set(this.cam.yaw, this.cam.pitch);

    this.renderer.render(this.scene, this.camera);

    this.frames++;
    if (now - this.lastFps > 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastFps));
      this.frames = 0; this.lastFps = now;
      this.bus.emit('fps', { fps: this.fps });
    }
  }
}
