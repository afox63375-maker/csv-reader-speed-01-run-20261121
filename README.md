[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/afox63375-maker/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/afox63375-maker/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# Read broken CSV files faster

A faster drop-in for make.fun's csv-reader 1.0.0. `solve.js` exports
`run(input)`, which returns exactly the reference reader's answer —
`{columns, rows, errors}` — for every `{text, header}` input, under the same
broken-row policy: a leading BOM dropped, records ending at LF or CRLF,
blank lines skipped, stray CRs dropped and reported, quoted fields with
doubled quotes and embedded line breaks read as LF, junk after a closing
quote appended and reported, a never-closing quote read again as unquoted
text, and every row padded or cut to the first record's width with
`short_row` / `long_row` errors carrying the record's start line and its
index in `rows`. `main.ts` is the harness driver: it reads
`/input/cases.json`, answers each case on its own, and writes
`/output/answers.json`.

## How it reads

The reference reader walks the text one character at a time and builds each
field one character at a time. This one jumps:

- **IndexOf-driven scanning.** Fields are found with `indexOf` jumps to the
  nearest comma, LF or CR and taken as whole slices, so a plain field costs
  a few native scans and one slice instead of a per-character loop.
- **Forward-only landmarks.** The next quote and the next CR are remembered
  and only looked for again once the scan has passed them, which keeps every
  probe amortised across the whole text. (The one place the scan steps
  backwards — the re-read of a never-closing quote — refreshes both
  landmarks from the stepped-back position.)
- **A plain-record fast path.** A record holding no quote and no CR before
  its line break is a single `slice(...).split(',')`.
- **Segment-wise quoted fields.** Inside quotes, the stretches between
  quotes are checked for CRs once: a stretch without one is sliced as it
  stands with its LFs counted; a stretch with one is normalised (CRLF and
  lone CR each become one LF) in one pass.
- **Segmented stray-CR handling.** An unquoted field is one slice unless a
  stray CR splits it, in which case the slices are joined — the common case
  never allocates the parts array.

## Verification and speed

Checked against csv-reader 1.0.0 itself, differentially: the kit's practice
set (6 cases, ~11 MB of CSV) matches the published reference answers byte
for byte through the full driver, and ~12,000 fuzz inputs — hostile
quote/CR/LF alphabets, structured broken records, and whole generated-style
files of ~1.7 M characters in both LF and CRLF flavours, with and without
unterminated tails — all match the reference exactly.

On the practice set, timing `run()` alone over all 6 cases (best of 5,
local machine): the reference reader takes ~451 ms, this entry ~111 ms —
about **4.1× faster**. The full driver run (JSON in, answers out) shows the
same ordering. Places in the contest go by CPU time, and a reward needs
beating the house baseline at 95% confidence; this entry clears that bar
with room to spare on the practice data.
