// Build encrypted word-bank files for the app from the source data folder.
// Usage: APP_KEY=<base64 32 bytes> node tools/build.js <source data folder> [version]
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const SRC = process.argv[2], VERSION = process.argv[3] || new Date().toISOString().slice(0, 10).replace(/-/g, "");
const KEY = Buffer.from(process.env.APP_KEY || "", "base64");
if (!SRC || KEY.length !== 32) { console.error("need source dir and APP_KEY (base64, 32 bytes)"); process.exit(1); }
const OUT = path.join(__dirname, "..", "data");

function loadJs(file) { const window = {}; eval(fs.readFileSync(path.join(SRC, file), "utf8")); return window; }
const BANKS = [
  { id: "m", name: "Must-Know 306 / 386", zh: "必考 306 + 386", pre: "mk-unit", n: 30, unitLabel: "Unit" },
  { id: "h", name: "Hot Words for the SAT", zh: "SAT 熱門字", pre: "hot-unit", n: loadJs("hot-words.js").HOT_LESSON_COUNT || 92, unitLabel: "Lesson" },
  { id: "b", name: "Barron's 1100 Words", zh: "Barron's 1100", pre: "unit", n: 46, unitLabel: "Unit" }
];
const clean = w => String(w || "").replace(/\s*\(.*?\)\s*/g, " ").trim();
const key = w => clean(w).toLowerCase();
const fill = (s, w) => String(s || "").replace(/_{3,}/g, w);

// ---- load ----
for (const B of BANKS) {
  B.units = [];
  for (let i = 1; i <= B.n; i++) {
    const u = Object.values(loadJs(`${B.pre}${i}-data.js`).FLASHCARD_UNITS)[0];
    const quiz = {};
    (u.quiz || []).forEach(q => { if (/_{3,}/.test(q.question)) quiz[key(q.answerWord)] = q; });
    B.units.push({ n: i, theme: u.theme || "", themeZh: u.themeZh || "", raw: u.cards, quiz });
  }
}

// ---- word forms ----
function buildForms(heads) {
  const forms = new Map();
  const add = (f, h) => { if (f.length > 2 && !forms.has(f)) forms.set(f, h); };
  heads.forEach(h => add(h, h));
  [...heads].sort((a, b) => Number(b.endsWith("e")) - Number(a.endsWith("e"))).forEach(w => {
    if (/\s/.test(w)) return;
    ["s", "es", "d", "ed", "ing", "ly", "ness", "ment"].forEach(s => add(w + s, w));
    if (w.endsWith("e")) { const st = w.slice(0, -1); ["ing", "ion", "ions", "ation", "ations"].forEach(s => add(st + s, w)); }
    if (/[^aeiou]y$/.test(w)) { const st = w.slice(0, -1); ["ies", "ied", "ily", "iness"].forEach(s => add(st + s, w)); }
    if (w.endsWith("le")) add(w.slice(0, -1) + "y", w);
    if (w.endsWith("ic")) add(w + "ally", w);
    if (/[^aeiou][aeiou][bdgklmnprt]$/.test(w)) { const l = w.slice(-1); ["ed", "ing"].forEach(s => add(w + l + s, w)); }
  });
  return forms;
}
const NOT_WORD = new Set(["railing", "railings", "precipitation", "expedition", "expeditions", "dined", "dining", "dines", "dinner",
  "novels", "remotely", "petting", "warranty", "warranties", "commonly", "costs", "spans"]);
const heads = {};                      // bank id -> Set of headwords
BANKS.forEach(B => { heads[B.id] = new Set(); B.units.forEach(u => u.raw.forEach(c => heads[B.id].add(key(c.word)))); });
const forms = {}; BANKS.forEach(B => forms[B.id] = buildForms([...heads[B.id]]));
const ALL = new Set([...heads.m, ...heads.h, ...heads.b]);
function findHead(token, own) {
  const t = token.toLowerCase(); if (NOT_WORD.has(t)) return null;
  for (const id of [own, "h", "b", "m"]) { const h = forms[id].get(t); if (h) return h; }
  return null;
}
// highlight ranges [start, length, headword] for every SAT word in a sentence
function highlights(text, own) {
  const out = [], re = /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ']*/g; let m;
  while ((m = re.exec(text))) {
    const tok = m[0].replace(/'s$/i, "").replace(/'+$/, "");
    const h = findHead(tok, own); if (h) out.push([m.index, tok.length, h]);
  }
  return out;
}
function blankOwn(sentence, word, bank) {       // Must-Know: turn the sample sentence into a cloze
  const re = /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ']*/g; let m, done = null;
  while ((m = re.exec(sentence))) {
    const tok = m[0].replace(/'s$/i, "");
    if (forms[bank].get(tok.toLowerCase()) === word && tok.toLowerCase() === word) { done = sentence.slice(0, m.index) + "__________" + sentence.slice(m.index + tok.length); break; }
  }
  return done;                                    // only exact-form matches, so the answer fits grammatically
}

// ---- inflected cloze for Must-Know: "my nervousness quickly abated" -> blank + options in the same form ----
const IRR = { overcome: ["overcomes", "overcame", "overcoming"], withdraw: ["withdraws", "withdrew", "withdrawing"], undergo: ["undergoes", "underwent", "undergoing"],
  forgo: ["forgoes", "forwent", "forgoing"], forsake: ["forsakes", "forsook", "forsaking"], uphold: ["upholds", "upheld", "upholding"], withhold: ["withholds", "withheld", "withholding"],
  foresee: ["foresees", "foresaw", "foreseeing"], arise: ["arises", "arose", "arising"], undertake: ["undertakes", "undertook", "undertaking"], mislead: ["misleads", "misled", "misleading"],
  seek: ["seeks", "sought", "seeking"], strive: ["strives", "strove", "striving"], shrink: ["shrinks", "shrank", "shrinking"], bear: ["bears", "bore", "bearing"], forbid: ["forbids", "forbade", "forbidding"],
  beget: ["begets", "begot", "begetting"], offset: ["offsets", "offset", "offsetting"], forecast: ["forecasts", "forecast", "forecasting"], shed: ["sheds", "shed", "shedding"], foretell: ["foretells", "foretold", "foretelling"], spread: ["spreads", "spread", "spreading"] };
const STRESS_LAST = new Set(["abhor", "outstrip", "deter", "defer", "infer", "refer", "confer", "prefer", "rebut", "abet", "compel", "repel", "impel", "propel", "dispel", "expel", "excel",
  "incur", "recur", "concur", "occur", "omit", "emit", "commit", "permit", "submit", "admit", "transmit", "regret", "allot", "equip", "acquit", "curtail_"]);
function inflect(w, t) {
  if (IRR[w]) return IRR[w][["s", "ed", "ing"].indexOf(t)];
  if (/ic$/.test(w) && t !== "s") return w + "k" + t;                      // mimic -> mimicked
  const oneSyl = (w.match(/[aeiouy]+/g) || []).length === 1;
  const dbl = /[^aeiou][aeiou][bdgmnprt]$/.test(w) && (oneSyl || STRESS_LAST.has(w));
  if (t === "s") return /(s|x|z|ch|sh)$/.test(w) ? w + "es" : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + "ies" : w + "s";
  if (t === "ed") return w.endsWith("e") ? w + "d" : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + "ied" : dbl ? w + w.slice(-1) + "ed" : w + "ed";
  return w.endsWith("ie") ? w.slice(0, -2) + "ying" : /[^e]e$/.test(w) ? w.slice(0, -1) + "ing" : dbl ? w + w.slice(-1) + "ing" : w + "ing";
}
function inflectedCloze(c, unit, B, REL) {
  const w = key(c.word), re = /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ]*/g; let m;
  while ((m = re.exec(c.sentence || ""))) {
    const tok = m[0].toLowerCase(), t = ["s", "ed", "ing"].find(x => inflect(w, x) === tok); if (!t) continue;
    const hasPos = (x, p) => String(x.pos || "").toLowerCase().split(/[\/\s]+/).some(q => q.replace(/\.$/, "") === p || (p === "v" && q === "vb."));
    const verb = t !== "s" || hasPos(c, "v"), isPos = x => verb ? hasPos(x, "v") && !/s$/.test(key(x.word)) : hasPos(x, "n") && !/(ence|ance|tude|ness|ity|ism|s)$/.test(key(x.word));
    const bad = new Set([w, ...((REL[w] || [])[0] || []), ...String(c.synonyms || "").toLowerCase().split(/,\s*/)]);
    const order = [unit, ...B.units.filter(u => u !== unit).sort((a, b) => Math.abs(a.n - unit.n) - Math.abs(b.n - unit.n))];
    const od = [], odh = [];
    for (const u of order) { for (const x of u.raw) { const k = key(x.word); if (od.length >= 8) break; if (bad.has(k) || !isPos(x) || /\s/.test(k) || (((REL[k] || [])[0]) || []).includes(w)) continue; const f = inflect(k, t); if (f && !od.includes(f) && f !== tok) { od.push(f); odh.push(k); } } if (od.length >= 8) break; }
    if (od.length < 3) return null;
    return { b: c.sentence.slice(0, m.index) + "__________" + c.sentence.slice(m.index + m[0].length), ao: tok, od, odh };
  }
  return null;
}

// ---- synonyms / antonyms that have a card in the app ----
const REL = loadJs("sat-relations.js").SAT_REL || {};
const rel = w => { const r = REL[w]; if (!r) return [[], []]; return [0, 1].map(i => (r[i] || []).filter(x => ALL.has(x) && x !== w).slice(0, 8)); };

// ---- suggested difficulty 1-4 (tools/difficulty.py) ----
const DIFF = process.env.DIFF_FILE ? JSON.parse(fs.readFileSync(process.env.DIFF_FILE, "utf8")) : null;
if (!DIFF) { console.error("need DIFF_FILE (run tools/difficulty.py first)"); process.exit(1); }

// ---- Hot Words 基礎/進階 per lesson (site tools/hot-level/build.py → hot-levels.js): hv 1 = 基礎字, 2 = 進階字 ----
const HOT_CORE = fs.existsSync(path.join(SRC, "hot-levels.js")) ? loadJs("hot-levels.js").HOT_CORE : null;
const HOT_MCQ = fs.existsSync(path.join(SRC, "hot-mcq.js")) ? loadJs("hot-mcq.js").HOT_MCQ : null;
if (!HOT_CORE) console.warn("  hot-levels.js not found: Hot Words cards get no 基礎/進階 level");

// ---- write ----
fs.mkdirSync(OUT, { recursive: true });
const meta = { version: VERSION, banks: [] };
const oldMeta = fs.existsSync(path.join(OUT, "meta.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "meta.json"), "utf8")) : { banks: [] };
for (const B of BANKS) {
  let count = 0, cloze = 0;
  const units = B.units.map(u => ({
    n: u.n, t: u.theme, tz: u.themeZh,
    c: u.raw.map(c => {
      const w = clean(c.word), k = key(c.word);
      const a = c.advSentence || fill(c.sentence, w), at = c.advSentence ? (c.advTranslation || "") : (c.translation || "");
      const q = u.quiz[k];
      let b = null, o = null;
      if (q) { b = q.question; o = q.options.map(x => x.text); if (!o.some(x => x.toLowerCase() === k)) { b = null; o = null; } }
      if (!b && /_{3,}/.test(c.sentence || "")) b = c.sentence;
      if (b && !o && B.id === "h" && HOT_MCQ && (HOT_MCQ[u.n] || {})[c.word]) o = [w, ...HOT_MCQ[u.n][c.word].map(clean)];   // site's checked wrong choices
      if (!b && B.id === "m") b = blankOwn(c.sentence || "", k, B.id);
      let inf = null; if (!b && B.id === "m") { inf = inflectedCloze(c, u, B, REL); if (inf) b = inf.b; else console.log("  no cloze:", w, "::", c.sentence); }
      const [syn, ant] = rel(k);
      count++; if (b) cloze++;
      const card = { w, p: (c.pos || "").trim(), d: c.definition || "", z: c.chinese || "", a, at, hl: highlights(a, B.id) };
      if (c.synonyms) card.s = c.synonyms;
      if (b) card.b = b; if (o) card.o = o;
      if (inf) { card.ao = inf.ao; card.od = inf.od; card.odh = inf.odh; }
      if (b) { const bh = highlights(b, B.id).filter(x => x[2] !== k); if (bh.length) card.bh = bh; }   // other SAT words in the quiz sentence
      if (syn.length) card.sy = syn; if (ant.length) card.an = ant;
      const df = DIFF[k]; if (!df) throw new Error("no difficulty for " + k); card.df = df[0]; card.dz = Math.round(df[1] * 100);
      if (c.root) card.r = c.root; if (c.source) card.src = c.source;
      if (B.id === "h" && HOT_CORE) card.hv = (HOT_CORE[u.n] || []).includes(c.word) ? 1 : 2;
      return card;
    })
  }));
  const json = Buffer.from(JSON.stringify({ id: B.id, name: B.name, zh: B.zh, ul: B.unitLabel, units }));
  const iv = crypto.randomBytes(12), ci = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([iv, ci.update(json), ci.final(), ci.getAuthTag()]);
  fs.writeFileSync(path.join(OUT, `${B.id}.bin`), enc);
  meta.banks.push({ id: B.id, name: B.name, zh: B.zh, units: units.length, words: count });
  console.log(B.id, B.name, "units", units.length, "cards", count, "cloze", cloze, "bytes", enc.length);
}
meta.banks.push(...oldMeta.banks.filter(b => !BANKS.some(B => B.id === b.id)));   // keep banks built by other scripts (易混淆字 "c")
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta));
