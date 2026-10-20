import { displayValue } from './views.js';

function cell(value) {
  const text = String(value ?? '');
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Byte order mark first: without it Excel opens a UTF-8 file as cp1251 and the labels turn
// into noise, which is exactly the file a manager would open first.
export function answersToCsv(form, answers) {
  const header = ['Когда', ...form.fields.map((field) => field.label)];
  const rows = answers.map((answer) => [
    new Date(answer.createdAt).toISOString(),
    ...form.fields.map((field) => displayValue(field, answer.values[field.id]))
  ]);

  return `\uFEFF${[header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

// HTTP headers are latin-1, so a Russian form title cannot go into filename= directly.
// RFC 5987 gives the plain fallback name and the real one side by side.
export function contentDisposition(form, today = new Date()) {
  const date = today.toISOString().slice(0, 10);
  const name = `${form.title.replace(/["\\]/g, '').trim() || 'Отклики'}, ${date}.csv`;
  return `attachment; filename="otkliki-${date}.csv"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
