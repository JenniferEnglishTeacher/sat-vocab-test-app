# SAT Vocab app

Phone app (PWA) for Jennifer's tutoring students: Must-Know 306/386, Hot Words for the SAT, Barron's 1100.
Live: https://jenniferenglishteacher.github.io/sat-vocab-test-app/ · Teacher overview: `teacher.html`

- Students sign in with a private code. Codes live in the Google Sheet "SAT Vocab App" (Students tab).
- Word banks in `data/*.bin` are encrypted; the key is handed out by the backend only after a valid code.
- `backend/Code.gs` — Google Apps Script backend (key and teacher password are NOT stored in this repo).
- `js/config.js` — backend URL.
- Rebuild data: `APP_KEY=<key> DIFF_FILE=<difficulty.json> node tools/build.js <source data folder> <version>`, then bump `version` in `js/config.js`.
- Local test: `APP_KEY=<key> node tools/mock-server.js` → http://localhost:8765 (codes TEST01 / TEST02, teacher password `teach`).
