import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAnalytics, formatSeconds, share, typicalFillSeconds } from '../src/analytics.js';

const form = {
  id: 'form1',
  fields: [
    { id: 'name', type: 'text', label: 'Имя', required: true, options: [], min: null, max: null },
    { id: 'mail', type: 'email', label: 'Почта', required: true, options: [], min: null, max: null },
    { id: 'course', type: 'select', label: 'Курс', required: true, options: ['Бакалавриат', 'Магистратура'], min: null, max: null }
  ]
};

const at = (seconds) => new Date(Date.UTC(2026, 9, 20, 12, 0, seconds)).toISOString();
const event = (visitId, type, seconds, extra = {}) => ({ formId: 'form1', visitId, type, at: at(seconds), ...extra });

test('доля считается только при ненулевом знаменателе', () => {
  assert.equal(share(1, 4), 25);
  assert.equal(share(1, 0), null);
});

test('секунды переводятся в читаемую строку', () => {
  assert.equal(formatSeconds(45), '45 с');
  assert.equal(formatSeconds(60), '1 мин');
  assert.equal(formatSeconds(95), '1 мин 35 с');
});

test('воронка считает визиты, а не события', () => {
  const events = [
    event('a', 'opened', 0), event('a', 'started', 5), event('a', 'submitted', 60),
    event('b', 'opened', 0), event('b', 'started', 9),
    event('c', 'opened', 0)
  ];
  const { funnel } = buildAnalytics({ form, events, answers: [] });
  assert.deepEqual([funnel.opened, funnel.started, funnel.submitted], [3, 2, 1]);
});

test('отправка засчитывается как начало заполнения', () => {
  const events = [event('a', 'opened', 0), event('a', 'submitted', 30)];
  const { funnel } = buildAnalytics({ form, events, answers: [] });
  assert.equal(funnel.started, 1, 'без этого отправок было бы больше, чем начавших');
});

test('события чужой формы не попадают в счет', () => {
  const events = [event('a', 'opened', 0), { ...event('x', 'opened', 0), formId: 'other' }];
  assert.equal(buildAnalytics({ form, events, answers: [] }).funnel.opened, 1);
});

test('последнее поле считается только у тех, кто не отправил', () => {
  const events = [
    event('a', 'opened', 0), event('a', 'progress', 20, { fieldId: 'mail', filled: 1 }), event('a', 'submitted', 40),
    event('b', 'opened', 0), event('b', 'progress', 15, { fieldId: 'course', filled: 2 }),
    event('c', 'opened', 0), event('c', 'progress', 12, { fieldId: 'course', filled: 1 }),
    event('d', 'opened', 0)
  ];
  const { dropOff } = buildAnalytics({ form, events, answers: [] });
  assert.equal(dropOff.abandoned, 3);
  assert.equal(dropOff.reported, 2);
  assert.equal(dropOff.rows[0].field.id, 'course');
  assert.equal(dropOff.rows[0].count, 2);
});

test('отказы сервера считаются один раз на визит и поле', () => {
  const events = [
    event('a', 'opened', 0), event('a', 'attempt', 10), event('a', 'rejected', 10, { fieldId: 'mail' }),
    event('a', 'attempt', 20), event('a', 'rejected', 20, { fieldId: 'mail' }), event('a', 'submitted', 30),
    event('b', 'opened', 0), event('b', 'attempt', 12), event('b', 'rejected', 12, { fieldId: 'mail' })
  ];
  const { rejections, attempts } = buildAnalytics({ form, events, answers: [] });
  assert.equal(rejections.rows[0].field.id, 'mail');
  assert.equal(rejections.rows[0].count, 2);
  assert.equal(rejections.visitsWithAttempt, 2);
  assert.equal(attempts.total, 3);
  assert.equal(attempts.perAnswer, 3);
});

test('медиана времени берется по дошедшим до отправки', () => {
  const events = [
    event('a', 'opened', 0), event('a', 'submitted', 30),
    event('b', 'opened', 0), event('b', 'submitted', 90),
    event('c', 'opened', 0), event('c', 'submitted', 60),
    event('d', 'opened', 0)
  ];
  const { timing } = buildAnalytics({ form, events, answers: [] });
  assert.equal(timing.medianFill, 60);
  assert.equal(timing.medianFillOf, 3);
});

test('типичное время не показывается, пока откликов мало', () => {
  const events = [event('a', 'opened', 0), event('a', 'submitted', 30)];
  const analytics = buildAnalytics({ form, events, answers: [] });
  assert.equal(typicalFillSeconds(analytics), null);
  assert.equal(typicalFillSeconds(analytics, 1), 30);
});

test('распределение ответов считается по заполнившим вопрос', () => {
  const answers = [
    { values: { course: 'Магистратура' } },
    { values: { course: 'Магистратура' } },
    { values: { course: '' } }
  ];
  const { distribution } = buildAnalytics({ form, events: [], answers });
  const course = distribution.find((item) => item.field.id === 'course');
  assert.equal(course.answered, 2);
  assert.equal(course.rows[0].option, 'Магистратура');
  assert.equal(course.rows[0].count, 2);
});
