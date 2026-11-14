// =====================================================================
// Mars Walk VR HUD - التطبيق: أنت واقف على سطح المريخ (عالم كامل 360°)، تلف وتمشي،
// يسار الـ HUD: التعرف على العقبات اللي تشوفها · يمين الـ HUD: البدلة مقابل المريخ
// الصخور والأرض مكسوّة بصور حقيقية من Perseverance ()
// =====================================================================
(function () {
"use strict";
const THREE = window.THREE, ML = window.MarsLogic, W = window.WalkLogic, CFG = W.WALK;
const $ = id => document.getElementById(id);
const statusEl = $("status");
function setStatus(msg, cls) { statusEl.textContent = msg; statusEl.className = "status " + (cls || ""); }
if (!THREE) { setStatus("ما انحملت مكتبة three.js. تأكدوا إن three.min.js موجود بجانب الصفحة.", "bad"); return; }
const PROFILES = window.CLASS_PROFILES, TEXCOL = window.TEXTURE_COLORS, ENV = window.PHOENIX_ENV || [];

const C = { hud: "#3cff8f", warn: "#ffd23c", danger: "#ff4a4a", dim: "rgba(60,255,143,0.65)", unk: "#c9a7ff", hw: "#7fb4ff" };
const RISK_COLOR = [C.hud, C.warn, C.danger];
const CLASS_COLOR = { BOULDER: C.danger, OUTCROP: C.danger, ROCK: C.warn, UNKNOWN: C.unk, "ROVER HARDWARE": C.hw };
const HUD_LAYER = 1;

const state = {
  ready: false, running: false, stereo: false, gyro: false, autoDemo: false,
  pos: { x: CFG.START.x, z: CFG.START.z }, yaw: 0, pitch: -0.08, yawOffset: 0,
  heading: 0, seen: [], summary: null, nextScan: 0,
  suit: W.initSuit(CFG), suitStatus: { st: {}, alarms: [] }, env: null, envHours: 0, demoT: 0,
  keys: new Set(), hold: { left: false, right: false, fwd: false, xrFwd: false }, lastFrame: 0, lastHud: 0
};
window.__walk = state;

// =====================================================================
// المشهد
// =====================================================================
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.xr.setReferenceSpaceType("local");
const scene = new THREE.Scene();
const HORIZON = new THREE.Color("#d6ad86"), ZENITH = new THREE.Color("#8d6a50");
scene.background = HORIZON.clone();
scene.fog = new THREE.Fog(HORIZON.clone(), 60, 1400);
const rig = new THREE.Group();
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 7000);
camera.layers.enable(HUD_LAYER); rig.add(camera); scene.add(rig);
const eyes = [-1, 1].map(side => {
  const e = new THREE.PerspectiveCamera(85, 1, 0.05, 7000);
  e.position.x = side * 0.032; e.layers.enable(HUD_LAYER); camera.add(e); return e;
});
const SUN_AZ = 50 * Math.PI / 180, SUN_EL = 30 * Math.PI / 180;
const sunDir = new THREE.Vector3(Math.cos(SUN_EL) * Math.sin(SUN_AZ), Math.sin(SUN_EL), -Math.cos(SUN_EL) * Math.cos(SUN_AZ));
const shadowDir = new THREE.Vector2(-sunDir.x, -sunDir.z).normalize();
const sun = new THREE.DirectionalLight(0xfff1e0, 2.6); sun.position.copy(sunDir);
scene.add(sun, new THREE.HemisphereLight(0xe6c09a, 0x5c3b29, 1.05));

let world = null, features = [], sky = null, selfShadow = null;
const loader = new THREE.TextureLoader();
const LOCAL_FILE = location.protocol === "file:";
function nasaTex(file, repeat) {
  if (LOCAL_FILE) return null; // المتصفح يمنع الصور المحلية داخل WebGL: نكمل بدون ملمس
  const t = loader.load(file, undefined, undefined, () => setStatus("ما انحمل ملف الملمس: " + file + " (تأكدوا إن صور الملمس مرفوعة)", "bad"));
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (repeat) t.repeat.set(repeat, repeat);
  return t;
}
function canvasTexture(w, hh, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = hh; draw(c.getContext("2d"), w, hh);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function buildScene() {
  const rnd = ML.mulberry32(ML.CONFIG.SEED + 999), tmp = new THREE.Color();
  const half = world.half, n1 = world.n1, cell = world.cell, N = world.N;

  // ---- السماء ----
  const skyGeo = new THREE.SphereGeometry(5000, 32, 16), sp = skyGeo.attributes.position, sc = new Float32Array(sp.count * 3);
  for (let i = 0; i < sp.count; i++) { tmp.copy(HORIZON).lerp(ZENITH, Math.pow(ML.clamp(sp.getY(i) / 5000, 0, 1), 0.55)); sc.set([tmp.r, tmp.g, tmp.b], i * 3); }
  skyGeo.setAttribute("color", new THREE.BufferAttribute(sc, 3));
  sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  const sunTex = canvasTexture(256, 256, (c, w) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.07, "rgba(255,250,240,1)"); g.addColorStop(0.12, "rgba(200,220,255,0.55)"); g.addColorStop(1, "rgba(170,200,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, w, w);
  });
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
  sunSprite.position.copy(sunDir).multiplyScalar(4500); sunSprite.scale.setScalar(1500); sky.add(sunSprite);
  sky.renderOrder = -10; scene.add(sky);

  // ---- الأرض: ملمس رمل حقيقي من Mastcam-Z يتكرر كل 2.5 م، مع تغير بسيط في السطوع ----
  const ground = nasaTex("ground.jpg");
  const pos = new Float32Array(n1 * n1 * 3), uv = new Float32Array(n1 * n1 * 2), col = new Float32Array(n1 * n1 * 3);
  for (let iz = 0; iz < n1; iz++) for (let ix = 0; ix < n1; ix++) {
    const i = iz * n1 + ix, x = -half + ix * cell, z = -half + iz * cell;
    pos.set([x, world.heights[i], z], i * 3); uv.set([x / 2.5, z / 2.5], i * 2);
    const v = 0.78 + 0.22 * ML.fbm(x / 23, z / 23, 3, ML.CONFIG.SEED + 300) - 0.12 * world.rough[i];
    col.set([v, v * 0.97, v * 0.95], i * 3);
  }
  const idx = new Uint32Array(N * N * 6);
  for (let iz = 0, k = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) { const a = iz * n1 + ix; idx.set([a, a + n1, a + 1, a + 1, a + n1, a + n1 + 1], k); k += 6; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
  if (!ground) for (let i = 0; i < col.length; i += 3) { col[i] *= 0.76; col[i + 1] *= 0.48; col[i + 2] *= 0.3; }
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: ground })));

  // ---- الأرض البعيدة والتلال ----
  const fc = half / 5, fseg = 2 * Math.round(3200 / fc), fsize = fseg * fc, fn1 = fseg + 1;
  const fpos = new Float32Array(fn1 * fn1 * 3), fuv = new Float32Array(fn1 * fn1 * 2), fidx = [];
  for (let iz = 0; iz < fn1; iz++) for (let ix = 0; ix < fn1; ix++) {
    const i = iz * fn1 + ix, x = -fsize / 2 + ix * fc, z = -fsize / 2 + iz * fc, d = Math.hypot(x, z);
    const hills = Math.max(0, ML.fbm(x / 700 + 3, z / 700 + 8, 3, ML.CONFIG.SEED + 400) - 0.42) * ML.smoothstep(350, 2400, d) * 520;
    fpos.set([x, ML.baseHeight(x, z, ML.CONFIG.SEED) + hills - 0.05, z], i * 3); fuv.set([x / 2.5, z / 2.5], i * 2);
  }
  for (let iz = 0; iz < fseg; iz++) for (let ix = 0; ix < fseg; ix++) {
    const x = -fsize / 2 + (ix + 0.5) * fc, z = -fsize / 2 + (iz + 0.5) * fc;
    if (Math.abs(x) < half && Math.abs(z) < half) continue;
    const a = iz * fn1 + ix; fidx.push(a, a + fn1, a + 1, a + 1, a + fn1, a + fn1 + 1);
  }
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute("position", new THREE.BufferAttribute(fpos, 3)); fgeo.setAttribute("uv", new THREE.BufferAttribute(fuv, 2));
  fgeo.setIndex(fidx); fgeo.computeVertexNormals();
  scene.add(new THREE.Mesh(fgeo, new THREE.MeshLambertMaterial({ map: ground, color: ground ? 0xd8d0c8 : 0xa6714d })));

  // ---- الصخور: 5 ملمسات صخر حقيقية من صور Mastcam-Z ----
  const rockGeo = (() => {
    const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.78 + 0.4 * ML.vnoise(x * 1.7 + 9, y * 1.7 + z * 1.3 + 4, 78);
      p.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals(); return g;
  })();
  const rockTex = [0, 1, 2, 3, 4].map(k => nasaTex("rock_" + k + ".jpg"));
  const groups = rockTex.map(() => []);
  world.rocks.forEach((rk, i) => { rk.tex = i % 5; rk.shade = 0.86 + rk.tint * 0.2; groups[rk.tex].push(rk); });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), e = new THREE.Euler();
  const v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();
  groups.forEach((list, k) => {
    const mesh = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ map: rockTex[k], color: rockTex[k] ? 0xffffff : 0x9a6a4e, flatShading: true }), list.length);
    list.forEach((rk, i) => {
      const sy = rk.h / 0.7;
      e.set((rk.tint - 0.5) * 0.5, rk.rot, (rk.sx - 1) * 1.2);
      m4.compose(v3.set(rk.x, rk.y - 0.3 * sy, rk.z), q.setFromEuler(e), s3.set(rk.r * rk.sx, sy, rk.r * rk.sz));
      mesh.setMatrixAt(i, m4); mesh.setColorAt(i, tmp.setScalar(rk.shade));
    });
    scene.add(mesh);
  });

  // ---- ظلال الصخور ----
  const shadowRocks = world.rocks.filter(r => r.r >= 0.14);
  const shadowGeo = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x1a0d08, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, shadowRocks.length);
  const shadowYaw = Math.atan2(-shadowDir.y, shadowDir.x);
  shadowRocks.forEach((rk, i) => {
    const len = rk.h / Math.tan(SUN_EL) * 0.6, cx = rk.x + shadowDir.x * len * 0.5, cz = rk.z + shadowDir.y * len * 0.5;
    const gy = ML.heightAt(world, cx, cz), gx1 = ML.heightAt(world, cx + 0.6, cz), gz1 = ML.heightAt(world, cx, cz + 0.6);
    nrm.set(-(gx1 - gy) / 0.6, 1, -(gz1 - gy) / 0.6).normalize();
    q.setFromUnitVectors(up, nrm).multiply(q2.setFromAxisAngle(up, shadowYaw));
    m4.compose(v3.set(cx, gy + 0.03, cz), q, s3.set(rk.r * 1.05 + len * 0.5, 1, rk.r * 1.05)); shadows.setMatrixAt(i, m4);
  });
  scene.add(shadows);
  selfShadow = new THREE.Mesh(shadowGeo, shadowMat.clone()); scene.add(selfShadow);

  // ---- المعالم الإضافية ----
  const outTex = [null, nasaTex("outcrop_1.jpg"), nasaTex("outcrop_2.jpg")];
  features.forEach(f => {
    const g = new THREE.Group();
    if (f.kind === "outcrop") {
      const bg = new THREE.BoxGeometry(1, 1, 1, 10, 3, 10), p = bg.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const edge = Math.max(Math.abs(x), Math.abs(z)) * 2, n = ML.vnoise(x * 4 + f.x, z * 4 + f.z, 91);
        p.setXYZ(i, x * (0.85 + 0.3 * n), y > 0 ? 0.5 - 0.35 * edge * edge - 0.15 * n + 0.05 * Math.round(n * 4) : y, z * (0.85 + 0.3 * ML.vnoise(z * 5, x * 5, 7)));
      }
      bg.computeVertexNormals();
      let t = null;
      if (outTex[f.tex]) { t = outTex[f.tex].clone(); t.repeat.set(f.w / 1.6, f.h / 1.2); t.needsUpdate = true; }
      const m = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ map: t, color: t ? 0xffffff : 0xc9a07c, flatShading: true }));
      m.scale.set(f.w, f.h * 1.6, f.d); m.position.y = -f.h * 0.3; g.add(m);
    } else if (f.kind === "debris") {
      const mat = new THREE.MeshLambertMaterial({ color: 0xa9a49d, emissive: 0x1c1b19 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(f.w, 0.04, f.d, 6, 1, 6), mat);
      const pp = plate.geometry.attributes.position;
      for (let i = 0; i < pp.count; i++) pp.setY(i, pp.getY(i) + 0.12 * Math.sin(pp.getX(i) * 6) * Math.cos(pp.getZ(i) * 5));
      plate.geometry.computeVertexNormals();
      plate.rotation.set(0.5, 0, 0.3); plate.position.y = f.h * 0.45;
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, f.w * 0.6, 12), new THREE.MeshLambertMaterial({ color: 0xc7c2ba }));
      can.rotation.z = Math.PI / 2; can.position.set(0, 0.1, f.d * 0.35);
      g.add(plate, can);
    } else {
      const mg = new THREE.IcosahedronGeometry(1, 2), p = mg.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.85 + 0.25 * ML.vnoise(p.getX(i) * 2 + 5, p.getY(i) * 2 + p.getZ(i), 33); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
      mg.computeVertexNormals();
      const m = new THREE.Mesh(mg, new THREE.MeshLambertMaterial({ color: 0x2c2724 }));
      m.scale.set(f.w / 2, f.h / 1.6, f.d / 2); m.position.y = f.h * 0.35; g.add(m);
    }
    g.position.set(f.x, f.y, f.z); g.rotation.y = f.rot; scene.add(g);
  });
}

// =====================================================================
// المسح والتعرف: كل عقبة ضمن 30 م وفي مجال النظر وما يغطيها تل
// =====================================================================
const ndc = new THREE.Vector3(), headPos = new THREE.Vector3(), headQuat = new THREE.Quaternion(), fwd = new THREE.Vector3();
function measured(o) {
  if (o.kind === "rock") {
    const t = TEXCOL["rock_" + o.ref.tex + ".jpg"];
    return { h: o.ref.h, w: 2 * o.ref.r * Math.max(o.ref.sx, o.ref.sz), lab: [t[0] * o.ref.shade, t[1], t[2]] };
  }
  const f = o.ref;
  return { h: f.h, w: Math.max(f.w, f.d), lab: f.color || TEXCOL["outcrop_" + f.tex + ".jpg"] };
}
function scan() {
  const R = CFG.SCAN_RANGE_M, cand = [];
  ML.rocksNear(world, headPos.x, headPos.z, R).forEach(rk => { if (rk.h >= CFG.MIN_OBSTACLE_H) cand.push({ kind: "rock", ref: rk, x: rk.x, y: rk.y + rk.h * 0.5, z: rk.z }); });
  features.forEach(f => cand.push({ kind: f.kind, ref: f, x: f.x, y: f.y + f.h * 0.5, z: f.z }));
  const seen = [];
  for (const o of cand) {
    const dx = o.x - headPos.x, dy = o.y - headPos.y, dz = o.z - headPos.z, dist = Math.hypot(dx, dy, dz);
    if (dist > R || dist < 0.4) continue;
    ndc.set(o.x, o.y, o.z).project(camera);
    if (ndc.z > 1 || Math.abs(ndc.x) > 1.02 || Math.abs(ndc.y) > 1.02) continue;
    const hit = ML.raycastTerrain(world, headPos.x, headPos.y, headPos.z, dx / dist, dy / dist, dz / dist, dist);
    if (hit && hit.t < dist - 1) continue; // تل يغطيها
    const m = measured(o), r = W.recognize(m, PROFILES, CFG);
    if (!r) continue;
    seen.push(Object.assign(r, { dist, h: m.h, w: m.w, o }));
  }
  seen.sort((a, b) => a.dist - b.dist);
  state.seen = seen; state.summary = W.summarize(seen);
  updateBrackets();
}

// علامات الزوايا حول العقبات (في طبقة الـ HUD)
function bracketTexture(color) {
  return canvasTexture(128, 128, (c, w) => {
    c.strokeStyle = color; c.lineWidth = 8; const m = 5, len = 34;
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, w - m, 1, -1], [w - m, w - m, -1, -1]]) { c.beginPath(); c.moveTo(x + dx * len, y); c.lineTo(x, y); c.lineTo(x, y + dy * len); c.stroke(); }
  });
}
const bracketTex = {}; for (const k in CLASS_COLOR) bracketTex[k] = bracketTexture(CLASS_COLOR[k]);
const marks = [];
for (let i = 0; i < CFG.MAX_BRACKETS; i++) {
  const box = new THREE.Sprite(new THREE.SpriteMaterial({ map: bracketTex.ROCK, depthTest: false, fog: false }));
  const lc = document.createElement("canvas"); lc.width = 320; lc.height = 48;
  const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt, depthTest: false, fog: false }));
  for (const s of [box, label]) { s.layers.set(HUD_LAYER); s.renderOrder = 20; s.visible = false; scene.add(s); }
  marks.push({ box, label, lc, lt, key: "" });
}
function updateBrackets() {
  marks.forEach((mk, i) => {
    const s = state.seen[i];
    mk.box.visible = mk.label.visible = !!s;
    if (!s) return;
    const o = s.o;
    mk.box.material.map = bracketTex[s.cls];
    mk.box.position.set(o.x, o.y, o.z);
    const size = Math.max(s.w, 0.35);
    mk.box.scale.set(size * 1.25, Math.max(s.h, 0.3) * 1.5, 1);
    const lh = Math.max(0.12, s.dist * 0.035);
    mk.label.position.set(o.x, o.y + Math.max(s.h, 0.3) * 0.75 + lh * 0.7, o.z);
    mk.label.scale.set(lh * 6.6, lh, 1);
    const key = (i + 1) + s.cls;
    if (mk.key !== key) {
      mk.key = key;
      const c = mk.lc.getContext("2d"); c.clearRect(0, 0, 320, 48);
      c.font = "700 30px ui-monospace, Menlo, Consolas, monospace"; c.textAlign = "center"; c.textBaseline = "middle";
      c.shadowColor = "rgba(0,0,0,0.95)"; c.shadowBlur = 5; c.fillStyle = CLASS_COLOR[s.cls];
      c.fillText((i + 1) + " " + s.cls, 160, 24); mk.lt.needsUpdate = true;
    }
  });
}

// =====================================================================
// لوحة الـ HUD
// =====================================================================
const hudCanvas = document.createElement("canvas"), h = hudCanvas.getContext("2d");
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace; hudTex.generateMipmaps = false; hudTex.minFilter = THREE.LinearFilter;
const hud = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
hud.layers.set(HUD_LAYER); hud.renderOrder = 100; hud.frustumCulled = false; camera.add(hud);

function layout() {
  const w = window.innerWidth, hh = window.innerHeight, xr = renderer.xr.isPresenting;
  if (!xr) { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(w, hh, false); }
  let aspect, fov, fill;
  if (xr) { aspect = 1.25; fov = 52; fill = 1; }
  else if (state.stereo) { aspect = (w / 2) / hh; fov = 85; fill = 0.9; }
  else { aspect = w / hh; fov = 75; fill = 1; }
  if (!xr) { camera.fov = fov; camera.aspect = aspect; camera.updateProjectionMatrix(); for (const e of eyes) { e.fov = fov; e.aspect = aspect; e.updateProjectionMatrix(); } }
  const D = 2.4, ph = 2 * D * Math.tan(fov * Math.PI / 360) * fill;
  hud.position.set(0, 0, -D); hud.scale.set(ph * aspect, ph, 1);
  const H = 900, Wd = Math.round(ML.clamp(H * aspect, 700, 1800));
  if (hudCanvas.width !== Wd || hudCanvas.height !== H) { hudCanvas.width = Wd; hudCanvas.height = H; hudTex.dispose(); }
  $("navBtns").style.display = state.running && !state.stereo && !xr ? "flex" : "none";
  state.lastHud = 0;
}
window.addEventListener("resize", layout);
function text(s, x, y, size, color, align, bold) { h.font = (bold ? "700 " : "600 ") + Math.round(size) + "px ui-monospace, Menlo, Consolas, monospace"; h.textAlign = align; h.fillStyle = color; h.fillText(s, x, y); }
function plate(x, y, w, hh) { h.save(); h.shadowBlur = 0; h.fillStyle = "rgba(0,0,0,0.36)"; h.fillRect(x, y, w, hh); h.restore(); }
const hhmm = m => Math.floor(m / 60) + ":" + String(Math.floor(m % 60)).padStart(2, "0");

function drawHud(now) {
  const Wd = hudCanvas.width, H = hudCanvas.height, u = H / 100, cx = Wd / 2;
  h.clearRect(0, 0, Wd, H); h.textBaseline = "middle"; h.lineWidth = Math.max(1.5, u * 0.3);
  h.shadowColor = "rgba(0,0,0,0.9)"; h.shadowBlur = u * 0.5;

  // ---- أعلى: البوصلة ----
  const hdg = ((state.heading % 360) + 360) % 360, span = 120, cw = Wd * 0.46;
  plate(cx - cw / 2 - u, H * 0.025, cw + 2 * u, H * 0.085);
  h.save(); h.beginPath(); h.rect(cx - cw / 2, H * 0.02, cw, H * 0.1); h.clip();
  for (let a = Math.ceil((hdg - span / 2) / 15) * 15; a <= hdg + span / 2; a += 15) {
    const x = cx + (a - hdg) / span * cw, aa = ((a % 360) + 360) % 360;
    const lbl = { 0: "N", 90: "E", 180: "S", 270: "W" }[aa];
    h.strokeStyle = C.dim; h.beginPath(); h.moveTo(x, H * 0.085); h.lineTo(x, H * (lbl ? 0.065 : 0.075)); h.stroke();
    text(lbl || (aa % 45 === 0 ? String(aa) : ""), x, H * 0.047, u * (lbl ? 2.4 : 1.5), lbl ? C.hud : C.dim, "center", true);
  }
  h.restore();
  h.fillStyle = "#ffffff"; h.beginPath(); h.moveTo(cx, H * 0.1); h.lineTo(cx - u, H * 0.118); h.lineTo(cx + u, H * 0.118); h.fill();
  text("HDG " + String(Math.round(hdg) % 360).padStart(3, "0") + "°", cx, H * 0.14, u * 1.8, C.hud, "center", true);

  // ---- وسط: إنذار + علامة النظر ----
  const al = state.suitStatus.alarms;
  if (al.length && !(al[0].level === 2 && Math.floor(now / 400) % 2 === 0)) text("!! " + al[0].msg, cx, H * 0.21, u * 3, RISK_COLOR[al[0].level], "center", true);
  h.strokeStyle = C.dim; h.beginPath();
  h.moveTo(cx - u * 3, H / 2); h.lineTo(cx - u, H / 2); h.moveTo(cx + u, H / 2); h.lineTo(cx + u * 3, H / 2);
  h.moveTo(cx, H / 2 - u * 3); h.lineTo(cx, H / 2 - u); h.moveTo(cx, H / 2 + u); h.lineTo(cx, H / 2 + u * 3); h.stroke();

  // ---- يسار: التعرف على العقبات ----
  const pw = Math.min(Wd * (state.stereo ? 0.25 : 0.27), u * 40), lx = Wd * 0.03, sum = state.summary;
  plate(lx - u, H * 0.17, pw, H * 0.64);
  text("OBSTACLE RECOGNITION", lx, H * 0.2, u * 2.1, C.hud, "left", true);
  if (!sum || !sum.total) text("NO OBSTACLES IN VIEW (" + CFG.SCAN_RANGE_M + " m)", lx, H * 0.245, u * 1.7, C.hud, "left", true);
  else {
    text(sum.total + " IN VIEW  ·  HAZARD " + W.RISK_NAME[sum.worst], lx, H * 0.245, u * 1.9, RISK_COLOR[sum.worst], "left", true);
    let y = H * 0.29;
    for (const c of W.CLASSES) {
      if (!sum.counts[c]) continue;
      text(c, lx, y, u * 1.7, CLASS_COLOR[c], "left", true);
      text(String(sum.counts[c]), lx + pw - u * 2.5, y, u * 1.7, CLASS_COLOR[c], "right", true);
      y += u * 2.9;
    }
    y += u * 1;
    h.strokeStyle = C.dim; h.beginPath(); h.moveTo(lx, y - u * 1.4); h.lineTo(lx + pw - u * 2.5, y - u * 1.4); h.stroke();
    state.seen.slice(0, CFG.MAX_LIST).forEach((s, n) => {
      text((n + 1) + " " + s.cls, lx, y, u * 1.65, CLASS_COLOR[s.cls], "left", true);
      const right = s.dist.toFixed(0) + " m  " + (s.cls === "UNKNOWN" ? "NO MATCH" : Math.round(s.conf * 100) + "%");
      text(right, lx + pw - u * 2.5, y, u * 1.5, CLASS_COLOR[s.cls], "right");
      text("H " + s.h.toFixed(1) + " m  W " + s.w.toFixed(1) + " m", lx + u * 2, y + u * 2.1, u * 1.25, C.dim, "left");
      y += u * 4.4;
    });
  }
  text("CLASSES + COLOURS FROM NASA DATA", lx, H * 0.785, u * 1.25, C.dim, "left");

  // ---- يمين: البدلة مقابل المريخ ----
  const rx = Wd * 0.97, s = state.suit, st = state.suitStatus.st, e = state.env;
  plate(rx - pw + u, H * 0.17, pw, H * 0.64);
  text("SUIT  vs  MARS", rx, H * 0.2, u * 2.1, C.hud, "right", true);
  const row = (y, label, sv, lvl, ev) => {
    text(label, rx, y, u * 1.6, C.dim, "right", true);
    text("SUIT " + sv, rx, y + u * 3, u * 2.4, RISK_COLOR[lvl || 0], "right", true);
    text("MARS " + ev, rx, y + u * 6, u * 2.4, C.hud, "right", true);
  };
  row(H * 0.255, "PRESSURE", s.suitPress.toFixed(1) + " kPa", st.press, e ? (e.pressPa / 1000).toFixed(3) + " kPa" : "--");
  row(H * 0.37, "TEMPERATURE", s.suitTemp.toFixed(1) + "°C", st.temp, e ? e.tempC.toFixed(1) + "°C" : "--");
  text("OXYGEN REMAINING", rx, H * 0.485, u * 1.6, C.dim, "right", true);
  const o2Left = s.o2Rate > 0 ? s.o2 / s.o2Rate : 0;
  text(Math.round(s.o2) + "%  ·  " + hhmm(o2Left) + " h", rx, H * 0.515, u * 2.6, RISK_COLOR[st.o2 || 0], "right", true);
  const bw = pw - u * 3, bx = rx - bw;
  h.fillStyle = "rgba(255,255,255,0.15)"; h.fillRect(bx, H * 0.54, bw, u * 1.2);
  h.fillStyle = RISK_COLOR[st.o2 || 0]; h.fillRect(bx + bw * (1 - s.o2 / 100), H * 0.54, bw * s.o2 / 100, u * 1.2);
  if (e) {
    text("MARS: NASA PHOENIX MET DATA", rx, H * 0.6, u * 1.3, C.dim, "right");
    text("SOL " + e.sol + " · LMST " + String(Math.floor(e.lmst)).padStart(2, "0") + ":" + String(Math.floor((e.lmst % 1) * 60)).padStart(2, "0") + " (REPLAY)", rx, H * 0.63, u * 1.3, C.dim, "right");
  }
  text("SUIT: SIMULATED", rx, H * 0.66, u * 1.3, C.dim, "right");

  text("SIMULATED TERRAIN · ROCK AND SAND TEXTURES FROM NASA PERSEVERANCE IMAGES", cx, H * 0.87, u * 1.35, C.dim, "center");
  if (state.autoDemo) text("AUTO FAULT DEMO", cx, H * 0.895, u * 1.35, C.dim, "center");
  hudTex.needsUpdate = true;
}

// =====================================================================
// التحكم: حساس الجوال · السحب · الأسهم للف · W/S أو ↑↓ للمشي · A/D خطوة جانبية
// =====================================================================
const zee = new THREE.Vector3(0, 0, 1), devEuler = new THREE.Euler(), q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
window.addEventListener("deviceorientation", ev => {
  if (ev.alpha == null || ev.beta == null || renderer.xr.isPresenting || !state.running) return;
  state.gyro = true;
  const orient = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
  devEuler.set(ev.beta * Math.PI / 180, ev.alpha * Math.PI / 180, -ev.gamma * Math.PI / 180, "YXZ");
  camera.quaternion.setFromEuler(devEuler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -orient));
});
function turn(rad) { if (state.gyro || renderer.xr.isPresenting) state.yawOffset += rad; else state.yaw += rad; }
function toggleLeak() { state.suit.leak = !state.suit.leak; if (navigator.vibrate) navigator.vibrate(60); }

let down = null, lastTap = 0;
canvas.addEventListener("contextmenu", ev => ev.preventDefault());
canvas.addEventListener("pointerdown", ev => { down = { x: ev.clientX, y: ev.clientY, px: ev.clientX, py: ev.clientY, t: performance.now(), moved: 0 }; canvas.setPointerCapture(ev.pointerId); });
canvas.addEventListener("pointermove", ev => {
  if (!down) return;
  const dx = ev.clientX - down.px, dy = ev.clientY - down.py; down.px = ev.clientX; down.py = ev.clientY;
  down.moved = Math.max(down.moved, Math.hypot(ev.clientX - down.x, ev.clientY - down.y));
  if (down.moved < 8) return;
  const k = (camera.fov * Math.PI / 180) / window.innerHeight;
  turn(dx * k);
  if (!state.gyro && !renderer.xr.isPresenting) state.pitch = ML.clamp(state.pitch + dy * k, -1.4, 1.4);
});
canvas.addEventListener("pointerup", () => {
  if (!down) return;
  const now = performance.now(), held = now - down.t, moved = down.moved; down = null;
  if (moved >= 12) return;
  if (held > 700) { toggleLeak(); lastTap = 0; return; }
  if (now - lastTap < 350) { stop(); return; }
  lastTap = now;
});
document.addEventListener("keydown", ev => {
  if (!state.running) return;
  const k = ev.key.toLowerCase(); state.keys.add(k);
  if (k === "escape") stop(); else if (k === "1") toggleLeak(); else if (k === "0") state.suit = W.initSuit(CFG);
  if (k.startsWith("arrow") || k === " ") ev.preventDefault();
});
document.addEventListener("keyup", ev => state.keys.delete(ev.key.toLowerCase()));
for (const [id, key] of [["btnLeft", "left"], ["btnFwd", "fwd"], ["btnRight", "right"]]) {
  const b = $(id);
  b.addEventListener("pointerdown", ev => { ev.preventDefault(); state.hold[key] = true; });
  for (const evn of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(evn, () => { state.hold[key] = false; });
}
for (const i of [0, 1]) {
  const c = renderer.xr.getController(i);
  c.addEventListener("selectstart", () => { state.hold.xrFwd = true; }); c.addEventListener("selectend", () => { state.hold.xrFwd = false; });
  c.addEventListener("squeeze", toggleLeak); rig.add(c);
}

// =====================================================================
// التشغيل
// =====================================================================
async function start(mode) {
  if (!state.ready) { setStatus("لسا جاري تجهيز سطح المريخ... انتظروا ثواني واضغطوا مرة ثانية.", "bad"); return; }
  if (!PROFILES) { setStatus("ما انحمل ملف walk_data.js. تأكدوا إنه مرفوع بجانب index.html.", "bad"); return; }
  state.stereo = $("vrMode").checked && mode !== "xr"; state.autoDemo = $("autoDemo").checked;
  if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) { try { await DeviceOrientationEvent.requestPermission(); } catch (_) {} }
  if (mode === "xr") {
    try {
      const session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local"] });
      renderer.xr.enabled = true; await renderer.xr.setSession(session);
      session.addEventListener("end", () => { renderer.xr.enabled = false; if (state.running) stop(); });
    } catch (_) { setStatus("ما قدرنا ندخل وضع WebXR على هذا الجهاز.", "bad"); return; }
  } else if (state.stereo) {
    try { await document.documentElement.requestFullscreen(); } catch (_) {}
    try { await screen.orientation.lock("landscape"); } catch (_) {}
  }
  try { state.wakeLock = await navigator.wakeLock.request("screen"); } catch (_) {}
  $("menu").style.display = "none"; canvas.style.display = "block";
  Object.assign(state, { running: true, pos: { x: CFG.START.x, z: CFG.START.z }, yaw: -CFG.START.headingDeg * Math.PI / 180, pitch: -0.08,
    yawOffset: 0, gyro: false, demoT: 0, envHours: 0, suit: W.initSuit(CFG), lastFrame: performance.now(), lastHud: 0, nextScan: 0 });
  layout(); renderer.setAnimationLoop(frame);
}
function stop() {
  if (!state.running) return;
  state.running = false; renderer.setAnimationLoop(null);
  const s = renderer.xr.getSession(); if (s) s.end().catch(() => {});
  if (state.wakeLock) state.wakeLock.release().catch(() => {});
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  state.keys.clear(); for (const k in state.hold) state.hold[k] = false;
  canvas.style.display = "none"; $("menu").style.display = "flex"; $("navBtns").style.display = "none";
}
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && state.running && state.stereo) stop(); });
$("btnStart").onclick = () => start("screen");
$("btnXR").onclick = () => start("xr");
if (navigator.xr && navigator.xr.isSessionSupported) navigator.xr.isSessionSupported("immersive-vr").then(ok => { if (ok) $("btnXR").style.display = "block"; }).catch(() => {});

const upv = new THREE.Vector3();
function frame() {
  if (!state.running) return;
  try { frameBody(); } catch (err) {
    console.error(err); stop();
    setStatus("صار خطأ أثناء التشغيل: " + (err && err.message || err) + " — صوّروا هذي الرسالة وأرسلوها.", "bad");
  }
}
function frameBody() {
  const now = performance.now(), dt = Math.min(0.1, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  const k = state.keys, hd = state.hold;
  const turnDir = (k.has("arrowleft") || hd.left ? 1 : 0) - (k.has("arrowright") || hd.right ? 1 : 0);
  if (turnDir) turn(turnDir * CFG.TURN_SPEED_DEG * Math.PI / 180 * dt);
  const f = (k.has("w") || k.has("arrowup") || hd.fwd || hd.xrFwd ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
  const sdir = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0);

  rig.rotation.y = state.yawOffset;
  if (!state.gyro && !renderer.xr.isPresenting) camera.rotation.set(state.pitch, state.yaw, 0, "YXZ");
  camera.updateWorldMatrix(true, false);
  camera.getWorldQuaternion(headQuat);
  fwd.set(0, 0, -1).applyQuaternion(headQuat); upv.set(0, 1, 0).applyQuaternion(headQuat);
  const gx = fwd.x - upv.x * fwd.y, gz = fwd.z - upv.z * fwd.y, gl = Math.hypot(gx, gz) || 1;
  state.heading = Math.atan2(gx, -gz) * 180 / Math.PI;
  if (f || sdir) {
    const sp = CFG.WALK_SPEED * dt / Math.hypot(f, sdir), fx = gx / gl, fz = gz / gl;
    const lim = world.half - 20;
    state.pos.x = ML.clamp(state.pos.x + (fx * f - fz * sdir) * sp, -lim, lim);
    state.pos.z = ML.clamp(state.pos.z + (fz * f + fx * sdir) * sp, -lim, lim);
  }
  const gy = ML.heightAt(world, state.pos.x, state.pos.z);
  rig.position.set(state.pos.x, gy + CFG.EYE_HEIGHT, state.pos.z);
  camera.updateWorldMatrix(true, false); camera.getWorldPosition(headPos);
  sky.position.copy(rig.position);
  const len = CFG.EYE_HEIGHT / Math.tan(SUN_EL), sx = state.pos.x + shadowDir.x * len * 0.5, sz = state.pos.z + shadowDir.y * len * 0.5;
  selfShadow.position.set(sx, ML.heightAt(world, sx, sz) + 0.04, sz);
  selfShadow.rotation.y = Math.atan2(-shadowDir.y, shadowDir.x); selfShadow.scale.set(len * 0.5, 1, 0.33);

  if (now >= state.nextScan) { state.nextScan = now + 1000 / CFG.SCAN_HZ; scan(); }
  state.envHours += dt * 24 / CFG.REPLAY_SOL_SECONDS;
  state.env = ENV.length ? W.envAt(ENV, state.envHours, CFG) : null;
  if (state.autoDemo) {
    state.demoT += dt; const leak = W.demoLeak(state.demoT, CFG);
    if (state.suit.leak && !leak) state.suit = W.initSuit(CFG);
    state.suit.leak = leak;
  }
  W.stepSuit(state.suit, dt, CFG); state.suitStatus = W.suitStatus(state.suit, CFG);
  if (now - state.lastHud >= 1000 / 15) { state.lastHud = now; drawHud(now); }

  if (renderer.xr.isPresenting) renderer.render(scene, camera);
  else if (state.stereo) {
    const w = window.innerWidth, hh = window.innerHeight, ew = w / 2;
    renderer.setScissorTest(true);
    eyes.forEach((cam, i) => { renderer.setViewport(i * ew, 0, ew, hh); renderer.setScissor(i * ew, 0, ew, hh); renderer.render(scene, cam); });
    renderer.setScissorTest(false);
  } else { renderer.setViewport(0, 0, window.innerWidth, window.innerHeight); renderer.render(scene, camera); }
}

// التجهيز
setTimeout(() => {
  try {
    world = ML.buildWorld(ML.CONFIG);
    features = W.placeFeatures(world, ML.mulberry32(ML.CONFIG.SEED + 55), ML);
    state.world = world; state.features = features;
    buildScene();
    state.ready = true; $("btnStart").disabled = false;
    if (LOCAL_FILE) setStatus("الصفحة مفتوحة من ملف محلي: تشتغل، لكن بدون ملمس صور ناسا. للنسخة الكاملة استخدموا رابط GitHub Pages أو serve.py.", "bad");
    else setStatus("سطح المريخ جاهز · " + world.rocks.length + " صخرة · ملمس الصخور والرمل من صور Perseverance · بيانات Phoenix لـ " + ENV.length + " يوم", "ok");
  } catch (err) { console.error(err); setStatus("تعذر تجهيز المشهد. تأكدوا إن المتصفح يدعم WebGL.", "bad"); }
}, 30);
})();
