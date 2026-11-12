import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCitations, claimCounts } from "../lib/citations.js";

test("splits evidence ids (incl. lists), claim tags and passage refs; keeps surrounding text", () => {
  const t = splitCitations("TAM is €1bn [E1, E3] per [Web2]. [UNVERIFIED] Deck says €6bn [Doc1]");
  assert.deepEqual(t, [
    { type: "text", value: "TAM is €1bn " },
    { type: "evidence", id: "E1" }, { type: "evidence", id: "E3" },
    { type: "text", value: " per " }, { type: "passage", ref: "Web2" },
    { type: "text", value: ". " }, { type: "claim", kind: "UNVERIFIED" },
    { type: "text", value: " Deck says €6bn " }, { type: "passage", ref: "Doc1" },
  ]);
});

test("leaves ordinary brackets alone and counts claim tags", () => {
  assert.deepEqual(splitCitations("see [note] and [1]"), [{ type: "text", value: "see [note] and [1]" }]);
  assert.deepEqual(claimCounts("[VERIFIED] a [VERIFIED] b [CONTRADICTED] c"), { VERIFIED: 2, UNVERIFIED: 0, CONTRADICTED: 1 });
  assert.deepEqual(claimCounts(null), { VERIFIED: 0, UNVERIFIED: 0, CONTRADICTED: 0 });
});
