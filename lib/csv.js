const QUOTE_RE = new RegExp('[",\\r\\n]');

export function toCsv(rows) {
  if (!rows || !rows.length) return '';
  
  // 모든 행의 키를 수집 (첫 행에 없는 필드도 포함)
  const headerSet = new Set();
  rows.forEach(r => {
    if (r && typeof r === 'object') {
      Object.keys(r).forEach(k => headerSet.add(k));
    }
  });
  const headers = Array.from(headerSet);
  
  const escape = (v) => {
    const s = String(v ?? '');
    // Quote if it contains comma, quote, or newline (CR/LF)
    if (QUOTE_RE.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h] ?? '')).join(','));
  }
  
  // BOM 추가 (Excel 호환)
  return '\ufeff' + lines.join('\n');
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

