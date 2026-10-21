# Gmail Archive

Save Gmail chats to your computer. Pick who the mails are from, pick dates, press Build, download a ZIP.

The ZIP has a PDF you can read plus the original mails and files.

## How to open it

1. Open a terminal in this folder.
2. Run this:
```bash
python3 -m http.server 8000
```
3. Open Firefox and go to:
```
http://localhost:8000
```
4. Leave that terminal open while you use the site. Close it when done.

Do not double click `index.html`. Google sign in only works through the address above.

## One time setup

The first time, the site asks for a Google Client ID. The site owner gives you this, or follow `OAUTH_SETUP.md` to make your own. Paste it in Step 1. It stays in this browser only.

If you run your own copy on your own computer, add this in Google Cloud under Authorized JavaScript origins:
```
http://localhost:8000
```

## How to save mails

1. Step 1. Press Sign in with Google. The site can read mail. It cannot send or delete mail.
2. Step 2. Type sender addresses. One per line. Pick start and end dates if you want. Both ends count. Press Search and preview.
3. Step 3. Check the list. If one mail matches, the full thread comes with it, with all replies. That is normal.
4. Step 4. Leave the options alone if unsure. Video and music are listed in the PDF and saved next to it.
5. Step 5. Press Build my archive. Wait for download, then PDF, then ZIP. Press Download ZIP archive.

If it says complete, you are done. If it says INCOMPLETE, press Build again. It only reads from Gmail. It never changes Gmail.

More detail is in `USER_GUIDE.md`.

## What you get

Open the ZIP. Inside:
  * `master-archive.pdf`. Read this first.
  * `emails/`. Original mails, one `.eml` per message. Open with Thunderbird, Apple Mail, or Outlook.
  * `attachments/`. Original files. Photos, documents, videos, music.
  * `manifest.csv`. List of all saved mails. Open in Excel or Google Sheets.
  * `checksums.sha256`. Use to check files later.
  * `export.log`, `errors.json`. What ran and what failed.

## Check nothing is missing

1. In the site open Verification. All lines should show a tick.
2. Compare the preview count with the rows in `manifest.csv`.
3. Optional. Unzip, then run `sha256sum -c checksums.sha256`.

## Safety

The site runs in your browser only. Mails go from Google straight to the ZIP you download. Nothing is sent to another server.

The site asks for read access only. Sign out clears access from this browser. You can also remove access in your Google Account under Security.

The PDF is for reading. The `.eml` files are the originals. Checksums show if a file changed later. They do not prove who sent the mail.

## If stuck

  * Sign in popup closes at once. Allow popups for this site. Try an Incognito window in Firefox.
  * Access blocked. Your Gmail is not listed as a test user in Google Cloud, or the read only scope is missing. See `OAUTH_SETUP.md`.
  * Search finds nothing. Check spelling of the sender. Widen the dates.
  * Build says INCOMPLETE. Most times the net dropped for a moment. Press Build again. For large mailboxes use smaller date ranges.
