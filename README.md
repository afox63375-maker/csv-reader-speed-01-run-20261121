[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/afox63375-maker/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/afox63375-maker/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# Read broken CSV files faster — a fresh entry

A from-scratch, dependency-free drop-in for csv-reader 1.0.0, written for
make.fun's "Read broken CSV files faster, 21 November 2026" bounty. It answers
every case exactly as csv-reader does — same columns, same rows, same errors,
in the same order — and it answers faster.

## Layout

- `solve.js` — an ES module exporting `run(input)`. For one case's input
  `{text, header}` it returns csv-reader's reading of the text:
  `{columns, rows, errors}`.
- `main.ts` — the driver the harness runs (`node /bot/main.ts`, Node 22). It
  reads every case from `/input/cases.json`, answers each one alone with
  `run`, and writes `/output/answers.json`.
- `package.json` — marks the entry as an ES-module package; nothing is
  installed and there are no dependencies.

## How it reads

The reference walks the text a character at a time and grows each field a
character at a time. This reader instead jumps from one interesting character
to the next with `indexOf` and lifts whole runs of plain text out with
`slice`, keeping every search inside the run it belongs to:

- an unquoted field is read by finding its next comma, slicing the run before
  it, and checking inside that run alone for an LF or a CR;
- a quoted field whose next quote closes it and whose content holds no line
  break is a single slice; doubled quotes, line breaks inside quotes, junk
  after a closing quote and unterminated quotes take a general path that
  follows the same rules piece by piece.

The broken-row policy is csv-reader's own, followed to the letter: a U+FEFF
at the very start is dropped; records end at LF or CRLF and a line left with
no characters is no record; a CR outside quotes that is not part of a CRLF is
dropped (`stray_cr`); inside quotes, `""` is one quote and each CRLF or lone
CR is read as LF; text after a closing quote is appended as it stands
(`quote_junk`); a quote that never closes is a literal character and the text
after it is read again as unquoted (`unterminated_quote`); rows are padded
(`short_row`) or cut (`long_row`) to the first record's width; every error is
`{code, line, row}` in the order met.

## Checks

- Practice set: all 6 cases answer identically to csv-reader 1.0.0, and the
  driver's `/output/answers.json` is byte-identical to the house baseline's
  on the practice input.
- Fuzzing: 25,146 generated inputs (token soup dense in quotes, commas and
  every kind of line break; structured records with deliberate breakage —
  unterminated quotes, junk after closing quotes, stray CRs, blank lines;
  long quoted blobs; a hand-written edge list), each compared against
  csv-reader 1.0.0: zero mismatches.
- Speed, measured locally against the baseline on the practice set
  (6 cases, 10.2 MB of text): about 3x faster by median run, and faster on
  LF-only, CRLF-only and quote-heavy synthetic corpora as well.
