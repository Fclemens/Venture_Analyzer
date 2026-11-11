// Deterministic scoring. The model scores each dimension against a rubric;
// the weighted total, coverage and verdict are computed here so the same
// inputs always give the same output.

import { SCORE_DIMENSIONS, VERDICTS, MIN_SCORE_COVERAGE } from "./constants.js";

const clamp = (n) => Math.min(10, Math.max(1, n));

export function computeScore(dimensionScores = {}) {
  let weighted = 0;
  let covered = 0;
  const dimensions = SCORE_DIMENSIONS.map(d => {
    const raw = dimensionScores?.[d.id] || {};
    const n = Number(raw.score);
    const scored = raw.score !== null && raw.score !== undefined && raw.score !== "" && Number.isFinite(n);
    if (scored) {
      weighted += clamp(n) * d.weight;
      covered += d.weight;
    }
    return {
      id: d.id,
      label: d.label,
      weight: d.weight,
      score: scored ? clamp(n) : null,
      confidence: raw.confidence || null,
      evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    };
  });

  // Renormalise over scored dimensions; round first so the verdict always matches
  // the number shown (avoids 7.4999999 failing a 7.5 threshold)
  const total = covered > 0 ? Math.round((weighted / covered) * 10) / 10 : null;
  const coverage = Math.round(covered * 100) / 100;
  const sufficient = coverage >= MIN_SCORE_COVERAGE;

  let verdict = "Insufficient data";
  if (total !== null && sufficient) {
    verdict = VERDICTS.find(v => total >= v.min).label;
  }

  return {
    dimensions,
    total,
    coverage,
    sufficient,
    verdict,
    score: total === null ? "n/a" : `${total.toFixed(1)}/10`,
    score_rationale: total === null
      ? "No dimension had enough evidence to be scored."
      : `Weighted over ${Math.round(coverage * 100)}% of the rubric${sufficient ? "" : " - below the 60% minimum, so no verdict is issued"}; unscored dimensions are excluded, not assumed.`,
  };
}
