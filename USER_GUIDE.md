# User guide — Gmail Archive (no tech knowledge needed)

## What this does

Saves emails from people you choose into one tidy download: a readable PDF plus the original files. Great for landlords, employers, legal records, or backups.

## The 5 steps

### 1. Connect
- Paste the Client ID if asked (the site owner gives you this), then **Sign in with Google**.
- Google shows what the site can do: **read** emails only. It cannot send or delete.

### 2. Pick emails
- Type sender address(es), e.g. `landlord@example.com`. One per line.
- Pick start/end dates if you want (both inclusive), or leave blank for everything.
- Press **Search & preview**.

### 3. Preview
- Check the count and the first rows. If it says 0, check spelling or widen dates.
- Note: if one message matches, its **whole conversation** (all replies) is included — the count can grow, which is correct.

### 4. Customize (optional)
- Leave defaults if unsure. They save originals + a PDF + attachments separately.
- Videos/music: PDFs can’t play them, so they’re listed in the PDF and saved next to it (or skipped if you choose).

### 5. Build & download
- Press **Build my archive**, watch the progress (3 stages: download → PDF → ZIP).
- Press **⬇ Download ZIP archive**. Also grab **PDF only** if you just want to read.
- If it says **complete**, you’re done. If it says **INCOMPLETE**, press Build again — it’s safe to retry.

## Opening your files

- `master-archive.pdf` — double-click, opens anywhere.
- `.eml` files (in `emails/`) — open with Thunderbird (free), Apple Mail, or Outlook.
- `manifest.csv` — opens in Excel / Google Sheets.
- Attachments — open normally (photos, documents, videos).

## Checking nothing is missing

- In the app: open **Verification** — all ticks should be ✓.
- On a computer: unzip, then verify hashes (optional): `sha256sum -c checksums.sha256`.
- Compare the preview count with `manifest.csv` rows.

## Tips

- Big mailbox? Do smaller date ranges (e.g. one year at a time).
- Network dropped? Just run Build again.
- Want a fresh start? **Start a new archive**.
- Your history stays in this browser only; **Clear history** removes it.
