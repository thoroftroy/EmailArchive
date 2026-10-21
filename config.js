/* Gmail Archive. Public configuration.
 * This file is served on GitHub Pages, so NEVER put secrets here.
 * Set your Google OAuth Client ID in one of these ways (first non-empty wins):
 *   1. Type it in the website's "Connect" step (saved in this browser only).
 *   2. Replace PASTE_YOUR_CLIENT_ID_HERE below and redeploy.
 * See OAUTH_SETUP.md for how to create a Client ID.
 */
window.ARCHIVE_CONFIG = {
  CLIENT_ID: "293943522937-fp32hbt8bbigmrcqaivghghki01f8ccs.apps.googleusercontent.com",

  // Read only Gmail scope. Do not change unless you know what you are doing.
  SCOPES: "https://www.googleapis.com/auth/gmail.readonly",

  APP_NAME: "Gmail Archive",
  SUPPORT_EMAIL_NOTE: "All data stays in your browser. Nothing is uploaded anywhere."
};
