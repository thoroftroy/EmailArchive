# Gmail Archive

A small website that saves Gmail threads to your computer. You sign in with Google, pick senders and dates, and you get a ZIP with a PDF plus the original files.

What you get in the ZIP:
  * `master-archive.pdf` for reading
  * `emails/` with the original `.eml` files
  * `attachments/` with the original files
  * `manifest.csv` with a list of what was saved
  * `checksums.sha256` to check files later
  * `export.log`, `errors.json`, `README.txt` that say what happened

Everything runs in your browser. Nothing is sent to a server.

## Try it on your computer

Open a terminal in this folder and run:

```bash
python3 -m http.server 8000
```

Then open this in Chrome or Edge:

```
http://localhost:8000
```

Do not double click `index.html`. If you open it as a file, Google sign in will not work. You have to use the address above.

## Put it on GitHub Pages

GitHub Pages on a free account only works if the repo is public. If your repo is private, the site will give a 404. Make it public first.

Steps:

  1. Push this folder to GitHub on the `main` branch.
  2. On GitHub open Settings, then Pages.
  3. Under Source pick GitHub Actions.
  4. Push again or press Run workflow. The file in `.github/workflows/pages.yml` will test and publish the site.
  5. Your site will be at `https://YOURNAME.github.io/EmailArchive/`

If you see a 404 after that, check these:
  * Repo is public, not private.
  * Pages Source is set to GitHub Actions, not Deploy from a branch.
  * The workflow finished with a green check under the Actions tab.
  * You waited a minute and refreshed.

To make a private repo public:
  * On the GitHub website open the repo, open Settings, scroll to Danger Zone, press Change visibility, pick Public. Or run `gh repo edit YOURNAME/EmailArchive --visibility public`.

## Setup you have to do once

Google asks you to register the site before sign in works. That means creating an OAuth Client ID. The full steps are in `OAUTH_SETUP.md`. Short version: turn on Gmail API, add the read only scope, add your site address to Authorized JavaScript origins, paste the Client ID into the site.

You need these two origins in Google Cloud Console:
  * `https://YOURNAME.github.io`
  * `http://localhost:8000`

## Files in this folder

  * `index.html` is the site
  * `styles.css` is the layout
  * `config.js` holds the Client ID placeholder
  * `js/` holds the code. `utils.js` has small helpers. `gmail.js` talks to Gmail. `pdf.js` builds the PDF. `export.js` builds the ZIP. `app.js` ties the buttons together.
  * `tests/` has checks you can run with `node --test tests/`
  * `.github/workflows/pages.yml` is the Pages publish job

## Tests

```bash
node --test tests/
```

More detail is in `TEST_REPORT.md`.

## Notes on safety

  * The site only asks for Gmail read access. It can read mail. It cannot send or delete mail.
  * The PDF is for reading. The `.eml` files are the originals.
  * `checksums.sha256` can show if a file changed later. It does not prove who sent the mail.
  * If any file fails to save, the site says INCOMPLETE. It does not say done when files are missing.
