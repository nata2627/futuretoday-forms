import { FIELD_TYPES, hasOptions } from './validation.js';
import { formatSeconds, share } from './analytics.js';
import {
  displayValue,
  errorBox,
  escapeHtml,
  formatDate,
  page,
  plural
} from './views.js';

const typeLabels = new Map(FIELD_TYPES.map((type) => [type.value, type.label]));

function siteHeader() {
  return `<header class="site">
<div class="site-inner">
<a class="site-name" href="/admin">Формы отклика</a>
<span class="site-note">админка без авторизации, так требует задание</span>
</div>
</header>`;
}

function tabs(form, current, answerCount) {
  const items = [
    ['', 'Конструктор'],
    ['/answers', `Ответы (${answerCount})`],
    ['/analytics', 'Аналитика'],
    ['/preview', 'Предпросмотр']
  ];
  return `<nav class="tabs">
${items.map(([suffix, label]) => {
    const href = `/admin/forms/${escapeHtml(form.id)}${suffix}`;
    const active = suffix === current ? ' class="active" aria-current="page"' : '';
    return `<a href="${href}"${active}>${escapeHtml(label)}</a>`;
  }).join('\n')}
</nav>`;
}

function formHeader(form, current, answerCount) {
  return `<p class="back"><a href="/admin">Все формы</a></p>
<div class="form-title">
<h1>${escapeHtml(form.title)}</h1>
<span class="badge ${form.published ? 'badge-live' : 'badge-draft'}">${form.published ? 'опубликована' : 'черновик'}</span>
</div>
<p class="meta">Создана ${escapeHtml(formatDate(form.createdAt))}${form.updatedAt ? `, изменена ${escapeHtml(formatDate(form.updatedAt))}` : ''}</p>
${tabs(form, current, answerCount)}`;
}

function adminPage({ title, form, tab, answerCount, body }) {
  return page({
    title,
    header: siteHeader(),
    bodyClass: 'admin',
    body: `${formHeader(form, tab, answerCount)}
${body}`
  });
}

export function adminListPage({ forms, answerCounts, errors = {}, values = {} }) {
  const rows = forms.map((form) => `<tr>
<td><a href="/admin/forms/${escapeHtml(form.id)}">${escapeHtml(form.title)}</a></td>
<td><span class="badge ${form.published ? 'badge-live' : 'badge-draft'}">${form.published ? 'опубликована' : 'черновик'}</span></td>
<td class="num">${form.fields.length}</td>
<td class="num">${answerCounts[form.id] || 0}</td>
<td>${escapeHtml(formatDate(form.createdAt))}</td>
</tr>`).join('\n');

  const table = forms.length
    ? `<div class="card">
<table>
<thead><tr><th>Форма</th><th>Статус</th><th class="num">Полей</th><th class="num">Ответов</th><th>Создана</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>`
    : `<div class="card empty">
<p><b>Форм пока нет.</b></p>
<p>Назовите первую форму, добавьте вопросы и нажмите «Опубликовать»: появится ссылка, которую можно отправить студентам.</p>
</div>`;

  return page({
    title: 'Админка, формы отклика',
    header: siteHeader(),
    bodyClass: 'admin',
    body: `<h1>Формы отклика</h1>
${table}
<div class="card">
<h2>Новая форма</h2>
${errorBox(Object.values(errors))}
<form method="post" action="/admin/forms" class="stack">
<div class="field">
<label for="new-title">Название</label>
<input type="text" id="new-title" name="title" maxlength="200" value="${escapeHtml(values.title)}" placeholder="Стажировка в отделе аналитики, лето 2026">
</div>
<div class="field">
<label for="new-description">Описание, необязательно</label>
<textarea id="new-description" name="description" maxlength="1000" rows="3" placeholder="Пара строк о стажировке и о том, что будет после отклика">${escapeHtml(values.description)}</textarea>
</div>
<div class="actions"><button type="submit">Создать форму</button></div>
</form>
</div>`
  });
}

function fieldSummary(field) {
  const parts = [typeLabels.get(field.type) || field.type];
  if (field.required) parts.push('обязательное');
  if (hasOptions(field.type)) parts.push(`${field.options.length} ${plural(field.options.length, 'вариант', 'варианта', 'вариантов')}`);
  if (field.type === 'number' && (field.min !== null || field.max !== null)) {
    parts.push(`от ${field.min ?? 'любого'} до ${field.max ?? 'любого'}`);
  }
  return parts.join(' · ');
}

function fieldRow(form, field, index, total) {
  const base = `/admin/forms/${escapeHtml(form.id)}/fields/${escapeHtml(field.id)}`;
  return `<li class="field-row">
<div class="field-row-main">
<p class="field-row-label"><span class="field-num">${index + 1}</span> ${escapeHtml(field.label)}${field.required ? ' <span class="req">*</span>' : ''}</p>
<p class="meta">${escapeHtml(fieldSummary(field))}</p>
${field.hint ? `<p class="meta">подсказка: ${escapeHtml(field.hint)}</p>` : ''}
${hasOptions(field.type) ? `<p class="meta options">${field.options.map((option) => `<span>${escapeHtml(option)}</span>`).join('')}</p>` : ''}
</div>
<div class="field-row-actions">
<form method="post" action="${base}/move"><input type="hidden" name="direction" value="up"><button class="icon" type="submit" title="Выше"${index === 0 ? ' disabled' : ''}>вверх</button></form>
<form method="post" action="${base}/move"><input type="hidden" name="direction" value="down"><button class="icon" type="submit" title="Ниже"${index === total - 1 ? ' disabled' : ''}>вниз</button></form>
<a class="icon" href="${base}/edit">изменить</a>
<form method="post" action="${base}/delete"><button class="icon icon-danger" type="submit">удалить</button></form>
</div>
</li>`;
}

function fieldForm({ action, values, errors, submitLabel, lockedType = null }) {
  const typeOptions = FIELD_TYPES.map((type) => `<option value="${escapeHtml(type.value)}"${values.type === type.value ? ' selected' : ''}>${escapeHtml(type.label)}</option>`).join('\n');
  const typeTitle = lockedType
    ? '<p class="field-title">Тип вопроса</p>'
    : '<label for="field-type">Тип вопроса</label>';
  const typeControl = lockedType
    ? `<p class="locked">${escapeHtml(typeLabels.get(lockedType) || lockedType)}<input type="hidden" name="type" value="${escapeHtml(lockedType)}"></p>
<p class="meta">Тип поля не меняется после создания: уже собранные ответы хранятся в его формате. Удалите поле и добавьте заново, если тип выбран неверно.</p>`
    : `<select id="field-type" name="type" data-type-select>
${typeOptions}
</select>
<p class="meta">${FIELD_TYPES.map((type) => `<span class="type-hint" data-for="${escapeHtml(type.value)}"${values.type === type.value ? '' : ' hidden'}>${escapeHtml(type.hint)}</span>`).join('')}</p>`;

  return `<form method="post" action="${action}" class="stack">
${errorBox(Object.values(errors))}
<div class="field">
${typeTitle}
${typeControl}
</div>
<div class="field">
<label for="field-label">Подпись</label>
<input type="text" id="field-label" name="label" maxlength="200" value="${escapeHtml(values.label)}" placeholder="Имя и фамилия">
</div>
<div class="field">
<label for="field-hint">Подсказка под полем, необязательно</label>
<input type="text" id="field-hint" name="hint" maxlength="200" value="${escapeHtml(values.hint)}" placeholder="На нее придет ответ">
</div>
<div class="field" data-when="select radio checkbox">
<label for="field-options">Варианты, по одному в строке</label>
<textarea id="field-options" name="options" rows="4" placeholder="Бакалавриат&#10;Магистратура&#10;Не обучаюсь">${escapeHtml(values.optionsText)}</textarea>
</div>
<div class="row" data-when="number">
<div class="field">
<label for="field-min">Не меньше</label>
<input type="text" id="field-min" name="min" value="${escapeHtml(values.min)}" placeholder="1">
</div>
<div class="field">
<label for="field-max">Не больше</label>
<input type="text" id="field-max" name="max" value="${escapeHtml(values.max)}" placeholder="40">
</div>
</div>
<div class="field">
<label class="choice"><input type="checkbox" name="required"${values.required ? ' checked' : ''}> <span>Обязательное поле</span></label>
</div>
<div class="actions"><button type="submit">${escapeHtml(submitLabel)}</button></div>
</form>`;
}

const emptyFieldValues = { type: 'text', label: '', hint: '', optionsText: '', min: '', max: '', required: false };

export function builderPage({ form, link, answerCount, fieldValues = emptyFieldValues, fieldErrors = {}, formErrors = [] }) {
  const list = form.fields.length
    ? `<ol class="field-list">
${form.fields.map((field, index) => fieldRow(form, field, index, form.fields.length)).join('\n')}
</ol>`
    : '<p class="empty">Вопросов пока нет. Добавьте первый ниже: он сразу появится в предпросмотре.</p>';

  const publish = form.published
    ? `<p class="meta">Ссылка для студентов</p>
<div class="link-row">
<input type="text" readonly id="form-link" value="${escapeHtml(link)}">
<button class="secondary" type="button" data-copy="form-link">Скопировать</button>
</div>
<div class="actions">
<a class="button secondary" href="${escapeHtml(link)}">Открыть как студент</a>
<form method="post" action="/admin/forms/${escapeHtml(form.id)}/unpublish"><button class="secondary" type="submit">Снять с публикации</button></form>
</div>`
    : `<p class="empty">Форма не опубликована, ссылки у студентов нет. Предпросмотр доступен всегда.</p>
<div class="actions"><form method="post" action="/admin/forms/${escapeHtml(form.id)}/publish"><button type="submit">Опубликовать и получить ссылку</button></form></div>`;

  return adminPage({
    title: `Конструктор: ${form.title}`,
    form,
    tab: '',
    answerCount,
    body: `<div class="card">
<h2>Публикация</h2>
${errorBox(formErrors)}
${publish}
</div>

<div class="card">
<h2>Вопросы формы</h2>
${list}
</div>

<div class="card">
<h2>Новый вопрос</h2>
${fieldForm({
      action: `/admin/forms/${escapeHtml(form.id)}/fields`,
      values: fieldValues,
      errors: fieldErrors,
      submitLabel: 'Добавить вопрос'
    })}
</div>

<div class="card danger">
<h2>Удаление</h2>
<p class="meta">Форма удаляется вместе с ответами и событиями аналитики. Отменить это нельзя.</p>
<form method="post" action="/admin/forms/${escapeHtml(form.id)}/delete"><button class="danger" type="submit">Удалить форму</button></form>
</div>
<script src="/admin.js" defer></script>`
  });
}

export function fieldEditPage({ form, field, answerCount, values, errors }) {
  return adminPage({
    title: `Вопрос: ${field.label}`,
    form,
    tab: '',
    answerCount,
    body: `<div class="card">
<h2>Изменить вопрос</h2>
${fieldForm({
      action: `/admin/forms/${escapeHtml(form.id)}/fields/${escapeHtml(field.id)}`,
      values,
      errors,
      submitLabel: 'Сохранить',
      lockedType: field.type
    })}
<p class="meta">Уже собранные ответы останутся на месте: вопрос узнается по внутреннему идентификатору, а не по подписи.</p>
</div>
<p class="back"><a href="/admin/forms/${escapeHtml(form.id)}">Назад в конструктор</a></p>
<script src="/admin.js" defer></script>`
  });
}

export function answersPage({ form, answers, answerCount }) {
  const body = answers.length
    ? `<div class="card">
<div class="card-head">
<h2>${answers.length} ${plural(answers.length, 'отклик', 'отклика', 'откликов')}</h2>
<a class="button secondary" href="/admin/forms/${escapeHtml(form.id)}/answers.csv">Скачать CSV</a>
</div>
<div class="scroll">
<table>
<thead><tr><th>Когда</th>${form.fields.map((field) => `<th>${escapeHtml(field.label)}</th>`).join('')}</tr></thead>
<tbody>
${answers.map((answer) => `<tr><td class="nowrap">${escapeHtml(formatDate(answer.createdAt))}</td>${form.fields.map((field) => `<td>${escapeHtml(displayValue(field, answer.values[field.id]))}</td>`).join('')}</tr>`).join('\n')}
</tbody>
</table>
</div>
<p class="meta">Таблица строится по текущим вопросам формы. Ответ на удаленный вопрос остается в файле, но в таблицу не попадает.</p>
</div>`
    : `<div class="card empty">
<p><b>Ответов пока нет.</b></p>
<p>Откройте предпросмотр, отправьте форму сами и вернитесь сюда: так видно, что увидит менеджер.</p>
</div>`;

  return adminPage({ title: `Ответы: ${form.title}`, form, tab: '/answers', answerCount, body });
}

function bar(part, whole, label) {
  const percent = share(part, whole);
  return `<div class="bar">
<div class="bar-track"><span class="bar-fill" style="width: ${percent === null ? 0 : percent}%"></span></div>
<p class="bar-label">${escapeHtml(label)}</p>
</div>`;
}

function withDenominator(part, whole) {
  const percent = share(part, whole);
  return percent === null ? `${part}` : `${part} из ${whole} (${percent}%)`;
}

export function analyticsPage({ form, analytics, answerCount }) {
  const { funnel, dropOff, rejections, timing, attempts, distribution } = analytics;

  const funnelBlock = `<div class="card">
<h2>Воронка</h2>
<table>
<thead><tr><th>Шаг</th><th class="num">Студентов</th><th>От предыдущего шага</th></tr></thead>
<tbody>
<tr><td>Открыли форму</td><td class="num">${funnel.opened}</td><td class="meta">начало отсчета</td></tr>
<tr><td>Начали заполнять</td><td class="num">${funnel.started}</td><td>${escapeHtml(withDenominator(funnel.started, funnel.opened))}</td></tr>
<tr><td>Отправили отклик</td><td class="num">${funnel.submitted}</td><td>${escapeHtml(withDenominator(funnel.submitted, funnel.started))}</td></tr>
</tbody>
</table>
${bar(funnel.started, funnel.opened, `Дошли до первого ввода: ${withDenominator(funnel.started, funnel.opened)}`)}
${bar(funnel.submitted, funnel.opened, `Дошли до отправки: ${withDenominator(funnel.submitted, funnel.opened)}`)}
<p class="conclusion">${escapeHtml(funnel.comment)}</p>
</div>`;

  const dropRows = dropOff.rows.map((row) => `<tr>
<td><span class="field-num">${row.position}</span> ${escapeHtml(row.field.label)}</td>
<td class="num">${row.count}</td>
<td>${escapeHtml(withDenominator(row.count, dropOff.reported))}</td>
</tr>`).join('\n');

  const dropBlock = `<div class="card">
<h2>Где остановились те, кто не отправил</h2>
${dropOff.rows.length
    ? `<table>
<thead><tr><th>Последний вопрос, на котором видели студента</th><th class="num">Студентов</th><th>Доля сообщивших</th></tr></thead>
<tbody>
${dropRows}
</tbody>
</table>
<p class="conclusion">Чаще всего заполнение обрывается на вопросе «${escapeHtml(dropOff.rows[0].field.label)}». ${dropOff.medianFilled === null ? '' : `Ушедшие успевали заполнить ${dropOff.medianFilled} ${plural(dropOff.medianFilled, 'вопрос', 'вопроса', 'вопросов')} по медиане.`}</p>`
    : '<p class="empty">Пока никто не уходил с формы, или браузеры не успели сообщить о последнем вопросе.</p>'}
<p class="meta">Ушли без отправки: ${dropOff.abandoned}. Браузер сообщил последний вопрос у ${withDenominator(dropOff.reported, dropOff.abandoned)}: сигнал уходит при закрытии вкладки и требует JavaScript, поэтому это нижняя оценка, а не полный счет.</p>
</div>`;

  const rejectBlock = `<div class="card">
<h2>Что сервер не принял</h2>
${rejections.rows.length
    ? `<table>
<thead><tr><th>Вопрос</th><th class="num">Визитов с отказом</th><th>От пытавшихся отправить</th></tr></thead>
<tbody>
${rejections.rows.map((row) => `<tr><td>${escapeHtml(row.field.label)}</td><td class="num">${row.count}</td><td>${escapeHtml(withDenominator(row.count, rejections.visitsWithAttempt))}</td></tr>`).join('\n')}
</tbody>
</table>
<p class="conclusion">Чаще всего спотыкаются на вопросе «${escapeHtml(rejections.rows[0].field.label)}». Если отказов много, помогает подсказка под полем или более мягкий формат.</p>`
    : '<p class="empty">Отказов не было: все, кто нажимал «Отправить», заполнили форму верно с первого раза.</p>'}
<p class="meta">Считается на сервере по каждой попытке отправки, JavaScript для этого не нужен, поэтому счет полный.</p>
</div>`;

  const timingBlock = `<div class="card">
<h2>Сколько времени уходит</h2>
<div class="stats">
<div class="stat">
<p class="stat-value">${timing.medianFill === null ? 'нет данных' : escapeHtml(formatSeconds(timing.medianFill))}</p>
<p class="stat-label">медиана от открытия до отправки, по ${timing.medianFillOf} ${plural(timing.medianFillOf, 'отклику', 'откликам', 'откликам')}</p>
</div>
<div class="stat">
<p class="stat-value">${timing.medianThink === null ? 'нет данных' : escapeHtml(formatSeconds(timing.medianThink))}</p>
<p class="stat-label">медиана от открытия до первого ввода, по ${timing.medianThinkOf} ${plural(timing.medianThinkOf, 'визиту', 'визитам', 'визитам')}</p>
</div>
<div class="stat">
<p class="stat-value">${attempts.perAnswer === null ? 'нет данных' : escapeHtml(String(attempts.perAnswer))}</p>
<p class="stat-label">попыток отправки на один принятый отклик, всего попыток ${attempts.total}</p>
</div>
</div>
<p class="meta">Медиана, а не среднее: одна вкладка, открытая на сутки, сдвинула бы среднее и соврала бы о форме.</p>
</div>`;

  const distributionBlock = distribution.length
    ? `<div class="card">
<h2>Что выбирают студенты</h2>
${distribution.map((item) => `<section class="distribution">
<h3>${escapeHtml(item.field.label)}</h3>
${item.rows.map((row) => bar(row.count, item.answered, `${row.option}: ${withDenominator(row.count, item.answered)}`)).join('\n')}
<p class="meta">Знаменатель это ${item.answered} ${plural(item.answered, 'отклик', 'отклика', 'откликов')}, где вопрос заполнен.</p>
</section>`).join('\n')}
</div>`
    : '';

  return adminPage({
    title: `Аналитика: ${form.title}`,
    form,
    tab: '/analytics',
    answerCount,
    body: `${funnelBlock}
${dropBlock}
${rejectBlock}
${timingBlock}
${distributionBlock}
<div class="card">
<h2>Как это считается</h2>
<p>Событий шесть видов. Открытие страницы, первый ввод в любое поле, попытка отправки, отказ сервера по конкретному вопросу, принятый отклик и отметка о последнем вопросе, которую браузер шлет при закрытии вкладки.</p>
<p>В событиях нет куки, адресов и заголовков браузера. Визит это одно открытие страницы со случайным идентификатором, который живет только в этой странице и ни с чем не связан.</p>
<p>Отправка засчитывается и как начало заполнения: первый ввод отслеживается скриптом, а отправка работает и без JavaScript, иначе отправок оказалось бы больше, чем начавших.</p>
<p>Визитом считается каждое открытие публичной ссылки, включая кнопку «Открыть как студент» в конструкторе. Вкладка «Предпросмотр» событий не пишет, ее открывать можно сколько угодно.</p>
</div>`
  });
}
