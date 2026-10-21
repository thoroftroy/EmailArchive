/* Archive assembly: ZIP + CSV + logs + checksums. Browser only (needs JSZip). */
(function (global) {
 "use strict";

 function stampDate(d) {
  d = d || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + String(p(d.getMonth() + 1)) + String(p(d.getDate())) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
 }

 async function sha256Hex(bytes) {
  if (global.crypto && global.crypto.subtle) {
   const h = await global.crypto.subtle.digest("SHA-256", bytes);
   return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("WebCrypto SHA-256 unavailable (need secure context: https or localhost).");
 }

 function needJSZip() {
  if (!global.JSZip) throw new Error("ZIP library failed to load (JSZip CDN blocked?). Disable ad-block for cdnjs and reload.");
  return new global.JSZip();
 }

 // messages: enriched objects from app.js:
 // {id, threadId, messageIdHeader, from, to, cc, subject, dateHeader, internalDate,
 // emlBytes (Uint8Array|null), emlPath, bodyText, bodyHtmlText,
 // attachments: [{filename, mimeType, sizeBytes, bytes (Uint8Array|null), exportPath, status, error}]}
 async function assembleArchive(args) {
  const U = global.ArchiveUtils;
  const messages = args.messages || [];
  const opts = args.options || {};
  const query = args.query || "";
  const queryHuman = args.queryHuman || query;
  const pdfBytes = args.pdfBytes || null; // Uint8Array
  const onProgress = args.onProgress || (() => {});
  const shouldCancel = args.shouldCancel || (() => false);

  const zip = needJSZip();
  const root = "gmail-archive-" + stampDate() + "/";
  const usedNames = new Set();
  const records = []; // CSV rows
  const errors = [];
  const logLines = [];
  const checksums = []; // {path, sha256, bytes}
  const t0 = Date.now();

  function log(s) { logLines.push("[" + new Date().toISOString() + "] " + s); }
  function checkCancel() { if (shouldCancel()) throw new Error("CANCELLED"); }

  log("Gmail Archive export started");
  log("Query (Gmail syntax): " + query);
  log("Query (human): " + queryHuman);
  log("Messages to export: " + messages.length);
  log("Options: " + JSON.stringify({ includeEml: opts.includeEml, includeAttachments: opts.includeAttachments, videoHandling: opts.videoHandling, audioHandling: opts.audioHandling, pdfImagePreviews: opts.pdfImagePreviews }));

  async function addFile(relPath, bytes, kind) {
   checkCancel();
   // Ensure unique path inside zip.
   let p = relPath;
   if (usedNames.has(root + p)) {
    const dot = p.lastIndexOf(".");
    const base = dot >= 0 ? p.slice(0, dot) : p;
    const ext = dot >= 0 ? p.slice(dot) : "";
    let i = 2;
    while (usedNames.has(root + base + "_" + i + ext)) i++;
    p = base + "_" + i + ext;
   }
   usedNames.add(root + p);
   zip.file(root + p, bytes);
   let hex = "";
   try { hex = await sha256Hex(bytes); } catch (e) { hex = "UNAVAILABLE:" + e.message; }
   checksums.push({ path: p, sha256: hex, size: bytes.length, kind: kind || "" });
   onProgress({ stage: "zip", file: p });
   return p;
  }

  // 1) .eml files
  let emlCount = 0;
  for (let i = 0; i < messages.length; i++) {
   checkCancel();
   const m = messages[i];
   onProgress({ stage: "eml", done: i + 1, total: messages.length });
   const senderFolder = U.sanitizeFolder(U.senderKey(m.from) || "unknown-sender");
   const threadFolder = U.sanitizeFolder(U.truncate((m.subject || "no-subject") + "-" + (m.threadId || "").slice(-6), 70));
   const datePart = (() => { try { return new Date(Number(m.internalDate)).toISOString().slice(0, 10); } catch (e) { return "unknown-date"; } })();
   const baseName = U.sanitizeFilename(String(i + 1).padStart(3, "0") + "-" + datePart + "-" + U.truncate(m.subject || "no-subject", 60) + ".eml");
   const relDir = "emails/" + senderFolder + "/" + threadFolder + "/";
   if (opts.includeEml !== false && m.emlBytes && m.emlBytes.length) {
    const saved = await addFile(relDir + baseName, m.emlBytes, "eml");
    m.emlPath = saved;
    emlCount++;
   } else {
    m.emlPath = "";
    if (opts.includeEml !== false) {
     errors.push({ messageId: m.id, file: relDir + baseName, error: m.emlError || "Original MIME unavailable for this message" });
     log("WARN no .eml for message " + m.id + ": " + (m.emlError || "unavailable"));
    }
   }
   await new Promise((r) => setTimeout(r, 0));
  }

  // 2) Attachments (originals). Video/audio honour skip/include choice.
  let attSaved = 0, attSkipped = 0, attFailed = 0;
  const wantAtt = (a) => {
   if (opts.includeAttachments === false) return { save: false, reason: "attachments disabled in options" };
   const kind = global.PdfBuilder.attachmentKind(a);
   if (kind === "video" && opts.videoHandling === "skip") return { save: false, reason: "video skipped per options" };
   if (kind === "audio" && opts.audioHandling === "skip") return { save: false, reason: "audio skipped per options" };
   return { save: true };
  };
  for (const m of messages) {
   checkCancel();
   const senderFolder = U.sanitizeFolder(U.senderKey(m.from) || "unknown-sender");
   for (const a of (m.attachments || [])) {
    const decision = wantAtt(a);
    if (!decision.save) {
     a.exportPath = "";
     a.status = "skipped: " + decision.reason;
     attSkipped++;
     continue;
    }
    if (!a.bytes || !a.bytes.length) {
     a.exportPath = "";
     a.status = "failed: " + (a.error || "download failed");
     attFailed++;
     errors.push({ messageId: m.id, file: a.filename, error: a.error || "attachment bytes missing" });
     continue;
    }
    const safeName = U.sanitizeFilename(a.filename || "attachment.bin");
    const rel = "attachments/" + senderFolder + "/" + safeName;
    try {
     const saved = await addFile(rel, a.bytes, "attachment");
     a.exportPath = saved;
     a.status = "saved";
     attSaved++;
    } catch (e) {
     a.exportPath = "";
     a.status = "failed: " + e.message;
     attFailed++;
     errors.push({ messageId: m.id, file: a.filename, error: String(e.message || e) });
    }
   }
  }

  // 3) Master PDF (built by caller; just store it).
  let pdfPath = "";
  if (pdfBytes && pdfBytes.length) {
   pdfPath = await addFile("master-archive.pdf", pdfBytes, "pdf");
  }

  // 4) manifest.csv
  const csvHeaders = ["#", "message_id", "thread_id", "from", "to", "cc", "date", "subject", "eml_file", "attachments", "status"];
  const csvRows = messages.map((m, i) => {
   const attSummary = (m.attachments || []).map((a) => (a.filename || "?") + " [" + (a.status || "?") + (a.exportPath ? " -> " + a.exportPath : "") + "]").join(" | ");
   const emlMissing = (!m.emlPath && opts.includeEml !== false);
   const anyAttFailed = (m.attachments || []).some((a) => String(a.status || "").indexOf("failed") === 0);
   const status = (emlMissing || anyAttFailed) ? "partial" : "ok";
   return [String(i + 1), m.id, m.threadId || "", m.from || "", m.to || "", m.cc || "", (() => { try { return new Date(Number(m.internalDate)).toISOString(); } catch (e) { return ""; } })(), m.subject || "", m.emlPath || "", attSummary, status];
  });
  const csvText = U.buildCsv(csvHeaders, csvRows);
  const csvPath = await addFile("manifest.csv", new TextEncoder().encode(csvText), "manifest");

  // 5) export.log + errors.json + README
  const failedMessages = errors.length;
  const complete = failedMessages === 0;
  log("EML files: " + emlCount + "/" + messages.length);
  log("Attachments saved=" + attSaved + " skipped=" + attSkipped + " failed=" + attFailed);
  log("Master PDF: " + (pdfPath || "(none)"));
  log("Manifest: " + csvPath + " (" + messages.length + " rows)");
  log("Errors: " + failedMessages + (complete ? ". COMPLETE" : ". INCOMPLETE, see errors.json"));
  log("Finished in " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  log("");
  log("INTEGRITY NOTE: checksums.sha256 lists SHA-256 for every file in this ZIP.");
  log("Checksums detect accidental changes/corruption. They do not independently prove");
  log("authenticity or completeness. compare manifest.csv row count to your preview count.");
  log("PDF is a reading copy; .eml files are the originals.");
  const logText = logLines.join("\n") + "\n";
  await addFile("export.log", new TextEncoder().encode(logText), "log");
  const errorsText = JSON.stringify({ complete, query, queryHuman, exportedAt: new Date().toISOString(), messageCount: messages.length, attachmentStats: { saved: attSaved, skipped: attSkipped, failed: attFailed }, errors }, null, 2);
  await addFile("errors.json", new TextEncoder().encode(errorsText), "log");
  const readmeText = "Gmail Archive. how to use these files\n========================================\n\n- master-archive.pdf: read everything in one document. Video/audio are listed, not embedded.\n- emails/: original .eml per message. Open with Thunderbird / Apple Mail / Outlook.\n- attachments/: original attachment files (unless you chose to skip a type).\n- manifest.csv: spreadsheet of every message + where its files are.\n- checksums.sha256: SHA-256 hashes. Verify with: sha256sum -c checksums.sha256\n- export.log / errors.json: what happened during export.\n\nAll processing happened locally in your browser. Nothing was uploaded.\n";
  await addFile("README.txt", new TextEncoder().encode(readmeText), "doc");

  // 6) checksums.sha256 (classic `sha256sum` format: "<hex> <path>")
  // Computed over every file added so far (excluding itself), then appended last.
  const checksumLines = checksums.map((c) => c.sha256 + " " + c.path);
  const checksumText = checksumLines.join("\n") + "\n";
  {
   const bytes = new TextEncoder().encode(checksumText);
   const p = "checksums.sha256";
   usedNames.add(root + p);
   zip.file(root + p, bytes);
  }

  onProgress({ stage: "zip-done" });
  const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (meta) => {
   onProgress({ stage: "compress", percent: meta.percent });
  });

  const stats = {
   root, emlCount, attSaved, attSkipped, attFailed,
   messageCount: messages.length, pdfPath, csvPath,
   complete, failedMessages, zipBytes: zipBlob.size,
  };
  return { zipBlob, csvText, logText, errorsText, checksumText, stats };
 }

 global.ExportBuilder = { assembleArchive, sha256Hex };
})(window);
