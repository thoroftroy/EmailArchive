# OAuth setup. Get a Google Client ID

You only do this once. It is free. It takes about five minutes.

## 1. Make a project

  1. Go to `https://console.cloud.google.com/` and sign in.
  2. Top bar, project picker, New Project. Name it `gmail archive`. Press Create.

## 2. Turn on Gmail API

  1. Open APIs and Services, then Library.
  2. Search for Gmail API. Press Enable.

## 3. Fill in the consent screen

  1. Open APIs and Services, then OAuth consent screen.
  2. Pick External. Press Create.
  3. App name: `Gmail Archive`. Support email: your Gmail. Press Save.
  4. Under Scopes press Add. Filter for `gmail.readonly`. Tick `https://www.googleapis.com/auth/gmail.readonly`. Press Save. This is read only access.
  5. Under Test users press Add users. Add your Gmail address. While the app is in Testing mode, only test users can sign in.
  6. You can stay in Testing mode for personal use. You can Publish later if you want other people to use it.

## 4. Make the Client ID

  1. Open APIs and Services, then Credentials. Press Create Credentials, then OAuth client ID.
  2. Application type: Web application. Name: `gmail archive pages`.
  3. Under Authorized JavaScript origins add these two lines. Origins only, no extra path at the end:
     * `https://YOURNAME.github.io`
     * `http://localhost:8000`
     Add your own domain too if you use one.
  4. Leave Authorized redirect URIs empty. This site does not use redirects.
  5. Press Create. Copy the Client ID. It ends with `apps.googleusercontent.com`.

## 5. Use it in the site

Pick one:
  * Open the site, go to Step 1, paste the Client ID in the box. It is saved in that browser only.
  * Or open `config.js` in this folder, replace `PASTE_YOUR_CLIENT_ID_HERE`, save, commit, push.

## If sign in fails

  * Error `redirect_uri_mismatch`. You added something under redirect URIs. Remove it. Only Authorized JavaScript origins should have entries.
  * Error `access_denied` or Access blocked. Add your Gmail under Test users. Check the `gmail.readonly` scope is added.
  * Sign in popup closes at once. Allow popups for the site. Turn off ad block for `accounts.google.com`. Try an Incognito window.
  * Message about missing Client ID. Paste it in Step 1 or in `config.js`.
  * Works on localhost but not on Pages. Add `https://YOURNAME.github.io` to Authorized JavaScript origins. The start of the address has to match exactly.

## Sign out

Press Sign out in the site. Or open your Google Account, open Security, open Third party access, remove Gmail Archive. Tokens expire after about one hour in any case.
