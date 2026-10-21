/* Master PDF builder using jsPDF (UMD). Browser only. */
(function (global) {
  "use strict";

  function getJsPDF() {
    const ns = global.jspdf || global.window.jspdf;
    if (ns && ns.jsPDF) return ns.jsPDF;
    throw new Error("PDF library failed to load (jsPDF CDN blocked?). Disable ad-block for cdnjs and reload.");
  }

  function isImageMime(m) { return /^image\/(png|jpe?g|gif|webp)$/i.test(m || ""); }
  function isVideoMime(m) { return /^video\//i.test(m || "") || /\.(mp4|mov|webm|mkv|avi)$/i.test(m || ""); }
  function isAudioMime(m) { return /^audio\//i.test(m || "") || /\.(mp3|wav|m4a|ogg|flac)$/i.test(m || ""); }

  function attachmentKind(att) {
    const mime = att.mimeType || "";
    const name = att.filename || "";
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (isImageMime(mime)) return "image";
    if (isVideoMime(mime) || ["mp4", "mov", "webm", "mkv", "avi"].includes(ext)) return "video";
    if (isAudioMime(mime) || ["mp3", "wav", "m4a", "ogg", "flac"].includes(ext)) return "audio";
    return "file";
  }

  // Build a single massive readable PDF. Returns {bytes: Uint8Array, pageCount}.
  async function buildMasterPdf(enrichedMessages, opts, onProgress) {
    opts = opts || {};
    onProgress = onProgress || (() => {});
    const JsPDF = getJsPDF();
    const U = global.ArchiveUtils;

    const doc = new JsPDF({ unit: "pt", format: "a4", compress: true });
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const M = 48;
    const MAXW = PW - M * 2;
    let y = 0;
    let pageCount = 1;

    function newPage() {
      doc.addPage();
      pageCount++;
      y = M;
      drawFooter();
    }
    function drawFooter() {
      const n = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(130);
      doc.text("Gmail Archive — page " + n + " — generated locally, verify with checksums.sha256", M, PH - 22);
      doc.setTextColor(0);
    }
    function ensureSpace(need) {
      if (y + need > PH - 60) newPage();
    }
    function heading(text, size, gap) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(String(text), MAXW);
      ensureSpace(lines.length * (size + 3) + (gap || 6));
      doc.text(lines, M, y);
      y += lines.length * (size + 3) + (gap || 6);
      doc.setFont("helvetica", "normal");
    }
    function bodyText(text, size) {
      size = size || 10;
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(String(text || ""), MAXW);
      const lh = size + 3.5;
      let i = 0;
      while (i < lines.length) {
        const room = Math.floor((PH - 60 - y) / lh);
        if (room <= 0) { newPage(); continue; }
        const chunk = lines.slice(i, i + room);
        doc.text(chunk, M, y);
        y += chunk.length * lh + 4;
        i += chunk.length;
      }
    }
    function metaRow(k, v) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      const kl = doc.splitTextToSize(k + ":", 120);
      doc.setFont("helvetica", "normal");
      const vl = doc.splitTextToSize(String(v == null ? "" : v), MAXW - 130);
      const h = Math.max(kl.length, vl.length) * 12.5;
      ensureSpace(h + 2);
      doc.text(kl, M, y);
      doc.text(vl, M + 130, y);
      y += h + 2;
    }
    function divider() {
      ensureSpace(14);
      doc.setDrawColor(200);
      doc.line(M, y, PW - M, y);
      y += 10;
    }

    // ---- Cover ----
    y = M;
    drawFooter();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.text(doc.splitTextToSize(opts.title || "Gmail Archive", MAXW), M, y);
    y += 44;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const coverLines = [
      "Exported: " + new Date().toLocaleString(),
      "Query: " + (opts.queryHuman || opts.query || "(all)"),
      "Messages: " + enrichedMessages.length,
      "",
      "This PDF is a convenient READING COPY. The authoritative originals are the",
      ".eml files in this archive (plus original attachments). Use checksums.sha256",
      "to detect accidental changes. Checksums detect changes; they do not by",
      "themselves prove authenticity or completeness — see export.log + manifest.csv.",
      "",
      "Video/audio attachments are NOT embedded in this PDF. They are listed where",
      "they occurred and saved separately in the ZIP (unless you chose to skip them).",
    ];
    doc.text(coverLines, M, y);
    y += coverLines.length * 14 + 18;

    heading("How date filtering worked", 14);
    bodyText(
      "Gmail search used: " + (opts.query || "(none)") + "\n" +
      "Start date is INCLUSIVE from 00:00 UTC. End date is INCLUSIVE through 23:59:59 UTC " +
      "(implemented as Gmail before:<end+1 day> plus a client-side check on each message's internal date). " +
      "When a message matched, its ENTIRE conversation thread was included (all replies from everyone), " +
      "so context stays complete. Messages are ordered oldest → newest.",
      10
    );
    divider();

    // ---- Contents ----
    heading("Contents (" + enrichedMessages.length + " messages)", 14);
    enrichedMessages.forEach((m, i) => {
      const line = (i + 1) + ". [" + U.formatDateTime(m.internalDate) + "] " + (m.subject || "(no subject)") + " — " + (m.from || "?");
      bodyText(U.truncate(line, 220), 9.5);
      if ((i + 1) % 40 === 0) onProgress({ stage: "pdf-toc", done: i + 1, total: enrichedMessages.length });
    });
    divider();

    // ---- Messages ----
    for (let idx = 0; idx < enrichedMessages.length; idx++) {
      const m = enrichedMessages[idx];
      onProgress({ stage: "pdf", done: idx + 1, total: enrichedMessages.length });
      if (idx > 0) { newPage(); }
      else { ensureSpace(40); }
      heading("Message " + (idx + 1) + " of " + enrichedMessages.length, 15);
      heading(m.subject || "(no subject)", 12);
      metaRow("From", m.from || "");
      metaRow("To", m.to || "");
      if (m.cc) metaRow("Cc", m.cc);
      metaRow("Date", U.formatDateTime(m.internalDate) + (m.dateHeader ? "  (" + m.dateHeader + ")" : ""));
      metaRow("Message-ID", m.messageId || m.id);
      metaRow("Thread-ID", m.threadId || "");
      metaRow("Original file", m.emlPath || "(eml not included — see options)");
      divider();
      const body = (m.bodyText && m.bodyText.trim()) ? m.bodyText : (m.bodyHtmlText || "(No readable text body — see original .eml)");
      bodyText(body.slice(0, 60000), 10);
      if (body.length > 60000) bodyText("\n[… body truncated in PDF at 60,000 chars — full body is in the .eml …]", 9);

      const atts = m.attachments || [];
      if (atts.length) {
        divider();
        heading("Attachments (" + atts.length + ")", 12);
        for (const a of atts) {
          const kind = attachmentKind(a);
          const where = a.exportPath || "(not saved — skipped by your options)";
          const line = "• " + (a.filename || "unnamed") + "  [" + (a.mimeType || "?") + ", " + U.formatBytes(a.sizeBytes) + "] → " + where;
          if (kind === "image" && opts.pdfImagePreviews !== false && a.previewDataUrl) {
            bodyText(line, 9.5);
            try {
              ensureSpace(170);
              const fmt = /png/i.test(a.mimeType || "") ? "PNG" : "JPEG";
              doc.addImage(a.previewDataUrl, fmt, M, y, 220, 150, undefined, "FAST");
              y += 158;
            } catch (e) {
              bodyText("[image preview unavailable: " + (e && e.message) + "]", 9);
            }
          } else if (kind === "video") {
            ensureSpace(64);
            doc.setFillColor(240, 244, 255);
            doc.roundedRect(M, y, MAXW, 52, 4, 4, "F");
            bodyText("▶ VIDEO attachment (not playable in PDF): " + (a.filename || "unnamed") + " (" + U.formatBytes(a.sizeBytes) + ")", 10);
            y += 2;
            bodyText("Saved separately: " + where + (opts.videoHandling === "skip" ? "  [you chose SKIP — file not in ZIP]" : ""), 9);
            y += 8;
          } else if (kind === "audio") {
            ensureSpace(64);
            doc.setFillColor(240, 255, 244);
            doc.roundedRect(M, y, MAXW, 52, 4, 4, "F");
            bodyText("♪ AUDIO attachment (not playable in PDF): " + (a.filename || "unnamed") + " (" + U.formatBytes(a.sizeBytes) + ")", 10);
            y += 2;
            bodyText("Saved separately: " + where + (opts.audioHandling === "skip" ? "  [you chose SKIP — file not in ZIP]" : ""), 9);
            y += 8;
          } else {
            bodyText(line, 9.5);
          }
        }
      }
      // Allow cooperative cancellation between messages.
      await new Promise((r) => setTimeout(r, 0));
      if (opts.shouldCancel && opts.shouldCancel()) throw new Error("CANCELLED");
    }

    const totalPages = doc.internal.getNumberOfPages();
    const out = doc.output("arraybuffer");
    return { bytes: new Uint8Array(out), pageCount: totalPages };
  }

  global.PdfBuilder = { buildMasterPdf, attachmentKind };
})(window);
