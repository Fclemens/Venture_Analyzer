// Which analyses were written before an upstream analysis they depend on changed?
// `resultTimes` = { methodId: ms timestamp of the last change to its result text }.

export function staleDependents({ methods, resultTimes, dependencies }) {
  const out = {};
  for (const m of methods) {
    if (m.decision === "skip") continue;
    const t = resultTimes[m.id];
    if (!t) continue;
    const upstreamPasses = new Set(dependencies[m.pass] || []);
    const changed = methods.filter(u =>
      u.id !== m.id && u.decision !== "skip" && upstreamPasses.has(u.pass) && (resultTimes[u.id] || 0) > t
    );
    if (changed.length) out[m.id] = changed.map(u => u.name || u.id);
  }
  return out;
}
