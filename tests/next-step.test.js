import { test } from "node:test";
import assert from "node:assert/strict";
import { nextStep, pipelineProgress } from "../lib/next-step.js";

const M = (id, pass, decision = "run") => ({ id, name: id.toUpperCase(), pass, decision });
const methods = [M("a", "p1"), M("b", "p2"), M("c", "p3"), M("s", "p4", "skip")];

test("progress counts ignore skipped methods", () => {
  assert.deepEqual(pipelineProgress(methods, { a: "done", b: "review", c: "extracting", s: "error" }),
    { total: 3, done: 1, review: 1, running: 1, error: 0, extracted: 0, notStarted: 0 });
});

test("priority: setup → errors → review → run remaining → wait → report → regenerate → open", () => {
  assert.equal(nextStep({ hasP0: false }).kind, "setup");
  assert.deepEqual(
    (({ kind, methodId, pass }) => ({ kind, methodId, pass }))(nextStep({ methods, status: { a: "review", b: "error" } })),
    { kind: "fix", methodId: "b", pass: "p2" }, "failures come first");
  assert.equal(nextStep({ methods, status: { a: "review", b: "done" } }).kind, "review");
  const run = nextStep({ methods, status: { a: "done", b: "extracted", c: "executing" } });
  assert.equal(run.kind, "runAll");
  assert.match(run.label, /Run 1 remaining analysis$/);
  assert.match(run.detail, /1 already running/);
  assert.equal(nextStep({ methods, status: { a: "done", b: "done", c: "executing" } }).kind, "wait");
  const all = { a: "done", b: "done", c: "done" };
  assert.equal(nextStep({ methods, status: all, report: { generating: true } }).kind, "wait");
  assert.equal(nextStep({ methods, status: all, report: {} }).label, "Generate the report");
  assert.equal(nextStep({ methods, status: all, report: { exists: true, stale: true } }).label, "Regenerate the report");
  assert.equal(nextStep({ methods, status: all, report: { exists: true } }).kind, "share");
});
