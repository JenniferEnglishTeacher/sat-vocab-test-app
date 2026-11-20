/**
 * SAT Vocab App — backend (Google Apps Script, bound to the "SAT Vocab App" Google Sheet)
 * Handles: student code login, device limit, progress sync, quiz log, teacher overview.
 * Deploy: Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
 */
const APP_KEY = 'PASTE_APP_KEY_HERE';            // content key: the app cannot open the word banks without it
const TEACHER_PASS = 'PASTE_TEACHER_PASSWORD';   // password for teacher.html
const DEFAULT_MAX_DEVICES = 3;                   // phones/tablets allowed per student code
const CHUNK = 40000;                             // a sheet cell holds at most 50,000 characters

const S_HEAD = ['Code', 'Name', 'Class', 'Active', 'MaxDevices', 'Devices', 'LastSeen', 'Note'];
const P_HEAD = ['Code', 'Name', 'Updated', 'Known', 'Level1', 'Level2', 'Level3', 'Streak', 'CardsToday', 'QuizCount', 'State'];
const Q_HEAD = ['Time', 'Code', 'Name', 'Class', 'Bank', 'Unit', 'Mode', 'Correct', 'Total', 'Percent', 'Wrong words', 'Seconds'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('SAT App')
    .addItem('1. 初始化工作表 Set up sheets', 'setup')
    .addItem('2. 新增學生 Add students', 'addStudents')
    .addToUi();
}

function sheet_(name, head) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function setup() {
  sheet_('Students', S_HEAD); sheet_('Progress', P_HEAD); sheet_('QuizLog', Q_HEAD);
  SpreadsheetApp.getActive().toast('Students / Progress / QuizLog 已建立');
}

function newCode_(taken) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += abc.charAt(Math.floor(Math.random() * abc.length));
    if (!taken[c]) { taken[c] = 1; return c; }
  }
}

/** Menu: type names (one per line or separated by commas); each gets a private code. */
function addStudents() {
  const ui = SpreadsheetApp.getUi();
  const r1 = ui.prompt('新增學生', '輸入學生姓名，用逗號分隔（例：王小明, 林小華）', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const r2 = ui.prompt('班級 / 組別', '輸入班級名稱（可留空）', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  const names = r1.getResponseText().split(/[,，、\n]+/).map(function (s) { return s.trim(); }).filter(String);
  if (!names.length) return;
  const sh = sheet_('Students', S_HEAD);
  const taken = {};
  sh.getDataRange().getValues().slice(1).forEach(function (r) { taken[String(r[0]).toUpperCase()] = 1; });
  const rows = names.map(function (n) { return [newCode_(taken), n, r2.getResponseText().trim(), true, DEFAULT_MAX_DEVICES, '', '', '']; });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, S_HEAD.length).setValues(rows);
  ui.alert('已新增 ' + rows.length + ' 位學生。把 Code 欄的代碼各自交給學生。');
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return out_({ ok: true, app: 'sat-vocab-app' }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad_request' }); }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    if (req.action === 'login') return out_(login_(req));
    if (req.action === 'sync') return out_(sync_(req));
    if (req.action === 'teacher') return out_(teacher_(req));
    return out_({ ok: false, error: 'bad_action' });
  } catch (err) {
    return out_({ ok: false, error: 'server', detail: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (err2) {}
  }
}

/** Finds the student row and checks the code is active and this device is allowed. */
function student_(req, register) {
  const code = String(req.code || '').trim().toUpperCase();
  const device = String(req.device || '').slice(0, 40);
  if (!code || !device) return { error: 'invalid' };
  const sh = sheet_('Students', S_HEAD);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toUpperCase() !== code) continue;
    const active = rows[i][3] === true || String(rows[i][3]).toUpperCase() === 'TRUE';
    if (!active) return { error: 'inactive' };
    const max = Number(rows[i][4]) || DEFAULT_MAX_DEVICES;
    const devices = String(rows[i][5] || '').split(',').filter(String);
    if (devices.indexOf(device) < 0) {
      if (!register) return { error: 'device' };
      if (devices.length >= max) return { error: 'devices' };
      devices.push(device);
      sh.getRange(i + 1, 6).setValue(devices.join(','));
    }
    sh.getRange(i + 1, 7).setValue(new Date());
    return { row: i + 1, code: code, name: String(rows[i][1]), cls: String(rows[i][2]) };
  }
  return { error: 'invalid' };
}

function progressRow_(code) {
  const sh = sheet_('Progress', P_HEAD);
  const codes = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (let i = 1; i < codes.length; i++) if (String(codes[i][0]) === code) return { sh: sh, row: i + 1 };
  return { sh: sh, row: 0 };
}

function readState_(code) {
  const p = progressRow_(code);
  if (!p.row) return '';
  const width = p.sh.getLastColumn();
  if (width < P_HEAD.length) return '';
  return p.sh.getRange(p.row, P_HEAD.length, 1, width - P_HEAD.length + 1).getValues()[0].join('');
}

function login_(req) {
  const st = student_(req, true);
  if (st.error) return { ok: false, error: st.error };
  return { ok: true, name: st.name, cls: st.cls, key: APP_KEY, state: readState_(st.code), now: Date.now() };
}

function sync_(req) {
  const st = student_(req, false);
  if (st.error) return { ok: false, error: st.error };
  const quizzes = req.quizzes || [];
  if (quizzes.length) {
    const q = sheet_('QuizLog', Q_HEAD);
    const rows = quizzes.slice(0, 200).map(function (z) {
      const total = Number(z.total) || 0, correct = Number(z.correct) || 0;
      return [new Date(Number(z.ts) || Date.now()), st.code, st.name, st.cls, String(z.bank || ''), String(z.unit || ''), String(z.mode || ''),
        correct, total, total ? Math.round(correct / total * 100) : 0, (z.wrong || []).join(', '), Number(z.secs) || 0];
    });
    q.getRange(q.getLastRow() + 1, 1, rows.length, Q_HEAD.length).setValues(rows);
  }
  if (typeof req.state === 'string') {
    const p = progressRow_(st.code);
    const s = req.summary || {};
    const row = p.row || p.sh.getLastRow() + 1;
    const prevCount = p.row ? Number(p.sh.getRange(row, 10).getValue()) || 0 : 0;
    const chunks = [];
    for (let i = 0; i < req.state.length; i += CHUNK) chunks.push(req.state.substr(i, CHUNK));
    if (!chunks.length) chunks.push('');
    const line = [st.code, st.name, new Date(), s.known || 0, s.l1 || 0, s.l2 || 0, s.l3 || 0, s.streak || 0, s.cardsToday || 0,
      prevCount + quizzes.length].concat(chunks);
    const width = Math.max(p.sh.getLastColumn(), line.length);
    while (line.length < width) line.push('');
    p.sh.getRange(row, 1, 1, line.length).setValues([line]);
  }
  return { ok: true, now: Date.now() };
}

function teacher_(req) {
  if (String(req.pass || '') !== TEACHER_PASS) return { ok: false, error: 'pass' };
  const students = sheet_('Students', S_HEAD).getDataRange().getValues().slice(1).filter(function (r) { return r[0]; });
  const prog = {};
  sheet_('Progress', P_HEAD).getDataRange().getValues().slice(1).forEach(function (r) {
    prog[String(r[0])] = { updated: r[2] ? new Date(r[2]).getTime() : 0, known: r[3], l1: r[4], l2: r[5], l3: r[6], streak: r[7], cardsToday: r[8], quizCount: r[9] };
  });
  const q = sheet_('QuizLog', Q_HEAD);
  const last = q.getLastRow();
  const take = Math.min(Math.max(last - 1, 0), 1500);
  const log = take ? q.getRange(last - take + 1, 1, take, Q_HEAD.length).getValues() : [];
  return {
    ok: true, now: Date.now(),
    students: students.map(function (r) {
      const code = String(r[0]).trim().toUpperCase();
      return { code: code, name: String(r[1]), cls: String(r[2]), active: r[3] === true || String(r[3]).toUpperCase() === 'TRUE',
        devices: String(r[5] || '').split(',').filter(String).length, lastSeen: r[6] ? new Date(r[6]).getTime() : 0, p: prog[code] || null };
    }),
    quizzes: log.map(function (r) {
      return { ts: new Date(r[0]).getTime(), code: String(r[1]), name: String(r[2]), cls: String(r[3]), bank: String(r[4]), unit: String(r[5]),
        mode: String(r[6]), correct: r[7], total: r[8], wrong: String(r[10] || '') };
    }).reverse()
  };
}
