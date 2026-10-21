# Gmail Archive — GitHub Pages site

A 100% static website (no server, no build step) that lets anyone — even with zero technical knowledge — sign in with Google (read-only) and archive Gmail conversations:

- Pick sender(s) + inclusive date range → preview counts
- Whole conversation threads included (replies from everyone), oldest → newest
- One click builds a **ZIP** containing:
  - `master-archive.pdf` — one big readable document (video/audio shown as placeholders, never embedded)
  - `emails/<sender>/<thread>/*.eml` — original MIME per message
  - `attachments/<sender>/*` — original files, deduped safely (video/audio separately or skipped, your choice)
  - `manifest.csv`, `checksums.sha256`, `export.log`, `errors.json`, `README.txt`
- Progress bars, cancellation, retry-safe, integrity verification, history, help

Live on GitHub Pages. All processing happens locally in the browser; nothing is uploaded anywhere.

## Quick start (try it locally)

```bash
cd gmail-archive-pages
python3 -m http.server 8000
# open http://localhost:8000
```

> Must use `http://localhost:8000` (not `file://`) so Google sign-in + WebCrypto work.

## Deploy to GitHub Pages

### Option A — click-through (easiest)

1. Create a **private** repo on GitHub (e.g. `gmail-archive`), upload these files to the `main` branch.
2. Repo → **Settings → Pages** → Source: **GitHub Actions**.
3. Push — the included workflow (`.github/workflows/pages.yml`) runs tests then deploys.
4. Your site: `https://YOUR-USERNAME.github.io/gmail-archive/`

### Option B — command line

```bash
cd gmail-archive-pages
git init -b main
git add .
git commit -m "Gmail Archive Pages site"
gh repo create gmail-archive --private --source=. --push   # or: git remote add origin <url>; git push -u origin main
# then enable Pages → GitHub Actions in repo Settings
```

See `OAUTH_SETUP.md` (required: create a free Google OAuth Client ID) and `USER_GUIDE.md` (for end users).

## Files

| File | Purpose |
|---|---|
| `index.html` | 5-step wizard UI |
| `styles.css` | Polished responsive styling |
| `config.js` | Public config (Client ID placeholder) |
| `js/utils.js` | Pure helpers (unit-tested) |
| `js/gmail.js` | Gmail API + OAuth layer |
| `js/pdf.js` | Master PDF builder (jsPDF) |
| `js/export.js` | ZIP + CSV + logs + SHA-256 |
| `js/app.js` | Wizard wiring, progress, history |
| `tests/` | `node --test` unit tests |
| `.github/workflows/pages.yml` | Test + deploy to Pages |

## Tests

```bash
node --test tests/
```

## Privacy & honesty notes (also shown in-app)

- Read-only Gmail scope only. No password handled. Sign-out revokes the token.
- PDFs are convenient reading copies; `.eml` files are the originals.
- `checksums.sha256` detects accidental changes — it does not by itself prove authenticity or completeness. Compare `manifest.csv` counts with the preview.
- If any file fails, the app reports **INCOMPLETE** and never claims success.
