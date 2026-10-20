// The task description says the reason for low conversion stays unknown. These three numbers
// are the answer: how many students opened the form, started filling it and sent it.

export function buildFunnel(events, formId) {
  const visits = { opened: new Set(), started: new Set(), submitted: new Set() };

  for (const event of events) {
    if (event.formId !== formId) continue;
    if (!visits[event.type]) continue;
    visits[event.type].add(event.visitId);
  }

  // A submission counts as started too: the first-keystroke event needs JavaScript, and without
  // it the funnel would show more submissions than starts.
  for (const visitId of visits.submitted) visits.started.add(visitId);

  const opened = visits.opened.size;
  const started = visits.started.size;
  const submitted = visits.submitted.size;

  return { opened, started, submitted, comment: comment(opened, started, submitted) };
}

export function share(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

function comment(opened, started, submitted) {
  if (!opened) return 'Форму еще никто не открывал, считать нечего.';
  if (!started) return `Форму открыли ${opened} раз и ни разу не начали заполнять: студенты уходят с первого экрана.`;

  const lostBeforeStart = opened - started;
  const lostWhileFilling = started - submitted;

  if (lostBeforeStart === 0 && lostWhileFilling === 0) return 'Все, кто открыл форму, дошли до отправки.';
  if (lostBeforeStart > lostWhileFilling) {
    return `Больше всего теряется на входе: ${lostBeforeStart} из ${opened} открывших не начали заполнять. Смотрите на первый экран, длину формы и описание.`;
  }
  if (lostWhileFilling > 0) {
    return `Больше всего теряется в середине: ${lostWhileFilling} из ${started} начавших не дошли до отправки. Смотрите на обязательные поля и длинные вопросы.`;
  }
  return `Все ${started} начавших заполнять отправили отклик, потери только на входе: ${lostBeforeStart} из ${opened}.`;
}
