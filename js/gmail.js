/* Gmail API layer (browser only). Uses Google Identity Services token client + fetch. */
(function (global) {
 "use strict";

 const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
 const U = () => global.ArchiveUtils;

 function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

 class GmailClient {
  constructor() {
   this.accessToken = null;
   this.expiresAt = 0;
   this.tokenClient = null;
   this.clientId = "";
   // Gap between Gmail calls. Starts gentle and grows automatically whenever
   // Google reports quota pressure, so long runs always finish instead of failing.
   this.lastCallAt = 0;
   this.minGapMs = 250;
   this.maxGapMs = 10000;
   this.throttleLevel = 0;
   this.totalCalls = 0;
   this.callTimes = [];
   this.onThrottle = null;
   this.cancelRequested = false;
  }

  async _pace() {
   const now = Date.now();
   const wait = this.minGapMs - (now - this.lastCallAt);
   if (wait > 0) await sleep(wait);
   this.lastCallAt = Date.now();
   this.totalCalls++;
   try {
    this.callTimes.push(this.lastCallAt);
    while (this.callTimes.length && this.callTimes[0] < this.lastCallAt - 120000) this.callTimes.shift();
   } catch (e) {}
  }

  callsInLastMinute() {
   try {
    const cut = Date.now() - 60000;
    let n = 0;
    for (let i = this.callTimes.length - 1; i >= 0; i--) {
     if (this.callTimes[i] >= cut) n++;
     else break;
    }
    return n;
   } catch (e) { return 0; }
  }

  async _sleepInterruptible(ms) {
   let left = Math.max(0, Number(ms) || 0);
   while (left > 0) {
    if (this.cancelRequested) throw new Error("CANCELLED");
    const chunk = Math.min(left, 2000);
    await sleep(chunk);
    left -= chunk;
   }
   if (this.cancelRequested) throw new Error("CANCELLED");
  }

  configuredClientId() {
   const fromConfig = (global.ARCHIVE_CONFIG && global.ARCHIVE_CONFIG.CLIENT_ID) || "";
   const clean = (v) => (v && v !== "PASTE_YOUR_CLIENT_ID_HERE" ? String(v).trim() : "");
   let saved = "";
   try { saved = localStorage.getItem("ga_client_id") || ""; } catch (e) { saved = ""; }
   return clean(this.clientId) || clean(fromConfig) || clean(saved);
  }

  setClientId(id) {
   this.clientId = String(id || "").trim();
   if (this.clientId) { try { localStorage.setItem("ga_client_id", this.clientId); } catch (e) {} }
  }

  isSignedIn() {
   return !!(this.accessToken && Date.now() < this.expiresAt - 30000);
  }

  ensureGisLoaded() {
   if (global.google && global.google.accounts && global.google.accounts.oauth2) return true;
   return false;
  }

  async waitForGis(timeoutMs) {
   const waitMs = (typeof timeoutMs === "number" && timeoutMs > 0) ? timeoutMs : 8000;
   const start = Date.now();
   while (Date.now() - start < waitMs) {
    if (this.ensureGisLoaded()) return true;
    await new Promise((r) => setTimeout(r, 400));
   }
   return this.ensureGisLoaded();
  }

  async requestAccessToken(clientId) {
   const cid = String(clientId || this.configuredClientId()).trim();
   if (!cid || cid === "PASTE_YOUR_CLIENT_ID_HERE") {
    throw new Error("Missing sign in code. Paste it in Step 1.");
   }
   await this.waitForGis(8000);
   if (!this.ensureGisLoaded()) {
    throw new Error("Google sign-in library did not load. Allow accounts.google.com in your ad blocker and Firefox protection, reload, and try again.");
   }
   const scopes = (global.ARCHIVE_CONFIG && global.ARCHIVE_CONFIG.SCOPES) || "https://www.googleapis.com/auth/gmail.readonly";
   const self = this;
   return new Promise((resolve, reject) => {
    try {
     self.tokenClient = global.google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: scopes,
      callback: (resp) => {
       if (resp && resp.access_token) {
        self.accessToken = resp.access_token;
        const secs = Number(resp.expires_in || 3600);
        self.expiresAt = Date.now() + secs * 1000;
        self.setClientId(cid);
        resolve(resp);
       } else {
        reject(new Error("Google sign-in was cancelled or failed. No access token returned."));
       }
      },
      error_callback: (err) => {
       let detail = "unknown";
       try {
        if (err && err.message) detail = String(err.message);
        else if (err && err.type) detail = "[" + String(err.type) + "] " + JSON.stringify(err).slice(0, 300);
        else detail = JSON.stringify(err).slice(0, 300);
       } catch (e2) { detail = String((err && (err.message || err.type)) || "unknown"); }
       reject(new Error("Google sign-in error: " + detail));
      },
     });
     self.tokenClient.requestAccessToken();
    } catch (e) {
     reject(e);
    }
   });
  }

  setToken(token, expiresInSecs) {
   this.accessToken = String(token || "");
   const secs = Number(expiresInSecs || 3600);
   this.expiresAt = Date.now() + (isFinite(secs) ? secs : 3600) * 1000;
  }

  parseRedirectHash() {
   try {
    const loc = global.location;
    if (!loc || !loc.hash) return null;
    const h = String(loc.hash);
    if (h.indexOf("access_token=") < 0 && h.indexOf("error=") < 0) return null;
    const params = new URLSearchParams(h.charAt(0) === "#" ? h.slice(1) : h);
    const err = params.get("error");
    if (err) return { error: err, errorDesc: params.get("error_description") || "" };
    const tok = params.get("access_token");
    if (!tok) return null;
    let want = "";
    try { want = sessionStorage.getItem("ga_oauth_state") || ""; } catch (e) { want = ""; }
    try { sessionStorage.removeItem("ga_oauth_state"); } catch (e) {}
    const got = params.get("state") || "";
    if (want && got !== want) throw new Error("Sign in return check failed. Please try again.");
    try { if (global.history && global.history.replaceState) global.history.replaceState(null, "", loc.pathname + loc.search); } catch (e) {}
    return { accessToken: tok, expiresIn: Number(params.get("expires_in") || 3600) };
   } catch (e) {
    if (e && e.message && e.message.indexOf("return check failed") >= 0) throw e;
    return null;
   }
  }

  async requestAccessTokenRedirect() {
   const cid = this.configuredClientId();
   if (!cid || cid === "PASTE_YOUR_CLIENT_ID_HERE") {
    throw new Error("Missing sign in code. Paste it in Step 1.");
   }
   await this.waitForGis(8000);
   if (!this.ensureGisLoaded()) {
    throw new Error("Google sign-in library did not load. Allow accounts.google.com in your ad blocker and Firefox protection, reload, and try again.");
   }
   const scopes = (global.ARCHIVE_CONFIG && global.ARCHIVE_CONFIG.SCOPES) || "https://www.googleapis.com/auth/gmail.readonly";
   const redirectUri = global.location.origin + global.location.pathname;
   let st = "";
   try {
    st = "ga" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("ga_oauth_state", st);
   } catch (e) { st = ""; }
   this.tokenClient = global.google.accounts.oauth2.initTokenClient({
    client_id: cid,
    scope: scopes,
    ux_mode: "redirect",
    redirect_uri: redirectUri,
    state: st,
    callback: function () {},
    error_callback: function () {}
   });
   this.setClientId(cid);
   this.tokenClient.requestAccessToken();
  }

  signOut() {
   const tok = this.accessToken;
   this.accessToken = null;
   this.expiresAt = 0;
   if (tok && global.google && global.google.accounts && global.google.accounts.oauth2) {
    try { global.google.accounts.oauth2.revoke(tok, () => {}); } catch (e) { /* ignore */ }
   }
   // Best-effort token invalidation (failure is fine. local sign-out already done).
   if (tok) {
    fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(tok), { method: "POST" }).catch(() => {});
   }
  }

  async apiFetch(path, opts, retry) {
   opts = opts || {};
   const maxNetRetries = retry == null ? 4 : retry;
   let netAttempts = 0;
   if (!this.isSignedIn()) throw new Error("Not signed in (token missing or expired). Please sign in again in Step 1.");
   for (;;) {
    try {
     await this._pace();
     const res = await fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers: { Authorization: "Bearer " + this.accessToken },
     });
     if (res.status === 401) {
      throw new Error("AUTH_EXPIRED: Google rejected the access token. Please sign in again.");
     }
     if (res.ok) return await res.json();
     let retryAfterMs = 0;
     try {
      const ra = Number(res.headers.get("Retry-After") || 0);
      if (isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, 120000);
     } catch (e) {}
     let detail = "", reason = "";
     try {
      const j = await res.json();
      detail = (j && j.error && j.error.message) || "";
      const errs = (j && j.error && j.error.errors) || [];
      reason = errs.map((x) => (x && x.reason) || "").join(",");
     } catch (e) { try { detail = await res.text(); } catch (e2) {} }
     const msg = "Gmail API error " + res.status + ": " + (detail || res.statusText);
     const rateLike = res.status === 429 || res.status === 503 ||
      (res.status === 403 && /ratelimit|quota|userRateLimitExceeded/i.test(reason + " " + detail));
     if (rateLike) {
      // Quota pressure is never a failure. Wait as Google instructs, slow the
      // steady pace further, then continue the same run for as long as needed.
      this.throttleLevel++;
      this.minGapMs = Math.min(this.maxGapMs, Math.max(this.minGapMs * 1.5, 500));
      const waitMs = Math.max(1500 * Math.pow(2, Math.min(this.throttleLevel, 6)), retryAfterMs);
      try { if (typeof this.onThrottle === "function") this.onThrottle({ waitMs: waitMs, gapMs: this.minGapMs }); } catch (e) {}
      await this._sleepInterruptible(waitMs);
      continue;
     }
     throw new Error(msg);
    } catch (e) {
     const em = String((e && e.message) || e);
     if (em.indexOf("AUTH_EXPIRED") === 0 || em === "CANCELLED") throw e;
     if (e instanceof TypeError) {
      // Network interruption. bounded retries, then fail loudly.
      netAttempts++;
      if (netAttempts > maxNetRetries) throw e;
      await this._sleepInterruptible(1200 * Math.pow(2, netAttempts));
      continue;
     }
     throw e;
    }
   }
  }

  async getProfile() {
   return this.apiFetch("/profile");
  }

  async getThreadMetadata(threadId) {
   const heads = ["From", "To", "Cc", "Subject", "Date", "Message-ID"].map((h) => "&metadataHeaders=" + encodeURIComponent(h)).join("");
   return this.apiFetch("/threads/" + encodeURIComponent(threadId) + "?format=metadata" + heads);
  }

  async listMessagesPage(query, pageToken, maxResults) {
   let q = "/messages?maxResults=" + (maxResults || 100) + "&q=" + encodeURIComponent(query || "");
   if (pageToken) q += "&pageToken=" + encodeURIComponent(pageToken);
   // includeSpamTrash=false default.
   return this.apiFetch(q);
  }

  async listAllMessageIds(query, opts) {
   opts = opts || {};
   const maxTotal = opts.maxTotal || 5000;
   const onProgress = opts.onProgress || (() => {});
   const shouldCancel = opts.shouldCancel || (() => false);
   const ids = [];
   let pageToken = null;
   let pages = 0;
   do {
    if (shouldCancel()) throw new Error("CANCELLED");
    const page = await this.listMessagesPage(query, pageToken, 200);
    const msgs = page.messages || [];
    for (const m of msgs) {
     if (m && m.id) ids.push({ id: m.id, threadId: m.threadId });
     if (ids.length >= maxTotal) break;
    }
    pages++;
    onProgress({ idsSoFar: ids.length, pages });
    pageToken = page.nextPageToken || null;
    if (ids.length >= maxTotal) break;
   } while (pageToken);
   return ids;
  }

  async getMessageFull(id) {
   return this.apiFetch("/messages/" + encodeURIComponent(id) + "?format=full");
  }

  async getMessageRaw(id) {
   return this.apiFetch("/messages/" + encodeURIComponent(id) + "?format=raw");
  }

  async getThreadFull(threadId) {
   return this.apiFetch("/threads/" + encodeURIComponent(threadId) + "?format=full");
  }

  async getThreadRaw(threadId) {
   return this.apiFetch("/threads/" + encodeURIComponent(threadId) + "?format=raw");
  }

  async getAttachment(messageId, attachmentId) {
   const j = await this.apiFetch(
    "/messages/" + encodeURIComponent(messageId) + "/attachments/" + encodeURIComponent(attachmentId)
   );
   return j; // {size, data: base64url}
  }
 }

 // Message payload helpers

 function collectParts(payload, out) {
  out = out || [];
  if (!payload) return out;
  if (payload.parts && payload.parts.length) {
   for (const p of payload.parts) collectParts(p, out);
  } else {
   out.push(payload);
  }
  return out;
 }

 function findBodies(payload) {
  // Returns {text, html} decoded strings (best effort).
  const res = { text: "", html: "" };
  if (!payload) return res;
  const U = global.ArchiveUtils;
  function decodePart(part) {
   if (!part || !part.body || !part.body.data) return "";
   try {
    const bytes = U.base64UrlToUint8(part.body.data);
    return U.uint8ToStringUtf8(bytes);
   } catch (e) { return ""; }
  }
  function walk(p) {
   if (!p) return;
   const mime = (p.mimeType || "").toLowerCase();
   if (p.body && p.body.data) {
    if (mime === "text/plain" && !res.text) res.text = decodePart(p);
    else if (mime === "text/html" && !res.html) res.html = decodePart(p);
   }
   (p.parts || []).forEach(walk);
  }
  walk(payload);
  return res;
 }

 function listAttachments(payload) {
  const out = [];
  function walk(p) {
   if (!p) return;
   const filename = p.filename || "";
   if (filename && p.body) {
    const isAttachment = p.body.attachmentId || (p.body.data && (p.mimeType || "").indexOf("text/") !== 0);
    // Gmail marks real attachments with a filename + attachmentId (or inline data).
    if (p.body.attachmentId || (p.body.data && filename)) {
     out.push({
      filename,
      mimeType: p.mimeType || "application/octet-stream",
      partId: p.partId || "",
      attachmentId: p.body.attachmentId || null,
      inlineData: p.body.attachmentId ? null : (p.body.data || null),
      size: p.body.size || 0,
      headers: p.headers || [],
     });
    }
   }
   (p.parts || []).forEach(walk);
  }
  walk(payload);
  return out;
 }

 global.GmailClient = GmailClient;
 global.GmailHelpers = { collectParts, findBodies, listAttachments };
})(window);
