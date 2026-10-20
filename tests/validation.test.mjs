import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateAnswer, validateField, validateFormDraft } from '../src/validation.js';

const field = (type, extra = {}) => ({
  id: 'q1',
  type,
  label: 'Вопрос',
  hint: '',
  required: true,
  options: extra.options || [],
  min: extra.min ?? null,
  max: extra.max ?? null
});

const answerErrors = (one, body) => validateAnswer({ fields: [one] }, body).errors.q1;

test('форма без названия не принимается', () => {
  assert.equal(validateFormDraft({ title: '   ' }).errors.title, 'Введите название формы');
  assert.deepEqual(validateFormDraft({ title: 'Стажировка' }).errors, {});
});

test('список требует не меньше двух непустых вариантов', () => {
  assert.ok(validateField({ label: 'Курс', type: 'select', options: '' }).errors.options);
  assert.ok(validateField({ label: 'Курс', type: 'select', options: 'Один' }).errors.options);
  assert.ok(validateField({ label: 'Курс', type: 'select', options: 'Один\nОдин' }).errors.options);
  assert.deepEqual(validateField({ label: 'Курс', type: 'select', options: 'Один\nДва' }).errors, {});
});

test('границы числа не могут идти задом наперед', () => {
  assert.ok(validateField({ label: 'Часы', type: 'number', min: '40', max: '10' }).errors.max);
});

test('обязательное поле без значения отклоняется', () => {
  assert.equal(answerErrors(field('text'), {}), 'Это поле обязательное');
});

test('почта проверяется по форме адреса', () => {
  assert.ok(answerErrors(field('email'), { q1: 'abc' }));
  assert.equal(answerErrors(field('email'), { q1: 'a@b.ru' }), undefined);
});

test('телефон проверяется по количеству цифр', () => {
  assert.ok(answerErrors(field('tel'), { q1: '+7 999' }));
  assert.ok(answerErrors(field('tel'), { q1: 'позвоните мне' }));
  assert.equal(answerErrors(field('tel'), { q1: '+7 (916) 123-45-67' }), undefined);
});

test('число проверяется по границам', () => {
  const hours = field('number', { min: 1, max: 40 });
  assert.ok(answerErrors(hours, { q1: '0' }));
  assert.ok(answerErrors(hours, { q1: '41' }));
  assert.ok(answerErrors(hours, { q1: 'много' }));
  assert.equal(answerErrors(hours, { q1: '20' }), undefined);
});

test('несуществующая дата отклоняется', () => {
  assert.ok(answerErrors(field('date'), { q1: '2026-02-31' }));
  assert.ok(answerErrors(field('date'), { q1: '31.02.2026' }));
  assert.equal(answerErrors(field('date'), { q1: '2026-06-01' }), undefined);
});

test('выбор принимается только из своих вариантов', () => {
  const course = field('select', { options: ['Бакалавриат', 'Магистратура'] });
  assert.ok(answerErrors(course, { q1: 'Аспирантура' }));
  assert.equal(answerErrors(course, { q1: 'Магистратура' }), undefined);
});

test('множественный выбор отбрасывает чужие значения', () => {
  const areas = field('checkbox', { options: ['Аналитика', 'Разработка'] });
  const { values, errors } = validateAnswer({ fields: [areas] }, { q1: ['Аналитика', 'Чужое'] });
  assert.deepEqual(values.q1, ['Аналитика']);
  assert.equal(errors.q1, undefined);
  assert.ok(validateAnswer({ fields: [areas] }, { q1: ['Чужое'] }).errors.q1);
});

test('согласие без галочки не проходит', () => {
  assert.ok(answerErrors(field('consent'), {}));
  assert.equal(answerErrors(field('consent'), { q1: 'да' }), undefined);
});

test('поля, которых нет в схеме, в ответ не попадают', () => {
  const { values } = validateAnswer({ fields: [field('text')] }, { q1: 'Анна', q2: 'лишнее' });
  assert.deepEqual(Object.keys(values), ['q1']);
});

test('слишком длинное значение отклоняется', () => {
  assert.ok(answerErrors(field('text'), { q1: 'a'.repeat(2001) }));
  assert.equal(answerErrors(field('textarea'), { q1: 'a'.repeat(2001) }), undefined);
});
