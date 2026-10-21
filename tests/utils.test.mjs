import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const U = require("../js/utils.js");

describe("sanitizeFilename", () => {
  it("strips illegal chars", () => {
    assert.equal(U.sanitizeFilename('a<b>c:d"e/f\\g|h?i*j'), "a_b_c_d_e_f_g_h_i_j");
  });
  it("handles empty", () => {
    assert.equal(U.sanitizeFilename(""), "unnamed");
  });
  it("truncates long names preserving extension", () => {
    const long = "a".repeat(200) + ".pdf";
    const out = U.sanitizeFilename(long, 50);
    assert.ok(out.length <= 50);
    assert.ok(out.endsWith(".pdf"));
  });
});

describe("buildGmailQuery", () => {
  it("single sender + inclusive dates", () => {
    const q = U.buildGmailQuery({ senders: ["a@x.com"], startDate: "2024-01-05", endDate: "2024-02-10" });
    assert.equal(q, "from:a@x.com after:2024/01/05 before:2024/02/11");
  });
  it("multiple senders OR-ed", () => {
    const q = U.buildGmailQuery({ senders: ["a@x.com", "b@y.org"] });
    assert.equal(q, "from:(a@x.com OR b@y.org)");
  });
  it("empty is empty", () => {
    assert.equal(U.buildGmailQuery({}), "");
  });
});

describe("isDateInRange (inclusive)", () => {
  it("start inclusive, end inclusive", () => {
    const day = Date.parse("2024-03-05T12:00:00Z");
    assert.equal(U.isDateInRange(day, "2024-03-05", "2024-03-05"), true);
    assert.equal(U.isDateInRange(Date.parse("2024-03-04T23:59:59Z"), "2024-03-05", "2024-03-06"), false);
    assert.equal(U.isDateInRange(Date.parse("2024-03-06T00:00:00Z"), "2024-03-05", "2024-03-05"), false);
  });
});

describe("csv", () => {
  it("escapes commas/quotes/newlines", () => {
    assert.equal(U.csvEscape('a,"b\nc'), '"a,""b\nc"');
    const csv = U.buildCsv(["a", "b"], [[1, "x,y"], [2, "z"]]);
    assert.ok(csv.includes('"x,y"'));
  });
});

describe("base64Url", () => {
  it("round-trips hello", () => {
    const bytes = U.base64UrlToUint8("aGVsbG8");
    assert.equal(U.uint8ToStringUtf8(bytes), "hello");
  });
});

describe("stripHtml", () => {
  it("converts breaks and strips tags", () => {
    const out = U.stripHtml("<p>Hi</p><br>bye<script>evil()</script>");
    assert.ok(out.includes("Hi"));
    assert.ok(out.includes("bye"));
    assert.ok(!out.includes("evil"));
  });
});

describe("getNextAvailableName", () => {
  it("dedupes", () => {
    const used = new Set();
    assert.equal(U.getNextAvailableName(used, "a.pdf"), "a.pdf");
    assert.equal(U.getNextAvailableName(used, "a.pdf"), "a_2.pdf");
    assert.equal(U.getNextAvailableName(used, "a.pdf"), "a_3.pdf");
  });
});

describe("senderKey", () => {
  it("extracts email from display name", () => {
    assert.equal(U.senderKey("Bob <bob@x.com>"), "bob@x.com");
    assert.equal(U.senderKey("carol@y.org"), "carol@y.org");
  });
});
