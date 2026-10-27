/* Shared pure helpers. Works in browser (window.ArchiveUtils) and Node (module.exports). */
(function (global) {
 "use strict";

 function sanitizeFilename(name, maxLen) {
  maxLen = maxLen || 120;
  if (!name) return "unnamed";
  // Remove characters illegal on Windows/macOS/Android.
  let s = String(name).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
  s = s.replace(/[\s.]+$/g, "").replace(/^\.+/g, "_");
  // Collapse repeats
  s = s.replace(/_+/g, "_");
  if (!s) s = "unnamed";
  if (s.length > maxLen) {
   const dot = s.lastIndexOf(".");
   if (dot > 0 && s.length - dot <= 12) {
    const ext = s.slice(dot);
    s = s.slice(0, maxLen - ext.length) + ext;
   } else {
    s = s.slice(0, maxLen);
   }
  }
  return s;
 }

 function sanitizeFolder(name, maxLen) {
  return sanitizeFilename(name, maxLen || 80).replace(/\./g, "_");
 }

 function base64UrlToUint8(b64url) {
  if (!b64url) return new Uint8Array(0);
  let b64 = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  // Browser path
  if (typeof atob === "function") {
   const bin = atob(b64);
   const out = new Uint8Array(bin.length);
   for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
   return out;
  }
  // Node path
  if (typeof Buffer !== "undefined") {
   const buf = Buffer.from(b64, "base64");
   return new Uint8Array(buf);
  }
  throw new Error("No base64 decoder available");
 }

 function uint8ToStringUtf8(bytes) {
  if (typeof TextDecoder !== "undefined") {
   return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  // Node fallback
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("utf-8");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
 }

 function formatGmailDateForQuery(isoDate) {
  // "2024-03-05" -> "2024/03/05"
  if (!isoDate) return "";
  return String(isoDate).slice(0, 10).replace(/-/g, "/");
 }

 function addDaysIso(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
 }

 // Build a Gmail search query. Gmail's after:/before: use YYYY/MM/DD.
 // Note: Gmail `before:` is EXCLUSIVE (messages before that date, not including it),
 // so to make end-date inclusive we add one day to `before:`.
 function buildGmailQuery(opts) {
  opts = opts || {};
  const senders = (opts.senders || []).map((s) => String(s).trim()).filter(Boolean);
  const parts = [];
  if (senders.length === 1) {
   parts.push("from:" + quoteIfNeeded(senders[0]));
  } else if (senders.length > 1) {
   parts.push("from:(" + senders.map(quoteIfNeeded).join(" OR ") + ")");
  }
  if (opts.startDate) {
   parts.push("after:" + formatGmailDateForQuery(opts.startDate));
  }
  if (opts.endDate) {
   // inclusive end -> exclusive before = end + 1 day
   parts.push("before:" + formatGmailDateForQuery(addDaysIso(opts.endDate, 1)));
  }
  return parts.join(" ").trim();
 }

 function quoteIfNeeded(s) {
  if (/[\s()"]/.test(s)) return '"' + s.replace(/"/g, "") + '"';
  return s;
 }

 // Client-side inclusive range check using Gmail internalDate (ms since epoch).
 function isDateInRange(internalDateMs, startIso, endIso) {
  const t = Number(internalDateMs);
  if (!Number.isFinite(t)) return true; // unknown -> keep, don't silently drop
  if (startIso) {
   const startMs = Date.parse(startIso + "T00:00:00Z");
   if (Number.isFinite(startMs) && t < startMs) return false;
  }
  if (endIso) {
   const endMsExclusive = Date.parse(addDaysIso(endIso, 1) + "T00:00:00Z");
   if (Number.isFinite(endMsExclusive) && t >= endMsExclusive) return false;
  }
  return true;
 }

 function extractHeader(headers, name) {
  if (!headers || !name) return "";
  const lower = String(name).toLowerCase();
  for (const h of headers) {
   if (h && h.name && String(h.name).toLowerCase() === lower) return h.value || "";
  }
  return "";
 }

 function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
 }

 function buildCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) lines.push(r.map(csvEscape).join(","));
  return lines.join("\r\n") + "\r\n";
 }

 function formatEta(ms) {
  ms = Math.max(0, Number(ms) || 0);
  const s = Math.round(ms / 1000);
  if (s < 5) return "a few seconds";
  if (s < 60) return "about " + s + " sec";
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs === 0 ? ("about " + m + " min") : ("about " + m + " min " + rs + " sec");
  const h = Math.floor(m / 60), rm = m % 60;
  return rm === 0 ? ("about " + h + " hr") : ("about " + h + " hr " + rm + " min");
}

function formatBytes(n) {
  n = Number(n);
  if (!Number.isFinite(n) || n < 0) return ". ";
  if (n < 1024) return n + " B";
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return (v >= 100 ? Math.round(v) : v.toFixed(1)) + " " + units[u];
 }

 function formatDateTime(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t)) return "unknown date";
  try {
   return new Date(t).toLocaleString();
  } catch (e) {
   return new Date(t).toISOString();
  }
 }

 function truncate(s, len) {
  s = String(s == null ? "" : s);
  if (s.length <= len) return s;
  return s.slice(0, Math.max(0, len - 1)) + "...";
 }

 function stripHtml(html) {
  if (!html) return "";
  let s = String(html);
  // Remove style/script blocks
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/div>/gi, "\n");
  s = s.replace(/<\/li>/gi, "\n").replace(/<li[^>]*>/gi, "- ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
   .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
 }

 function getNextAvailableName(usedSet, desired) {
  if (!usedSet.has(desired)) { usedSet.add(desired); return desired; }
  const dot = desired.lastIndexOf(".");
  const base = dot >= 0 ? desired.slice(0, dot) : desired;
  const ext = dot >= 0 ? desired.slice(dot) : "";
  let i = 2;
  while (true) {
   const cand = base + "_" + i + ext;
   if (!usedSet.has(cand)) { usedSet.add(cand); return cand; }
   i++;
   if (i > 9999) throw new Error("Too many duplicate filenames");
  }
 }

 function senderKey(fromHeader) {
  const m = String(fromHeader || "").match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  const m2 = String(fromHeader || "").trim().match(/[\w.+-]+@[\w.-]+\.\w+/);
  return (m2 ? m2[0] : String(fromHeader || "unknown").slice(0, 60)).toLowerCase();
 }

 function shortThreadLabel(subject, threadId) {
  const s = (subject || "No subject").trim() || "No subject";
  return truncate(s, 60) + " [" + String(threadId).slice(-6) + "]";
 }

 const api = {
  sanitizeFilename, sanitizeFolder, base64UrlToUint8, uint8ToStringUtf8,
  formatGmailDateForQuery, addDaysIso, buildGmailQuery, isDateInRange,
  extractHeader, csvEscape, buildCsv, formatBytes, formatEta, formatDateTime,
  truncate, stripHtml, getNextAvailableName, senderKey, shortThreadLabel
 };

 if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
 } else {
  global.ArchiveUtils = api;
 }
})(typeof window !== "undefined" ? window : globalThis);
