// Build the 易混淆字 (Confusables) word bank: data/c.bin, and add/refresh bank "c" in data/meta.json.
// The other banks (b, h, m) are left untouched.
// Usage: APP_KEY=<base64 32 bytes> node tools/build-cf.js <flashcard site folder> <bank version>
// Source: the site's cf-unit1..N-data.js (made by tools/confusables/build.py in the site repo).
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const SRC = process.argv[2], VER = process.argv[3];
const KEY = Buffer.from(process.env.APP_KEY || "", "base64");
if (!SRC || !VER || KEY.length !== 32) { console.error("need site folder, version and APP_KEY"); process.exit(1); }
const OUT = path.join(__dirname, "..", "data");
const loadJs = file => { const window = {}; eval(fs.readFileSync(path.join(SRC, file), "utf8")); return window; };
const clean = w => String(w || "").replace(/\s*\(.*?\)\s*/g, " ").trim();
const key = w => clean(w).toLowerCase();

// ---- headwords of the banks already in the app (same unit ranges as tools/build.js) ----
const OTHER = [["m", "mk-unit", 30], ["h", "hot-unit", loadJs("hot-words.js").HOT_LESSON_COUNT || 92], ["b", "unit", 46]];
const heads = { c: new Set() };
for (const [id, pre, n] of OTHER) {
  heads[id] = new Set();
  for (let i = 1; i <= n; i++) Object.values(loadJs(`${pre}${i}-data.js`).FLASHCARD_UNITS)[0].cards.forEach(c => heads[id].add(key(c.word)));
}
const units = [];
for (let n = 1; fs.existsSync(path.join(SRC, `cf-unit${n}-data.js`)); n++) units.push(loadJs(`cf-unit${n}-data.js`).CF_UNIT);
units.forEach(u => u.groups.forEach(g => g.words.forEach(w => heads.c.add(key(w.w)))));
const ALL = new Set(Object.values(heads).flatMap(s => [...s]));

function buildForms(hs) {
  const forms = new Map(), add = (f, h) => { if (f.length > 2 && !forms.has(f)) forms.set(f, h); };
  hs.forEach(h => add(h, h));
  [...hs].sort((a, b) => Number(b.endsWith("e")) - Number(a.endsWith("e"))).forEach(w => {
    if (/\s/.test(w)) return;
    ["s", "es", "d", "ed", "ing", "ly", "ness", "ment"].forEach(s => add(w + s, w));
    if (w.endsWith("e")) { const st = w.slice(0, -1); ["ing", "ion", "ions", "ation", "ations"].forEach(s => add(st + s, w)); }
    if (/[^aeiou]y$/.test(w)) { const st = w.slice(0, -1); ["ies", "ied", "ily", "iness"].forEach(s => add(st + s, w)); }
    if (/[^aeiou][aeiou][bdgklmnprt]$/.test(w)) { const l = w.slice(-1); ["ed", "ing"].forEach(s => add(w + l + s, w)); }
  });
  return forms;
}
const forms = {}; Object.keys(heads).forEach(id => forms[id] = buildForms([...heads[id]]));
const NOT_WORD = new Set(["railing", "railings", "novels", "remotely", "warranty", "commonly", "costs", "checked", "checks", "checking", "flags", "flagged"]);
function highlights(text, own) {
  const out = [], re = /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ']*/g; let m;
  while ((m = re.exec(text))) {
    const tok = m[0].replace(/'s$/i, "").replace(/'+$/, ""), t = tok.toLowerCase();
    if (NOT_WORD.has(t) && t !== own) continue;
    let h = null; for (const id of ["c", "h", "b", "m"]) { h = forms[id].get(t); if (h) break; }
    if (h) out.push([m.index, tok.length, h]);
  }
  return out;
}
const zipf = JSON.parse(process.env.ZIPF_FILE ? fs.readFileSync(process.env.ZIPF_FILE, "utf8") : "{}");   // word -> Zipf frequency
const level = z => z >= 3.55 ? 1 : z >= 2.95 ? 2 : z >= 2.35 ? 3 : 4;                                       // same cuts as tools/difficulty.py

// ---- cards: one per word, in group order ----
const seen = new Set(), outUnits = [];
let count = 0, cloze = 0;
for (const u of units) {
  const cards = [];
  for (const g of u.groups) {
    const members = [...new Set(g.words.map(w => key(w.w)))];
    const grp = { id: g.id, n: g.name, tz: g.tipZh, te: g.tipEn, tr: g.trap };
    for (const k of members) {
      if (seen.has(k)) continue; seen.add(k);
      const senses = g.words.filter(w => key(w.w) === k), w = senses[senses.length - 1];   // 熟字僻義: the SAT sense is the main one
      const card = { w: w.w, p: w.pos, d: w.def, z: w.zh, a: w.s, at: w.t, hl: highlights(w.s, k), g: grp };
      if (senses.length > 1) card.cm = [senses[0].pos, senses[0].def, senses[0].zh, senses[0].s, senses[0].t];
      const rel = s => String(s || "").split(/\s*,\s*/).map(x => x.toLowerCase()).filter(x => ALL.has(x) && x !== k);
      if (w.syn) card.s = w.syn;
      const sy = rel(w.syn), an = rel(w.ant); if (sy.length) card.sy = sy; if (an.length) card.an = an;
      const ex = new Set((w.ex || []).map(key));                                            // near-synonyms in the group are never offered as wrong choices
      const others = members.filter(x => x !== k && !ex.has(x)); if (others.length) card.gm = others;
      const cz = g.qs.find(q => q.k === "cz" && key(q.w) === k);
      if (cz) {
        card.b = cz.q.replace("_____", "__________"); card.go = cz.o; card.goh = cz.oh.map(key); card.ao = cz.o[cz.a];
        const bh = highlights(card.b, k).filter(x => x[2] !== k); if (bh.length) card.bh = bh;
        cloze++;
      }
      const zf = zipf[k]; if (zf == null) throw new Error("no Zipf for " + k);
      card.df = senses.length > 1 ? Math.max(3, level(zf)) : level(zf); card.dz = Math.round(zf * 100);
      cards.push(card); count++;
    }
  }
  outUnits.push({ n: u.n, t: u.title, tz: cards.slice(0, 3).map(c => c.w).join(" · ") + " …", c: cards });
}
const bankInfo = { id: "c", name: "易混淆字 Confusables", zh: "形近・字根誤導・熟字僻義・易混用法・字根形近", ul: "Set" };
const json = Buffer.from(JSON.stringify(Object.assign({}, bankInfo, { units: outUnits })));
const iv = crypto.randomBytes(12), ci = crypto.createCipheriv("aes-256-gcm", KEY, iv);
const enc = Buffer.concat([iv, ci.update(json), ci.final(), ci.getAuthTag()]);
fs.writeFileSync(path.join(OUT, "c.bin"), enc);
const meta = JSON.parse(fs.readFileSync(path.join(OUT, "meta.json"), "utf8"));
meta.banks = meta.banks.filter(b => b.id !== "c").concat([{ id: "c", name: bankInfo.name, zh: bankInfo.zh, units: outUnits.length, words: count, v: VER }]);
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta));
console.log("c", bankInfo.name, "units", outUnits.length, "cards", count, "cloze", cloze, "bytes", enc.length);
