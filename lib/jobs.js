// In-process durable job runner.
//
// Jobs are rows in the `jobs` table, so work survives page reloads, closed
// tabs and server restarts (jobs that were running are re-queued on start).
// A small pool runs independent methods in parallel, with a per-user cap so one
// user cannot starve the rest or trip provider rate limits.
//
// Scaling note: this runs inside the Next.js server process, so it needs a
// long-lived Node host (not serverless). The queue is already in the database,
// so moving execution to a separate worker process or a managed workflow
// service only means replacing `pump()`.

import {
  claimNextJob, finishJob, requeueRunningJobs, saveRun, getRun,
  enqueueJob, activeJob,
} from "./runs.js";

const JOB_TIMEOUT_MS = 15 * 60_000;

// Survives dev hot-reloads, which re-evaluate this module
const g = globalThis;
const state = (g.__ventureJobs ??= {
  started: false, active: 0, timer: null, handlers: null,
  concurrency: Number(process.env.PIPELINE_CONCURRENCY) || 3,
  perUserCap: Number(process.env.PIPELINE_PER_USER) || 2,
  idle: [],
});

// Tests inject fake handlers; production lazily loads the real ones
export function configureWorker({ handlers, concurrency, perUserCap } = {}) {
  if (handlers !== undefined) state.handlers = handlers;
  if (concurrency) state.concurrency = concurrency;
  if (perUserCap) state.perUserCap = perUserCap;
}

async function getHandlers() {
  if (!state.handlers) state.handlers = (await import("./job-handlers.js")).handlers;
  return state.handlers;
}

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error("Job timed out")), ms).unref?.()),
]);

async function runJob(job) {
  try {
    const handlers = await getHandlers();
    const handler = handlers[job.action];
    if (!handler) throw new Error(`Unknown job action: ${job.action}`);
    await withTimeout(handler(job), JOB_TIMEOUT_MS);
    finishJob(job.id);
  } catch (err) {
    console.error(`[jobs] ${job.action} ${job.method_id} failed:`, err.message);
    finishJob(job.id, err.message);
    // Keep prior evidence/result so the user can retry or keep the old draft
    // Project-level jobs (e.g. the report) use "__name__" ids and have no method run
    if (!job.method_id.startsWith("__")) saveRun(job.project_id, job.method_id, { status: "error", error: err.message });
  }
}

function pump() {
  while (state.active < state.concurrency) {
    const job = claimNextJob({ perUserCap: state.perUserCap });
    if (!job) break;
    state.active++;
    runJob(job).finally(() => {
      state.active--;
      pump();
      if (state.active === 0) { const waiters = state.idle.splice(0); waiters.forEach(r => r()); }
    });
  }
}

// Idempotent: safe to call from instrumentation, routes and tests
export function ensureWorker() {
  if (!state.started) {
    state.started = true;
    requeueRunningJobs(); // anything "running" belonged to a process that is gone
    state.timer = setInterval(pump, 5000); // picks up jobs freed by per-user caps
    state.timer.unref?.();
  }
  pump();
}

export function stopWorker() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.started = false;
}

// Resolves when nothing is running and nothing is claimable (used by tests)
export function whenIdle() {
  return new Promise(resolve => {
    const check = () => (state.active === 0 ? resolve() : state.idle.push(check));
    pump();
    check();
  });
}

// Queue work for a method and mark its run as in progress.
// Throws if the method already has work queued or running.
export function submitJob({ projectId, userId, methodId, action, payload }) {
  if (activeJob(projectId, methodId)) {
    const e = new Error("This method is already running."); e.status = 409; throw e;
  }
  const run = getRun(projectId, methodId, { full: false });
  saveRun(projectId, methodId, { status: action === "extract" ? "extracting" : "executing", error: null });
  enqueueJob({ projectId, userId, methodId, action, payload });
  ensureWorker();
  return run;
}

// Project-level jobs (not tied to one method) use "__name__" ids
export const REPORT_JOB = "__report__";
export const REINDEX_JOB = "__reindex__";

export function submitProjectJob({ projectId, userId, jobId, action, busyMessage }) {
  if (activeJob(projectId, jobId)) {
    const e = new Error(busyMessage); e.status = 409; throw e;
  }
  enqueueJob({ projectId, userId, methodId: jobId, action });
  ensureWorker();
}

export const submitReport = ({ projectId, userId }) =>
  submitProjectJob({ projectId, userId, jobId: REPORT_JOB, action: "report", busyMessage: "A report is already being generated." });

export const submitReindex = ({ projectId, userId }) =>
  submitProjectJob({ projectId, userId, jobId: REINDEX_JOB, action: "reindex", busyMessage: "Re-indexing is already running." });
