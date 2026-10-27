# Test report

Date: 2026-10-21. Ran on this computer and in GitHub Actions.

## Auto checks

File: `tests/utils.test.mjs`. 12 tests in 8 groups. Result: 12 pass, 0 fail.

Covered:
  * `sanitizeFilename` strips bad chars, handles empty, keeps `.pdf` when cutting long names
  * `buildGmailQuery` builds single sender, multi sender, and empty queries. End date is inclusive by adding one day
  * `isDateInRange` keeps start day and end day
  * `csvEscape` and `buildCsv` handle commas, quotes, new lines
  * `base64UrlToUint8` decodes `aGVsbG8` to `hello`
  * `stripHtml` keeps text, drops script and style
  * `getNextAvailableName` makes `a.pdf`, `a_2.pdf`, `a_3.pdf`
  * `senderKey` pulls `bob@x.com` from `Bob <bob@x.com>`

Static checks:
  * `node --check` on `config.js` and all files in `js/`. All pass.
  * `index.html` parses with Python `html.parser`.
  * Local server serves `index.html`, all JS, CSS, manifest, icon with 200.

Run it:

```bash
node --test tests/
```

## Manual run on localhost

This part needs your own Google Client ID. Actions cannot do it.

  1. In this folder run `python3 -m http.server 8000`
  2. Open `http://localhost:8000` in Firefox. Do not double click the file.
  3. Step 1: paste Client ID, press Sign in with Google. Your address should show.
  4. Step 2: enter a sender and dates. Press Search and preview. Rows should show.
  5. Step 4: leave defaults. Press Build my archive. The log should show download, then PDF, then ZIP.
  6. Step 5: press Download ZIP. Unzip. Open the PDF. Open an `.eml` file. Check `manifest.csv` row count matches the preview. Run `sha256sum -c checksums.sha256`.
  7. Turn off net mid export to test errors. The site should show INCOMPLETE, not complete.

Tested here 2026-10-21:
  * `python3 -m http.server` served all 14 files with 200
  * `node --test tests/` gave 12 pass
  * `node --check` gave pass on all JS files

## Known limits

  * Max messages setting defaults to 1000, max 5000 per run. For big mailboxes you can still go one year at a time for speed.
  * Rate limits are handled for you. The app previews with light requests, batches originals per thread, reuses preview data, paces calls, waits out quota windows automatically with growing gaps, shows time left on every stage, and never treats a rate error as a failed export. Cancel stays available throughout.
  * One message body in the PDF is cut at 60000 chars. Full text stays in the `.eml`.
  * Image previews only for images under about 900 KB. Video and audio are never put in the PDF. They are listed and saved next to it, or skipped if you pick skip.
  * SHA check needs `https` or `http://localhost`. GitHub Pages is fine. Opening the file straight from disk is not fine.
