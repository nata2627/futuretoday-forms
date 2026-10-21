import assert from 'node:assert/strict';
import { test } from 'node:test';

import { answersToCsv, contentDisposition } from '../src/csv.js';

const form = {
  id: 'f1',
  title: 'Стажировка, лето 2026',
  fields: [
    { id: 'name', type: 'text', label: 'Имя', required: true, options: [], min: null, max: null },
    { id: 'tel', type: 'tel', label: 'Телефон', required: false, options: [], min: null, max: null },
    { id: 'areas', type: 'checkbox', label: 'Направления', required: false, options: ['Аналитика', 'Разработка'], min: null, max: null },
    { id: 'about', type: 'textarea', label: 'О себе', required: false, options: [], min: null, max: null }
  ]
};

const answer = (values) => ({
  id: 'a1',
  formId: 'f1',
  visitId: 'v1',
  values: { name: '', tel: '', areas: [], about: '', ...values },
  createdAt: '2026-10-21T10:08:29.493Z'
});

const lines = (csv) => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

test('метка кодировки стоит первой, иначе Excel читает файл как cp1251', () => {
  assert.ok(answersToCsv(form, []).startsWith('﻿'));
});

test('столбцы разделены точкой с запятой, как ждет русский Excel', () => {
  const [header] = lines(answersToCsv(form, []));
  assert.equal(header, 'Когда;Имя;Телефон;Направления;О себе');
});

test('дата идет в местном формате, без ISO и часового пояса', () => {
  const [, row] = lines(answersToCsv(form, [answer({ name: 'Анна' })]));
  const when = row.split(';')[0];
  assert.match(when, /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
  assert.ok(!when.includes('T') && !when.includes('Z'), 'в файл ушла ISO-строка');
});

test('телефон с плюсом не превращается в формулу', () => {
  const [, row] = lines(answersToCsv(form, [answer({ tel: '+7 (916) 123-45-67' })]));
  assert.equal(row.split(';')[2], "'+7 (916) 123-45-67");
});

const unquote = (field) => (field.startsWith('"') ? field.slice(1, -1).replaceAll('""', '"') : field);

test('формула, вставленная студентом, обезврежена', () => {
  for (const value of ['=1+1', '-2+3', '@SUM(A1)', '=HYPERLINK("http://x")']) {
    const [, row] = lines(answersToCsv(form, [answer({ name: value })]));
    assert.equal(unquote(row.split(';')[1]), `'${value}`, `значение ${value} ушло как формула`);
  }
});

test('точка с запятой внутри значения закавычена и столбцы не разъезжаются', () => {
  const csv = answersToCsv(form, [answer({ name: 'Иванова; Анна' })]);
  const [, row] = lines(csv);
  assert.ok(row.includes('"Иванова; Анна"'));
  assert.equal(row.split('"').length, 3, 'кавычки должны обрамлять ровно одно значение');
});

test('кавычка внутри значения удваивается', () => {
  const [, row] = lines(answersToCsv(form, [answer({ name: 'Анна "Аня"' })]));
  assert.ok(row.includes('"Анна ""Аня"""'));
});

test('запятая в значении кавычек больше не требует', () => {
  const [, row] = lines(answersToCsv(form, [answer({ areas: ['Аналитика', 'Разработка'] })]));
  assert.equal(row.split(';')[3], 'Аналитика, Разработка');
});

test('перевод строки внутри значения не рвет файл на лишние записи', () => {
  const csv = answersToCsv(form, [answer({ about: 'первая\nвторая' })]);
  assert.equal(lines(csv).length, 2, 'записей должно быть две, заголовок и один отклик');
  assert.ok(csv.includes('"первая\nвторая"'), 'многострочное значение должно быть в кавычках');
});

test('имя файла идет и латиницей, и в кодировке RFC 5987', () => {
  const header = contentDisposition(form, new Date('2026-10-21T00:00:00Z'));
  assert.ok(header.includes('filename="otkliki-2026-10-21.csv"'));
  assert.ok(header.includes("filename*=UTF-8''"));
  assert.ok(!/[^\x00-\x7F]/.test(header), 'в заголовке HTTP остались нелатинские символы');
});
