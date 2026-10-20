// The task description says the reason for low conversion stays unknown. This module turns the
// raw events into the numbers that answer it: how far students get, where they are seen last,
// which fields the server rejects, and how long the form actually takes.

import { hasOptions, isMulti } from './validation.js';

export function share(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function formatSeconds(seconds) {
  if (seconds === null) return null;
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} мин ${rest} с` : `${minutes} мин`;
}

// One row per visit: a visit is one opening of the public page, identified by a random id that
// the server puts into that page. No cookies, no addresses, nothing about the person.
function collectVisits(events, formId) {
  const visits = new Map();

  for (const event of events) {
    if (event.formId !== formId) continue;
    let visit = visits.get(event.visitId);
    if (!visit) {
      visit = { attempts: 0, rejected: new Set() };
      visits.set(event.visitId, visit);
    }
    const at = Date.parse(event.at);

    switch (event.type) {
      case 'opened': visit.opened = at; break;
      case 'started': visit.started = at; break;
      case 'submitted': visit.submitted = at; break;
      case 'attempt': visit.attempts += 1; break;
      case 'rejected': visit.rejected.add(event.fieldId); break;
      case 'progress':
        visit.lastFieldId = event.fieldId;
        visit.filled = event.filled;
        break;
      default: break;
    }
  }

  return visits;
}

function funnelComment(opened, started, submitted) {
  if (!opened) return 'Форму еще никто не открывал, считать нечего.';
  if (!started) return `Форму открыли ${opened} раз и ни разу не начали заполнять: студенты уходят с первого экрана.`;

  const lostBeforeStart = opened - started;
  const lostWhileFilling = started - submitted;

  if (!lostBeforeStart && !lostWhileFilling) return 'Все, кто открыл форму, дошли до отправки.';
  if (lostBeforeStart > lostWhileFilling) {
    return `Больше всего теряется на входе: ${lostBeforeStart} из ${opened} открывших не начали заполнять. Смотрите на первый экран, длину формы и описание.`;
  }
  if (lostWhileFilling > 0) {
    return `Больше всего теряется в середине: ${lostWhileFilling} из ${started} начавших не дошли до отправки. Смотрите на обязательные поля и длинные вопросы.`;
  }
  return `Все ${started} начавших заполнять отправили отклик, потери только на входе: ${lostBeforeStart} из ${opened}.`;
}

function answerValues(answers, field) {
  const counts = new Map();
  let answered = 0;

  for (const answer of answers) {
    const value = answer.values[field.id];
    const chosen = isMulti(field.type) ? (Array.isArray(value) ? value : []) : (value ? [value] : []);
    if (chosen.length) answered += 1;
    for (const item of chosen) counts.set(item, (counts.get(item) || 0) + 1);
  }

  const rows = (hasOptions(field.type) ? field.options : ['да'])
    .map((option) => ({ option, count: counts.get(option) || 0 }))
    .sort((a, b) => b.count - a.count);

  return { rows, answered };
}

export function buildAnalytics({ form, events, answers }) {
  const visits = collectVisits(events, form.id);
  const all = [...visits.values()];

  const opened = all.filter((visit) => visit.opened !== undefined);
  const submittedVisits = opened.filter((visit) => visit.submitted !== undefined);
  // A submission counts as started too: the first-keystroke event needs JavaScript, and without
  // it the funnel would show more submissions than starts.
  const startedVisits = opened.filter((visit) => visit.started !== undefined || visit.submitted !== undefined);

  const funnel = {
    opened: opened.length,
    started: startedVisits.length,
    submitted: submittedVisits.length
  };
  funnel.comment = funnelComment(funnel.opened, funnel.started, funnel.submitted);

  const abandoned = opened.filter((visit) => visit.submitted === undefined);
  const withLastField = abandoned.filter((visit) => visit.lastFieldId);
  const lastFieldCounts = new Map();
  for (const visit of withLastField) {
    lastFieldCounts.set(visit.lastFieldId, (lastFieldCounts.get(visit.lastFieldId) || 0) + 1);
  }

  const dropOff = {
    abandoned: abandoned.length,
    reported: withLastField.length,
    rows: form.fields
      .map((field, index) => ({
        field,
        position: index + 1,
        count: lastFieldCounts.get(field.id) || 0
      }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count),
    medianFilled: median(withLastField.map((visit) => visit.filled).filter((value) => Number.isFinite(value)))
  };

  const rejectionCounts = new Map();
  for (const visit of all) {
    for (const fieldId of visit.rejected) {
      rejectionCounts.set(fieldId, (rejectionCounts.get(fieldId) || 0) + 1);
    }
  }
  const attemptVisits = all.filter((visit) => visit.attempts > 0);
  const rejections = {
    visitsWithAttempt: attemptVisits.length,
    rows: form.fields
      .map((field) => ({ field, count: rejectionCounts.get(field.id) || 0 }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count)
  };

  const fillSeconds = submittedVisits
    .filter((visit) => visit.opened !== undefined)
    .map((visit) => Math.round((visit.submitted - visit.opened) / 1000));
  const thinkSeconds = startedVisits
    .filter((visit) => visit.started !== undefined && visit.opened !== undefined)
    .map((visit) => Math.round((visit.started - visit.opened) / 1000));

  const timing = {
    medianFill: median(fillSeconds),
    medianFillOf: fillSeconds.length,
    medianThink: median(thinkSeconds),
    medianThinkOf: thinkSeconds.length
  };

  const totalAttempts = all.reduce((sum, visit) => sum + visit.attempts, 0);
  const attempts = {
    total: totalAttempts,
    submitted: funnel.submitted,
    perAnswer: funnel.submitted ? Math.round((totalAttempts / funnel.submitted) * 10) / 10 : null
  };

  const distribution = form.fields
    .filter((field) => hasOptions(field.type) || field.type === 'consent')
    .map((field) => ({ field, ...answerValues(answers, field) }));

  return { funnel, dropOff, rejections, timing, attempts, distribution, answers: answers.length };
}

// Shown on the public page once there is something to average: a promise about filling time
// should come from measurements, not from a guess.
export function typicalFillSeconds(analytics, minimumAnswers = 5) {
  if (analytics.timing.medianFillOf < minimumAnswers) return null;
  return analytics.timing.medianFill;
}
