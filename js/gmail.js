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
  }

  configuredClientId() {
   const fromConfig = (global.ARCHIVE_CONFIG && global.ARCHIVE_CONFIG.CLIENT_ID) || "";
   const clean = (v) => (v && v !== "PASTE_YOUR_CLIENT_ID_HERE" ? String(v).trim() : "");
   let saved = "";
   try { saved = localStorage.getItem("ga_client_id") || ""; } catch (e) { saved = ""; }
   return clean(this.clientId) || clean(saved) || clean(fromConfig);
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

  requestAccessToken(clientId) {
   const cid = String(clientId || this.configuredClientId()).trim();
   if (!cid || cid === "PASTE_YOUR_CLIENT_ID_HERE") {
    throw new Error("Missing Client ID. Create one in Google Cloud Console (see OAUTH_SETUP.md) and paste it in Step 1.");
   }
   if (!this.ensureGisLoaded()) {
    throw new Error("Google sign-in library is still loading or blocked. Check your connection / ad-blocker and reload.");
   }
   const scopes = (global.ARCHIVE_CONFIG && global.ARCHIVE_CONFIG.SCOPES) || "https://www.googleapis.com/auth/gmail.readonly";
   return new Promise((resolve, reject) => {
    try {
     this.tokenClient = global.google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: scopes,
      callback: (resp) => {
       if (resp && resp.access_token) {
        this.accessToken = resp.access_token;
        const secs = Number(resp.expires_in || 3600);
        this.expiresAt = Date.now() + secs * 1000;
        this.setClientId(cid);
        resolve(resp);
       } else {
        reject(new Error("Google sign-in was cancelled or failed. No access token returned."));
       }
      },
      error_callback: (err) => reject(new Error("Google sign-in error: " + (err && (err.message || err.type) || "unknown"))),
     });
     this.tokenClient.requestAccessToken({ prompt: "consent" });
    } catch (e) {
     reject(e);
    }
   });
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
   retry = retry == null ? 4 : retry;
   if (!this.isSignedIn()) throw new Error("Not signed in (token missing or expired). Please sign in again in Step 1.");
   let lastErr = null;
   for (let attempt = 0; attempt <= retry; attempt++) {
    try {
     const res = await fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers: { Authorization: "Bearer " + this.accessToken },
     });
     if (res.status === 401) {
      throw new Error("AUTH_EXPIRED: Google rejected the access token. Please sign in again.");
     }
     if (res.status === 403 && attempt < retry) {
      // Rate limit / quota. back off.
      await sleep(1200 * Math.pow(2, attempt));
      continue;
     }
     if (res.status === 429 && attempt < retry) {
      await sleep(1500 * Math.pow(2, attempt));
      continue;
     }
     if (res.status >= 500 && attempt < retry) {
      await sleep(1000 * Math.pow(2, attempt));
      continue;
     }
     if (!res.ok) {
      let detail = "";
      try { const j = await res.json(); detail = (j && j.error && j.error.message) || ""; } catch (e) { try { detail = await res.text(); } catch (e2) {} }
      throw new Error("Gmail API error " + res.status + ": " + (detail || res.statusText));
     }
     return await res.json();
    } catch (e) {
     lastErr = e;
     if (String(e && e.message).startsWith("AUTH_EXPIRED")) throw e;
     if (attempt >= retry) throw e;
     if (e instanceof TypeError) {
      // Network interruption. wait and retry.
      await sleep(1200 * Math.pow(2, attempt));
      continue;
     }
     throw e;
    }
   }
   throw lastErr || new Error("Gmail request failed");
  }

  async getProfile() {
   return this.apiFetch("/profile");
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
