# Test report — Gmail Archive Pages site

Date: 2026-10-20 (UTC) · Ran locally + in CI (`.github/workflows/pages.yml` runs `node --test tests/` on every push).

## Automated unit tests (`node --test tests/`)

File: `tests/utils.test.mjs` — 12 tests, 8 suites. Result: **12 pass, 0 fail**.

- `sanitizeFilename`: strips `<>:"/\|?*`, handles empty → `unnamed`, truncates long names preserving `.pdf`.
- `buildGmailQuery`: single sender + inclusive dates → `from:a@x.com after:2024/01/05 before:2024/02/11` (end+1 for inclusive `before:`); multi-sender OR; empty → `""`.
- `isDateInRange`: start/end inclusive (00:00 UTC → next-day 00:00 UTC exclusive bound).
- `csvEscape`/`buildCsv`: commas/quotes/newlines escaped per RFC 4180.
- `base64UrlToUint8`/`uint8ToStringUtf8`: `aGVsbG8` → `hello`.
- `stripHtml`: `<br>`→newline, strips `<script>/<style>`, decodes entities.
- `getNextAvailableName`: `a.pdf` → `a_2.pdf` → `a_3.pdf`.
- `senderKey`: `Bob <bob@x.com>` → `bob@x.com`.

## Static checks

- `node --check` on all JS: `config.js`, `js/utils.js`, `js/gmail.js`, `js/pdf.js`, `js/export.js`, `js/app.js` — all **OK**.
- `index.html` parses with Python `html.parser` — **OK**.
- All local `<script src>` / CSS targets exist; CDN scripts (GIS, JSZip 3.10.1, jsPDF 2.5.1 UMD) use pinned HTTPS URLs.
- `python3 -m http.server` serves `index.html` (200), `js/app.js` (200), `styles.css` (200).

## Manual flow (requires your own Google Client ID — cannot be automated in CI)

1. `python3 -m http.server 8000` → open `http://localhost:8000` (Direct `file://` will fail by design: GIS + WebCrypto need http).
2. Step 1: paste Client ID → Sign in with Google → account shown, status green.
3. Step 2: enter `you@example.com`, dates, Max 100 → Search & preview → table fills, counts shown.
4. Step 4: defaults → Build → 3 stages log to `export-log`, progress bars move, Cancel works.
5. Step 5: Download ZIP → unzip → `master-archive.pdf` opens, `.eml` opens in Thunderbird, `manifest.csv` row count == preview count, `sha256sum -c checksums.sha256` passes.
6. Disconnect network mid-export → errors shown, status **INCOMPLETE** (never claims success); re-run is safe.

## Known limits (documented in-app)

- Gmail API list cap: Max messages setting (default 1000, hard cap 5000 per run). Larger mailboxes → run per-year ranges.
- `master-archive.pdf` truncates any single message body at 60,000 chars (full text remains in `.eml`).
- Image previews only for images < ~900 KB; video/audio never embedded (listed + saved separately or skipped per your choice).
- WebCrypto SHA-256 needs a secure context (`https://` or `http://localhost`) — GitHub Pages qualifies.
