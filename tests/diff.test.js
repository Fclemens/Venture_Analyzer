import { test } from "node:test";
import assert from "node:assert/strict";
import { lineDiff, diffStats } from "../lib/diff.js";

test("lineDiff marks added, removed and unchanged lines in order", () => {
  const d = lineDiff("a\nb\nc\nd", "a\nB\nc\nd\ne");
  assert.deepEqual(d.map(x => x.type + ":" + x.text), ["same:a", "del:b", "add:B", "same:c", "same:d", "add:e"]);
  assert.deepEqual(diffStats(d), { added: 2, removed: 1 });
});

test("lineDiff handles empty and identical input and CRLF", () => {
  assert.deepEqual(lineDiff("", "x").map(x => x.type), ["del", "add"].slice(1).length ? ["del", "add"] : []);
  assert.deepEqual(lineDiff("same\r\nlines", "same\nlines").every(x => x.type === "same"), true);
});

test("lineDiff falls back for huge inputs instead of blowing memory", () => {
  const big = Array.from({ length: 2000 }, (_, i) => "l" + i).join("\n");
  const d = lineDiff(big, big + "\nx");
  assert.equal(d.length, 2000 + 2001);
});

import { staleDependents } from "../lib/staleness.js";
import { DEPENDENCIES } from "../lib/constants.js";

test("staleDependents flags analyses older than a changed upstream pass; ignores skipped and same-pass methods", () => {
  const methods = [
    { id: "tam", name: "Top-down TAM", pass: "p2", decision: "run" },
    { id: "tam2", name: "Bottom-up", pass: "p2", decision: "run" },
    { id: "comp", name: "Competitors", pass: "p3", decision: "run" },
    { id: "skipped", name: "Skipped", pass: "p3", decision: "skip" },
    { id: "wtp", name: "WTP", pass: "p4", decision: "run" },
  ];
  // p4 (WTP) was written at t=100; p2 TAM was revised afterwards at t=500
  const times = { tam: 500, tam2: 50, comp: 90, skipped: 9999, wtp: 100 };
  const stale = staleDependents({ methods, resultTimes: times, dependencies: DEPENDENCIES });
  assert.deepEqual(stale.wtp, ["Top-down TAM"]);
  assert.equal(stale.tam, undefined, "p2 depends on p0/p1, not on itself");
  assert.equal(stale.tam2, undefined, "same-pass changes don't make a method stale");
  assert.equal(stale.skipped, undefined);
  assert.equal(stale.comp, undefined, "p3 depends on p0,p1 only");
});
