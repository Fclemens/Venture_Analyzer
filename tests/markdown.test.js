import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMarkdown } from "../lib/markdown.js";

test("never merges a heading with the paragraph under it (regression)", () => {
  assert.equal(normalizeMarkdown("## Key insight\nThe market is smaller."), "## Key insight\nThe market is smaller.");
});

test("joins soft-wrapped paragraph lines but keeps lists, tables, quotes and fences intact", () => {
  assert.equal(normalizeMarkdown("one\ntwo\n\n\n\nthree"), "one two\n\nthree");
  assert.equal(normalizeMarkdown("- a\n- b"), "- a\n- b");
  assert.equal(normalizeMarkdown("| x | y |\n|---|---|\n| 1 | 2 |"), "| x | y |\n|---|---|\n| 1 | 2 |");
  assert.equal(normalizeMarkdown("> quote\ntext"), "> quote\ntext");
  assert.equal(normalizeMarkdown("```\ncode a\ncode b\n```"), "```\ncode a\ncode b\n```");
  assert.equal(normalizeMarkdown("1. first\n2. second"), "1. first\n2. second");
  assert.equal(normalizeMarkdown(null), "");
});
