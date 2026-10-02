// Minimal RFC-4180 CSV parser/serializer (no dependencies). Handles quoted fields, escaped quotes,
// CRLF/LF, UTF-8 BOM, and auto-detects comma / tab / semicolon delimiters.

export function detectDelimiter(text) {
  const firstLine = text.slice(0, 5000).split(/\r?\n/)[0] || '';
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  let best = ',';
  for (const d of Object.keys(counts)) if (counts[d] > counts[best]) best = d;
  return best;
}

/** Parse CSV text into an array of string arrays. */
export function parseCSVRows(text, delimiter) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
    if (ch === d) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (inQuotes) {
    const err = new Error('Malformed CSV: unterminated quoted field');
    err.code = 'CSV_UNTERMINATED_QUOTE';
    throw err;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // drop fully empty trailing lines
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

/**
 * Parse CSV into objects keyed by header. Returns { headers, records, warnings }.
 * 'NA', 'N/A', '' and 'null' are converted to null.
 */
export function parseCSV(text, { delimiter, naValues = ['', 'NA', 'N/A', 'null', 'NULL', 'NaN'] } = {}) {
  const rows = parseCSVRows(text, delimiter);
  if (!rows.length) return { headers: [], records: [], warnings: ['File is empty'] };
  const headers = rows[0].map((h) => h.trim());
  const warnings = [];
  const seen = new Map();
  headers.forEach((h, i) => {
    if (seen.has(h)) {
      warnings.push(`Duplicate column header "${h}" (columns ${seen.get(h) + 1} and ${i + 1}); the second was renamed "${h}_${i + 1}".`);
      headers[i] = `${h}_${i + 1}`;
    } else seen.set(h, i);
  });
  const na = new Set(naValues);
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0] === '') continue;
    if (row.length !== headers.length) {
      warnings.push(`Row ${r + 1} has ${row.length} fields; expected ${headers.length}.`);
    }
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const v = row[c];
      obj[headers[c]] = v === undefined || na.has(v.trim()) ? null : v.trim();
    }
    records.push(obj);
  }
  return { headers, records, warnings };
}

function escapeField(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  // Spreadsheet formula injection: a text cell from a source or an import (e.g. a player "name" of =HYPERLINK(…))
  // would run as a formula when the export is opened in Excel/Sheets. Prefix such text with ' — numbers (including
  // negative ones written as text, like "-12.5") are left alone.
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize objects to CSV. columns: array of keys or {key, label}. */
export function toCSV(objects, columns) {
  const cols = (columns || Object.keys(objects[0] || {})).map((c) => (typeof c === 'string' ? { key: c, label: c } : c));
  const lines = [cols.map((c) => escapeField(c.label ?? c.key)).join(',')];
  for (const o of objects) {
    lines.push(cols.map((c) => escapeField(typeof c.get === 'function' ? c.get(o) : o[c.key])).join(','));
  }
  return lines.join('\n') + '\n';
}

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[$%\s]/g, '');
  // Commas: thousands separators only when they form 3-digit groups ("1,234", "12,345.6"); otherwise a decimal comma
  // ("12,5", "0,85" — European exports, usually ';'-delimited). Stripping every comma read "0,85" as 85.
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^[-+]?\d*,\d+$/.test(s)) s = s.replace(',', '.');
  if (s === '' || s === '-' || /^n\/?a$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
