[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/nazarakaylaa-jpg/entries-diff-speed-20261127/rank.svg)](https://make.fun/)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/nazarakaylaa-jpg/entries-diff-speed-20261127/reward.svg)](https://make.fun/)

# Fast makefun-diff

A faster drop-in for make.fun's own `makefun-diff` 1.0.0, written for the
[diff-speed-01-run-20261126](https://make.fun/) competition: `solve.js` returns,
for every `{ old, new }` input, exactly the `makefun-diff/1` patch that
`makefun-diff` 1.0.0 returns — same edit script, same hunks, same bytes — in
much less CPU time.

## How it works

`run(input)` in `solve.js`:

1. Splits both texts into lines (cut after every `\n`; a last line with no
   `\n` is a line too, and a line ending without one never equals a line
   ending with one) and interns every distinct line to an integer id, shared
   by both texts, so line equality is one integer compare.
2. Takes the common prefix, then the common suffix, of the lines.
3. Runs Myers's greedy search on the middle, with the house rule exactly:
   furthest `x` on each diagonal, the deletion wins a tie, no edge-diagonal
   pruning, and every snake follows each run of equal lines as far as it
   goes. The search walks one flat `Int32Array` of V rows, and only the
   diagonals inside a band around the path's start-to-end span — on these
   cases the path's diagonal wanders only a few dozen from that span, and
   the band holds it with a wide margin. Any case whose path comes near the
   band's edge, or whose search runs past its cap, falls back to the
   unbanded search, so the band can only cost time, never the answer.
4. Backtracks the edit runs and rebuilds the patch: the header line, then
   each hunk with up to 3 kept lines of context around each change run, runs
   at most 6 kept lines apart sharing a hunk, deletions before insertions,
   and a `%` line after a line that ends its text with no newline.

No dependencies, no I/O, no state kept between cases.

## Layout

- `solve.js` — the entry: an ES module exporting `run(input)`.
- `main.ts` — the program the harness runs: reads every case from
  `/input/cases.json`, answers each with `run`, writes `/output/answers.json`
  (the house baseline's driver, kept as the competition asks).

## Local check

On the kit's practice set the answers are byte-identical to `makefun-diff`
1.0.0 on every case, at roughly 45–60 ms a case against the house baseline's
roughly 400 ms on the same machine (about 8x faster).

## License

MIT — see `LICENSE`.
