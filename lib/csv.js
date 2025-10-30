const QUOTE_RE = new RegExp('[",\\r\\n]');

export function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = String(v ?? '');
    // Quote if it contains comma, quote, or newline (CR/LF)
    if (QUOTE_RE.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join(','));
  return lines.join('\n');
}

export function toCsvAndDownload(rows, filename = 'export.csv') {
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

