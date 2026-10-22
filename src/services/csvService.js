function escapeCsv(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Prevent formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(escapeCsv).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escapeCsv(row[h])).join(','));
  }
  return lines.join('\r\n');
}

module.exports = { toCsv, escapeCsv };