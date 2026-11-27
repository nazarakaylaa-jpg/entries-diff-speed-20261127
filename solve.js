// solve.js — fast drop-in for makefun-diff 1.0.0 (diff-speed-01).
// Own implementation of the rule in the house baseline's vendor/makefun-diff/index.js header:
// common prefix, then common suffix, then Myers's greedy search (furthest x on each diagonal,
// deletion wins ties, no edge pruning, snake follows every equal run), then the makefun-diff/1 patch.
// Lines are interned to integer ids once, the search runs on one flat Int32Array of V rows,
// and the patch is rebuilt from the original line strings. No dependency, no I/O, no cross-case state.
//
// Speed: the search is banded. The edit path's diagonal k = x - y starts at 0, ends at
// an - bm and, on this competition's cases (two texts ~90% alike, edits spread through them),
// wanders only a few dozen diagonals from that span; the band below holds it with a wide
// margin, and the search only walks the diagonals inside it. Any case whose path comes near
// the band's edge, or whose search runs past its cap, falls back to the unbanded search, so
// the band can only cost time, never the answer.

const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;
/** Stored in a V row for a diagonal no path reaches at that d; larger than any line count. */
const SENT = 1000000000;
/** How far past the path's start-to-end diagonal span the band reaches, each side. */
const BAND_W = 250;
/** How close to the band's edge a path may come before the search falls back to unbanded. */
const BAND_MARGIN = 100;
/** A banded search that has not finished by this d falls back to the unbanded search. */
const BAND_D_CAP = 12000;

/** Backtrack the runs of a finished search from its flat V rows. banded ? [kLo, kHi] : null. */
function backtrack(V, D, kEnd, an, bm, band) {
  const rev = [];
  let k = kEnd;
  let cx = an;
  let kMin = k;
  let kMax = k;
  for (let d = D; d >= 1; d--) {
    const baseP = (d - 1) * (d - 1);
    const j = k + d;
    const jLoPrev = band === null ? 0 : bandJLo(band[0], d - 1);
    const jHiPrev = band === null ? 2 * d - 2 : bandJHi(band[1], d - 1);
    let delX = -1;
    let insX = -1;
    if (j - 2 >= jLoPrev) {
      const v = V[baseP + j - 2];
      if (v < an) delX = v + 1;
    }
    if (j <= jHiPrev) {
      const v = V[baseP + j];
      if (v - k <= bm) insX = v;
    }
    let x0;
    let kind;
    if (delX >= insX) {
      kind = DELETE;
      x0 = delX;
    } else {
      kind = INSERT;
      x0 = insX;
    }
    const snake = cx - x0;
    if (snake > 0) rev.push([KEEP, snake]);
    rev.push([kind, 1]);
    if (kind === DELETE) {
      cx = x0 - 1;
      k = k - 1;
    } else {
      cx = x0;
      k = k + 1;
    }
    if (k < kMin) kMin = k;
    if (k > kMax) kMax = k;
  }
  if (cx > 0) rev.push([KEEP, cx]);

  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i];
    const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
    if (last !== undefined && last[0] === r[0]) last[1] += r[1];
    else runs.push([r[0], r[1]]);
  }
  return { runs, kMin, kMax };
}

/** Smallest even j of row d whose diagonal is inside the band (j = k + d). */
function bandJLo(kLo, d) {
  const r = Math.max(0, kLo + d);
  return r + (r & 1);
}
/** Largest even j of row d whose diagonal is inside the band. */
function bandJHi(kHi, d) {
  const r = Math.min(2 * d, kHi + d);
  return r - (r & 1);
}

/**
 * The edit runs of the middle slices a[0..an) into b[0..bm) (integer line ids, each padded with
 * one sentinel element past its end: a[an] = -1, b[bm] = -2, so a snake stops at either end),
 * as [kind, count] pairs in order, kind 0 keep / 1 delete / 2 insert. Exactly the runs the
 * house baseline's editRuns returns for the same slices (same tie-break, same snakes).
 * Returns null when the banded search must fall back to the unbanded one.
 */
function myersRuns(a, an, b, bm, banded) {
  if (an === 0) return bm === 0 ? [] : [[INSERT, bm]];
  if (bm === 0) return [[DELETE, an]];
  const kEnd = an - bm;
  const band = banded ? [Math.min(0, kEnd) - BAND_W, Math.max(0, kEnd) + BAND_W] : null;
  const kLo = band === null ? -1e9 : band[0];
  const kHi = band === null ? 1e9 : band[1];
  // Flat V: row d starts at d*d, diagonal k at d*d + (k + d); SENT entries are unreachable.
  // D is at most ~15% of an + bm for this competition's generator; size for that up front.
  let capD = Math.max(1024, Math.ceil((an + bm) * 0.15));
  let V = new Int32Array((capD + 1) * (capD + 1));
  // d = 0: the snake from (0, 0).
  let x = 0;
  while (a[x] === b[x]) x++;
  V[0] = x;
  let D = -1;
  if (x === an && x === bm) {
    D = 0;
  } else {
    outer: for (let d = 1; ; d++) {
      if (band !== null && d > BAND_D_CAP) return null;
      if (d > capD) {
        const ncap = d * 2;
        const NV = new Int32Array((ncap + 1) * (ncap + 1));
        NV.set(V);
        V = NV;
        capD = ncap;
      }
      const baseD = d * d;
      const baseP = (d - 1) * (d - 1);
      const jLo = band === null ? 0 : bandJLo(kLo, d);
      const jHi = band === null ? 2 * d : bandJHi(kHi, d);
      const jLoPrev = band === null ? 0 : bandJLo(kLo, d - 1);
      const jHiPrev = band === null ? 2 * d - 2 : bandJHi(kHi, d - 1);
      // Interior diagonals, where both predecessors are in the band: the two edge
      // diagonals are handled separately, so this loop carries no validity checks.
      const iLo = Math.max(jLo, jLoPrev + 2);
      const iHi = Math.min(jHi, jHiPrev);
      let pi = baseP + jLo;
      let di = baseD + jLo;
      let k = jLo - d;
      // Left edge diagonal: its deletion predecessor is outside the band.
      if (jLo <= jLoPrev) {
        const vi = V[pi];
        let x0 = vi - k <= bm ? vi : -1;
        if (x0 < 0) {
          V[di] = SENT;
        } else {
          let y0 = x0 - k;
          while (a[x0] === b[y0]) {
            x0++;
            y0++;
          }
          V[di] = x0;
        }
        pi += 2;
        di += 2;
        k += 2;
      }
      for (let j = iLo; j <= iHi; j += 2) {
        const vd = V[pi - 2];
        const vi = V[pi];
        // Deletion: one old line past the (d-1)-point on k-1; insertion: one new line past
        // the (d-1)-point on k+1. Further into the old text wins; the deletion wins a tie.
        const delX = vd < an ? vd + 1 : -1;
        const insX = vi - k <= bm ? vi : -1;
        let x0 = delX >= insX ? delX : insX;
        if (x0 < 0) {
          V[di] = SENT;
        } else {
          let y0 = x0 - k;
          while (a[x0] === b[y0]) {
            x0++;
            y0++;
          }
          V[di] = x0;
        }
        pi += 2;
        di += 2;
        k += 2;
      }
      // Right edge diagonal: its insertion predecessor is outside the band.
      if (pi - baseP <= jHi) {
        const vd = V[pi - 2];
        let x0 = vd < an ? vd + 1 : -1;
        if (x0 < 0) {
          V[di] = SENT;
        } else {
          let y0 = x0 - k;
          while (a[x0] === b[y0]) {
            x0++;
            y0++;
          }
          V[di] = x0;
        }
      }
      // Reached both ends when the row's kEnd diagonal consumed every old line.
      if (((kEnd + d) & 1) === 0) {
        const je = kEnd + d;
        if (je >= jLo && je <= jHi && V[baseD + je] === an) {
          D = d;
          break outer;
        }
      }
    }
  }

  const bt = backtrack(V, D, kEnd, an, bm, band);
  if (band !== null && (bt.kMin < kLo + BAND_MARGIN || bt.kMax > kHi - BAND_MARGIN)) return null;
  return bt.runs;
}

/** Backtrack the runs of a finished banded search, whose flat V rows are stored compactly:
 * row d at d*BW, diagonal k at d*BW + (k - kLo). */
function backtrackCompact(V, D, kEnd, an, bm, kLo, BW) {
  const rev = [];
  let k = kEnd;
  let cx = an;
  let kMin = k;
  let kMax = k;
  for (let d = D; d >= 1; d--) {
    const baseP = (d - 1) * BW;
    const t = k - kLo;
    const parityP = (d - 1 - kLo) & 1;
    let tLoPrev = Math.max(0, -(d - 1) - kLo);
    if ((tLoPrev & 1) !== parityP) tLoPrev++;
    let tHiPrev = Math.min(BW - 1, (d - 1) - kLo);
    if ((tHiPrev & 1) !== parityP) tHiPrev--;
    let delX = -1;
    let insX = -1;
    if (t - 1 >= tLoPrev) {
      const v = V[baseP + t - 1];
      if (v < an) delX = v + 1;
    }
    if (t + 1 <= tHiPrev) {
      const v = V[baseP + t + 1];
      if (v - k <= bm) insX = v;
    }
    let x0;
    let kind;
    if (delX >= insX) {
      kind = DELETE;
      x0 = delX;
    } else {
      kind = INSERT;
      x0 = insX;
    }
    const snake = cx - x0;
    if (snake > 0) rev.push([KEEP, snake]);
    rev.push([kind, 1]);
    if (kind === DELETE) {
      cx = x0 - 1;
      k = k - 1;
    } else {
      cx = x0;
      k = k + 1;
    }
    if (k < kMin) kMin = k;
    if (k > kMax) kMax = k;
  }
  if (cx > 0) rev.push([KEEP, cx]);

  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i];
    const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
    if (last !== undefined && last[0] === r[0]) last[1] += r[1];
    else runs.push([r[0], r[1]]);
  }
  return { runs, kMin, kMax };
}

/**
 * The banded search on the compact layout: row d at d*BW, diagonal k at d*BW + (k - kLo),
 * so the whole V table is (capD+1)*BW entries (~9 MB for this competition) instead of the
 * (capD+1)^2 triangle (~260 MB). Same rule as myersRuns: deletion wins ties, no edge pruning,
 * snakes follow every equal run. Returns null when it must fall back to the unbanded search.
 */
function myersRunsBanded(a, an, b, bm) {
  if (an === 0) return bm === 0 ? [] : [[INSERT, bm]];
  if (bm === 0) return [[DELETE, an]];
  const kEnd = an - bm;
  const kLo = Math.min(0, kEnd) - BAND_W;
  const kHi = Math.max(0, kEnd) + BAND_W;
  const BW = kHi - kLo + 1;
  let capD = Math.max(1024, Math.ceil((an + bm) * 0.08));
  let V = new Int32Array((capD + 1) * BW);
  let x = 0;
  while (a[x] === b[x]) x++;
  V[-kLo] = x;
  let D = -1;
  if (x === an && x === bm) {
    D = 0;
  } else {
    outer: for (let d = 1; ; d++) {
      if (d > BAND_D_CAP) return null;
      if (d > capD) {
        const ncap = d * 2;
        const NV = new Int32Array((ncap + 1) * BW);
        NV.set(V);
        V = NV;
        capD = ncap;
      }
      const baseD = d * BW;
      const baseP = (d - 1) * BW;
      const parity = (d - kLo) & 1;
      let tLo = Math.max(0, -d - kLo);
      if ((tLo & 1) !== parity) tLo++;
      let tHi = Math.min(BW - 1, d - kLo);
      if ((tHi & 1) !== parity) tHi--;
      const parityP = (d - 1 - kLo) & 1;
      let tLoPrev = Math.max(0, -(d - 1) - kLo);
      if ((tLoPrev & 1) !== parityP) tLoPrev++;
      let tHiPrev = Math.min(BW - 1, (d - 1) - kLo);
      if ((tHiPrev & 1) !== parityP) tHiPrev--;
      const iLo = Math.max(tLo, tLoPrev + 1);
      const iHi = Math.min(tHi, tHiPrev - 1);
      let pi = baseP + tLo;
      let di = baseD + tLo;
      let k = tLo + kLo;
      // Left edge diagonal: its deletion predecessor is outside the band.
      if (tLo <= tLoPrev) {
        const vi = V[pi + 1];
        let x0 = vi - k <= bm ? vi : -1;
        if (x0 < 0) {
          V[di] = SENT;
        } else {
          let y0 = x0 - k;
          while (a[x0] === b[y0]) {
            x0++;
            y0++;
          }
          V[di] = x0;
        }
        pi += 2;
        di += 2;
        k += 2;
      }
      for (let t = iLo; t <= iHi; t += 2) {
        const vd = V[pi - 1];
        const vi = V[pi + 1];
        const delX = vd < an ? vd + 1 : -1;
        const insX = vi - k <= bm ? vi : -1;
        let x0 = delX >= insX ? delX : insX;
        if (x0 < 0) {
          V[di] = SENT;
        } else {
          let y0 = x0 - k;
          while (a[x0] === b[y0]) {
            x0++;
            y0++;
          }
          V[di] = x0;
        }
        pi += 2;
        di += 2;
        k += 2;
      }
      // Right edge diagonal: its insertion predecessor is outside the band.
      if (pi - baseP <= tHi) {
        const vd = V[pi - 1];
        let x0 = vd < an ? vd + 1 : -1;
        if (x0 < 0) {
          V[di] = SENT;
        } else {
          let y0 = x0 - k;
          while (a[x0] === b[y0]) {
            x0++;
            y0++;
          }
          V[di] = x0;
        }
      }
      // Reached both ends when the row's kEnd diagonal consumed every old line.
      const tEnd = kEnd - kLo;
      if ((tEnd & 1) === parity && tEnd >= tLo && tEnd <= tHi && V[baseD + tEnd] === an) {
        D = d;
        break outer;
      }
    }
  }

  const bt = backtrackCompact(V, D, kEnd, an, bm, kLo, BW);
  if (bt.kMin < kLo + BAND_MARGIN || bt.kMax > kHi - BAND_MARGIN) return null;
  return bt.runs;
}

/** A line as the patch writes it: op + line, a newline, and "%" on its own line when it had none. */
function written(op, parts, i, nLines, endsNL) {
  const hasNL = i < nLines - 1 || endsNL;
  return hasNL ? op + parts[i] + '\n' : op + parts[i] + '\n%\n';
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const oldText = input.old;
  const newText = input.new;

  // Lines: cut after every '\n'; a last line with no '\n' is a line too; the empty text has none.
  const aParts = oldText.split('\n');
  const bParts = newText.split('\n');
  const aLast = aParts[aParts.length - 1];
  const bLast = bParts[bParts.length - 1];
  const n = aParts.length - (aLast === '' ? 1 : 0);
  const m = bParts.length - (bLast === '' ? 1 : 0);
  const oldEndsNL = n > 0 && aLast === '';
  const newEndsNL = m > 0 && bLast === '';

  // Identical texts are the first line alone.
  if (oldText === newText) return `${FORMAT} old=${n} new=${m} hunks=0 deleted=0 inserted=0\n`;

  // Intern every distinct line (without its '\n') to an integer id, shared by both texts, so
  // line equality is one integer compare. A bare last line (no '\n') gets an id offset by the
  // number of distinct parts, so it never equals a line that ends with '\n'.
  const ids = new Map();
  const aIds = new Int32Array(n);
  const bIds = new Int32Array(m);
  let nextId = 0;
  for (let i = 0; i < n; i++) {
    const s = aParts[i];
    let id = ids.get(s);
    if (id === undefined) {
      id = nextId++;
      ids.set(s, id);
    }
    aIds[i] = id;
  }
  for (let i = 0; i < m; i++) {
    const s = bParts[i];
    let id = ids.get(s);
    if (id === undefined) {
      id = nextId++;
      ids.set(s, id);
    }
    bIds[i] = id;
  }
  const P = nextId;
  const oldBare = n > 0 && aLast !== '';
  const newBare = m > 0 && bLast !== '';
  if (oldBare) aIds[n - 1] += P;
  if (newBare) bIds[m - 1] += P;

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && aIds[prefix] === bIds[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && aIds[n - 1 - suffix] === bIds[m - 1 - suffix]) suffix++;
  const an = n - prefix - suffix;
  const bm = m - prefix - suffix;

  // Sentinel-padded copies of the middle slices, so a snake stops at either end with no
  // bounds check (a[an] = -1, b[bm] = -2, never equal to a real id or to each other).
  const aMid = new Int32Array(an + 1);
  const bMid = new Int32Array(bm + 1);
  aMid.set(aIds.subarray(prefix, n - suffix));
  bMid.set(bIds.subarray(prefix, m - suffix));
  aMid[an] = -1;
  bMid[bm] = -2;

  let mid = myersRunsBanded(aMid, an, bMid, bm);
  if (mid === null) mid = myersRuns(aMid, an, bMid, bm, false);

  const runs = [];
  if (prefix > 0) runs.push([KEEP, prefix]);
  for (let i = 0; i < mid.length; i++) runs.push(mid[i]);
  if (suffix > 0) runs.push([KEEP, suffix]);

  // The change runs: each a stretch of deletions and insertions between two kept lines.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let r = 0; r < runs.length; r++) {
    const kind = runs[r][0];
    const count = runs[r][1];
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes.length > 0 ? changes[changes.length - 1] : undefined;
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DELETE) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const h = hunks.length > 0 ? hunks[hunks.length - 1] : undefined;
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) out.push(written('=', aParts, at, n, oldEndsNL));
      for (let i = 0; i < c.dels; i++) out.push(written('-', aParts, c.o + i, n, oldEndsNL));
      for (let i = 0; i < c.ins; i++) out.push(written('+', bParts, c.p + i, m, newEndsNL));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', aParts, at, n, oldEndsNL));
  }
  return out.join('');
}
