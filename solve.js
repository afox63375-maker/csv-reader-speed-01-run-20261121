// solve.js — a fast reader for broken CSV, answering exactly as csv-reader 1.0.0 does.
//
// run(input) takes one case's input {text, header} and returns {columns, rows, errors}:
// csv-reader's reading of the text. The reading policy, followed to the letter:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes, a CR not followed by LF is dropped and reported (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled: ""
//     inside it is one quote, and each CRLF or lone CR inside it is read as LF; whatever
//     follows the closing quote, up to the next comma or line break, is appended as it
//     stands (quote_junk, when that appended part is not empty);
//   - a quote that never closes is a literal character, and the text after it is read
//     again as an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings,
//     never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the rest,
//     each padded with "" (short_row) or cut (long_row) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line the record starts on
//     (every LF, CRLF and lone CR inside quotes counted), row the record's index in
//     rows (null for the header), in the order met.
//
// Where the reference walks the text a character at a time and grows each field a
// character at a time, this reader jumps from one interesting character to the next
// with indexOf and lifts whole runs of plain text out with slice. Searches are kept
// inside the run they belong to, so a rare character never makes a scan run long.

// How a field ended: at a comma (the record goes on), at a line break, or at the
// end of the text (the record ends either way).
const AT_COMMA = 0;
const AT_BREAK = 1;
const AT_END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes
  // (null while it could still be the header). Errors met while reading it are
  // stamped with these two.
  let recLine = 1;
  let recRow = null;

  function report(code) {
    errors.push({ code, line: recLine, row: recRow });
  }

  // Reads unquoted text onto `seed`, up to the next comma or line break. A CR not
  // followed by LF is dropped (stray_cr) and the run of plain text on either side
  // of it is kept. Returns the field, how it ended, and how many characters were
  // kept past the seed (`added`, which the quote_junk rule reads).
  function readPlain(seed) {
    let pieces = null; // plain runs collected once a dropped CR splits the field
    let acc = seed; // the value so far while no CR has split the field
    let added = 0;
    let p = pos;
    for (;;) {
      // Most fields end at a comma: find it, lift the run before it out with one
      // slice, then check inside that run alone for an LF or a CR, either of
      // which ends or splits the field sooner than the comma does.
      const comma = text.indexOf(',', p);
      const stop = comma === -1 ? len : comma;
      const run = text.slice(p, stop);
      const lfAt = run.indexOf('\n');
      const crAt = run.indexOf('\r');
      if (crAt !== -1 && (lfAt === -1 || crAt < lfAt)) {
        const cr = p + crAt;
        const head = run.slice(0, crAt);
        if (pieces !== null) pieces.push(head);
        else acc += head;
        added += crAt;
        if (text[cr + 1] === '\n') {
          // A CRLF ends the field; its LF is the run's last character or the
          // one just past the run.
          line += 1;
          pos = cr + 2;
          return { value: pieces !== null ? pieces.join('') : acc, ended: AT_BREAK, added };
        }
        // A stray CR: it is dropped, and the reading goes on past it.
        report('stray_cr');
        if (pieces === null) {
          pieces = [acc];
          acc = null;
        }
        p = cr + 1;
        continue;
      }
      if (lfAt !== -1) {
        const head = run.slice(0, lfAt);
        if (pieces !== null) pieces.push(head);
        else acc += head;
        added += lfAt;
        line += 1;
        pos = p + lfAt + 1;
        return { value: pieces !== null ? pieces.join('') : acc, ended: AT_BREAK, added };
      }
      // Neither: the run is the rest of the field, ended by the comma or by
      // the end of the text.
      if (pieces !== null) pieces.push(run);
      else acc += run;
      added += run.length;
      if (comma === -1) {
        pos = len;
        return { value: pieces !== null ? pieces.join('') : acc, ended: AT_END, added };
      }
      pos = comma + 1;
      return { value: pieces !== null ? pieces.join('') : acc, ended: AT_COMMA, added };
    }
  }

  // What follows a quoted field's closing quote: a comma, a line break, the end
  // of the text, or junk — whatever stands up to the next comma or line break,
  // appended as it stands (quote_junk, when any of it was kept).
  function finishQuoted(value) {
    if (pos >= len) return { value, ended: AT_END };
    const c = text[pos];
    if (c === ',') {
      pos += 1;
      return { value, ended: AT_COMMA };
    }
    if (c === '\n') {
      pos += 1;
      line += 1;
      return { value, ended: AT_BREAK };
    }
    if (c === '\r' && text[pos + 1] === '\n') {
      pos += 2;
      line += 1;
      return { value, ended: AT_BREAK };
    }
    const junk = readPlain(value);
    if (junk.added > 0) report('quote_junk');
    return junk;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const openPos = pos;
    const openLine = line;
    // The common quoted field: the next quote closes it and its content holds
    // no line break, so one slice is the whole field.
    const close = text.indexOf('"', pos + 1);
    if (close !== -1 && text[close + 1] !== '"') {
      const content = text.slice(pos + 1, close);
      if (content.indexOf('\n') === -1 && content.indexOf('\r') === -1) {
        pos = close + 1;
        return finishQuoted(content);
      }
    }
    // The general path: doubled quotes, line breaks inside the quotes, or a
    // quote that never closes. The scan lifts the run up to the nearer of the
    // next quote and the next LF out with one slice and looks for a CR inside
    // that run alone.
    const pieces = [];
    let p = pos + 1;
    let closed = false;
    for (;;) {
      let i = text.indexOf('"', p);
      const lf = text.indexOf('\n', p);
      if (lf !== -1 && (i === -1 || lf < i)) i = lf;
      const stop = i === -1 ? len : i;
      const run = text.slice(p, stop);
      const crAt = run.indexOf('\r');
      if (crAt !== -1) {
        // CRLF and a lone CR inside quotes are each read as one LF.
        const cr = p + crAt;
        pieces.push(run.slice(0, crAt), '\n');
        line += 1;
        p = text[cr + 1] === '\n' ? cr + 2 : cr + 1;
        continue;
      }
      if (i === -1) {
        pieces.push(run);
        p = len;
        break;
      }
      if (text[i] === '\n') {
        // An LF inside quotes stays in the value as it stands; it only moves
        // the line count.
        pieces.push(run, '\n');
        line += 1;
        p = i + 1;
        continue;
      }
      // The run ends at a quote: a doubled one is one quote in the value,
      // a single one closes the field.
      if (text[i + 1] === '"') {
        pieces.push(run, '"');
        p = i + 2;
        continue;
      }
      pieces.push(run);
      p = i + 1;
      closed = true;
      break;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as an unquoted field, from just past the quote, with
      // the line count as it was when the quote opened.
      pos = openPos + 1;
      line = openLine;
      report('unterminated_quote');
      return readPlain('"');
    }
    pos = p;
    return finishQuoted(pieces.join(''));
  }

  for (;;) {
    // Lines with no characters are no records: skip bare LFs and CRLFs.
    while (pos < len) {
      const c = text[pos];
      if (c === '\n') {
        pos += 1;
        line += 1;
      } else if (c === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recLine = line;
    recRow = header && columns === null ? null : rows.length;

    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text[pos] === '"';
      field = quoted ? readQuoted() : readPlain('');
      fields.push(field.value);
    } while (field.ended === AT_COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (the stray_cr errors it raised stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? columns ?? [] : null, rows, errors };
}
