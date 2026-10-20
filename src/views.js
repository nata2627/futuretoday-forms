import { share } from './funnel.js';

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

// Every string that reaches HTML comes from a manager or a student, so it goes through here.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export function page({ title, body }) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

// Dates are stored in ISO and shown in local format: an ISO string with a timezone is not
// something a manager should have to read.
export function formatDate(iso) {
  return dateFormat.format(new Date(iso));
}

function errorBox(messages) {
  if (!messages.length) return '';
  return `<div class="error-box">${messages.map((message) => `<p class="error">${escapeHtml(message)}</p>`).join('\n')}</div>`;
}

function fieldTypeLabel(types, value) {
  return types.find((type) => type.value === value)?.label || value;
}

export function adminListPage({ forms, answerCounts, errors = {}, values = {} }) {
  const rows = forms
    .map((form) => `<tr>
<td><a href="/admin/forms/${escapeHtml(form.id)}">${escapeHtml(form.title)}</a></td>
<td>${form.published ? 'опубликована' : 'черновик'}</td>
<td>${form.fields.length}</td>
<td>${answerCounts[form.id] || 0}</td>
<td>${escapeHtml(formatDate(form.createdAt))}</td>
</tr>`)
    .join('\n');

  const table = forms.length
    ? `<table>
<thead><tr><th>Форма</th><th>Статус</th><th>Полей</th><th>Ответов</th><th>Создана</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`
    : '<p class="muted">Форм пока нет. Создайте первую: назовите ее, добавьте поля и нажмите «Опубликовать», чтобы получить ссылку для студентов.</p>';

  return page({
    title: 'Админка, формы отклика',
    body: `<h1>Формы отклика</h1>
${table}
<h2>Новая форма</h2>
${errorBox(Object.values(errors))}
<form method="post" action="/admin/forms">
<label><span>Название</span>
<input type="text" name="title" maxlength="200" value="${escapeHtml(values.title)}" placeholder="Стажировка в отделе аналитики, лето 2026">
</label>
<label><span>Описание, необязательно</span>
<textarea name="description" maxlength="1000" placeholder="Пара строк о стажировке и о том, что будет после отклика">${escapeHtml(values.description)}</textarea>
</label>
<button type="submit">Создать форму</button>
</form>`
  });
}

function funnelBlock(funnel) {
  const { opened, started, submitted } = funnel;
  const percent = (part, whole) => {
    const value = share(part, whole);
    return value === null ? '' : ` (${value}%)`;
  };

  return `<table>
<thead><tr><th>Шаг</th><th>Студентов</th><th>От предыдущего шага</th></tr></thead>
<tbody>
<tr><td>Открыли форму</td><td>${opened}</td><td class="muted">начало отсчета</td></tr>
<tr><td>Начали заполнять</td><td>${started}</td><td>${started} из ${opened}${percent(started, opened)}</td></tr>
<tr><td>Отправили отклик</td><td>${submitted}</td><td>${submitted} из ${started}${percent(submitted, started)}</td></tr>
</tbody>
</table>
<p>${escapeHtml(funnel.comment)}</p>
<p class="muted">Считается по событиям без куки и внешних счетчиков: открытие страницы, первый ввод в любое поле, успешная отправка. Отправка засчитывается и как начало заполнения, потому что первый ввод отслеживается скриптом на странице, а отправка работает и без него.</p>`;
}

export function adminFormPage({ form, link, answers, fieldTypes, funnel, fieldValues = {}, fieldErrors = {}, formErrors = [] }) {
  const fieldsList = form.fields.length
    ? `<table>
<thead><tr><th>Подпись</th><th>Тип</th><th>Обязательное</th><th></th></tr></thead>
<tbody>
${form.fields.map((field) => `<tr>
<td>${escapeHtml(field.label)}${field.options.length ? `<br><span class="muted">${escapeHtml(field.options.join(', '))}</span>` : ''}</td>
<td>${escapeHtml(fieldTypeLabel(fieldTypes, field.type))}</td>
<td>${field.required ? 'да' : 'нет'}</td>
<td><form method="post" action="/admin/forms/${escapeHtml(form.id)}/fields/${escapeHtml(field.id)}/delete"><button class="button-secondary" type="submit">Удалить</button></form></td>
</tr>`).join('\n')}
</tbody>
</table>`
    : '<p class="muted">Полей пока нет. Добавьте первое поле ниже.</p>';

  const publishBlock = form.published
    ? `<p>Ссылка для студентов:</p>
<p><input type="text" readonly id="form-link" value="${escapeHtml(link)}"> <button class="button-secondary" type="button" data-copy="form-link">Скопировать</button></p>
<p><a href="${escapeHtml(link)}">Открыть форму как студент</a></p>
<form method="post" action="/admin/forms/${escapeHtml(form.id)}/unpublish"><button class="button-secondary" type="submit">Снять с публикации</button></form>`
    : `<p class="muted">Форма еще не опубликована, ссылки у студентов нет.</p>
<form method="post" action="/admin/forms/${escapeHtml(form.id)}/publish"><button type="submit">Опубликовать и получить ссылку</button></form>`;

  const answersBlock = answers.length
    ? `<table>
<thead><tr><th>Когда</th>${form.fields.map((field) => `<th>${escapeHtml(field.label)}</th>`).join('')}</tr></thead>
<tbody>
${answers.map((answer) => `<tr><td>${escapeHtml(formatDate(answer.createdAt))}</td>${form.fields.map((field) => `<td>${escapeHtml(answer.values[field.id] || '')}</td>`).join('')}</tr>`).join('\n')}
</tbody>
</table>`
    : '<p class="muted">Ответов пока нет. Отправьте форму по ссылке сами, чтобы увидеть, как это выглядит для менеджера.</p>';

  return page({
    title: `Форма: ${form.title}`,
    body: `<p><a href="/admin">Все формы</a></p>
<h1>${escapeHtml(form.title)}</h1>
${form.description ? `<p>${escapeHtml(form.description)}</p>` : ''}
<p class="muted">Создана ${escapeHtml(formatDate(form.createdAt))}</p>

<h2>Публикация</h2>
${errorBox(formErrors)}
${publishBlock}

<h2>Поля формы</h2>
${fieldsList}

<h3>Добавить поле</h3>
${errorBox(Object.values(fieldErrors))}
<form method="post" action="/admin/forms/${escapeHtml(form.id)}/fields">
<label><span>Подпись</span>
<input type="text" name="label" maxlength="200" value="${escapeHtml(fieldValues.label)}" placeholder="Ваше имя">
</label>
<label><span>Тип</span>
<select name="type">
${fieldTypes.map((type) => `<option value="${escapeHtml(type.value)}"${fieldValues.type === type.value ? ' selected' : ''}>${escapeHtml(type.label)}</option>`).join('\n')}
</select>
</label>
<label><span>Варианты, по одному в строке. Нужны только для типа «Выбор из списка»</span>
<textarea name="options" placeholder="Бакалавриат&#10;Магистратура">${escapeHtml(fieldValues.optionsText)}</textarea>
</label>
<label><span><input type="checkbox" name="required"${fieldValues.required ? ' checked' : ''}> Обязательное поле</span></label>
<button type="submit">Добавить поле</button>
</form>

<h2>Воронка заполнения</h2>
${funnelBlock(funnel)}

<h2>Ответы</h2>
${answersBlock}

<h2>Опасная зона</h2>
<form method="post" action="/admin/forms/${escapeHtml(form.id)}/delete"><button class="button-secondary" type="submit">Удалить форму вместе с ответами</button></form>
<script src="/admin.js" defer></script>`
  });
}

export function publicFormPage({ form, values, errors, visitId }) {
  const fields = form.fields.map((field) => {
    const value = values[field.id] || '';
    const error = errors[field.id];
    const required = field.required ? ' required' : '';
    let control;

    if (field.type === 'textarea') {
      control = `<textarea name="${escapeHtml(field.id)}" maxlength="2000"${required}>${escapeHtml(value)}</textarea>`;
    } else if (field.type === 'select') {
      control = `<select name="${escapeHtml(field.id)}"${required}>
<option value="">Не выбрано</option>
${field.options.map((option) => `<option value="${escapeHtml(option)}"${option === value ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('\n')}
</select>`;
    } else {
      const type = field.type === 'email' ? 'email' : 'text';
      control = `<input type="${type}" name="${escapeHtml(field.id)}" maxlength="2000" value="${escapeHtml(value)}"${required}>`;
    }

    return `<label>
<span>${escapeHtml(field.label)}${field.required ? ' <span class="required">*</span>' : ''}</span>
${control}
${error ? `<span class="error">${escapeHtml(error)}</span>` : ''}
</label>`;
  }).join('\n');

  const hasErrors = Object.keys(errors).length > 0;

  return page({
    title: form.title,
    body: `<h1>${escapeHtml(form.title)}</h1>
${form.description ? `<p>${escapeHtml(form.description)}</p>` : ''}
${hasErrors ? errorBox(['Проверьте отмеченные поля, остальное сохранено.']) : ''}
<form method="post" action="/f/${escapeHtml(form.id)}" id="public-form" data-started="/f/${escapeHtml(form.id)}/started?v=${escapeHtml(visitId)}">
<input type="hidden" name="visitId" value="${escapeHtml(visitId)}">
${fields}
<button type="submit">Отправить отклик</button>
</form>
<script src="/form.js" defer></script>`
  });
}

export function sentPage({ form }) {
  return page({
    title: 'Отклик отправлен',
    body: `<h1>Отклик отправлен</h1>
<p>Спасибо, ваш отклик по форме «${escapeHtml(form.title)}» принят. Менеджер увидит его в админке.</p>`
  });
}
