# SAT Vocab app

Phone app (PWA) for Jennifer's tutoring students: Must-Know 306/386, Hot Words for the SAT, Barron's 1100.
Live: https://jenniferenglishteacher.github.io/sat-vocab-test-app/ · Teacher overview: `teacher.html`

- Students sign in with a private code. Codes live in the Google Sheet "SAT Vocab App" (Students tab).
- Word banks in `data/*.bin` are encrypted; the key is handed out by the backend only after a valid code.
- `backend/Code.gs` — Google Apps Script backend (key and teacher password are NOT stored in this repo).
- `js/config.js` — backend URL.
- Rebuild data: `APP_KEY=<key> DIFF_FILE=<difficulty.json> node tools/build.js <source data folder> <version>`, then bump `version` in `js/config.js`.
- Local test: `APP_KEY=<key> node tools/mock-server.js` → http://localhost:8765 (codes TEST01 / TEST02, teacher password `teach`).

## 易混淆字 Confusables bank (c) — added 2026-11-25
`APP_KEY=… ZIPF_FILE=<word→Zipf json> node tools/build-cf.js <flashcard site repo> <bank version>` writes `data/c.bin` and adds bank `c` (with its own `v`) to `data/meta.json`; banks b/h/m are not rebuilt.
Source: the site's `cf-unitN-data.js` (site repo `tools/confusables/build.py`). One card per word; 熟字僻義 cards carry the everyday sense in `cm`.
Quiz: 看例句選單字 offers only the group's look-alikes (`go`/`goh`, in the sentence's form); 看英文選英文解釋 / 看英文選中文 put the group's words (`gm`) and, for 熟字僻義, the everyday meaning first. Bank c stays out of the 依建議難度 zones.
