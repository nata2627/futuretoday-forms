import { displayValue, formatDateForFile } from './views.js';

// Excel on a Russian system splits a csv by semicolons, and this file is opened by a manager,
// not by a script. The separator follows the reader.
const SEPARATOR = ';';

// A leading =, +, - or @ turns a cell into a formula. Excel reads a phone number like
// +7 (916) 123-45-67 as arithmetic, and a student can paste a real formula on purpose. An
// apostrophe in front keeps the cell as text and stays invisible in the table.
function guardFormula(text) {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cell(value) {
  const text = guardFormula(String(value ?? ''));
  return /["\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Byte order mark first: without it Excel opens a UTF-8 file as cp1251 and the labels turn
// into noise, which is exactly the file a manager would open first.
export function answersToCsv(form, answers) {
  const header = ['Когда', ...form.fields.map((field) => field.label)];
  const rows = answers.map((answer) => [
    formatDateForFile(answer.createdAt),
    ...form.fields.map((field) => displayValue(field, answer.values[field.id]))
  ]);

  return `\uFEFF${[header, ...rows].map((row) => row.map(cell).join(SEPARATOR)).join('\r\n')}\r\n`;
}

// HTTP headers are latin-1, so a Russian form title cannot go into filename= directly.
// RFC 5987 gives the plain fallback name and the real one side by side.
export function contentDisposition(form, today = new Date()) {
  const date = today.toISOString().slice(0, 10);
  const name = `${form.title.replace(/["\\]/g, '').trim() || 'Отклики'}, ${date}.csv`;
  return `attachment; filename="otkliki-${date}.csv"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
