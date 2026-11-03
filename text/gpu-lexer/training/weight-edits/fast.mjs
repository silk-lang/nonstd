// A flat re-implementation of tree-model.js treeProbabilities (hybrid tree) that also returns
// each part's 64-dim [leaf, context] vector so head-only edits can be re-scored cheaply.
const H = 32, C = 72, A = 16, K = 9;

export function prep(rec) {
  // features as flat offsets, and skip mask
  const n = rec.features.length;
  const isSpace = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const k = rec.features[i][0]; isSpace[i] = Number(k === 1 || k === 2); }
  return { n, isSpace };
}

export function forward(m, rec, { joinedOut = null } = {}) {
  const n = rec.features.length;
  const raw = new Float32Array(n * H);
  const E = m.featureEmbedding;
  for (let i = 0; i < n; i++) for (const f of rec.features[i]) {
    const r = f * H, o = i * H;
    for (let h = 0; h < H; h++) raw[o + h] += E[r + h];
  }
  const space = (i) => { const k = rec.features[i][0]; return k === 1 || k === 2; };
  const prev = new Int32Array(n), next = new Int32Array(n);
  let last = -1;
  for (let i = 0; i < n; i++) { prev[i] = last; if (!space(i)) last = i; }
  last = -1;
  for (let i = n - 1; i >= 0; i--) { next[i] = last; if (!space(i)) last = i; }
  const local = new Float32Array(n * H);
  const LO = m.localOffsetScale, LN = m.localNonspaceScale, LB = m.leafBias;
  for (let i = 0; i < n; i++) for (let h = 0; h < H; h++) {
    let v = LB[h];
    for (let off = -2; off <= 2; off++) {
      const j = i + off;
      if (j >= 0 && j < n) v += raw[j * H + h] * LO[(off + 2) * H + h];
    }
    if (prev[i] >= 0) v += raw[prev[i] * H + h] * LN[h];
    if (next[i] >= 0) v += raw[next[i] * H + h] * LN[H + h];
    local[i * H + h] = Math.tanh(v);
  }
  const gates = new Float32Array(n * H), values = new Float32Array(n * H);
  for (let i = 0; i < n; i++) for (let h = 0; h < H; h++) {
    let g = m.stateGateBias[h], v = m.stateInputBias[h];
    for (let k = 0; k < H; k++) { const x = local[i * H + k]; g += x * m.stateGate[h * H + k]; v += x * m.stateInput[h * H + k]; }
    gates[i * H + h] = 1 / (1 + Math.exp(-g));
    values[i * H + h] = Math.tanh(v);
  }
  const fwd = new Float32Array(n * H), rev = new Float32Array(n * H);
  const st = new Float32Array(H);
  for (let i = 0; i < n; i++) for (let h = 0; h < H; h++) { const g = gates[i * H + h]; st[h] = g * st[h] + (1 - g) * values[i * H + h]; fwd[i * H + h] = st[h]; }
  st.fill(0);
  for (let i = n - 1; i >= 0; i--) for (let h = 0; h < H; h++) { const g = gates[i * H + h]; st[h] = g * st[h] + (1 - g) * values[i * H + h]; rev[i * H + h] = st[h]; }
  const leaf = new Float32Array(n * H);
  for (let i = 0; i < n; i++) for (let h = 0; h < H; h++) {
    let s = m.stateMixBias[h];
    for (let k = 0; k < H; k++) s += fwd[i * H + k] * m.stateMix[h * 2 * H + k] + rev[i * H + k] * m.stateMix[h * 2 * H + H + k];
    leaf[i * H + h] = Math.tanh(local[i * H + h] + s);
  }
  // tree up
  let width = 1; while (width < n) width *= 2;
  let level = []; for (let i = 0; i < width; i++) level.push(i < n ? leaf.subarray(i * H, i * H + H) : null);
  const levels = [level];
  let depth = 0;
  const sb = m.mergeOwnLeft.length / H;
  while (level.length > 1) {
    const nx = new Array(level.length / 2);
    const scale = Math.min(depth, sb - 1) * H;
    const shift = 1 << Math.min(depth, 4);
    for (let p = 0; p < nx.length; p++) {
      const L = level[p * 2], R = level[p * 2 + 1];
      if (!L) nx[p] = null; else if (!R) nx[p] = L; else {
        const out = new Float32Array(H);
        for (let h = 0; h < H; h++) {
          const q = h ^ shift;
          const mixed = Math.tanh(L[h] * m.mergeOwnLeft[scale + h] + R[h] * m.mergeOwnRight[scale + h] +
            L[q] * m.mergeCrossLeft[scale + h] + R[q] * m.mergeCrossRight[scale + h] + m.mergeBias[scale + h]);
          out[h] = (mixed + (h < H / 2 ? L[h] : R[h])) * 0.5;
        }
        nx[p] = out;
      }
    }
    levels.push(nx); level = nx; depth += 1;
  }
  let down = [level[0]];
  for (let d = levels.length - 2; d >= 0; d--) {
    const ch = levels[d];
    const nx = new Array(ch.length);
    const scale = Math.min(d, sb - 1) * H;
    const shift = 1 << Math.min(d, 4);
    for (let p = 0; p < down.length; p++) {
      const L = ch[p * 2], R = ch[p * 2 + 1];
      if (!L) continue;
      if (!R) { nx[p * 2] = down[p]; continue; }
      nx[p * 2] = descend(m, down[p], L, R, scale, shift, m.downLeftBias);
      nx[p * 2 + 1] = descend(m, down[p], R, L, scale, shift, m.downRightBias);
    }
    down = nx;
  }
  const joined = joinedOut ?? new Float32Array(n * 2 * H);
  for (let i = 0; i < n; i++) { joined.set(leaf.subarray(i * H, i * H + H), i * 2 * H); joined.set(down[i], i * 2 * H + H); }
  return joined;
}

function descend(m, parent, self, sib, scale, shift, bias) {
  const out = new Float32Array(H);
  for (let h = 0; h < H; h++) {
    const ix = scale + h, q = h ^ shift;
    const mixed = Math.tanh(parent[h] * m.downOwnParent[ix] + self[h] * m.downOwnSelf[ix] + sib[h] * m.downOwnSibling[ix] +
      parent[q] * m.downCrossParent[ix] + self[q] * m.downCrossSelf[ix] + sib[q] * m.downCrossSibling[ix] + bias[ix]);
    const skip = 1 / (1 + Math.exp(-m.downSkip[ix]));
    out[h] = parent[h] * skip + mixed * (1 - skip);
  }
  return out;
}

/** Head: joined (64) -> aux (16) -> classifier (72) -> logits (9). Returns logits array. */
export function head(m, joined, offset, logits = new Float32Array(K), hidden = null) {
  const x = new Float32Array(2 * H + A);
  for (let k = 0; k < 2 * H; k++) x[k] = joined[offset + k];
  for (let a = 0; a < A; a++) {
    let s = m.auxiliaryBias[a];
    for (let k = 0; k < 2 * H; k++) s += m.auxiliaryOutput[a * 2 * H + k] * x[k];
    x[2 * H + a] = 1 / (1 + Math.exp(-s));
  }
  const cls = hidden ?? new Float32Array(C);
  for (let c = 0; c < C; c++) {
    let s = m.classifierBias[c];
    for (let k = 0; k < 2 * H + A; k++) s += m.classifierInput[c * (2 * H + A) + k] * x[k];
    cls[c] = Math.tanh(s);
  }
  for (let o = 0; o < K; o++) {
    let s = m.outputBias[o];
    for (let c = 0; c < C; c++) s += m.output[o * C + c] * cls[c];
    logits[o] = s;
  }
  return logits;
}

export function argmax(v) { let b = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[b]) b = i; return b; }

export function predictFast(m, rec) {
  const joined = forward(m, rec);
  const n = rec.features.length;
  const out = new Uint8Array(n);
  const logits = new Float32Array(K);
  for (let i = 0; i < n; i++) {
    const k = rec.features[i][0];
    out[i] = (k === 1 || k === 2) ? 0 : argmax(head(m, joined, i * 2 * H, logits));
  }
  return out;
}
