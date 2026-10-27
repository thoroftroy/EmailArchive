# User guide. Gmail Archive

## What this is for

It saves emails from people you pick into one tidy download. Good for records, landlords, work mail, or backup.

## The steps

### 1. Connect
  * If the box asks for a Client ID, paste it. The site owner gives you this.
  * Press Sign in with Google.
  * Google will show what the site can do. It can read mail. It cannot send or delete mail.

### 2. Pick emails
  * Type sender addresses. One per line. Example: `landlord@example.com`
  * Pick start and end dates if you want. Both ends count. Leave blank for all dates.
  * Press Search and preview.

### 3. Preview
  * Look at the count and the first rows. If it says 0, check spelling or widen the dates.
  * If one mail matches, the site pulls the full thread. That means all replies in that chat. The count can grow. That is normal.

### 4. Change options if you want
  * Leave defaults if you are unsure. Defaults save originals plus a PDF plus attachments.
  * Video and music cannot play inside a PDF. The PDF lists them. The files are saved next to the PDF in the ZIP. Or you can pick skip.

### 5. Build and download
  * Press Build my archive. Watch the three stages: download, then PDF, then ZIP.
  * Press Download ZIP archive. Press Download PDF only if you just want to read.
  * If it says complete, you are done. If it says INCOMPLETE, press Build again. It is safe to run again.

## Open your files

  * `master-archive.pdf` opens anywhere.
  * `.eml` files in `emails/` open with Thunderbird, Apple Mail, or Outlook.
  * `manifest.csv` opens in Excel or Google Sheets.
  * Attachments open as normal.

## Check nothing is missing

  * In the site open Verification. All lines should show a tick.
  * On a computer you can unzip, then run `sha256sum -c checksums.sha256`.
  * Compare the preview count with the rows in `manifest.csv`.

## Tips

  * Big inbox. Just let it run. The app slows down by itself and waits out limits, with a time estimate on screen. Smaller date ranges still finish faster.
  * Net dropped. Just press Build again.
  * Want a fresh start. Press Start a new archive.
  * History stays in this browser only. Clear history removes it.
