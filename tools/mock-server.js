// Local test server: serves the app and imitates backend/Code.gs (same request/response shapes).
// Usage: APP_KEY=<key> node tools/mock-server.js [port]
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = process.env.ROOT || path.join(__dirname, ".."), PORT = Number(process.argv[2]) || 8765;
const students = {
  TEST01: { name: "王小明", cls: "SAT-A", active: true, max: 2, devices: [], lastSeen: 0 },
  TEST02: { name: "林小華", cls: "SAT-A", active: true, max: 1, devices: [], lastSeen: 0 },
  GONE01: { name: "停用生", cls: "SAT-B", active: false, max: 2, devices: [], lastSeen: 0 }
};
const progress = {}, quizlog = [];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".bin": "application/octet-stream", ".webp": "image/webp" };

function student(req, register) {
  const code = String(req.code || "").trim().toUpperCase(), s = students[code];
  if (!s || !req.device) return { error: "invalid" };
  if (!s.active) return { error: "inactive" };
  if (!s.devices.includes(req.device)) { if (!register) return { error: "device" }; if (s.devices.length >= s.max) return { error: "devices" }; s.devices.push(req.device); }
  s.lastSeen = Date.now();
  return { code, ...s };
}
function api(req) {
  if (req.action === "login") { const s = student(req, true); return s.error ? { ok: false, error: s.error } : { ok: true, name: s.name, cls: s.cls, key: process.env.APP_KEY, state: (progress[s.code] || {}).state || "", now: Date.now() }; }
  if (req.action === "sync") {
    const s = student(req, false); if (s.error) return { ok: false, error: s.error };
    (req.quizzes || []).forEach(z => quizlog.push({ ...z, code: s.code, name: s.name, cls: s.cls, wrong: (z.wrong || []).join(", ") }));
    if (typeof req.state === "string") progress[s.code] = { state: req.state, updated: Date.now(), ...(req.summary || {}), quizCount: ((progress[s.code] || {}).quizCount || 0) + (req.quizzes || []).length };
    return { ok: true, now: Date.now() };
  }
  if (req.action === "teacher") {
    if (req.pass !== "teach") return { ok: false, error: "pass" };
    return { ok: true, now: Date.now(), students: Object.entries(students).map(([code, s]) => ({ code, name: s.name, cls: s.cls, active: s.active, devices: s.devices.length, lastSeen: s.lastSeen, p: progress[code] || null })), quizzes: [...quizlog].reverse() };
  }
  return { ok: false, error: "bad_action" };
}
http.createServer((rq, rs) => {
  if (rq.url.startsWith("/api")) {
    let body = ""; rq.on("data", d => body += d); rq.on("end", () => {
      let out; try { out = api(JSON.parse(body || "{}")); } catch (e) { out = { ok: false, error: "bad_request" }; }
      rs.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); rs.end(JSON.stringify(out));
    }); return;
  }
  if (rq.url.startsWith("/__state")) { rs.writeHead(200, { "Content-Type": "application/json" }); rs.end(JSON.stringify({ students, progress, quizlog })); return; }
  let file = decodeURIComponent(rq.url.split("?")[0]); if (file.endsWith("/")) file += "index.html";
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT) || !fs.existsSync(full)) { rs.writeHead(404); rs.end("not found"); return; }
  if (file === "/js/config.js" && !process.env.ROOT) { rs.writeHead(200, { "Content-Type": "text/javascript" }); rs.end(`window.APP_CONFIG={api:"/api",version:"test"};`); return; }
  rs.writeHead(200, { "Content-Type": TYPES[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-store" }); fs.createReadStream(full).pipe(rs);
}).listen(PORT, () => console.log("mock on " + PORT));
