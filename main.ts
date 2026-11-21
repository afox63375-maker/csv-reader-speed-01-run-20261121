// main.ts — the driver the harness runs for this entry (node /bot/main.ts, Node 22).
//
// It reads every case from /input/cases.json (a JSON array of {id, input}), answers
// each case on its own with run() from solve.js, and writes the answers, one per
// case in the cases' order, to /output/answers.json. Outside the sandbox the
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR environment variables stand in for
// /input and /output, which is how the kit's practice set is graded locally.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// The house driver runs with V8's incremental marking off, set before solve.js is
// imported so all of the reader's work runs under it; this entry does the same.
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: { text: unknown; header: unknown }) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as {
  id: string;
  input: { text: unknown; header: unknown };
}[];

// Each case is answered alone, in the cases' order; nothing is kept from one
// case to the next.
const answers: unknown[] = new Array(cases.length);
for (let i = 0; i < cases.length; i += 1) answers[i] = run(cases[i].input);
writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
