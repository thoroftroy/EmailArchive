/* Main UI wiring: wizard, Gmail flow, preview, export. Browser only. */
(function () {
 "use strict";
 const U = window.ArchiveUtils;
 const $ = (id) => document.getElementById(id);
 const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

 const state = {
  gmail: null,
  profile: null,
  searchResults: [],  // enriched message summaries for preview
  enriched: [],    // full enriched messages ready for export
  fullCache: null,      // id -> full message payloads already fetched during preview
  logFn: null,            // active export log writer, if any
  query: "",
  queryHuman: "",
  cancelled: false,
  exporting: false,
  lastStats: null,
  lastZipBlob: null,
  lastPdfBytes: null,
 };

 function toast(msg, kind) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show " + (kind || "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = "toast"; }, 4200);
 }

 function setStep(n) {
  $$(".stepper .step").forEach((el) => {
   const s = Number(el.dataset.step);
   el.classList.toggle("active", s === n);
   el.classList.toggle("done", s < n);
  });
  $$(".card-step").forEach((el) => {
   el.hidden = Number(el.dataset.cardStep) !== n;
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
 }

 function goStep(n) {
  if (n === 5 && !state.searchResults.length) {
   toast("Search first. Pick senders and press Search and preview.", "err");
   setStep(2);
   return;
  }
  setStep(n);
 }

 function etaText(done, total, t0) {
  if (!total || total <= 0 || done <= 0) return "calculating time left.";
  if (done >= total) return "almost done.";
  const left = (Date.now() - t0) / done * (total - done);
  if (left < 3000) return "almost done.";
  return "about " + U.formatEta(left) + " left.";
 }

 function noteThrottle(info) {
  const s = "Google asked us to slow down. Waiting " + Math.max(1, Math.round(info.waitMs / 1000)) + "s, then continuing automatically. Nothing is lost.";
  const a = $("progress-label"), b = $("export-progress-label");
  if (a) a.textContent = s;
  if (b) b.textContent = s;
  if (state.logFn) { try { state.logFn(s); } catch (e) {} }
 }

 function setProgress(pct, label) {
  const pctClamped = Math.max(0, Math.min(100, pct));
  const bar = $("progress-bar"), txt = $("progress-label");
  if (bar) bar.style.width = pctClamped + "%";
  if (txt && label) txt.textContent = label;
  const ebar = $("export-progress-bar"), etxt = $("export-progress-label");
  if (ebar) ebar.style.width = pctClamped + "%";
  if (etxt && label) etxt.textContent = label;
 }

 function showProgress(show) {
  const w = $("progress-wrap");
  if (w) w.hidden = !show;
  const ew = $("export-progress-wrap");
  if (ew) ew.hidden = !show;
 }

 function statusDot(ok, text) {
  const el = $("connect-status");
  el.innerHTML = "";
  const dot = document.createElement("span");
  dot.className = "dot " + (ok ? "ok" : "idle");
  el.appendChild(dot);
  el.appendChild(document.createTextNode(text));
 }

 // Step 1. Connect

 function refreshConnectUI() {
  const signed = state.gmail && state.gmail.isSignedIn();
  $("btn-signin").hidden = signed;
  $("btn-signout").hidden = !signed;
  $("account-line").hidden = !signed;
  if (signed && state.profile) {
   $("account-email").textContent = state.profile.emailAddress || "(signed in)";
   statusDot(true, "Signed in. read only access. You can revoke anytime.");
  } else if (signed) {
   statusDot(true, "Signed in.");
  } else {
   statusDot(false, "Not signed in.");
  }
 }

 async function finishSignIn() {
  state.profile = await state.gmail.getProfile().catch(() => null);
  refreshConnectUI();
  toast("Signed in" + (state.profile && state.profile.emailAddress ? " as " + state.profile.emailAddress : "") + ".");
  saveHistoryEvent("signin", {});
 }

 function clearSigninTimer() {
  if (state.signinTimer) { try { clearTimeout(state.signinTimer); } catch (e) {} state.signinTimer = null; }
 }

 async function doSignIn() {
  const cid = $("client-id").value.trim() || (window.ARCHIVE_CONFIG && window.ARCHIVE_CONFIG.CLIENT_ID) || "";
  if (!cid || cid === "PASTE_YOUR_CLIENT_ID_HERE") {
   toast("Paste the sign in code first.", "err");
   return;
  }
  try {
   state.gmail.setClientId(cid);
   toast("Opening Google sign-in...");
   statusDot(false, "Waiting for the Google window. Finish the steps there.");
   clearSigninTimer();
   state.signinTimer = setTimeout(() => {
    if (!state.gmail.isSignedIn()) {
     statusDot(false, "Still waiting for Google. No answer yet.");
     toast("Still no answer from Google. If the Google window closed with no result, allow third party cookies for Google, allow popups, and try the redirect sign in below.", "err");
    }
   }, 90000);
   await state.gmail.requestAccessToken(cid);
   clearSigninTimer();
   await finishSignIn();
  } catch (e) {
   clearSigninTimer();
   console.error(e);
   const msg = String((e && e.message) || e);
   state.lastSigninError = msg;
   if (msg.indexOf("access_denied") >= 0 || msg.indexOf("403") >= 0 || msg.toLowerCase().indexOf("blocked") >= 0) {
    toast("Sign in blocked. Only selected users can sign in. Use Send request in Step 1. Type your Gmail and press Send.", "err");
   } else if (/popup|closed|dismiss/i.test(msg)) {
    toast("Popup closed or blocked. Allow popups for this site and for Google, then try again.", "err");
   } else {
    toast("Sign in failed: " + msg + ". If it keeps failing, turn off tracking protection for this site and for Google, allow popups, reload, and try again.", "err");
   }
  }
 }

 function doSignOut() {
  if (state.gmail) state.gmail.signOut();
  state.profile = null;
  try { localStorage.removeItem("ga_token_note"); } catch (e) {}
  refreshConnectUI();
  toast("Signed out. Google access was revoked in this browser.");
 }

 // Step 2. Search form

 function readSenders() {
  return $("senders").value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
 }

 function humanQuery() {
  const senders = readSenders();
  const s = $("start-date").value, e = $("end-date").value;
  let h = senders.length ? "From: " + senders.join(", ") : "All senders";
  if (s || e) h += ". Dates: " + (s || "any") + " to " + (e || "any") + " (inclusive)";
  else h += ". All dates";
  return h;
 }

 function validateSearch() {
  const senders = readSenders();
  for (const s of senders) {
   if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && !/^[\w.+-]+@[\w.-]+$/.test(s)) {
    // Allow slightly loose but warn.
    if (s.indexOf("@") < 0) return "“" + s + "” doesn’t look like an email address. Use full addresses like name@example.com.";
   }
  }
  const s = $("start-date").value, e = $("end-date").value;
  if (s && e && s > e) return "Start date is after end date. Swap them.";
  return "";
 }

 // Step 3. Preview

 async function doPreview() {
  const err = validateSearch();
  if (err) { toast(err, "err"); return; }
  if (!state.gmail || !state.gmail.isSignedIn()) {
   toast("Sign in with Google first (Step 1).", "err");
   setStep(1);
   return;
  }
  const senders = readSenders();
  const startDate = $("start-date").value || "";
  const endDate = $("end-date").value || "";
  const maxTotal = Math.max(50, Math.min(5000, Number($("max-messages").value) || 1000));

  state.cancelled = false;
  state.gmail.cancelRequested = false;
  state.gmail.onThrottle = noteThrottle;
  const pvStartT = Date.now();
  const callsAtStart = state.gmail.totalCalls;
  setStep(3);
  showProgress(true);
  setProgress(4, "Searching Gmail...");
  $("preview-empty").hidden = true;
  $("preview-table-wrap").hidden = true;
  $("preview-summary").textContent = "";
  $("btn-to-customize").disabled = true;

  const query = U.buildGmailQuery({ senders, startDate, endDate });
  state.query = query;
  state.queryHuman = humanQuery();
  $("query-echo").textContent = "Gmail search: " + (query || "(no filter. Newest mail first)") + ". " + state.queryHuman;

  try {
   // Phase A: list matching message IDs (paginated).
   const ids = await state.gmail.listAllMessageIds(query || "in:inbox OR in:sent OR in:all", {
    maxTotal,
    shouldCancel: () => state.cancelled,
    onProgress: (p) => setProgress(4 + Math.min(30, p.idsSoFar / 10), "Found " + p.idsSoFar + " matching messages... (page " + p.pages + ")"),
   });
   if (state.cancelled) throw new Error("CANCELLED");

   // Phase B: expand to FULL threads so replies from everyone are included.
   const threadIds = [...new Set(ids.map((x) => x.threadId).filter(Boolean))];
   setProgress(38, "Including full conversation threads (" + threadIds.length + " threads)...");

   const seenMsg = new Map(); // id -> message (dedupe across threads)
   let done = 0;
   const concurrency = 2;
   async function fetchThread(tid) {
    const t = await state.gmail.getThreadMetadata(tid);
    for (const m of (t.messages || [])) {
     if (m && m.id && !seenMsg.has(m.id)) seenMsg.set(m.id, m);
    }
   }
   // Bounded parallel fetch with retries already inside apiFetch.
   for (let i = 0; i < threadIds.length; i += concurrency) {
    if (state.cancelled) throw new Error("CANCELLED");
    await Promise.all(threadIds.slice(i, i + concurrency).map(fetchThread));
    done += Math.min(concurrency, threadIds.length - i);
    setProgress(38 + Math.round(40 * (done / Math.max(1, threadIds.length))), "Reading threads " + done + "/" + threadIds.length + ". " + etaText(done, threadIds.length, pvStartT));
    await new Promise((r) => setTimeout(r, 0));
   }

   state.gmail.onThrottle = null;
   // Phase C: client-side inclusive date filter + summarize.
   let all = [...seenMsg.values()];
   all = all.filter((m) => U.isDateInRange(Number(m.internalDate), startDate, endDate));
   all.sort((a, b) => Number(a.internalDate) - Number(b.internalDate));

   state.searchResults = all.map((m) => summarizeFull(m));
   state.fullCache = seenMsg;
   {
    const pvSecs = (Date.now() - pvStartT) / 1000;
    const pvCalls = state.gmail.totalCalls - callsAtStart;
    const pvRate = pvSecs > 1 ? pvCalls / pvSecs : 0;
    if (pvRate > 0) {
     const estCalls = threadIds.length * 2 + state.searchResults.length + Math.round(state.searchResults.length * 0.5);
     $("preview-summary").textContent += " Export will make roughly " + estCalls + " more calls, " + U.formatEta(estCalls / pvRate * 1000) + " at this speed.";
    }
   }
   renderPreview(startDate, endDate);
   setProgress(100, "Preview ready.");
   setTimeout(() => showProgress(false), 600);
   saveHistoryEvent("preview", { query, count: state.searchResults.length });
  } catch (e) {
   showProgress(false);
   if (String(e.message) === "CANCELLED") { toast("Search cancelled."); return; }
   console.error(e);
   toast("Search failed: " + e.message, "err");
   $("preview-empty").hidden = false;
   $("preview-empty").textContent = "Search failed: " + e.message;
  }
 }

 function summarizeFull(m) {
  const headers = (m.payload && m.payload.headers) || [];
  return {
   id: m.id,
   threadId: m.threadId,
   internalDate: Number(m.internalDate),
   from: U.extractHeader(headers, "From"),
   to: U.extractHeader(headers, "To"),
   cc: U.extractHeader(headers, "Cc"),
   subject: U.extractHeader(headers, "Subject") || "(no subject)",
   snippet: m.snippet || "",
   labelIds: m.labelIds || [],
  };
 }

 function renderPreview() {
  const rows = state.searchResults;
  $("preview-summary").textContent = rows.length
   ? rows.length + " message(s) in " + new Set(rows.map((r) => r.threadId)).size + " conversation thread(s) will be exported (oldest to newest)."
   : "No messages matched. Try widening the dates or checking sender spelling.";
  $("preview-empty").hidden = rows.length > 0;
  if (!rows.length) {
   $("preview-empty").textContent = "No messages matched this search. Nothing will be exported.";
   $("preview-table-wrap").hidden = true;
   $("btn-to-customize").disabled = true;
   return;
  }
  $("preview-table-wrap").hidden = false;
  $("btn-to-customize").disabled = false;
  const tb = $("preview-tbody");
  tb.innerHTML = "";
  rows.slice(0, 300).forEach((r, i) => {
   const tr = document.createElement("tr");
   [String(i + 1), U.formatDateTime(r.internalDate), r.from, r.subject].forEach((v, ci) => {
    const td = document.createElement("td");
    td.textContent = U.truncate(v, ci === 3 ? 70 : 50);
    if (ci === 3) td.title = r.subject + "\n\n" + (r.snippet || "");
    tr.appendChild(td);
   });
   tb.appendChild(tr);
  });
  $("preview-more").textContent = rows.length > 300 ? "Showing first 300 of " + rows.length + ". The export includes all " + rows.length + "." : "";
 }

 // Step 4 and 5. Export

 function readOptions() {
  return {
   includeEml: $("opt-eml").checked,
   includeAttachments: $("opt-attachments").checked,
   videoHandling: $("opt-video").value, // "include" | "skip"
   audioHandling: $("opt-audio").value,
   pdfImagePreviews: $("opt-imgpreview").checked,
   title: $("opt-title").value.trim() || "Gmail Archive",
  };
 }

 async function doExport() {
  if (!state.searchResults.length) { toast("Nothing to export. run a search with matches first.", "err"); return; }
  if (state.exporting) return;
  const opts = readOptions();
  state.cancelled = false;
  state.gmail.cancelRequested = false;
  state.gmail.onThrottle = noteThrottle;
  const exStart = Date.now();
  const exCallsAtStart = state.gmail.totalCalls;
  state.exporting = true;
  setStep(5);
  showProgress(true);
  $("export-log").textContent = "";
  $("btn-cancel-export").hidden = false;
  $("btn-download-zip").hidden = true;
  $("btn-download-pdf").hidden = true;
  $("done-card").hidden = true;

  const log = (s) => { $("export-log").textContent += s + "\n"; $("export-log").scrollTop = 1e9; };
  state.logFn = log;
  const setStepLabel = (t) => { $("export-step").textContent = t; };

  try {
   const total = state.searchResults.length;
   // Phase 1: download originals (.eml raw + bodies + attachment bytes).
   setStepLabel("Step 1 of 3. Downloading originals from Gmail...");
   log("Downloading " + total + " messages (originals)...");
   const enriched = [];
   let ok = 0, fail = 0;
   const concurrency = 3;
   const queue = state.searchResults.slice();

   // One raw thread call per conversation instead of one raw call per message.
   // Anything missed here falls back to a single fetch inside the worker.
   const rawById = new Map();
   const fullById = new Map();
   const pfT0 = Date.now();
   if (opts.includeEml !== false) {
    const tids = [...new Set(queue.map((s) => s.threadId).filter(Boolean))];
    log("Fetching originals in " + tids.length + " thread batches...");
    let tDone = 0;
    for (const tid of tids) {
     if (state.cancelled) throw new Error("CANCELLED");
     try {
      const th = await state.gmail.getThreadRaw(tid);
      for (const m of (th.messages || [])) {
       if (m && m.id && m.raw) rawById.set(m.id, m.raw);
      }
      const tf = await state.gmail.getThreadFull(tid);
      for (const m of (tf.messages || [])) {
       if (m && m.id && m.payload && !fullById.has(m.id)) fullById.set(m.id, m);
      }
     } catch (e) {
      log("Thread batch missed, will fetch singly (" + (e.message || e) + ")");
     }
     tDone++;
     if (tDone % 10 === 0 || tDone === tids.length) {
      setProgress(Math.round(8 * tDone / Math.max(1, tids.length)), "Fetching originals " + tDone + "/" + tids.length + " threads. " + etaText(tDone, tids.length, pfT0));
     }
     await new Promise((r) => setTimeout(r, 0));
    }
   }

   async function worker() {
    while (queue.length) {
     if (state.cancelled) throw new Error("CANCELLED");
     const s = queue.shift();
     try {
      const e = await enrichOne(s, opts, rawById, fullById);
      enriched.push(e);
      ok++;
     } catch (err) {
      fail++;
      log("FAILED " + s.id + ": " + (err.message || err));
      enriched.push(enrichFailed(s, err));
     }
     const done = ok + fail;
     setProgress(Math.round(8 + 52 * done / total), "Downloaded " + done + "/" + total + " (" + fail + " failed). " + etaText(done, total, dlT0));
     await new Promise((r) => setTimeout(r, 0));
    }
   }
   const dlT0 = Date.now();
   await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
   enriched.sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
   // Re-number in chronological order.
   state.enriched = enriched;
   log("Downloaded: ok=" + ok + " failed=" + fail);

   // Phase 2: build massive PDF.
   setStepLabel("Step 2 of 3. Building master PDF...");
   log("Building master PDF with " + enriched.length + " messages...");
   setProgress(66, "Building master PDF...");
   // Fill attachment exportPath placeholders later. for PDF video/audio notes we need decisions now.
   for (const m of enriched) {
    for (const a of (m.attachments || [])) {
     const kind = window.PdfBuilder.attachmentKind(a);
     if ((!opts.includeAttachments) ||
       (kind === "video" && opts.videoHandling === "skip") ||
       (kind === "audio" && opts.audioHandling === "skip")) {
      a.exportPath = ""; // PDF will say skipped
     } else {
      a.exportPath = a.exportPath || ("attachments/.../" + (a.filename || ""));
     }
    }
   }
   const pdfT0 = Date.now();
   const pdfRes = await window.PdfBuilder.buildMasterPdf(enriched, {
    title: opts.title,
    query: state.query,
    queryHuman: state.queryHuman,
    pdfImagePreviews: opts.pdfImagePreviews,
    videoHandling: opts.videoHandling,
    audioHandling: opts.audioHandling,
    shouldCancel: () => state.cancelled,
   }, (p) => {
    if (p.stage === "pdf") setProgress(66 + Math.round(14 * p.done / Math.max(1, p.total)), "PDF page " + p.done + "/" + p.total + ". " + etaText(p.done, Math.max(1, p.total), pdfT0));
   });
   state.lastPdfBytes = pdfRes.bytes;
   log("PDF built: " + pdfRes.pageCount + " pages, " + U.formatBytes(pdfRes.bytes.length));

   // Phase 3: assemble ZIP (eml + attachments + pdf + csv + logs + checksums).
   setStepLabel("Step 3 of 3. Zipping + checksums...");
   setProgress(84, "Assembling ZIP archive...");
   const zipT0 = Date.now();
   const built = await window.ExportBuilder.assembleArchive({
    messages: enriched,
    options: opts,
    query: state.query,
    queryHuman: state.queryHuman,
    pdfBytes: pdfRes.bytes,
    shouldCancel: () => state.cancelled,
    onProgress: (p) => {
     if (p.stage === "compress") setProgress(90 + Math.round(p.percent / 10), "Compressing ZIP " + Math.round(p.percent) + "%. " + etaText(Math.round(p.percent), 100, zipT0));
    },
   });
   state.lastZipBlob = built.zipBlob;
   state.lastStats = built.stats;
   setProgress(100, built.stats.complete ? "Export complete." : "Export finished WITH ERRORS.");

   // Update real attachment paths in the in-memory enriched copy (ZIP may have deduped).
   log("ZIP: " + U.formatBytes(built.stats.zipBytes) + ". eml=" + built.stats.emlCount + ". attachments saved=" + built.stats.attSaved + ". skipped=" + built.stats.attSkipped + ". failed=" + built.stats.attFailed);
   if (!built.stats.complete) log("WARNING: " + built.stats.failedMessages + " error(s). NOT complete. See errors in completion screen.");

   built.stats.tookMs = Date.now() - exStart;
   built.stats.apiCalls = state.gmail.totalCalls - exCallsAtStart;
   log("Total time: " + U.formatEta(built.stats.tookMs) + ". Gmail calls: " + built.stats.apiCalls + " (" + (built.stats.apiCalls / Math.max(1, (Date.now() - exStart) / 1000)).toFixed(1) + "/s).");
   showDone(built.stats, opts);
   saveHistoryEvent("export", { query: state.query, messages: built.stats.messageCount, complete: built.stats.complete });
  } catch (e) {
   if (String(e.message) === "CANCELLED") {
    log("Cancelled by user.");
    toast("Export cancelled.");
    setProgress(0, "Cancelled.");
   } else {
    console.error(e);
    log("FATAL: " + (e.message || e));
    toast("Export failed: " + (e.message || e), "err");
   }
  } finally {
   state.exporting = false;
   state.logFn = null;
   state.gmail.onThrottle = null;
   $("btn-cancel-export").hidden = true;
  }
 }

 async function enrichOne(summary, opts, rawById, fullById) {
  const g = state.gmail;
  const U = window.ArchiveUtils;
  // Raw MIME for .eml (authoritative original). Prefetched per thread when possible.
  let raw = null, emlBytes = null, emlError = "";
  if (opts.includeEml !== false) {
   try {
    const pre = rawById ? rawById.get(summary.id) : null;
    raw = pre ? { raw: pre } : await g.getMessageRaw(summary.id);
    emlBytes = U.base64UrlToUint8(raw.raw || "");
   } catch (e) {
    emlError = e.message || String(e);
    // Fall back: still export metadata + body without .eml.
   }
  }
  // Full payload for body + attachment metadata. Reuse the preview copy when present.
  const fromBatch = fullById ? fullById.get(summary.id) : null;
  const pc = state.fullCache ? state.fullCache.get(summary.id) : null;
  const cachedFull = (pc && pc.payload && (pc.payload.parts || (pc.payload.body && pc.payload.body.data))) ? pc : null;
  const full = fromBatch || cachedFull || await g.getMessageFull(summary.id);
  const payload = full.payload || {};
  const headers = payload.headers || [];
  const bodies = window.GmailHelpers.findBodies(payload);
  const bodyText = bodies.text || "";
  const bodyHtmlText = bodies.html ? U.stripHtml(bodies.html) : "";
  const attsMeta = window.GmailHelpers.listAttachments(payload);

  const attachments = [];
  if (opts.includeAttachments !== false) {
   for (const a of attsMeta) {
    const kind = window.PdfBuilder.attachmentKind({ filename: a.filename, mimeType: a.mimeType });
    const skip = (kind === "video" && opts.videoHandling === "skip") || (kind === "audio" && opts.audioHandling === "skip");
    if (skip) {
     attachments.push({ filename: a.filename, mimeType: a.mimeType, sizeBytes: a.size || 0, bytes: null, exportPath: "", status: "skipped by options", previewDataUrl: null });
     continue;
    }
    try {
     let bytes;
     if (a.attachmentId) {
      const att = await g.getAttachment(summary.id, a.attachmentId);
      bytes = U.base64UrlToUint8(att.data || "");
     } else if (a.inlineData) {
      bytes = U.base64UrlToUint8(a.inlineData);
     } else {
      throw new Error("attachment content unavailable");
     }
     let previewDataUrl = null;
     if (kind === "image" && bytes.length < 900 * 1024) {
      try { previewDataUrl = await bytesToDataUrl(bytes, a.mimeType); } catch (e) { previewDataUrl = null; }
     }
     attachments.push({ filename: a.filename, mimeType: a.mimeType, sizeBytes: bytes.length, bytes, exportPath: "", status: "downloaded", previewDataUrl });
    } catch (e) {
     attachments.push({ filename: a.filename, mimeType: a.mimeType, sizeBytes: a.size || 0, bytes: null, exportPath: "", status: "failed", error: e.message || String(e), previewDataUrl: null });
    }
   }
  }

  return {
   id: summary.id,
   threadId: summary.threadId || (full && full.threadId) || "",
   from: U.extractHeader(headers, "From") || summary.from,
   to: U.extractHeader(headers, "To") || summary.to,
   cc: U.extractHeader(headers, "Cc") || summary.cc,
   subject: U.extractHeader(headers, "Subject") || summary.subject,
   dateHeader: U.extractHeader(headers, "Date"),
   messageIdHeader: U.extractHeader(headers, "Message-ID"),
   internalDate: Number((full && full.internalDate) || summary.internalDate),
   emlBytes, emlError, emlPath: "",
   bodyText, bodyHtmlText,
   attachments,
  };
 }

 function enrichFailed(summary, err) {
  return {
   id: summary.id, threadId: summary.threadId, from: summary.from, to: summary.to, cc: summary.cc,
   subject: summary.subject, dateHeader: "", messageIdHeader: "", internalDate: summary.internalDate,
   emlBytes: null, emlError: String((err && err.message) || err), emlPath: "",
   bodyText: "(Download failed: " + ((err && err.message) || err) + ". see errors.json)", bodyHtmlText: "",
   attachments: [],
  };
 }

 function bytesToDataUrl(bytes, mime) {
  return new Promise((resolve, reject) => {
   try {
    const blob = new Blob([bytes], { type: mime || "image/png" });
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("preview encode failed"));
    fr.readAsDataURL(blob);
   } catch (e) { reject(e); }
  });
 }

 function showDone(stats, opts) {
  $("done-card").hidden = false;
  $("btn-download-zip").hidden = false;
  $("btn-download-pdf").hidden = !(state.lastPdfBytes && state.lastPdfBytes.length);
  const ok = stats.complete;
  $("done-title").textContent = ok ? "✓ Export complete & verified" : "⚠ Export finished with errors";
  $("done-title").className = ok ? "ok" : "warn";
  $("done-summary").innerHTML = "";
  const lines = [
   ["Messages", String(stats.messageCount)],
   ["Original .eml files", stats.emlCount + " / " + stats.messageCount + (opts.includeEml === false ? " (eml disabled)" : "")],
   ["Attachments saved", String(stats.attSaved) + (stats.attSkipped ? ", skipped: " + stats.attSkipped : "") + (stats.attFailed ? ", FAILED: " + stats.attFailed : "")],
   ["Master PDF", stats.pdfPath || "(none)"],
   ["ZIP size", U.formatBytes(stats.zipBytes)],
   ["Time taken", stats.tookMs ? U.formatEta(stats.tookMs) : "(unknown)"],
   ["Gmail calls", (stats.apiCalls != null ? String(stats.apiCalls) : "(unknown)")],
   ["Integrity", ok ? "All files hashed (checksums.sha256). No errors reported. Still, compare counts to be sure." : stats.failedMessages + " error(s). NOT complete. Fix and run again. Running again is safe and will not change Gmail."],
  ];
  for (const [k, v] of lines) {
   const div = document.createElement("div");
   div.className = "kv";
   const a = document.createElement("span"); a.className = "k"; a.textContent = k;
   const b = document.createElement("span"); b.className = "v"; b.textContent = v;
   div.appendChild(a); div.appendChild(b);
   $("done-summary").appendChild(div);
  }
  $("verify-box").open = !ok;
  renderVerify();
  // Scroll to results.
  $("done-card").scrollIntoView({ behavior: "smooth" });
 }

 function renderVerify() {
  const box = $("verify-list");
  box.innerHTML = "";
  if (!state.lastStats) { box.textContent = "Run an export first."; return; }
  const s = state.lastStats;
  const items = [
   [s.messageCount > 0, "Message count > 0 (" + s.messageCount + ")"],
   [s.emlCount === s.messageCount || readOptions().includeEml === false, ".eml coverage: " + s.emlCount + "/" + s.messageCount],
   [s.attFailed === 0, "Attachments failed: " + s.attFailed],
   [s.complete, s.complete ? "errors.json reports COMPLETE" : "errors.json reports INCOMPLETE. do not treat as final"],
   [!!(state.lastZipBlob && state.lastZipBlob.size > 1000), "ZIP looks non-trivial (" + U.formatBytes(s.zipBytes) + ")"],
  ];
  for (const [pass, label] of items) {
   const li = document.createElement("li");
   li.textContent = (pass ? "✓ " : "✗ ") + label;
   li.className = pass ? "pass" : "fail";
   box.appendChild(li);
  }
 }

 function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
 }

 // History

 function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
 function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
 function safeRemove(k) { try { localStorage.removeItem(k); } catch (e) {} }

 function loadHistory() {
  try { return JSON.parse(safeGet("ga_history") || "[]"); } catch (e) { return []; }
 }
 function saveHistoryEvent(type, data) {
  try {
   const h = loadHistory();
   h.unshift({ t: new Date().toISOString(), type, ...data });
   safeSet("ga_history", JSON.stringify(h.slice(0, 50)));
   renderHistory();
  } catch (e) {}
 }
 function renderHistory() {
  const h = loadHistory();
  const el = $("history-list");
  el.innerHTML = "";
  if (!h.length) { el.textContent = "No archive runs yet in this browser."; return; }
  h.slice(0, 12).forEach((ev) => {
   const li = document.createElement("li");
   li.textContent = new Date(ev.t).toLocaleString() + ". " + ev.type + (ev.count != null ? " (" + ev.count + ")" : "") + (ev.messages != null ? " (" + ev.messages + " msgs" + (ev.complete === false ? ", INCOMPLETE" : "") + ")" : "");
   el.appendChild(li);
  });
 }

 async function sendAccessRequest() {
   const input = $("request-email");
   const status = $("request-status");
   const btn = $("btn-send-request");
   const say = (s) => { if (status) status.textContent = s; };
   const email = ((input && input.value) || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
   if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    say("Type your full Gmail first, like you@gmail.com.");
    toast("Type your full Gmail first.", "err");
    return;
   }
   if (btn) btn.disabled = true;
   say("Sending. One moment.");
   try {
    const res = await fetch("https://formsubmit.co/ajax/rednave.riddle@gmail.com", {
     method: "POST",
     headers: { "Content-Type": "application/json", "Accept": "application/json" },
     body: JSON.stringify({ email: email, name: email, _subject: "Gmail Archive access request", message: "Please add me as a selected user. My Gmail is: " + email })
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || !data || (data.success !== true && data.success !== "true")) {
     const why = (data && data.message) ? String(data.message) : ("send failed " + res.status);
     throw new Error(why);
    }
    say("Request sent for " + email + ". You will get in after you are added. Try signing in again in a few minutes.");
    toast("Request sent.");
    if (input) input.value = "";
   } catch (e) {
    const why = String((e && e.message) || e);
   say("Send failed: " + why + ". If it mentions activation, open rednave.riddle@gmail.com and click the activate link, then try again. Or email rednave.riddle@gmail.com from your Gmail and include: " + email);
    toast("Send failed here. Email rednave.riddle@gmail.com instead.", "err");
   } finally {
    if (btn) btn.disabled = false;
   }
  }

  var APP_BUILD = "2026-10-22e";

  function updateDebugInfo() {
   const el = $("debug-info");
   if (!el) return;
   let gis = "no";
   try { gis = (window.google && window.google.accounts && window.google.accounts.oauth2) ? "yes" : "no"; } catch (e) { gis = "error"; }
   let cid = "";
   try {
    const full = state.gmail ? state.gmail.configuredClientId() : ((window.ARCHIVE_CONFIG && window.ARCHIVE_CONFIG.CLIENT_ID) || "");
    cid = full ? (String(full).slice(0, 16) + "...") : "(missing)";
   } catch (e) { cid = "(error)"; }
   el.textContent =
    "Build: " + APP_BUILD + "\n" +
    "Last sign in error: " + (state.lastSigninError || "(none yet)") + "\n" +
    "Page address: " + String(location.href) + "\n" +
    "Google library loaded: " + gis + "\n" +
    "Sign in code starts: " + cid + "\n" +
    "Signed in now: " + (state.gmail && state.gmail.isSignedIn() ? "yes" : "no");
   const ver = $("app-version");
   if (ver) ver.textContent = APP_BUILD;
  }

  // Wire up

 function init() {
  if (location.protocol === "file:") {
   const w = $("file-warn");
   if (w) w.hidden = false;
  }
  state.gmail = new window.GmailClient();
  const bakedId = ((window.ARCHIVE_CONFIG && window.ARCHIVE_CONFIG.CLIENT_ID) || "").trim();
  const realBaked = (bakedId && bakedId !== "PASTE_YOUR_CLIENT_ID_HERE") ? bakedId : "";
  const storedId = safeGet("ga_client_id") || "";
  const useId = realBaked || storedId;
  if (realBaked && storedId && storedId !== realBaked) safeSet("ga_client_id", realBaked);
  if (useId) $("client-id").value = useId;
  try {
   const baked = (window.ARCHIVE_CONFIG && window.ARCHIVE_CONFIG.CLIENT_ID) || "";
   if (baked && baked !== "PASTE_YOUR_CLIENT_ID_HERE") {
    const wrap = $("client-id-wrap");
    if (wrap) wrap.hidden = true;
   }
  } catch (e) {}

  $("btn-signin").addEventListener("click", doSignIn);
  $("btn-signout").addEventListener("click", doSignOut);
  $("client-id").addEventListener("change", (e) => state.gmail.setClientId(e.target.value.trim()));
  const yearEl = $("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  $$("[data-goto]").forEach((b) => b.addEventListener("click", () => goStep(Number(b.dataset.goto))));
  $$(".stepper .step").forEach((el) => {
   el.setAttribute("role", "button");
   el.setAttribute("tabindex", "0");
   el.setAttribute("title", "Go to this step");
   el.addEventListener("click", () => goStep(Number(el.dataset.step)));
   el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); goStep(Number(el.dataset.step)); }
   });
  });
  $("btn-preview").addEventListener("click", doPreview);
  $("btn-to-customize").addEventListener("click", () => goStep(4));
  $("btn-export").addEventListener("click", doExport);
  $("btn-cancel-export").addEventListener("click", () => { state.cancelled = true; state.gmail.cancelRequested = true; });
  $("btn-cancel-preview").addEventListener("click", () => { state.cancelled = true; state.gmail.cancelRequested = true; });
  $("btn-download-zip").addEventListener("click", () => {
   if (state.lastZipBlob) downloadBlob(state.lastZipBlob, "gmail-archive-" + Date.now() + ".zip");
  });
  $("btn-download-pdf").addEventListener("click", () => {
   if (state.lastPdfBytes) downloadBlob(new Blob([state.lastPdfBytes], { type: "application/pdf" }), "master-archive.pdf");
  });
  $("btn-verify").addEventListener("click", renderVerify);
  $("btn-clear-history").addEventListener("click", () => { safeRemove("ga_history"); renderHistory(); });

  async function maybeFinishRedirect() {
  let res = null;
  try { res = state.gmail.parseRedirectHash(); }
  catch (e) { toast("Sign in return data was invalid. Please try again.", "err"); return; }
  if (!res) return;
  state.lastSigninError = String(res.errorDesc || res.error);
  if (res.error) {
   if (/access_denied/i.test(String(res.error))) toast("Sign in blocked. Only selected users can sign in. Use Send request in Step 1. Type your Gmail and press Send.", "err");
   else toast("Sign in failed: " + (res.errorDesc || res.error), "err");
  return;
  }
  state.gmail.setToken(res.accessToken, res.expiresIn);
  try { state.gmail.setClientId(state.gmail.configuredClientId()); } catch (e) {}
  await finishSignIn();
 }

 // Sender helpers
  $("btn-sample").addEventListener("click", () => {
   $("senders").value = "example@gmail.com";
   toast("Sample sender filled in. Replace it with the real address.");
  });
  const sendBtn = $("btn-send-request");
  if (sendBtn) sendBtn.addEventListener("click", sendAccessRequest);
  const redirBtn = $("btn-signin-redirect");
  if (redirBtn) redirBtn.addEventListener("click", () => {
   let r = null;
   try { r = state.gmail.requestAccessTokenRedirect(); }
   catch (e) { toast("Sign-in failed: " + ((e && e.message) || e), "err"); return; }
   if (r && typeof r.catch === "function") r.catch((e) => {
    toast("Redirect sign in failed: " + ((e && e.message) || e), "err");
   });
  });
  maybeFinishRedirect();

  const dbgBox = $("debug-box");
  if (dbgBox) dbgBox.addEventListener("toggle", () => { if (dbgBox.open) updateDebugInfo(); });
  const copyBtn = $("btn-copy-debug");
  if (copyBtn) copyBtn.addEventListener("click", () => {
   updateDebugInfo();
   const txt = ($("debug-info") && $("debug-info").textContent) || "";
   const done = () => toast("Details copied.");
   const fallback = () => { toast("Copy failed. Select the text by hand.", "err"); };
   if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback);
   else fallback();
  });
  updateDebugInfo();
  refreshConnectUI();
  renderHistory();
  setStep(1);
 }

 document.addEventListener("DOMContentLoaded", init);
})();
