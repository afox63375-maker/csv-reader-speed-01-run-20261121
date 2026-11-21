// A fast drop-in replacement for csv-reader 1.0.0, written for the
// csv-reader-speed-01 contest. run(input) answers exactly what the reference
// reader answers for {text, header} — {columns, rows, errors} under its
// broken-row policy — but reads the text with indexOf-driven jumps and whole
// field slices instead of one character at a time.
//
// The policy, as this module applies it:
//   - one leading U+FEFF is dropped;
//   - records end at LF or CRLF; a line with nothing on it is no record;
//   - a CR outside quotes that is not part of a CRLF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next undoubled quote, ""
//     meaning one quote, and line breaks inside it (LF, CRLF, lone CR) each
//     become one LF in the value and one step of the line count;
//   - whatever stands between a closing quote and the next comma or line
//     break is appended to the field as it stands (quote_junk when any of it
//     is kept);
//   - a quote that never closes counts as a literal character and the rest of
//     the field is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings; rows are padded with "" (short_row) or cut
//     (long_row) to the first record's width;
//   - errors carry the line their record starts on and the record's index in
//     rows (null for the header), in the order they are met.

// Character codes the scanner jumps between.
const QUOTE = 34; // "
const COMMA = 44; // ,
const LF = 10; // \n
const CR = 13; // \r
const BOM = 0xfeff;

// How a field ended, as small ints: the record goes on, the record ends at a
// line break, or the record ends at the end of the text.
const ENDED_COMMA = 0;
const ENDED_BREAK = 1;
const ENDED_TEXT = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = n > 0 && text.charCodeAt(0) === BOM ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on and the index it takes in
  // rows (null while it could still be the header). Field errors are charged
  // to the record, so both are fixed before its first field is read.
  let recLine = 1;
  let recRow = null;

  // Forward-only landmarks: the next quote and the next CR at or after the
  // point they were last looked for. pos never moves backwards except for the
  // unterminated-quote re-read, which stays inside one field, so a landmark
  // behind pos is simply looked for again from pos.
  let nextQuote = text.indexOf('"', pos);
  let nextCr = text.indexOf('\r', pos);

  // What the field readers leave behind: the field's value, how it ended,
  // and how many characters the last unquoted read kept (quote_junk needs it).
  let fValue = '';
  let fEnded = ENDED_TEXT;
  let fKept = 0;

  function fail(code) {
    errors.push({ code, line: recLine, row: recRow });
  }

  // The next CR at or after p, refreshing the landmark when it has fallen
  // behind. Returns -1 when the rest of the text holds none.
  function crFrom(p) {
    if (nextCr !== -1 && nextCr < p) nextCr = text.indexOf('\r', p);
    return nextCr;
  }

  // Reads an unquoted field whose value starts as `first` ("" for a plain
  // field, the opening quote for an unterminated one, a quoted field's value
  // for its junk tail). Stops at the next comma or line break; stray CRs are
  // dropped with an error each.
  function readPlain(first) {
    let kept = 0;
    let parts = null; // stays null while no stray CR has split the field
    for (;;) {
      const commaAt = text.indexOf(',', pos);
      const lfAt = text.indexOf('\n', pos);
      const crAt = crFrom(pos);
      let i = n;
      let kind = ENDED_TEXT;
      if (commaAt !== -1 && commaAt < i) {
        i = commaAt;
        kind = ENDED_COMMA;
      }
      if (lfAt !== -1 && lfAt < i) {
        i = lfAt;
        kind = ENDED_BREAK;
      }
      if (crAt !== -1 && crAt < i) {
        i = crAt;
        kind = 3; // a CR: CRLF ends the field, a lone one is stray
      }
      if (kind === 3 && text.charCodeAt(i + 1) !== LF) {
        if (parts === null) parts = [first, text.slice(pos, i)];
        else parts.push(text.slice(pos, i));
        kept += i - pos;
        fail('stray_cr');
        pos = i + 1;
        continue;
      }
      kept += i - pos;
      let value;
      if (parts === null) {
        value = first === '' ? text.slice(pos, i) : first + text.slice(pos, i);
      } else {
        parts.push(text.slice(pos, i));
        value = parts.join('');
      }
      if (kind === ENDED_TEXT) {
        pos = n;
        fEnded = ENDED_TEXT;
      } else if (kind === ENDED_COMMA) {
        pos = i + 1;
        fEnded = ENDED_COMMA;
      } else if (kind === ENDED_BREAK) {
        pos = i + 1;
        line += 1;
        fEnded = ENDED_BREAK;
      } else {
        pos = i + 2; // CRLF
        line += 1;
        fEnded = ENDED_BREAK;
      }
      fValue = value;
      fKept = kept;
      return;
    }
  }

  // The stretch of a quoted field between two quotes, [a, b): appends its
  // reading to `parts` (or returns it when parts is null and it stands
  // alone), with every CR or CRLF inside read as one LF and counted.
  function quotedStretch(a, b, parts) {
    const crAt = crFrom(a);
    if (crAt === -1 || crAt >= b) {
      // No CR inside: the stretch stands as it is; only its LFs count.
      const seg = text.slice(a, b);
      let j = text.indexOf('\n', a);
      while (j !== -1 && j < b) {
        line += 1;
        j = text.indexOf('\n', j + 1);
      }
      if (parts === null) return seg;
      parts.push(seg);
      return null;
    }
    // CRs inside: count the breaks (each CR one, each LF not after a CR
    // one), then rewrite CRLF and lone CR alike as LF.
    let j = a;
    for (;;) {
      j = text.indexOf('\r', j);
      if (j === -1 || j >= b) break;
      line += 1;
      j += 1;
    }
    j = text.indexOf('\n', a);
    while (j !== -1 && j < b) {
      if (text.charCodeAt(j - 1) !== CR) line += 1;
      j = text.indexOf('\n', j + 1);
    }
    const seg = text.slice(a, b).replace(/\r\n|\r/g, '\n');
    if (parts === null) return seg;
    parts.push(seg);
    return null;
  }

  // Reads a field whose opening quote is at pos.
  function readQuoted() {
    const openPos = pos;
    const openLine = line;
    pos += 1;
    let segStart = pos;
    let parts = null;
    let value = '';
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as an unquoted field. The re-read steps pos
        // back to just after the opening quote, so the landmarks — looked
        // for from points the scan had already passed — are looked for
        // again from there.
        pos = openPos + 1;
        line = openLine;
        nextCr = text.indexOf('\r', pos);
        nextQuote = text.indexOf('"', pos);
        fail('unterminated_quote');
        readPlain('"');
        return;
      }
      if (q > segStart) {
        const seg = quotedStretch(segStart, q, parts);
        if (parts === null) {
          if (seg !== null) value = seg;
        }
      }
      if (text.charCodeAt(q + 1) === QUOTE) {
        if (parts === null) {
          parts = [value];
          value = '';
        }
        parts.push('"');
        pos = q + 2;
        segStart = pos;
        continue;
      }
      if (parts !== null) value = parts.join('');
      pos = q + 1;
      break;
    }
    if (pos >= n) {
      fValue = value;
      fEnded = ENDED_TEXT;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === COMMA) {
      pos += 1;
      fValue = value;
      fEnded = ENDED_COMMA;
      return;
    }
    if (c === LF) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = ENDED_BREAK;
      return;
    }
    if (c === CR && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = ENDED_BREAK;
      return;
    }
    // Anything else after the closing quote is junk, appended as it stands
    // by the unquoted read; it is quote_junk when any of it is kept.
    readPlain(value);
    if (fKept > 0) fail('quote_junk');
  }

  for (;;) {
    // Lines left with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recLine = line;
    recRow = header && columns === null ? null : rows.length;

    if (nextQuote !== -1 && nextQuote < pos) nextQuote = text.indexOf('"', pos);

    // A record with no quote and no CR before its line break (other than a
    // CRLF's own CR) is a plain split on commas.
    const lfAt = text.indexOf('\n', pos);
    const lineEnd = lfAt === -1 ? n : lfAt;
    const crlf = lfAt !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === CR;
    const contentEnd = crlf ? lineEnd - 1 : lineEnd;
    const crAt = crFrom(pos);

    let fields;
    let lastQuoted = false;
    if ((nextQuote === -1 || nextQuote >= lineEnd) && (crAt === -1 || crAt >= contentEnd) && contentEnd > pos) {
      fields = text.slice(pos, contentEnd).split(',');
      pos = lfAt === -1 ? n : lineEnd + 1;
      if (lfAt !== -1) line += 1;
    } else {
      fields = [];
      let ended;
      do {
        lastQuoted = text.charCodeAt(pos) === QUOTE;
        if (lastQuoted) readQuoted();
        else readPlain('');
        fields.push(fValue);
        ended = fEnded;
      } while (ended === ENDED_COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

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

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
