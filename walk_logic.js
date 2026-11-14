// =====================================================================
// Mars Walk VR HUD - المنطق (بدون رسم): إعدادات المشي، المعالم الإضافية (صخر أساسي، حطام، نيزك)،
// التعرف على العقبات، بيئة المريخ من بيانات Phoenix، والبدلة.
// التضاريس والصخور نفسها من mars_logic.js. يشتغل في المتصفح وفي Node (node tests/test_logic.js)
// =====================================================================

const WALK = {
  EYE_HEIGHT: 1.7,          // طول عين شخص عادي
  WALK_SPEED: 1.4,          // م/ث (مشي عادي)
  TURN_SPEED_DEG: 70,       // سرعة اللف بالأسهم
  START: { x: 0, z: 0, headingDeg: 0 },

  // ---- التعرف على العقبات ----
  SCAN_RANGE_M: 30,         // يشوف العقبات لين 30 م
  SCAN_HZ: 5,               // كم مرة في الثانية يتحدث المسح
  MIN_OBSTACLE_H: 0.2,      // أقل من 20 سم ما تعتبر عقبة
  BOULDER_H: 0.5,           // جلمود: 50 سم أو أكثر
  OUTCROP_MIN_W: 2.5,       // صخر أساسي: طبقة مسطحة عرضها 2.5 م أو أكثر
  OUTCROP_MAX_FLAT: 0.3,    //   وارتفاعها أقل من 30% من عرضها
  COLOR_TOLERANCE: 1.5,     // مدى السماح في مطابقة اللون (× الانحراف المعياري للصنف)
  KNOWN_THRESHOLD: 0.5,     // أقل من 50% تطابق مع أي صنف = UNKNOWN
  HARDWARE_MARGIN: 0.15,    // نختار "جزء مركبة" بدل الصنف اللي يقوله الشكل فقط إذا لونه أقرب بفرق واضح
  MAX_LIST: 6, MAX_BRACKETS: 12,

  // ---- البيئة والبدلة ----
  REPLAY_SOL_SECONDS: 240, START_LMST_H: 10,
  SUIT_TEMP_C: 22, SUIT_PRESS_KPA: 29.6, O2_CAPACITY_MIN: 480, SIM_SPEED: 30,
  SUIT_PRESS_CAUTION: 27, SUIT_PRESS_DANGER: 24, O2_CAUTION: 30, O2_DANGER: 15,
  LEAK_KPA_PER_S: 0.12, LEAK_O2_FACTOR: 8, DEMO_CYCLE_S: 120
};

const CLASSES = ["BOULDER", "OUTCROP", "ROCK", "UNKNOWN", "ROVER HARDWARE"];
const RISK = { BOULDER: 2, OUTCROP: 2, ROCK: 1, UNKNOWN: 1, "ROVER HARDWARE": 1 };
const PROFILE_KEY = { BOULDER: "boulder", OUTCROP: "outcrop", ROCK: "rock", "ROVER HARDWARE": "rover_hardware" };
const RISK_NAME = ["LOW", "CAUTION", "HIGH"];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// =====================================================================
// معالم إضافية قريبة من نقطة البداية عشان تظهر كل الأصناف في العرض
//   outcrop  = طبقات صخرية مسطحة واسعة (ملمسها من صور Mastcam-Z للصخر الأساسي)
//   debris   = حطام معدني رمادي (يشبه صنف أجزاء المركبة في البيانات)
//   meteorite= نيزك حديدي داكن: ما يشبه أي صنف في البيانات → المفروض يطلع UNKNOWN
// =====================================================================
function placeFeatures(world, rand, ML) {
  const out = [];
  const spots = [
    ["outcrop", 11, -14], ["outcrop", -22, 6], ["outcrop", 28, 12], ["outcrop", -8, 30],
    ["debris", 6, -9], ["debris", -11, -14], ["debris", 18, 22],
    ["meteorite", -5, -12], ["meteorite", 12, 5]
  ];
  spots.forEach(([kind, x, z], i) => {
    const rot = rand() * Math.PI;
    let f;
    if (kind === "outcrop") f = { w: 3 + rand() * 3, d: 2 + rand() * 2, h: 0.45 + rand() * 0.45, tex: 1 + (i % 2), color: null };
    else if (kind === "debris") f = { w: 0.7 + rand() * 0.8, d: 0.5 + rand() * 0.5, h: 0.25 + rand() * 0.3, color: [66, 1, 8] };
    else f = { w: 0.6 + rand() * 0.3, d: 0.5 + rand() * 0.3, h: 0.45 + rand() * 0.2, color: [20, 2, 4] };
    out.push(Object.assign(f, { kind, x, z, y: ML.heightAt(world, x, z), rot, id: "f" + i }));
  });
  return out;
}

// =====================================================================
// التعرف: الحساس (محاكاة ليدار + لون السطح) يقيس الارتفاع والعرض واللون،
// وكل صنف له "بصمة لون" محسوبة من مربعاتنا المعلّمة في صور ناسا (analysis/profiles.json).
//   1) الشكل يحدد الصنف المرشح: صخر أساسي / جلمود / صخرة
//   2) نقارن لون السطح ببصمة الصنف المرشح وببصمة أجزاء المركبة
//   3) أعلى تطابق ≥ 50% = الصنف · غير ذلك = UNKNOWN
// =====================================================================
function colorMatch(lab, profile, tol) {
  let d2 = 0;
  for (let k = 0; k < 3; k++) { const z = (lab[k] - profile.mean[k]) / (profile.std[k] * tol); d2 += z * z; }
  return Math.exp(-0.5 * d2 / 3);
}

function shapeClass(m, cfg) {
  if (m.h < cfg.MIN_OBSTACLE_H) return null;
  if (m.w >= cfg.OUTCROP_MIN_W && m.h / m.w <= cfg.OUTCROP_MAX_FLAT) return "OUTCROP";
  return m.h >= cfg.BOULDER_H ? "BOULDER" : "ROCK";
}

// m = {h, w, lab:[L,a,b]} · profiles = {rock:{mean,std}, ...}
function recognize(m, profiles, cfg) {
  const shape = shapeClass(m, cfg);
  if (!shape) return null;
  const nat = { cls: shape, conf: colorMatch(m.lab, profiles[PROFILE_KEY[shape]], cfg.COLOR_TOLERANCE) };
  const hw = { cls: "ROVER HARDWARE", conf: colorMatch(m.lab, profiles.rover_hardware, cfg.COLOR_TOLERANCE) };
  const best = hw.conf > nat.conf + cfg.HARDWARE_MARGIN ? hw : nat.conf >= hw.conf ? nat : (nat.conf >= cfg.KNOWN_THRESHOLD ? nat : hw);
  if (best.conf < cfg.KNOWN_THRESHOLD) return { cls: "UNKNOWN", conf: best.conf, risk: RISK.UNKNOWN, nearest: best.cls };
  return { cls: best.cls, conf: best.conf, risk: RISK[best.cls] };
}

function summarize(list) {
  const counts = {}; CLASSES.forEach(c => { counts[c] = 0; });
  let worst = 0;
  list.forEach(o => { counts[o.cls]++; worst = Math.max(worst, o.risk); });
  return { total: list.length, counts, worst };
}

// =====================================================================
// البيئة الخارجية: إعادة تشغيل بيانات Phoenix اليومية · والبدلة (محاكاة)
// =====================================================================
function envAt(env, hoursSinceStart, cfg) {
  const total = cfg.START_LMST_H + hoursSinceStart;
  const dayIdx = Math.floor(total / 24), t = total - dayIdx * 24, n = env.length;
  const at = i => env[((i % n) + n) % n];
  const d = at(dayIdx), next = at(dayIdx + 1), prev = at(dayIdx - 1);
  const half = (a, b, f) => a + (b - a) * (1 - Math.cos(Math.PI * clamp(f, 0, 1))) / 2;
  let temp;
  if (t < d.tminAt) temp = half(prev.tmax, d.tmin, (t + 24 - prev.tmaxAt) / (d.tminAt + 24 - prev.tmaxAt));
  else if (t < d.tmaxAt) temp = half(d.tmin, d.tmax, (t - d.tminAt) / (d.tmaxAt - d.tminAt));
  else temp = half(d.tmax, next.tmin, (t - d.tmaxAt) / (next.tminAt + 24 - d.tmaxAt));
  const press = d.pmean + (d.pmax - d.pmin) / 2 * Math.cos(2 * Math.PI * (t - 9) / 24);
  return { sol: d.sol, date: d.date, lmst: t, tempC: temp, pressPa: press };
}
function initSuit(cfg) { return { suitTemp: cfg.SUIT_TEMP_C, suitPress: cfg.SUIT_PRESS_KPA, o2: 100, o2Rate: 100 / cfg.O2_CAPACITY_MIN, leak: false }; }
function stepSuit(s, dt, cfg, rnd = Math.random) {
  const dMin = dt * cfg.SIM_SPEED / 60;
  s.suitTemp += (cfg.SUIT_TEMP_C - s.suitTemp) * Math.min(1, dt * 0.2) + (rnd() - 0.5) * 0.05;
  if (s.leak) s.suitPress = Math.max(0, s.suitPress - cfg.LEAK_KPA_PER_S * dt);
  else s.suitPress += (cfg.SUIT_PRESS_KPA - s.suitPress) * Math.min(1, dt * 0.5);
  s.o2Rate = (100 / cfg.O2_CAPACITY_MIN) * (s.leak ? cfg.LEAK_O2_FACTOR : 1);
  s.o2 = Math.max(0, s.o2 - s.o2Rate * dMin);
  return s;
}
function suitStatus(s, cfg) {
  const below = (v, c, d) => v < d ? 2 : v < c ? 1 : 0;
  const st = { press: below(s.suitPress, cfg.SUIT_PRESS_CAUTION, cfg.SUIT_PRESS_DANGER), o2: below(s.o2, cfg.O2_CAUTION, cfg.O2_DANGER),
    temp: (s.suitTemp < 10 || s.suitTemp > 35) ? 2 : (s.suitTemp < 18 || s.suitTemp > 27) ? 1 : 0 };
  const alarms = [];
  if (st.press) alarms.push({ level: st.press, msg: "SUIT PRESSURE LOW" });
  if (st.o2) alarms.push({ level: st.o2, msg: "O2 LOW" });
  if (st.temp) alarms.push({ level: st.temp, msg: "SUIT TEMP" });
  alarms.sort((a, b) => b.level - a.level);
  return { st, alarms };
}
function demoLeak(sec, cfg) { const ph = sec % cfg.DEMO_CYCLE_S; return ph >= 30 && ph < 80; }

const WalkLogic = { WALK, CLASSES, RISK, RISK_NAME, clamp, placeFeatures, colorMatch, shapeClass, recognize, summarize,
  envAt, initSuit, stepSuit, suitStatus, demoLeak };
if (typeof window !== "undefined") window.WalkLogic = WalkLogic;
if (typeof module !== "undefined") module.exports = WalkLogic;
