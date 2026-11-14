// node tests/test_logic.js
const assert = require("assert");
global.window = {};
require("../walk_data.js");
const ML = require("../mars_logic.js"), W = require("../walk_logic.js"), C = W.WALK;
const P = window.CLASS_PROFILES, T = window.TEXTURE_COLORS, E = window.PHOENIX_ENV;
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok  - " + name); };

t("class profiles come from the labelled NASA boxes", () => {
  for (const k of ["rock", "boulder", "outcrop", "rover_hardware"]) assert.ok(P[k] && P[k].n >= 10 && P[k].mean.length === 3);
});
t("shape decides rock / boulder / outcrop; tiny pebbles are ignored", () => {
  assert.strictEqual(W.shapeClass({ h: 0.1, w: 0.3 }, C), null);
  assert.strictEqual(W.shapeClass({ h: 0.3, w: 0.5 }, C), "ROCK");
  assert.strictEqual(W.shapeClass({ h: 0.8, w: 1 }, C), "BOULDER");
  assert.strictEqual(W.shapeClass({ h: 0.7, w: 4 }, C), "OUTCROP");
});
t("every rock texture in the scene is recognised as rock-type, never UNKNOWN", () => {
  for (let k = 0; k < 5; k++) for (const shade of [0.86, 1.06]) for (const m of [{ h: 0.3, w: 0.5 }, { h: 0.9, w: 1.2 }]) {
    const c = T["textures/rock_" + k + ".jpg"], r = W.recognize({ ...m, lab: [c[0] * shade, c[1], c[2]] }, P, C);
    assert.ok(["ROCK", "BOULDER"].includes(r.cls), k + " " + r.cls);
  }
});
t("outcrop textures read as OUTCROP, grey debris as ROVER HARDWARE, dark meteorite as UNKNOWN", () => {
  for (const k of [1, 2]) assert.strictEqual(W.recognize({ h: 0.7, w: 4, lab: T["textures/outcrop_" + k + ".jpg"] }, P, C).cls, "OUTCROP");
  assert.strictEqual(W.recognize({ h: 0.4, w: 1, lab: [66, 1, 8] }, P, C).cls, "ROVER HARDWARE");
  const m = W.recognize({ h: 0.5, w: 0.7, lab: [20, 2, 4] }, P, C);
  assert.strictEqual(m.cls, "UNKNOWN"); assert.ok(m.conf < C.KNOWN_THRESHOLD);
});
t("features are placed on the terrain near the start", () => {
  const world = ML.buildWorld(ML.CONFIG), f = W.placeFeatures(world, ML.mulberry32(1), ML);
  assert.strictEqual(f.length, 9);
  f.forEach(x => { assert.ok(Math.hypot(x.x, x.z) < 40); assert.ok(Math.abs(x.y - ML.heightAt(world, x.x, x.z)) < 1e-9); });
});
t("Phoenix replay stays inside the recorded range", () => {
  for (let h = 0; h < 24 * 30; h += 0.5) { const e = W.envAt(E, h, C); assert.ok(e.tempC >= -82 && e.tempC <= -20 && e.pressPa > 780 && e.pressPa < 830); }
});
t("suit leak raises the pressure alarm", () => {
  const s = W.initSuit(C); s.leak = true;
  for (let i = 0; i < 600; i++) W.stepSuit(s, 0.1, C, () => 0.5);
  assert.strictEqual(W.suitStatus(s, C).alarms[0].msg, "SUIT PRESSURE LOW");
});
console.log("\n" + n + " tests passed");
