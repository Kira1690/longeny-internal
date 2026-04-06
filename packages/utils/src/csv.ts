/**
 * Convert array of objects to CSV string
 */
export function toCSV(data: Record<string, unknown>[], headers?: string[]): string {
  if (data.length === 0) return '';

  const keys = headers || Object.keys(data[0]);
  const headerRow = keys.map(escapeCSV).join(',');
  const rows = data.map(row =>
    keys.map(key => escapeCSV(String(row[key] ?? ''))).join(',')
  );

  return [headerRow, ...rows].join('\n');
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
