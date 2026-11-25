/* SAT Vocab app — flashcards, self-rating, quizzes, mistakes, history, sync. Plain JS, no libraries. */
(() => {
"use strict";
const CFG = window.APP_CONFIG || {}, $ = s => document.querySelector(s), app = $("#app"), nav = $("#nav");
const LS = {
  get(k, d) { try { const v = localStorage.getItem("sva." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("sva." + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem("sva." + k); } catch (e) {} }
};
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 864e5);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const LV = ["已經會了", "不會 1", "不會 2", "不會 3"], LVHINT = ["", "有點不熟", "不熟", "完全不會"];
const MODES = { ed: "看英文選英文解釋", cz: "看例句選單字", ez: "看英文選中文", sp: "聽發音拼字", mix: "混合題型" };
const REVIEW_GAPS = [3, 7, 14, 30];
const HV = ["全部", "基礎字", "進階字"], HVHINT = ["基礎＋進階", "核心常考字，先學熟", "延伸的艱澀字，學有餘力再挑戰"];   // Hot Words lessons: hv 1 / 2
const DF = ["", "基礎", "中階", "進階", "挑戰"], DFHINT = ["", "較常見的字，先拿下", "SAT 核心字", "較少見，需要多看幾次", "最難，行有餘力再攻"], SETSIZE = 20;

/* ---------- saved data ---------- */
let auth = LS.get("auth", null);
let W = LS.get("words", {});              // word -> [level 0-3, correct streak, review stage, due day, wrong count, last day]
let M = Object.assign({ star: {}, hist: [], lastWrong: [], days: {}, tokens: 0, correct: 0, queue: [], last: null, dirty: false,
  set: { rate: 0.9, autoWord: true, autoSent: true, theme: "light", font: 1, goal: 20, email: "" } }, LS.get("meta", {}));
const saveW = () => { LS.set("words", W); M.dirty = true; LS.set("meta", M); };
const saveM = () => LS.set("meta", M);
const day = () => (M.days[today()] = M.days[today()] || { c: 0, q: 0, r: 0 });
function streak() { let n = 0, d = today(); if (!M.days[d]) d--; while (M.days[d] && (M.days[d].c || M.days[d].q)) { n++; d--; } return n; }
function device() { let d = LS.get("device", ""); if (!d) { d = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); LS.set("device", d); } return d; }

/* ---------- word banks ---------- */
let BANKS = [], CARDS = [], INDEX = {}, ready = false;
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function loadBanks() {
  const meta = await (await fetch("data/meta.json?v=" + CFG.version)).json();
  const key = await crypto.subtle.importKey("raw", b64(auth.key), "AES-GCM", false, ["decrypt"]);
  BANKS = await Promise.all(meta.banks.map(async m => {
    const buf = new Uint8Array(await (await fetch(`data/${m.id}.bin?v=${m.v || meta.version}`)).arrayBuffer());
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }));
  CARDS = []; INDEX = {};
  BANKS.forEach(B => B.units.forEach(u => u.c.forEach((c, i) => {
    c.bank = B.id; c.unit = u.n; c.i = i; c.k = c.w.toLowerCase(); c.pg = (c.p.match(/[a-z]+/i) || [""])[0].toLowerCase().replace("vb", "v");
    CARDS.push(c); (INDEX[c.k] = INDEX[c.k] || []).push(c);
  })));
  ready = true;
}
const bank = id => BANKS.find(b => b.id === id);
const unitOf = (id, n) => bank(id).units.find(u => u.n === n);
const unitName = (B, u) => `${B.ul} ${u.n}` + (u.t ? ` · ${u.t}` : "");
const hcards = (u, L) => (L ? u.c.filter(c => (c.hv || 1) === L) : u.c);      // Hot Words: one lesson's 基礎字 / 進階字
let hlv = LS.get("hlv", 1);
const lookup = (k, prefer) => { const l = INDEX[k]; return l ? (l.find(c => c.bank === prefer) || l[0]) : null; };
const lv = k => (W[k] ? W[k][0] : -1);          // -1 = not rated yet
const isDue = k => W[k] && W[k][0] === 0 && W[k][3] <= today();
const uniq = cards => { const seen = {}; return cards.filter(c => !seen[c.k] && (seen[c.k] = 1)); };
function tally(cards) { const t = { n: 0, known: 0, l1: 0, l2: 0, l3: 0, new: 0 }; uniq(cards).forEach(c => { t.n++; const l = lv(c.k); if (l < 0) t.new++; else if (l === 0) t.known++; else t["l" + l]++; }); return t; }

const dfCards = L => uniq(CARDS.filter(c => c.bank !== "c")).filter(c => c.df === L).sort((a, b) => b.dz - a.dz || (a.k < b.k ? -1 : 1));   // commonest first
const dfSet = (L, S) => dfCards(L).slice((S - 1) * SETSIZE, S * SETSIZE);

/* ---------- speech ---------- */
let voice = null;
function pickVoice() { const v = speechSynthesis.getVoices(); voice = v.find(x => /en[-_]US/i.test(x.lang) && /Samantha|Google US|Aria|Jenny/i.test(x.name)) || v.find(x => /en[-_]US/i.test(x.lang)) || v.find(x => /^en/i.test(x.lang)) || null; }
if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text, then) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; if (voice) u.voice = voice; u.rate = M.set.rate;
  if (then) u.onend = then; speechSynthesis.speak(u);
}
const hush = () => { if ("speechSynthesis" in window) speechSynthesis.cancel(); };

/* ---------- backend ---------- */
async function api(body) {
  if (!CFG.api) throw new Error("no_api");
  const r = await fetch(CFG.api, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" });
  return r.json();
}
const packState = () => JSON.stringify({ w: W, s: M.star, lw: M.lastWrong, d: Object.fromEntries(Object.entries(M.days).slice(-40)), t: M.tokens, c: M.correct, h: M.hist.slice(0, 40), l: M.last });
function unpackState(s) {
  try { const o = JSON.parse(s); W = o.w || {}; M.star = o.s || {}; M.lastWrong = o.lw || []; M.days = o.d || {}; M.tokens = o.t || 0; M.correct = o.c || 0; M.hist = o.h || []; M.last = o.l || null; LS.set("words", W); saveM(); } catch (e) {}
}
let syncing = false;
async function sync(force) {
  if (!auth || syncing || (!force && !M.dirty && !M.queue.length)) return "idle";
  syncing = true;
  try {
    const sent = M.queue.slice(), t = tally(CARDS);
    const res = await api({ action: "sync", code: auth.code, device: auth.device, state: packState(), quizzes: sent,
      summary: { known: t.known, l1: t.l1, l2: t.l2, l3: t.l3, streak: streak(), cardsToday: day().c } });
    if (res.ok) { M.queue = M.queue.slice(sent.length); M.dirty = false; M.lastSync = Date.now(); saveM(); auth.lastOk = Date.now(); LS.set("auth", auth); return "ok"; }
    if (["invalid", "inactive", "device"].includes(res.error)) { lockOut(res.error); return "locked"; }
    return "fail";
  } catch (e) { return "offline"; } finally { syncing = false; }
}
function lockOut(why) {
  auth = null; LS.del("auth"); ready = false; BANKS = []; CARDS = []; INDEX = {};
  go("login", { msg: why === "inactive" ? "這組代碼已停用，請聯絡 Jennifer 老師。" : why === "device" ? "這支裝置已被移除，請重新輸入代碼。" : "代碼無效，請聯絡 Jennifer 老師。" });
}
document.addEventListener("visibilitychange", () => { if (document.hidden) { hush(); sync(); } });

/* ---------- small UI helpers ---------- */
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200); }
function sheet(html) { const s = $("#sheet"); s.innerHTML = `<div class="sheet-bg" data-act="closeSheet"></div><div class="sheet-body">${html}</div>`; s.hidden = false; }
const closeSheet = () => { $("#sheet").hidden = true; $("#sheet").innerHTML = ""; };
const bar = t => `<div class="bar"><b style="width:${t.n ? t.known / t.n * 100 : 0}%" class="k"></b><b style="width:${t.n ? (t.l1 + t.l2 + t.l3) / t.n * 100 : 0}%" class="u"></b></div>`;
const head = (title, sub, right = "") => `<header><button class="back" data-act="back">‹</button><div class="ht"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>${right}</header>`;

/* ---------- navigation ---------- */
let view = "", arg = {}, stack = [];
function go(v, a = {}, replace) {
  hush(); closeSheet();
  if (!replace && view && view !== "login" && view !== v) stack.push([view, arg]);
  if (["home", "login"].includes(v)) stack = [];
  view = v; arg = a; render(); window.scrollTo(0, 0);
}
function back() { const p = stack.pop(); if (p) { hush(); closeSheet(); view = p[0]; arg = p[1]; render(); } else go("home"); }
function render() {
  document.documentElement.dataset.theme = M.set.theme; document.documentElement.style.fontSize = 16 * M.set.font + "px";
  const full = ["login", "cards", "quiz", "game"].includes(view);
  nav.hidden = full; document.body.classList.toggle("full", full);
  nav.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.go === view));
  (VIEWS[view] || VIEWS.home)();
}
const VIEWS = {};

/* ---------- login ---------- */
VIEWS.login = () => {
  app.innerHTML = `<div class="login"><div class="logo">SAT<br><span>VOCAB</span></div>
    <h1>Jennifer 老師 SAT 單字</h1><p>請輸入老師給你的學生代碼</p>
    <input id="code" maxlength="12" autocomplete="off" autocapitalize="characters" placeholder="學生代碼">
    <button class="btn primary" data-act="login">登入</button>
    <p class="err" id="lerr">${esc(arg.msg || (CFG.api ? "" : "系統尚未開通，請稍後再試。"))}</p>
    <p class="fine">本 app 僅供 Jennifer 老師的學生使用。<br>每組代碼限本人使用，請勿外流。</p></div>`;
};
async function doLogin() {
  const code = $("#code").value.trim().toUpperCase(), err = $("#lerr"); if (!code) return;
  err.textContent = "驗證中…";
  try {
    const res = await api({ action: "login", code, device: device() });
    if (!res.ok) { err.textContent = { invalid: "代碼不正確。", inactive: "這組代碼已停用，請聯絡老師。", devices: "這組代碼已在其他裝置使用，達到上限。請聯絡老師。" }[res.error] || "登入失敗，請再試一次。"; return; }
    auth = { code, device: device(), name: res.name, cls: res.cls, key: res.key, lastOk: Date.now() }; LS.set("auth", auth);
    if (res.state && !Object.keys(W).length) unpackState(res.state);
    await start();
  } catch (e) { err.textContent = e.message === "no_api" ? "系統尚未開通，請稍後再試。" : "無法連線，請檢查網路。"; }
}
async function start() {
  app.innerHTML = `<div class="boot">SAT Vocab<br><small>下載字庫中…</small></div>`;
  try { await loadBanks(); } catch (e) { app.innerHTML = `<div class="boot">字庫載入失敗<br><small>請連上網路後重新開啟</small><br><button class="btn" data-act="reload">重試</button></div>`; return; }
  go("home"); sync(true);
}

/* ---------- home ---------- */
function pools() {
  const u = uniq(CARDS), lw = M.lastWrong.filter(k => INDEX[k]);
  return { lw, due: u.filter(c => isDue(c.k)).map(c => c.k), l3: u.filter(c => lv(c.k) === 3).map(c => c.k), l2: u.filter(c => lv(c.k) === 2).map(c => c.k), l1: u.filter(c => lv(c.k) === 1).map(c => c.k) };
}
VIEWS.home = () => {
  const p = pools(), d = day(), goal = M.set.goal, pct = Math.min(100, Math.round(d.c / goal * 100));
  const row = (label, list, key, cls) => list.length ? `<div class="rrow ${cls}"><div><b>${label}</b><small>${list.length} 個字</small></div>
      <button class="chip" data-act="deck" data-src="${key}">字卡</button><button class="chip solid" data-act="quizFrom" data-src="${key}">測驗</button></div>` : "";
  const zone = (label, n, key, cls, sub) => n ? `<button class="rrow zr ${cls}" data-act="rlist" data-src="${key}"><div><b>${label}</b><small>${sub || n + " 個字"}</small></div><i>›</i></button>` : "";
  const nmix = p.l3.length + p.l2.length + p.l1.length, hw = M.hist.filter(h => h.wrong.length).length;
  const rows = row("上次錯題", p.lw, "lw", "r0") + row("到期複習（已會的字）", p.due, "due", "rd")
    + ([p.l3, p.l2, p.l1].filter(x => x.length).length > 1 ? zone("不會 1／2／3 混合", nmix, "lmix", "rm", `${nmix} 個字 · 完全不會的字考最多次`) : "")
    + zone("不會 3 · 完全不會", p.l3.length, "l3", "r3") + zone("不會 2 · 不熟", p.l2.length, "l2", "r2") + zone("不會 1 · 有點不熟", p.l1.length, "l1", "r1")
    + (hw ? `<button class="rrow zr rh" data-act="pickhist"><div><b>跨次錯題本</b><small>勾選多次測驗，把錯題合在一起考</small></div><i>›</i></button>` : "");
  const last = M.last && bank(M.last.b) && unitOf(M.last.b, M.last.u);
  app.innerHTML = `<div class="page">
    <div class="hello"><div><small>${esc(auth.cls || "SAT")}</small><h2>Hi, ${esc(auth.name)}</h2></div>
      <div class="badges"><span title="連續天數">🔥 ${streak()}</span><button data-act="game" class="${M.tokens ? "has" : ""}">🎮 ${M.tokens}</button></div></div>
    <div class="goal"><div class="ring" style="--p:${pct}"><b>${d.c}</b><small>/ ${goal}</small></div>
      <div><b>今日目標</b><p>今天看了 ${d.c} 張字卡，答對 ${d.r} 題${pct >= 100 ? "，達標 🎉" : ""}</p></div></div>
    <button class="search" data-act="search">🔍 搜尋單字（跨字庫）</button>
    ${last ? `<button class="cont" data-act="unit" data-b="${M.last.b}" data-u="${M.last.u}" data-i="${M.last.i || 0}" data-lv="${M.last.hv || 0}"><small>繼續上次</small><b>${esc(bank(M.last.b).name)} · ${esc(unitName(bank(M.last.b), last))}${M.last.hv ? " · " + HV[M.last.hv] : ""}</b><i>›</i></button>` : ""}
    ${rows ? `<h3>先複習</h3><div class="review">${rows}</div>` : `<div class="tip">先選一個字庫開始看字卡，把每個字分成「已經會了」或「不會 1 / 2 / 3」。測驗只會考「不會」的字。</div>`}
    <h3>依建議難度學習</h3><div class="levels">${[1, 2, 3, 4].map(L => { const t = tally(dfCards(L)); return `<button class="lvl d${L}" data-act="level" data-l="${L}"><b>${DF[L]}</b><small>${t.n} 字</small>${bar(t)}<small>已會 ${t.known}</small></button>`; }).join("")}</div>
    <h3>字庫</h3>
    ${BANKS.map(B => { const t = tally(B.units.flatMap(u => u.c)); return `<button class="bankcard b-${B.id}" data-act="bank" data-b="${B.id}">
      <div><b>${esc(B.name)}</b><small>${esc(B.zh)} · ${B.units.length} 個單元 · ${t.n} 字</small></div>${bar(t)}
      <div class="nums"><span>已會 ${t.known}</span><span>不會 ${t.l1 + t.l2 + t.l3}</span><span>未分類 ${t.new}</span></div></button>`; }).join("")}
  </div>`;
};

/* ---------- unit list ---------- */
VIEWS.bank = () => {
  const B = bank(arg.b), isH = B.id === "h" && B.units.some(u => u.c.some(c => c.hv)), L = isH ? hlv : 0, sfx = L ? ":" + L : "";
  const seg = isH ? `<div class="hvbar"><div class="seg">${[1, 2, 0].map(n => { const cnt = B.units.reduce((t, u) => t + hcards(u, n).length, 0); return `<button class="${hlv === n ? "on" : ""} hv${n}" data-act="hlv" data-l="${n}">${HV[n]} <small>${cnt}</small></button>`; }).join("")}</div>
      <p class="muted">${L === 1 ? "基礎字＝每課原本的核心 SAT 常考字，先把這些學熟。" : L === 2 ? "進階字＝後來擴充的延伸字，比較艱澀，學有餘力再挑戰。" : "基礎字＋進階字全部一起。"}字卡、總表和測驗都只用所選的字。</p></div>` : "";
  app.innerHTML = head(B.name, B.zh) + `<div class="page">${seg}<div class="units">${B.units.filter(u => hcards(u, L).length).map(u => { const cs = hcards(u, L), t = tally(cs); return `<div class="urow">
      <button class="umain" data-act="unit" data-b="${B.id}" data-u="${u.n}" data-lv="${L}"><b>${B.ul} ${u.n}${L ? ` <em class="hvtag hv${L}">${HV[L]}</em>` : ""}</b><span>${esc(u.t || "")}${u.tz ? " " + esc(u.tz) : ""}</span>${bar(t)}
      <small>${t.n} 字 · 已會 ${t.known} · 不會 ${t.l1 + t.l2 + t.l3}</small></button>
      <div class="uact"><button class="chip" data-act="rlist" data-src="u:${B.id}:${u.n}${sfx}">總表</button><button class="chip solid" data-act="quizFrom" data-src="u:${B.id}:${u.n}${sfx}">測驗</button>${(() => { const ns = uniq(cs).filter(c => M.star[c.k]).length; return ns ? `<button class="chip ustar" data-act="quizFrom" data-src="us:${B.id}:${u.n}${sfx}" title="只考這單元的星號字">★ ${ns}</button>` : ""; })()}</div></div>`; }).join("")}</div></div>`;
};

/* ---------- suggested-difficulty zone: ready-made sets of 20, no self-sorting needed ---------- */
VIEWS.level = () => {
  const L = arg.l, all = dfCards(L), t = tally(all), sets = Math.ceil(all.length / SETSIZE);
  app.innerHTML = head(`難度 ${L} · ${DF[L]}`, DFHINT[L]) + `<div class="page"><div class="box pad"><b>${t.n} 個字</b> · 已會 ${t.known} · 不會 ${t.l1 + t.l2 + t.l3} · 還沒看 ${t.new}${bar(t)}
      <p class="muted">不用先分類。直接選一組看字卡，或直接測驗；測驗會考這一區所有「還沒標記已經會了」的字。</p>
      <button class="btn primary" data-act="quizFrom" data-src="d:${L}">測驗整個「${DF[L]}」區</button></div>
    <h3>每組 ${SETSIZE} 字（由常見到少見）</h3><div class="units">${Array.from({ length: sets }, (_, i) => { const cs = all.slice(i * SETSIZE, (i + 1) * SETSIZE), ts = tally(cs); return `<div class="urow">
      <button class="umain" data-act="dset" data-l="${L}" data-s="${i + 1}"><b>第 ${i + 1} 組</b><span>${esc(cs[0].w)} … ${esc(cs[cs.length - 1].w)}</span>${bar(ts)}<small>${ts.n} 字 · 已會 ${ts.known} · 不會 ${ts.l1 + ts.l2 + ts.l3}</small></button>
      <button class="chip solid" data-act="quizFrom" data-src="d:${L}:${i + 1}">測驗</button></div>`; }).join("")}</div></div>`;
};

/* ---------- flashcards ---------- */
let deck = null;                                   // { title, cards, i }
function openDeck(title, cards, i = 0, unitRef) { if (!cards.length) return toast("沒有單字"); deck = { title, cards, i: Math.min(i, cards.length - 1), unitRef, done: false }; go("cards"); }
function richText(text, hl, own) {               // SAT words inside a sentence become tappable
  let out = "", pos = 0;
  (hl || []).forEach(([s, n, h]) => {
    if (s < pos) return; out += esc(text.slice(pos, s));
    const txt = esc(text.slice(s, s + n));
    out += h === own ? `<b class="own">${txt}</b>` : `<b class="sat" data-act="pop" data-w="${esc(h)}" data-say="${txt}">${txt}</b>`;
    pos = s + n;
  });
  return out + esc(text.slice(pos));
}
const sentenceHtml = c => richText(c.a, c.hl, c.k);
function autoSpeak(c) {
  hush(); if (!M.set.autoWord && !M.set.autoSent) return;
  const id = deck && deck.i;
  const sent = () => { if (M.set.autoSent && view === "cards" && deck && deck.i === id) setTimeout(() => { if (view === "cards" && deck.i === id) speak(c.a); }, 500); };
  if (M.set.autoWord) speak(c.w, sent); else sent();
}
VIEWS.cards = () => {
  const c = deck.cards[deck.i], l = lv(c.k), B = bank(c.bank);
  if (deck.unitRef) { M.last = { b: c.bank, u: c.unit, i: deck.i, hv: deck.unitRef.hv || 0 }; saveM(); }
  if (deck.done) {
    const t = tally(deck.cards);
    const nq = uniq(deck.cards).filter(c => lv(c.k) > 0).length;
    app.innerHTML = head(deck.title, "完成") + `<div class="page"><div class="center"><div class="big">🎉</div><h2>這一輪看完了</h2>
      <p>已會 ${t.known} · 不會 ${t.l1 + t.l2 + t.l3} · 未分類 ${t.new}</p>${bar(t)}</div>
      <h3>本輪單字總表</h3>${revBar(uniq(deck.cards).length)}<div class="wlist">${uniq(deck.cards).map(c => trow(c.k, false, c.bank)).join("")}</div>
      <h3>測驗這一輪「不會」的字（${nq}）</h3>${nq ? modePick() + `<button class="btn primary" data-act="quizDeck">開始測驗</button>` : `<p class="muted">這一輪沒有標「不會」的字。</p>`}
      <button class="btn" data-act="again">再看一次</button><button class="btn" data-act="back">返回</button></div>`;
    sync(); return;
  }
  const rel = (label, list) => list && list.length ? `<div class="rel"><small>${label}</small>${list.map(w => `<button class="chip" data-act="pop" data-w="${esc(w)}">${esc(w)}</button>`).join("")}</div>` : "";
  app.innerHTML = head(deck.title, `${deck.i + 1} / ${deck.cards.length}`, `<button class="star ${M.star[c.k] ? "on" : ""}" data-act="star">★</button>`) + `
    <div class="prog"><b style="width:${(deck.i + 1) / deck.cards.length * 100}%"></b></div>
    <div class="card" id="card">
      <div class="src">${esc(B.name)} · ${B.ul} ${c.unit}${c.src ? ` · List ${esc(c.src)}` : ""} · <span class="dfb d${c.df}">難度 ${c.df} ${DF[c.df]}</span></div>
      <div class="word"><h1>${esc(c.w)}</h1><button class="spk" data-act="say" data-t="${esc(c.w)}">🔊</button></div>
      <div class="pos">${esc(c.p)}</div>
      <p class="def">${esc(c.d)}</p><p class="zh">${esc(c.z)}</p>
      ${c.r ? `<p class="root">字源 ${esc(c.r)}</p>` : ""}
      ${c.cm ? `<p class="cm"><small>常見義</small> <em>${esc(c.cm[0])}</em> ${esc(c.cm[2])} — ${esc(c.cm[1])}<br><span>${esc(c.cm[3])}</span></p>` : ""}
      ${c.g ? `<div class="cfbox"><div class="cfh"><small>易混淆 ${esc(c.g.id)}</small>${[c.k, ...(c.gm || [])].map(k => k === c.k ? `<b>${esc(c.w)}</b>` : `<button class="chip" data-act="pop" data-w="${esc(k)}">${esc(k)}</button>`).join("")}</div>
        <p>💡 ${esc(c.g.tz)}</p><p class="en">${esc(c.g.te)}</p><p class="trap">⚠ ${esc(c.g.tr)}</p></div>` : ""}
      <div class="sent"><div class="sl"><small>例句</small><button class="spk" data-act="saySent">🔊</button></div>
        <p class="en">${sentenceHtml(c)}</p><p class="tr">${esc(c.at)}</p></div>
      ${rel("SAT 同義字", c.sy) + rel("SAT 反義字", c.an)}
      ${c.s ? `<p class="syn"><small>近義詞</small> ${esc(c.s)}</p>` : ""}
    </div>
    <div class="rate"><small>${l < 0 ? "這個字你會嗎？" : "目前：" + LV[l]}</small><div>
      <button class="r0 ${l === 0 ? "on" : ""}" data-act="rate" data-l="0">✓<br>已經會了</button>
      ${[1, 2, 3].map(n => `<button class="r${n} ${l === n ? "on" : ""}" data-act="rate" data-l="${n}">不會 ${n}<br><small>${LVHINT[n]}</small></button>`).join("")}
    </div><div class="navb"><button data-act="prev">‹ 上一張</button><button data-act="next">下一張 ›</button></div></div>`;
  autoSpeak(c);
};
function move(d) {
  const n = deck.i + d;
  if (n < 0) return; if (n >= deck.cards.length) { deck.done = true; return render(); }
  deck.i = n; render(); $("#card") && ($("#card").scrollTop = 0);
}
function setLevel(k, l) {
  const old = W[k];
  W[k] = l === 0 ? [0, 0, 0, today() + REVIEW_GAPS[0], old ? old[4] : 0, today(), old ? old[6] || 0 : 0] : [l, 0, 0, 0, old ? old[4] : 0, today(), old ? old[6] || 0 : 0];
  saveW();
}
function rate(l) {
  const c = deck.cards[deck.i], old = W[c.k], first = !old || old[5] !== today();
  setLevel(c.k, l); if (first) { day().c++; saveM(); }
  move(1);
}
const LVBTN = [[3, "完全不會 3"], [2, "不熟 2"], [1, "有點不熟 1"], [0, "已經會了"]];
function popWord(k, say) {
  const c = lookup(k, view === "quiz" && quiz ? quiz.qs[quiz.i].c.bank : deck && deck.cards[deck.i] ? deck.cards[deck.i].bank : "h"); if (!c) return;
  hush(); speak(say || c.w);
  sheet(`<div class="popw"><h2>${esc(c.w)} <button class="spk" data-act="say" data-t="${esc(c.w)}">🔊</button></h2><small>${esc(c.p)} · ${esc(bank(c.bank).name)} ${bank(c.bank).ul} ${c.unit}${lv(c.k) >= 0 ? " · " + LV[lv(c.k)] : ""}</small>
    <p class="def">${esc(c.d)}</p><p class="zh">${esc(c.z)}</p>
    <div class="addlv"><small>新增至</small><div>${LVBTN.map(([n, t]) => `<button class="r${n} ${lv(c.k) === n ? "on" : ""}" data-act="setlv" data-w="${esc(c.k)}" data-l="${n}">${t}</button>`).join("")}</div></div>
    <button class="btn primary" data-act="openWord" data-w="${esc(c.k)}">開啟這張字卡</button></div>`);
}
let touch = null;
app.addEventListener("touchstart", e => { if (view === "cards") touch = [e.touches[0].clientX, e.touches[0].clientY]; }, { passive: true });
app.addEventListener("touchend", e => {
  if (view !== "cards" || !touch || deck.done) return;
  const dx = e.changedTouches[0].clientX - touch[0], dy = e.changedTouches[0].clientY - touch[1]; touch = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) move(dx < 0 ? 1 : -1);
}, { passive: true });

/* ---------- quiz ---------- */
function cardsFor(src) {
  const p = pools(), pick = ks => ks.map(k => lookup(k)).filter(Boolean);
  if (src === "all") return [uniq(CARDS), "全部字庫"];
  if (src === "lw") return [pick(p.lw), "上次錯題"];
  if (src === "due") return [pick(p.due), "到期複習"];
  if (/^l[123]$/.test(src)) return [pick(p[src]), `${LV[+src[1]]} · ${LVHINT[+src[1]]}`];
  if (src === "lmix") return [pick([...p.l3, ...p.l2, ...p.l1]), "不會 1／2／3 混合"];
  if (src === "hp") return [pick(uniqK(M.hist.filter(h => hpick.has(h.ts)).flatMap(h => h.wrong))), "勾選的測驗錯題"];
  if (src === "star") return [pick(Object.keys(M.star)), "星號單字"];
  if (src === "wrong") return [uniq(CARDS).filter(c => W[c.k] && W[c.k][4] > 0).sort((a, b) => wrongSort === "rate" ? missRate(b.k) - missRate(a.k) || W[b.k][4] - W[a.k][4] : W[b.k][4] - W[a.k][4] || missRate(b.k) - missRate(a.k)), "全部錯題"];
  if (src === "known") return [uniq(CARDS).filter(c => lv(c.k) === 0), "已經會了"];
  const m = src.split(":");
  if (m[0] === "d") return m[2] ? [dfSet(+m[1], +m[2]), `難度 ${m[1]} ${DF[m[1]]} · 第 ${m[2]} 組`] : [dfCards(+m[1]), `難度 ${m[1]} ${DF[m[1]]}`];
  if (m[0] === "b") return [uniq(bank(m[1]).units.flatMap(u => hcards(u, +m[2] || 0))), bank(m[1]).name + (+m[2] ? " · " + HV[+m[2]] : "")];
  if (m[0] === "us") { const B = bank(m[1]), u = unitOf(m[1], +m[2]), L = +m[3] || 0; return [uniq(hcards(u, L)).filter(c => M.star[c.k]), `${B.name} · ${B.ul} ${u.n}${L ? " · " + HV[L] : ""} · ★ 星號字`]; }
  if (m[0] === "u") { const B = bank(m[1]), u = unitOf(m[1], +m[2]), L = +m[3] || 0; return [hcards(u, L), `${B.name} · ${B.ul} ${u.n}${L ? " · " + HV[L] : ""}`]; }
  return [[], ""];
}
const uniqK = ks => [...new Set(ks)];
let hpick = new Set();                              // quiz records (by timestamp) picked for a merged mistake quiz
let setup = { src: "all", lv: { 1: true, 2: true, 3: true }, mode: "ed", n: 10 };
function quizPool() {
  const [cards] = cardsFor(setup.src);
  if (["lw", "due", "known", "hp", "star"].includes(setup.src) || setup.src.startsWith("us:")) return cards;       // these lists are quizzed as they are (us: a unit's ★ words)
  if (setup.src.startsWith("d:")) return cards.filter(c => lv(c.k) !== 0);   // difficulty zones: everything not yet marked known
  return cards.filter(c => { const l = lv(c.k); return l > 0 && setup.lv[l]; });
}
VIEWS.quizsetup = () => {
  if (arg.src) { setup.src = arg.src; arg = {}; }
  const pool = quizPool(), fixed = ["lw", "due", "known", "hp", "star"].includes(setup.src) || /^(d|us):/.test(setup.src);
  const opt = (v, t) => `<option value="${v}" ${setup.src === v ? "selected" : ""}>${esc(t)}</option>`;
  const cur = cardsFor(setup.src)[1];
  app.innerHTML = `<div class="page"><h2>測驗</h2><p class="muted">字庫範圍只考你標記「不會」的字；難度區會考所有還沒標「已經會了」的字。不會的等級越高，越常出現。</p>
    <label>範圍</label><select id="qsrc">${opt("all", "全部字庫")}${BANKS.map(B => opt("b:" + B.id, B.name) + (B.id === "h" && B.units.some(u => u.c.some(c => c.hv)) ? opt("b:h:1", B.name + " · 基礎字") + opt("b:h:2", B.name + " · 進階字") : "")).join("")}
      ${[1, 2, 3, 4].map(L => opt("d:" + L, `難度 ${L} · ${DF[L]}`)).join("")}
      ${opt("lw", "上次錯題")}${opt("due", "到期複習（已會的字）")}${opt("wrong", "全部錯題")}${opt("star", "星號單字")}
      ${/^(u:|us:|d:\d+:|hp$|lmix$|l[123]$)/.test(setup.src) ? opt(setup.src, cur) : ""}</select>
    ${fixed ? "" : `<label>難度</label><div class="seg multi">${[1, 2, 3].map(n => `<button class="${setup.lv[n] ? "on" : ""}" data-act="qlv" data-l="${n}">不會 ${n}</button>`).join("")}</div>`}
    ${modePick()}
    <label>題數</label><div class="seg">${[10, 20, 30, 0].map(n => `<button class="${setup.n === n ? "on" : ""}" data-act="qn" data-n="${n}">${n || "全部"}</button>`).join("")}</div>
    <div class="poolinfo ${pool.length ? "" : "empty"}">${pool.length ? `符合的單字：<b>${pool.length}</b> 個` : (fixed ? "這個範圍目前沒有可以考的字。" : "這個範圍還沒有「不會」的字。先去看字卡把單字分類，或改選「難度」範圍直接考。")}</div>
    <button class="btn primary" data-act="qstart" ${pool.length ? "" : "disabled"}>開始測驗</button></div>`;
};
function weightedOrder(cards) {                     // level 3 comes up 4x as often as level 1
  return cards.map(c => { const w = [1, 1, 2, 4][Math.max(lv(c.k), 0)] || 1; return [c, Math.pow(Math.random(), 1 / w)]; }).sort((a, b) => b[1] - a[1]).map(x => x[0]);
}
function distractors(c, field) {
  const B = bank(c.bank), bad = new Set([c.k, ...(c.sy || [])]), out = [], seen = new Set([String(c[field]).toLowerCase()]);
  const take = list => shuffle(list).forEach(x => {
    if (out.length >= 3 || bad.has(x.k) || x.pg !== c.pg || (x.sy || []).includes(c.k)) return;
    const v = String(x[field]).toLowerCase(); if (seen.has(v)) return; seen.add(v); out.push(x);
  });
  (c.gm || []).forEach(k => { const x = lookup(k, "c"); if (!x || out.length >= 3) return; const v = String(x[field]).toLowerCase(); if (seen.has(v)) return; seen.add(v); out.push(x); });   // 易混淆字: the look-alikes are the choices
  if (c.cm && field !== "w" && out.length < 3) out.push({ w: c.w + "（常見義）", k: c.k, p: c.cm[0], d: c.cm[1], z: c.cm[2], pg: c.pg });   // 熟字僻義: the everyday meaning is the trap
  if (c.bank === "c" && field !== "w") { const pool = shuffle(bank("c").units.flatMap(u => u.c)); pool.forEach(x => { if (out.length >= 3 || x.k === c.k || x.pg !== c.pg) return; const v = String(x[field]).toLowerCase(); if (seen.has(v)) return; seen.add(v); out.push(x); }); }
  const near = d => B.units.filter(u => Math.abs(u.n - c.unit) <= d && u.n !== c.unit).flatMap(u => u.c);
  if (c.bank !== "h") take(unitOf(c.bank, c.unit).c);   // Hot Words lessons are synonym groups, so same-lesson choices would be unfair
  take(near(2)); take(near(6)); take(B.units.flatMap(u => u.c)); take(CARDS);
  return out;
}
function makeQ(c, mode) {
  if (mode === "mix") mode = shuffle(["ed", "ed", "cz", "cz", "ez", "sp"])[0];
  if (mode === "ed" && !c.d) mode = "ez";
  if (mode === "cz" && !c.b) mode = "ez";
  if (mode === "sp" && /\s/.test(c.w)) mode = "ez";
  if (mode === "sp") return { c, mode };
  if (mode === "cz") {
    let pairs;                                    // [option text, that option's card]
    if (c.go) pairs = c.go.map((f, i) => [f, f === c.ao ? c : lookup(c.goh[i], "c")]);   // 易混淆字: only the group's look-alikes, in the sentence's form
    else if (c.ao) pairs = [[c.ao, c], ...shuffle(c.od.map((f, i) => [f, lookup((c.odh || [])[i] || "", c.bank)])).slice(0, 3)];   // sentence uses a changed form (abated): options take the same form
    else if (c.o && c.o.length === 4) pairs = c.o.map(o => [o, o.toLowerCase() === c.k ? c : lookup(o.toLowerCase(), c.bank)]);
    else pairs = [[c.w, c], ...distractors(c, "w").map(x => [x.w, x])];
    pairs = shuffle(pairs);
    return { c, mode, opts: pairs.map(x => x[0]), oc: pairs.map(x => x[1]), ans: c.ao || c.w };
  }
  const f = mode === "ed" ? "d" : "z";             // ed: pick the English definition (as on the real SAT); ez: pick the Chinese
  const pairs = shuffle([[c[f], c], ...distractors(c, f).map(x => [x[f], x])]);
  return { c, mode, opts: pairs.map(x => x[0]), oc: pairs.map(x => x[1]), ans: c[f] };
}
let quiz = null;
function spreadOrder(cards, n) {
  const times = c => Math.max(1, Math.min(3, lv(c.k)));
  let words = weightedOrder(cards);
  if (n) { let tot = 0; words = words.filter(c => { if (tot && tot + times(c) > n) return false; tot += times(c); return true; }); }
  // every copy gets a slot spread evenly over the quiz, so the same word never comes back right away
  const seq = words.flatMap(c => Array.from({ length: times(c) }, (_, j) => [c, (j + .15 + Math.random() * .7) / times(c)])).sort((a, b) => a[1] - b[1]).map(x => x[0]);
  for (let i = 1; i < seq.length; i++) if (seq[i].k === seq[i - 1].k) {
    const j = seq.findIndex((x, m) => m > i && x.k !== seq[i].k && (m + 1 >= seq.length || seq[m + 1].k !== seq[i].k) && seq[m - 1].k !== seq[i].k);
    if (j > 0) [seq[i], seq[j]] = [seq[j], seq[i]];
  }
  return seq;
}
function startQuiz(cards, mode, n, label, redo, rep) {
  let order;
  if (rep) order = spreadOrder(cards, n);
  else {
    order = weightedOrder(cards); const want = n || order.length;
    if (order.length > want) order = order.slice(0, want);
    else if (!redo && n && order.length < want && order.length >= 4) {          // short list: harder words come back a second time
      const extra = weightedOrder(cards.filter(c => lv(c.k) >= 2)).slice(0, want - order.length); order = order.concat(extra);
    }
  }
  if (!order.length) return toast("沒有可以考的字");
  quiz = { label, mode, n, rep, qs: order.map(c => makeQ(c, mode)), i: 0, right: 0, wrong: [], t0: Date.now(), cards, picked: null, unlocked: 0 };
  go("quiz");
}
VIEWS.quiz = () => {
  const q = quiz.qs[quiz.i], c = q.c, done = quiz.picked != null;
  let body;
  if (q.mode === "sp") {
    body = `<div class="qsp"><button class="bigspk" data-act="say" data-t="${esc(c.w)}">🔊</button><p class="zh">${esc(c.z)}</p><p class="def">${esc(c.d)}</p>
      <input id="spin" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="拼出這個字" ${done ? "disabled" : ""} value="${done ? esc(quiz.picked) : ""}">
      ${done ? "" : `<button class="btn primary" data-act="spell">送出</button>`}</div>`;
  } else {
    const stem = q.mode === "cz" ? `<p class="stem">${richText(c.b, c.bh, "").replace(/_{3,}/g, '<u class="blank"></u>')}</p>${c.bh && !done ? `<p class="muted hint">藍色的字可以點開看意思</p>` : ""}` : `<div class="qword"><h1>${esc(c.w)}</h1><button class="spk" data-act="say" data-t="${esc(c.w)}">🔊</button><small>${esc(c.p)}</small></div>`;
    // after answering, every option shows its meaning, a speaker and a link to its flashcard
    const row = (o, i) => { const x = q.oc[i], cls = o === q.ans ? "ok" : o === quiz.picked ? "no" : "";
      return `<div class="opt ${cls}"><i>${"ABCD"[i]}</i><div class="ot"><b>${esc(o)}</b>${x ? `<small>${q.mode === "cz" ? `${esc(x.p)} ${esc(x.z)}` : q.mode === "ed" ? `${esc(x.w)} <em>${esc(x.p)}</em> ${esc(x.z)}` : `${esc(x.w)} <em>${esc(x.p)}</em>`}</small>` : ""}</div>
        ${x ? `<button class="spk" data-act="say" data-t="${esc(x.w)}">🔊</button><button class="chip" data-act="pop" data-w="${esc(x.k)}">字卡</button>` : ""}</div>`; };
    body = stem + `<div class="opts ${q.mode === "ed" ? "en" : ""}">${done ? q.opts.map(row).join("") : q.opts.map((o, i) => `<button data-act="pick" data-i="${i}"><i>${"ABCD"[i]}</i>${esc(o)}</button>`).join("")}</div>`;
  }
  const ok = done && quiz.lastOk;
  app.innerHTML = head(quiz.label, `${quiz.i + 1} / ${quiz.qs.length} · ${MODES[q.mode]}`, `<span class="score">✓ ${quiz.right}</span>`) +
    `<div class="prog"><b style="width:${(quiz.i + (done ? 1 : 0)) / quiz.qs.length * 100}%"></b></div><div class="page quiz">${body}
    ${done ? `<div class="fb ${ok ? "ok" : "no"}"><b>${ok ? "答對了！" : "答錯了"}</b><p><b>${esc(c.w)}</b> <small>${esc(c.p)}</small> ${esc(c.z)}</p><p class="def">${esc(c.d)}</p>
      <p class="muted">${esc(quiz.note || "")}</p></div><button class="btn primary" data-act="qnext">${quiz.i + 1 < quiz.qs.length ? "下一題" : "看結果"}</button>` : ""}</div>`;
  if (!done) { if (q.mode === "sp") { hush(); speak(c.w); const el = $("#spin"); el && el.focus(); } else if ((q.mode === "ez" || q.mode === "ed") && M.set.autoWord) { hush(); speak(c.w); } }
};
function answer(val, ok) {
  const q = quiz.qs[quiz.i], k = q.c.k, fresh = !W[k], s = W[k] || [1, 0, 0, 0, 0, today()];
  quiz.picked = val; quiz.lastOk = ok; quiz.note = ""; s[6] = (s[6] || Math.max(s[4], 0)) + 1;
  if (ok) {
    quiz.right++; M.correct++; day().r++;
    if (s[0] === 0) { s[2] = Math.min(s[2] + 1, REVIEW_GAPS.length - 1); s[3] = today() + REVIEW_GAPS[s[2]]; quiz.note = `複習通過，${REVIEW_GAPS[s[2]]} 天後再考一次。`; }
    else { s[1]++; if (s[1] >= 3) { s[0]--; s[1] = 0; if (s[0] === 0) { s[2] = 0; s[3] = today() + REVIEW_GAPS[0]; quiz.note = "連續答對 3 次，升級為「已經會了」🎉"; } else quiz.note = `連續答對 3 次，降為「${LV[s[0]]}」。`; } else quiz.note = `再連續答對 ${3 - s[1]} 次就降一級。`; }
    if (M.correct % 10 === 0) { M.tokens++; quiz.unlocked++; toast("🎮 答對 10 題，解鎖一局小遊戲！"); }
  } else {
    if (!quiz.wrong.includes(k)) quiz.wrong.push(k);
    s[4]++; s[1] = 0; s[0] = s[0] === 0 || fresh ? 1 : Math.min(3, s[0] + 1); quiz.note = `已記入錯題本，目前「${LV[s[0]]}」。`;
  }
  s[5] = today(); W[k] = s; saveW(); render();
}
function finishQuiz() {
  const secs = Math.round((Date.now() - quiz.t0) / 1000), u = setup.src.split(":");
  const rec = { ts: Date.now(), bank: quiz.label, unit: u[0] === "u" ? u[2] : "", mode: MODES[quiz.mode], total: quiz.qs.length, correct: quiz.right, wrong: quiz.wrong.slice(), secs };
  M.hist.unshift(rec); M.hist = M.hist.slice(0, 100); M.queue.push(rec); M.lastWrong = quiz.wrong.slice(); day().q++; saveM();
  go("result", {}, true); sync(true);
}
VIEWS.result = () => {
  const pct = Math.round(quiz.right / quiz.qs.length * 100);
  app.innerHTML = head("測驗結果", quiz.label) + `<div class="page center"><div class="ring big" style="--p:${pct}"><b>${pct}%</b><small>${quiz.right} / ${quiz.qs.length}</small></div>
    ${M.tokens ? `<button class="btn game" data-act="game">🎮 玩小遊戲（${M.tokens} 局）</button>` : ""}
    ${quiz.wrong.length ? `<button class="btn primary" data-act="redo">只重做錯題（${quiz.wrong.length}）</button><button class="btn" data-act="deck" data-src="lw">看錯題字卡</button><button class="btn" data-act="mail" data-src="lw">📧 寄錯題到我的 Email</button>` : `<p class="big">💯</p><p>全對！</p>`}
    <button class="btn" data-act="qagain">再考一次</button><button class="btn" data-act="home">回首頁</button>
    ${quiz.wrong.length ? `<h3>這次的錯題</h3><div class="wlist">${quiz.wrong.map(wrow).join("")}</div>` : ""}</div>`;
};
const tries = k => (W[k] ? Math.max(W[k][6] || 0, W[k][4]) : 0), missRate = k => (tries(k) ? W[k][4] / tries(k) : 0);
// One row of a word table: the meaning stays hidden until the student taps, so they can think first.
const trow = (k, stats, prefer) => { const c = lookup(k, prefer); if (!c) return ""; const l = lv(k), x = W[k] ? W[k][4] : 0, n = tries(k);
  return `<div class="trow ${l >= 0 ? "t" + l : ""}"><button class="th" data-act="rev"><b>${esc(c.w)}</b><small>${esc(c.p)}</small>
    ${stats && x ? `<em>✗${x}/${n} · ${Math.round(x / n * 100)}%</em>` : ""}${l >= 0 ? `<i class="t${l}">${l ? LVHINT[l] : "已會"}</i>` : ""}<span class="tv">看意思</span></button>
    <div class="tb"><p class="tdef">${esc(c.d)}</p><p class="tzh">${esc(c.z)}</p><div class="ta"><button class="spk" data-act="say" data-t="${esc(c.w)}">🔊</button><button class="chip" data-act="openWord" data-w="${esc(k)}">開字卡</button></div></div></div>`; };
const wrow = k => trow(k, true);
const revBar = n => `<div class="revbar"><span>${n} 個字 · 先想意思，再點一下對答案</span><button class="chip" data-act="revAll">全部顯示</button></div>`;
const modePick = () => `<label>考試方式</label><div class="modes">${Object.entries(MODES).map(([k, t]) => `<button class="${setup.mode === k ? "on" : ""}" data-act="qmode" data-m="${k}">${t}</button>`).join("")}</div>`;

/* ---------- word lists (mistake book) ---------- */
let listTab = "lw", wrongSort = "count";
VIEWS.words = () => {
  const tabs = [["lw", "上次錯題"], ["wrong", "全部錯題"], ["l3", "不會 3"], ["l2", "不會 2"], ["l1", "不會 1"], ["due", "到期複習"], ["star", "★ 星號"], ["known", "已會"]];
  const [cards] = cardsFor(listTab);
  app.innerHTML = `<div class="page"><h2>錯題本與單字清單</h2><button class="btn hpbtn" data-act="pickhist">📋 跨次錯題本：勾選多次測驗，錯題合併考</button><div class="tabs">${tabs.map(([k, t]) => `<button class="${listTab === k ? "on" : ""}" data-act="ltab" data-t="${k}">${t}</button>`).join("")}</div>
    ${listTab === "wrong" && cards.length ? `<div class="seg sortseg"><button class="${wrongSort === "count" ? "on" : ""}" data-act="wsort" data-s="count">依錯誤次數排序</button><button class="${wrongSort === "rate" ? "on" : ""}" data-act="wsort" data-s="rate">依錯誤比例排序</button></div><p class="muted">✗錯誤次數 / 考過次數 · 錯誤比例。最常錯的排最上面。</p>` : ""}
    ${cards.length ? `<div class="two"><button class="btn" data-act="deck" data-src="${listTab}">看字卡（${cards.length}）</button><button class="btn primary" data-act="quizFrom" data-src="${listTab}">測驗</button></div>
      <div class="two"><button class="btn" data-act="mail" data-src="${listTab}">📧 寄到我的 Email</button><button class="btn" data-act="csv" data-src="${listTab}">⬇️ 下載檔案</button></div>
      ${revBar(Math.min(cards.length, 300))}<div class="wlist">${cards.slice(0, 300).map(c => wrow(c.k)).join("")}</div>${cards.length > 300 ? `<p class="muted">只顯示前 300 個</p>` : ""}` : `<div class="tip">這裡目前沒有單字。</div>`}</div>`;
};

/* ---------- word table (總表): look over every word first, then quiz ---------- */
let rnum = 0;
VIEWS.rlist = () => {
  const src = arg.src, [cards, label] = cardsFor(src), isUnit = /^u:/.test(src), mix = src === "lmix";
  const list = isUnit ? uniq(cards) : uniq(cards).sort((a, b) => lv(b.k) - lv(a.k) || (W[b.k] ? W[b.k][4] : 0) - (W[a.k] ? W[a.k][4] : 0));
  const pool = isUnit ? list.filter(c => lv(c.k) > 0) : list;
  const GN = { 3: "不會 3 · 完全不會", 2: "不會 2 · 不熟", 1: "不會 1 · 有點不熟", 0: "已經會了", "-1": "還沒分類" };
  const groups = isUnit ? [[null, list]] : [3, 2, 1, 0, -1].map(L => [L, list.filter(c => Math.max(lv(c.k), -1) === L)]).filter(g => g[1].length);
  const prefer = isUnit ? src.split(":")[1] : undefined;
  const qs = mix ? pool.reduce((t, c) => t + Math.max(1, Math.min(3, lv(c.k))), 0) : pool.length;
  app.innerHTML = head(label, isUnit ? "單元總表" : "由完全不會排到有點不熟") + `<div class="page">
    ${list.length ? revBar(list.length) + groups.map(([L, cs]) => `${L == null ? "" : `<div class="lgrp g${L}">${GN[L]}（${cs.length}）</div>`}<div class="wlist">${cs.map(c => trow(c.k, !isUnit, prefer)).join("")}</div>`).join("")
      + `<button class="btn" data-act="deck" data-src="${esc(src)}">看字卡（${list.length}）</button>` : `<div class="tip">這裡目前沒有單字。</div>`}
    ${pool.length ? `<h3>${isUnit ? `測驗這單元「不會」的字（${pool.length}）` : "看完了，開始測驗"}</h3>${modePick()}
      ${mix ? `<p class="muted">完全不會 3 的字考 3 次、不熟 2 考 2 次、有點不熟 1 考 1 次，會分散出現。全部共 ${qs} 題。</p>` : ""}
      <label>${mix ? "題數" : "考幾個字"}</label><div class="seg" id="rnum">${[20, 40, 0].map(n => `<button class="${rnum === n ? "on" : ""}" data-act="rnum" data-n="${n}">${n || `全部（${qs}）`}</button>`).join("")}</div>
      <button class="btn primary" data-act="rstart" data-src="${esc(src)}">開始測驗</button>`
      : isUnit && list.length ? `<p class="muted">這單元還沒有標「不會」的字，先看字卡把字分類。</p>` : ""}</div>`;
};

/* ---------- cross-quiz mistake book: tick several quiz records, quiz all their mistakes together ---------- */
VIEWS.pickhist = () => {
  const fmt = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const hs = M.hist.filter(h => h.wrong.length), n = uniqK(hs.filter(h => hpick.has(h.ts)).flatMap(h => h.wrong)).length;
  app.innerHTML = head("跨次錯題本", "勾選要合併的測驗") + `<div class="page">
    ${hs.length ? `<div class="two"><button class="btn" data-act="hpall">全選</button><button class="btn" data-act="hpnone">全部取消</button></div>
      <div class="hlist">${hs.map(h => `<button class="hpk ${hpick.has(h.ts) ? "on" : ""}" data-act="hpk" data-ts="${h.ts}"><span class="cb">${hpick.has(h.ts) ? "✓" : ""}</span>
        <div><b>${esc(h.bank)}</b><small>${fmt(h.ts)} · ${esc(h.mode)} · ${h.correct} / ${h.total}</small></div><em>錯 ${h.wrong.length}</em></button>`).join("")}</div>
      <div class="hpbar"><span>已選 ${hpick.size} 次測驗 · 共 <b>${n}</b> 個錯字（重複的只算一次）</span>
        <button class="btn primary" data-act="rlist" data-src="hp" ${n ? "" : "disabled"}>看總表再測驗</button></div>` : `<div class="tip">還沒有答錯過的測驗紀錄。</div>`}</div>`;
};

/* ---------- history ---------- */
VIEWS.history = () => {
  const t = tally(CARDS), d0 = today(), days = Array.from({ length: 14 }, (_, i) => d0 - 13 + i);
  const fmt = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  app.innerHTML = `<div class="page"><h2>學習紀錄</h2>
    <div class="stats"><div><b>${streak()}</b><small>連續天數</small></div><div><b>${t.known}</b><small>已會</small></div><div><b>${t.l1 + t.l2 + t.l3}</b><small>不會</small></div><div><b>${M.hist.length}</b><small>測驗次數</small></div></div>
    ${bar(t)}<p class="muted">全部 ${t.n} 字 · 未分類 ${t.new}</p>
    <h3>最近 14 天</h3><div class="cal">${days.map(d => { const x = M.days[d], dt = new Date(d * 864e5); return `<div class="${x && (x.c || x.q) ? "on" : ""}"><small>${dt.getUTCDate()}</small><b>${x ? x.c : ""}</b></div>`; }).join("")}</div>
    <h3>測驗紀錄</h3>${M.hist.some(h => h.wrong.length) ? `<button class="btn hpbtn" data-act="pickhist">📋 勾選多次測驗，錯題合併考</button>` : ""}${M.hist.length ? M.hist.map((h, i) => `<button class="hrow" data-act="hist" data-i="${i}"><div><b>${esc(h.bank)}</b><small>${fmt(h.ts)} · ${esc(h.mode)}</small></div>
      <span class="${h.correct === h.total ? "full" : ""}">${h.correct} / ${h.total}</span></button>`).join("") : `<div class="tip">還沒有測驗紀錄。</div>`}</div>`;
};

/* ---------- search ---------- */
VIEWS.search = () => {
  app.innerHTML = head("搜尋單字", "跨三個字庫") + `<div class="page"><input id="q" type="search" placeholder="輸入英文或中文" autocomplete="off" autocapitalize="none"><div class="wlist" id="hits"></div></div>`;
  const q = $("#q"); q.focus();
  q.oninput = () => { const v = q.value.trim().toLowerCase(); $("#hits").innerHTML = v.length < 2 ? "" : uniq(CARDS.filter(c => c.k.startsWith(v)).concat(CARDS.filter(c => c.k.includes(v) || c.z.includes(v)))).slice(0, 40).map(c => wrow(c.k)).join("") || `<p class="muted">找不到</p>`; };
};

/* ---------- settings ---------- */
VIEWS.settings = () => {
  const s = M.set, tog = (k, t) => `<div class="srow"><span>${t}</span><button class="tog ${s[k] ? "on" : ""}" data-act="tog" data-k="${k}"><i></i></button></div>`;
  app.innerHTML = `<div class="page"><h2>設定</h2>
    <div class="box"><div class="srow"><span>${esc(auth.name)}<small>${esc(auth.cls)} · 代碼 ${esc(auth.code)}</small></span></div>
      <div class="srow"><span>同步<small>${M.lastSync ? "上次 " + new Date(M.lastSync).toLocaleString("zh-TW") : "尚未同步"}${M.queue.length ? ` · ${M.queue.length} 筆待上傳` : ""}</small></span><button class="chip solid" data-act="syncNow">立即同步</button></div></div>
    <div class="box"><button class="srow link" data-act="mailEdit"><span>我的 Email<small>${esc(s.email || "尚未設定（寄錯題用）")}</small></span><i>›</i></button></div>
    <div class="box">${tog("autoWord", "自動念單字")}${tog("autoSent", "自動念例句")}
      <div class="srow"><span>語速</span><div class="seg sm">${[[0.7, "慢"], [0.9, "中"], [1.05, "快"]].map(([v, t]) => `<button class="${s.rate === v ? "on" : ""}" data-act="set" data-k="rate" data-v="${v}">${t}</button>`).join("")}</div></div></div>
    <div class="box"><div class="srow"><span>深色模式</span><button class="tog ${s.theme === "dark" ? "on" : ""}" data-act="theme"><i></i></button></div>
      <div class="srow"><span>字體大小</span><div class="seg sm">${[[0.9, "小"], [1, "中"], [1.15, "大"]].map(([v, t]) => `<button class="${s.font === v ? "on" : ""}" data-act="set" data-k="font" data-v="${v}">${t}</button>`).join("")}</div></div>
      <div class="srow"><span>每日目標（字卡）</span><div class="seg sm">${[10, 20, 40].map(v => `<button class="${s.goal === v ? "on" : ""}" data-act="set" data-k="goal" data-v="${v}">${v}</button>`).join("")}</div></div></div>
    <div class="box"><button class="srow link" data-act="install"><span>📲 把 app 加到手機主畫面</span><i>›</i></button>
      <button class="srow link danger" data-act="logout"><span>登出</span><i>›</i></button></div>
    <p class="fine">版本 ${esc(CFG.version)} · 僅供 Jennifer 老師的學生使用</p></div>`;
};
VIEWS.install = () => {
  app.innerHTML = head("加到主畫面", "像一般 app 一樣開啟") + `<div class="page"><div class="box pad"><h3>iPhone / iPad</h3><ol><li>用 <b>Safari</b> 開啟這個網頁</li><li>點下方的「分享」按鈕 <b>⬆️</b></li><li>往下找到「<b>加入主畫面</b>」</li><li>點右上角「加入」</li></ol></div>
    <div class="box pad"><h3>Android</h3><ol><li>用 <b>Chrome</b> 開啟這個網頁</li><li>點右上角 <b>⋮</b></li><li>點「<b>安裝應用程式</b>」或「加到主畫面」</li><li>點「安裝」</li></ol></div>
    <p class="muted">加入後，從主畫面的 SAT Vocab 圖示開啟。看過的字庫沒有網路也能用，連上網路後會自動同步紀錄。</p></div>`;
};

/* ---------- send a word list to the student's own email, or save it as a file ---------- */
function askEmail(src) {
  sheet(`<div class="popw"><h2>我的 Email</h2><p class="muted">錯題會用你手機的郵件 app 寄到這個信箱。只存在這支手機。</p>
    <input id="em" type="email" inputmode="email" autocapitalize="none" placeholder="name@example.com" value="${esc(M.set.email || "")}" data-src="${esc(src)}">
    <button class="btn primary" data-act="mailSave">${src ? "儲存並寄出" : "儲存"}</button><button class="btn" data-act="closeSheet">取消</button></div>`);
}
function mailList(src) {
  const [cards, label] = cardsFor(src); if (!cards.length) return toast("沒有單字");
  if (!M.set.email) return askEmail(src);
  const d = new Date(), date = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`, subject = `SAT Vocab ${label}（${cards.length} 字）${date}`;
  const withSent = cards.length <= 25, url0 = `mailto:${encodeURIComponent(M.set.email)}?subject=${encodeURIComponent(subject)}&body=`;
  let body = `${auth.name} 的 ${label} · ${date}\n\n`, n = 0;
  for (const c of cards) {
    const x = W[c.k] ? W[c.k][4] : 0, line = `${n + 1}. ${c.w} (${c.p}) ${c.z}${x ? ` ✗${x}` : ""}\n   ${c.d}\n` + (withSent ? `   e.g. ${c.a}\n` : "") + "\n";
    if (encodeURIComponent(body + line).length > 7000) break;       // mail apps cut very long links
    body += line; n++;
  }
  if (n < cards.length) body += `… 還有 ${cards.length - n} 個字。完整清單請用 app 的「下載檔案」。\n`;
  const link = document.createElement("a"); link.href = url0 + encodeURIComponent(body); link.id = "mailgo"; document.body.appendChild(link); link.click(); link.remove();
}
async function exportCsv(src) {
  const [cards, label] = cardsFor(src); if (!cards.length) return toast("沒有單字");
  const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const rows = [["Word", "POS", "中文", "Definition", "Sentence", "中譯", "錯誤次數", "狀態", "難度", "字庫"]].concat(cards.map(c => [c.w, c.p, c.z, c.d, c.a, c.at, W[c.k] ? W[c.k][4] : 0, lv(c.k) < 0 ? "未分類" : LV[lv(c.k)], `${c.df} ${DF[c.df]}`, bank(c.bank).name]));
  const d = new Date(), name = `SAT_Vocab_${label.replace(/[^\w\u4e00-\u9fff]+/g, "_")}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.csv`;
  const file = new File(["\ufeff" + rows.map(r => r.map(q).join(",")).join("\r\n")], name, { type: "text/csv" });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast("已下載 " + name);
}

/* ---------- mini games (one token each; a token is earned every 10 correct answers) ---------- */
let game = null;
function gameWords(n) {
  const recent = (quiz ? quiz.qs.map(q => q.c) : []).concat(uniq(CARDS).filter(c => lv(c.k) > 0));
  const pool = uniq(recent.filter(c => !/\s/.test(c.w) && c.w.length <= 12 && c.z.length <= 14));
  return shuffle(pool.length >= n ? pool : uniq(pool.concat(shuffle(CARDS).slice(0, 60).filter(c => !/\s/.test(c.w))))).slice(0, n);
}
function startGame() {
  if (!M.tokens) return toast("每答對 10 題可以玩一局");
  M.tokens--; saveM();
  const type = shuffle(["match", "speed", "scramble"])[0];
  if (type === "match") { const ws = gameWords(6); game = { type, tiles: shuffle(ws.flatMap(c => [{ k: c.k, t: c.w, en: 1 }, { k: c.k, t: c.z }])), open: [], gone: {}, moves: 0, t0: Date.now() }; }
  if (type === "speed") { game = { type, ws: gameWords(30), score: 0, n: 0, left: 30 }; nextSpeed(); game.timer = setInterval(() => { if (view !== "game") return clearInterval(game.timer); if (--game.left <= 0) { clearInterval(game.timer); game.over = true; } render(); }, 1000); }
  if (type === "scramble") { game = { type, ws: gameWords(5), i: 0, score: 0 }; nextScramble(); }
  go("game");
}
function nextSpeed() { const g = game, c = g.ws[g.n % g.ws.length], truth = Math.random() < 0.5; g.cur = c; g.truth = truth; g.shown = truth ? c.z : (shuffle(g.ws.filter(x => x.k !== c.k))[0] || c).z; if (g.shown === c.z) g.truth = true; g.n++; }
function nextScramble() { const g = game, c = g.ws[g.i]; g.cur = c; g.letters = shuffle(c.w.split("").map((ch, i) => ({ ch, i }))); g.built = []; }
VIEWS.game = () => {
  const g = game; let body = "";
  if (g.over) {
    body = `<div class="center"><div class="big">🏆</div><h2>${g.type === "match" ? `${g.moves} 步完成 · ${Math.round((g.t1 - g.t0) / 1000)} 秒` : g.type === "speed" ? `得分 ${g.score}` : `答對 ${g.score} / ${g.ws.length}`}</h2>
      ${M.tokens ? `<button class="btn game" data-act="game">再玩一局（${M.tokens}）</button>` : `<p class="muted">每答對 10 題可以再玩一局</p>`}<button class="btn primary" data-act="home">回首頁</button></div>`;
  } else if (g.type === "match") {
    body = `<p class="muted center">配對英文和中文</p><div class="match">${g.tiles.map((t, i) => `<button class="${g.gone[t.k] ? "gone" : g.open.includes(i) ? "open" : ""} ${t.en ? "en" : ""}" data-act="gmatch" data-i="${i}">${esc(t.t)}</button>`).join("")}</div>`;
  } else if (g.type === "speed") {
    body = `<div class="center"><div class="timer">${g.left}s</div><p class="muted">意思對不對？</p><h1>${esc(g.cur.w)}</h1><p class="zh big2">${esc(g.shown)}</p>
      <div class="two"><button class="btn no" data-act="gspeed" data-v="0">✗ 不對</button><button class="btn ok" data-act="gspeed" data-v="1">✓ 對</button></div><p>得分 ${g.score}</p></div>`;
  } else {
    body = `<div class="center"><p class="muted">${g.i + 1} / ${g.ws.length} · 把字母排回正確的字</p><p class="zh big2">${esc(g.cur.z)}</p><p class="def">${esc(g.cur.d)}</p>
      <div class="built">${g.built.map((l, i) => `<button data-act="gunpick" data-i="${i}">${esc(l.ch)}</button>`).join("") || "&nbsp;"}</div>
      <div class="letters">${g.letters.map((l, i) => `<button data-act="gpick" data-i="${i}" ${g.built.includes(l) ? "disabled" : ""}>${esc(l.ch)}</button>`).join("")}</div>
      <button class="btn" data-act="gskip">跳過</button></div>`;
  }
  app.innerHTML = head("小遊戲", { match: "配對翻牌", speed: "30 秒快閃", scramble: "拼字重組" }[g.type]) + `<div class="page game">${body}</div>`;
};

/* ---------- actions ---------- */
const ACT = {
  back, closeSheet, login: doLogin, reload: () => location.reload(), home: () => go("home"),
  bank: d => go("bank", { b: d.b }),
  level: d => go("level", { l: +d.l }),
  dset: d => { const [cards, label] = cardsFor(`d:${d.l}:${d.s}`); setup.src = `d:${d.l}:${d.s}`; openDeck(label, cards); },
  mail: d => mailList(d.src), csv: d => exportCsv(d.src),
  mailSave: () => { const v = $("#em").value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast("請輸入正確的 Email"); M.set.email = v; saveM(); const src = $("#em").dataset.src; closeSheet(); if (src) mailList(src); else render(); },
  mailEdit: () => askEmail(""),
  unit: d => { const B = bank(d.b), u = unitOf(d.b, +d.u), L = d.b === "h" ? +d.lv || 0 : 0; openDeck(`${B.ul} ${u.n}${u.t ? " · " + u.t : ""}${L ? " · " + HV[L] : ""}`, hcards(u, L), +d.i || 0, { hv: L }); },
  hlv: d => { hlv = +d.l; LS.set("hlv", hlv); render(); },
  deck: d => { const [cards, label] = cardsFor(d.src); openDeck(label, cards); },
  quizFrom: d => go("quizsetup", { src: d.src }),
  search: () => go("search"), install: () => go("install"),
  say: d => { hush(); speak(d.t); }, saySent: () => { hush(); speak(deck.cards[deck.i].a); },
  star: () => { const k = deck.cards[deck.i].k; if (M.star[k]) delete M.star[k]; else M.star[k] = 1; M.dirty = true; saveM(); render(); },
  rate: d => rate(+d.l), prev: () => move(-1), next: () => move(1),
  again: () => { deck.done = false; deck.i = 0; render(); },
  rlist: d => { closeSheet(); go("rlist", { src: d.src }); },
  pickhist: () => go("pickhist"),
  hpk: d => { const t = +d.ts; if (hpick.has(t)) hpick.delete(t); else hpick.add(t); render(); },
  hpall: () => { M.hist.filter(h => h.wrong.length).forEach(h => hpick.add(h.ts)); render(); },
  hpnone: () => { hpick.clear(); render(); },
  rev: (d, el) => { const r = el.closest(".trow"); if (r.classList.toggle("open")) { const b = r.querySelector("[data-act=say]"); if (b) { hush(); speak(b.dataset.t); } } },   // opening a row also says the word
  revAll: (d, el) => { const rows = [...app.querySelectorAll(".trow")], open = !rows.every(r => r.classList.contains("open")); rows.forEach(r => r.classList.toggle("open", open)); app.querySelectorAll("[data-act=revAll]").forEach(b => b.textContent = open ? "全部隱藏" : "全部顯示"); },
  rnum: d => { rnum = +d.n; app.querySelectorAll("#rnum button").forEach(b => b.classList.toggle("on", +b.dataset.n === rnum)); },
  rstart: d => { const [cards, label] = cardsFor(d.src), isUnit = /^u:/.test(d.src); setup.src = d.src;
    startQuiz(isUnit ? uniq(cards).filter(c => lv(c.k) > 0) : uniq(cards), setup.mode, rnum, label, false, d.src === "lmix"); },
  setlv: d => { setLevel(d.w, +d.l); closeSheet(); const c = lookup(d.w); toast(`${c ? c.w : d.w} → ${+d.l ? `不會 ${d.l} · ${LVHINT[+d.l]}` : "已經會了"}`); if (/^(rlist|words|home)$/.test(view)) render(); },
  quizDeck: () => { const cards = uniq(deck.cards).filter(c => lv(c.k) > 0); if (!cards.length) return toast("這一輪沒有「不會」的字"); setup.src = deck.unitRef ? `u:${deck.cards[0].bank}:${deck.cards[0].unit}${deck.unitRef.hv ? ":" + deck.unitRef.hv : ""}` : setup.src; startQuiz(cards, setup.mode, 0, deck.unitRef ? `${bank(deck.cards[0].bank).name} · ${deck.title}` : deck.title); },
  pop: d => popWord(d.w, d.say),
  openWord: d => { const c = lookup(d.w); if (!c) return; closeSheet(); openDeck(c.w, [c]); },
  qlv: d => { setup.lv[d.l] = !setup.lv[d.l]; if (!setup.lv[1] && !setup.lv[2] && !setup.lv[3]) setup.lv[d.l] = true; render(); },
  qmode: d => { setup.mode = d.m; if (view === "quizsetup") render(); else app.querySelectorAll(".modes button").forEach(b => b.classList.toggle("on", b.dataset.m === d.m)); }, qn: d => { setup.n = +d.n; render(); },
  qstart: () => { const pool = quizPool(); if (pool.length) startQuiz(pool, setup.mode, setup.n, cardsFor(setup.src)[1], false, setup.src === "lmix"); },
  pick: d => { const q = quiz.qs[quiz.i]; if (quiz.picked == null) answer(q.opts[+d.i], q.opts[+d.i] === q.ans); },
  spell: () => { const v = $("#spin").value.trim(); if (!v) return; answer(v, v.toLowerCase() === quiz.qs[quiz.i].c.k); },
  qnext: () => { quiz.picked = null; if (++quiz.i >= quiz.qs.length) { quiz.i--; finishQuiz(); } else render(); },
  redo: () => startQuiz(quiz.wrong.map(k => lookup(k)).filter(Boolean), quiz.mode, 0, "重做錯題", true),
  qagain: () => startQuiz(quiz.cards, quiz.mode, quiz.rep ? quiz.n : quiz.qs.length, quiz.label, false, quiz.rep),
  ltab: d => { listTab = d.t; render(); }, wsort: d => { wrongSort = d.s; render(); },
  hist: d => { const h = M.hist[+d.i]; sheet(`<div class="popw"><h2>${esc(h.bank)}</h2><small>${new Date(h.ts).toLocaleString("zh-TW")} · ${esc(h.mode)} · ${h.correct} / ${h.total}</small>
    ${h.wrong.length ? `<h3>錯題</h3><div class="wlist">${h.wrong.map(wrow).join("")}</div>` : `<p>全對 💯</p>`}<button class="btn" data-act="closeSheet">關閉</button></div>`); },
  tog: d => { M.set[d.k] = !M.set[d.k]; saveM(); render(); },
  set: d => { M.set[d.k] = +d.v; saveM(); render(); },
  theme: () => { M.set.theme = M.set.theme === "dark" ? "light" : "dark"; saveM(); render(); },
  syncNow: async () => { toast("同步中…"); const r = await sync(true); toast({ ok: "已同步", offline: "沒有網路，稍後會自動同步", fail: "同步失敗", idle: "已同步", locked: "" }[r] || ""); if (view === "settings") render(); },
  logout: () => sheet(`<div class="popw"><h2>確定登出？</h2><p>會先把紀錄同步給老師。重新登入後紀錄會還原。</p><button class="btn primary" data-act="logout2">登出</button><button class="btn" data-act="closeSheet">取消</button></div>`),
  logout2: async () => { const r = await sync(true); if (r !== "ok" && r !== "idle") { closeSheet(); return toast("需要網路才能登出（避免紀錄遺失）"); } ["auth", "words", "meta"].forEach(LS.del); location.reload(); },
  game: () => startGame(),
  gmatch: d => { const g = game, i = +d.i, t = g.tiles[i]; if (g.gone[t.k] || g.open.includes(i) || g.open.length === 2) return; g.open.push(i); if (t.en) { hush(); speak(t.t); }
    if (g.open.length === 2) { g.moves++; const [a, b] = g.open.map(x => g.tiles[x]); if (a.k === b.k && a.en !== b.en) { g.gone[a.k] = 1; g.open = []; if (Object.keys(g.gone).length === g.tiles.length / 2) { g.over = true; g.t1 = Date.now(); } } else setTimeout(() => { g.open = []; if (view === "game") render(); }, 700); }
    render(); },
  gspeed: d => { const g = game; if ((+d.v === 1) === g.truth) g.score++; else g.score = Math.max(0, g.score - 1); nextSpeed(); render(); },
  gpick: d => { const g = game; g.built.push(g.letters[+d.i]); if (g.built.length === g.letters.length) { const ok = g.built.map(l => l.ch).join("") === g.cur.w; if (ok) { g.score++; hush(); speak(g.cur.w); } toast(ok ? "✓ " + g.cur.w : "✗ 答案是 " + g.cur.w); if (++g.i >= g.ws.length) g.over = true; else nextScramble(); } render(); },
  gunpick: d => { game.built.splice(+d.i, 1); render(); },
  gskip: () => { const g = game; toast("答案是 " + g.cur.w); if (++g.i >= g.ws.length) g.over = true; else nextScramble(); render(); }
};
document.addEventListener("click", e => {
  const n = e.target.closest("[data-go]"); if (n) { stack = []; return go(n.dataset.go); }
  const a = e.target.closest("[data-act]"); if (a && ACT[a.dataset.act]) { e.preventDefault(); ACT[a.dataset.act](a.dataset, a); }
});
document.addEventListener("change", e => { if (e.target.id === "qsrc") { setup.src = e.target.value; render(); } });
document.addEventListener("keydown", e => { if (e.key !== "Enter") return; if (e.target.id === "code") doLogin(); if (e.target.id === "spin") ACT.spell(); });

/* ---------- boot ---------- */
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
if (auth && auth.key) {
  // A saved record fetched at sign-in elsewhere in this browser: take it over.
  if (!Object.keys(W).length) { const pending = LS.get("pending", ""); if (pending) unpackState(pending); }
  LS.del("pending");
  // Offline use is allowed for 14 days after the last successful check with the server.
  if (Date.now() - (auth.lastOk || 0) > 14 * 864e5 && !navigator.onLine) { app.innerHTML = `<div class="boot">需要連線驗證<br><small>請連上網路後重新開啟</small><br><button class="btn" data-act="reload">重試</button></div>`; }
  else start();
} else go("login");
})();
