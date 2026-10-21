# OAuth setup — get a Google Client ID (free, ~5 min)

The site uses the official Gmail API with OAuth 2.0. Google requires you to register the site once. No coding needed.

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in.
2. Top bar → project picker → **New Project** → name e.g. `gmail-archive` → Create.

## 2. Enable the Gmail API

1. Left menu → **APIs & Services → Library**.
2. Search **Gmail API** → **Enable**.

## 3. Configure the consent screen

1. **APIs & Services → OAuth consent screen** → User type **External** → Create.
2. App name: `Gmail Archive`, support email: your Gmail. Save.
3. **Scopes** → Add → filter `gmail.readonly` → check `https://www.googleapis.com/auth/gmail.readonly` → Save.
   - This is read-only. The app cannot send/delete mail.
4. **Test users** (while in Testing mode) → Add your Gmail address(es). Only these accounts can sign in until you Publish.
5. Optionally **Publish** later to let anyone with a Google account use it (may trigger verification for sensitive scopes — for personal use, Testing + Test users is fine).

## 4. Create the Client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**. Name: `gmail-archive-pages`.
3. Under **Authorized JavaScript origins**, add BOTH:
   - `https://YOUR-USERNAME.github.io`
   - `http://localhost:8000`
   - (Do NOT add paths — origins only. Add your custom domain too if you use one.)
4. **Authorized redirect URIs**: leave empty (this app uses the token model, no redirects).
5. Create → copy the **Client ID** (ends with `apps.googleusercontent.com`).

## 5. Put it in the site

- Easiest: open the site → Step 1 → paste the Client ID (saved in that browser only), OR
- Bake it in: edit `config.js` → replace `PASTE_YOUR_CLIENT_ID_HERE` → commit & push.

## Troubleshooting

| Error | Fix |
|---|---|
| `Error 400: redirect_uri_mismatch` | You added a redirect URI — remove it; only JavaScript origins matter. |
| `Error 403: access_denied` / “Access blocked” | Add your Gmail as a Test user; check the `gmail.readonly` scope is added. |
| Sign-in popup closes instantly | Allow popups for the site; disable ad-block for `accounts.google.com`; try Incognito. |
| “Missing Client ID” | Paste it in Step 1 or `config.js`. |
| Works on localhost but not Pages | Add `https://YOUR-USERNAME.github.io` to Authorized JavaScript origins (exact scheme + host). |

## Revoking access

Site → Sign out & revoke, or Google Account → Security → Third-party access → remove “Gmail Archive”. Tokens expire after ~1 hour anyway.
