// Line-level diff (longest common subsequence) for comparing analysis versions.
// Returns [{ type: "same" | "add" | "del", text }] in reading order.

const MAX_LINES = 1500; // beyond this fall back to a coarse whole-block diff

export function lineDiff(a = "", b = "") {
  const A = String(a).replace(/\r\n/g, "\n").split("\n");
  const B = String(b).replace(/\r\n/g, "\n").split("\n");
  if (A.length > MAX_LINES || B.length > MAX_LINES) {
    return [...A.map(text => ({ type: "del", text })), ...B.map(text => ({ type: "add", text }))];
  }
  const n = A.length, m = B.length;
  // dp[i][j] = LCS length of A[i..] and B[j..]
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ type: "same", text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: A[i++] }); }
    else { out.push({ type: "add", text: B[j++] }); }
  }
  while (i < n) out.push({ type: "del", text: A[i++] });
  while (j < m) out.push({ type: "add", text: B[j++] });
  return out;
}

export function diffStats(diff) {
  return diff.reduce((s, d) => { if (d.type !== "same") s[d.type === "add" ? "added" : "removed"]++; return s; }, { added: 0, removed: 0 });
}
