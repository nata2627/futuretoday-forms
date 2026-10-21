import { isMulti } from './validation.js';

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

export function page({ title, body, header = '', bodyClass = '' }) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${header}
<main class="page">
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

const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });

// Dates are stored in ISO and shown in local format: an ISO string with a timezone is not
// something a manager should have to read.
export function formatDate(iso) {
  return dateFormat.format(new Date(iso));
}

// A csv is opened in Excel, and Excel parses a date only without the comma that Intl puts
// between the day and the time.
export function formatDateForFile(iso) {
  return formatDate(iso).replace(', ', ' ');
}

export function formatDay(value) {
  const [year, month, day] = value.split('-').map(Number);
  return dayFormat.format(new Date(Date.UTC(year, month - 1, day)));
}

export function errorBox(messages) {
  if (!messages.length) return '';
  return `<div class="notice notice-error">
${messages.map((message) => `<p>${escapeHtml(message)}</p>`).join('\n')}
</div>`;
}

export function displayValue(field, value) {
  if (isMulti(field.type)) return Array.isArray(value) ? value.join(', ') : '';
  if (field.type === 'date' && value) return formatDay(value);
  return value || '';
}

function control(field, value, hasError) {
  const name = escapeHtml(field.id);
  const id = `f_${name}`;
  const required = field.required ? ' required' : '';
  const invalid = hasError ? ' aria-invalid="true"' : '';

  switch (field.type) {
    case 'textarea':
      return `<textarea id="${id}" name="${name}" maxlength="4000" rows="5"${required}${invalid}>${escapeHtml(value)}</textarea>`;
    case 'select':
      return `<select id="${id}" name="${name}"${required}${invalid}>
<option value="">Выберите вариант</option>
${field.options.map((option) => `<option value="${escapeHtml(option)}"${option === value ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('\n')}
</select>`;
    case 'radio':
      return `<div class="choices">
${field.options.map((option, index) => `<label class="choice"><input type="radio" name="${name}" id="${id}_${index}" value="${escapeHtml(option)}"${option === value ? ' checked' : ''}${required}> <span>${escapeHtml(option)}</span></label>`).join('\n')}
</div>`;
    case 'checkbox': {
      const chosen = Array.isArray(value) ? value : [];
      return `<div class="choices">
${field.options.map((option, index) => `<label class="choice"><input type="checkbox" name="${name}" id="${id}_${index}" value="${escapeHtml(option)}"${chosen.includes(option) ? ' checked' : ''}> <span>${escapeHtml(option)}</span></label>`).join('\n')}
</div>`;
    }
    case 'consent':
      return `<label class="choice"><input type="checkbox" id="${id}" name="${name}" value="да"${value === 'да' ? ' checked' : ''}${required}> <span>${escapeHtml(field.label)}${field.required ? ' <span class="req">*</span>' : ''}</span></label>`;
    case 'number': {
      const bounds = `${field.min === null ? '' : ` min="${field.min}"`}${field.max === null ? '' : ` max="${field.max}"`}`;
      return `<input type="number" id="${id}" name="${name}" value="${escapeHtml(value)}" step="any"${bounds}${required}${invalid}>`;
    }
    case 'date':
      return `<input type="date" id="${id}" name="${name}" value="${escapeHtml(value)}"${required}${invalid}>`;
    case 'tel':
      return `<input type="tel" id="${id}" name="${name}" value="${escapeHtml(value)}" maxlength="25" autocomplete="tel"${required}${invalid}>`;
    case 'email':
      return `<input type="email" id="${id}" name="${name}" value="${escapeHtml(value)}" maxlength="2000" autocomplete="email"${required}${invalid}>`;
    default:
      return `<input type="text" id="${id}" name="${name}" value="${escapeHtml(value)}" maxlength="2000"${required}${invalid}>`;
  }
}

export function renderField(field, value, error) {
  const id = `f_${escapeHtml(field.id)}`;
  const mark = field.required ? ' <span class="req" title="обязательное поле">*</span>' : '';
  const hint = field.hint ? `<p class="hint" id="${id}_hint">${escapeHtml(field.hint)}</p>` : '';
  const problem = error ? `<p class="error" id="${id}_error">${escapeHtml(error)}</p>` : '';
  const group = field.type === 'radio' || field.type === 'checkbox';
  const consent = field.type === 'consent';

  const head = consent
    ? ''
    : group
      ? `<legend>${escapeHtml(field.label)}${mark}</legend>`
      : `<label for="${id}">${escapeHtml(field.label)}${mark}</label>`;

  const inner = `${head}
${hint}
${control(field, value, Boolean(error))}
${problem}`;

  const attrs = `class="field${error ? ' field-error' : ''}" data-field="${escapeHtml(field.id)}" data-type="${escapeHtml(field.type)}"${field.required ? ' data-required="1"' : ''}`;
  return group ? `<fieldset ${attrs}>\n${inner}\n</fieldset>` : `<div ${attrs}>\n${inner}\n</div>`;
}

// Rounded on purpose: the student needs an order of magnitude, and a measured median of a few
// seconds printed as "3 с" would read as a broken number rather than as a short form.
function typicalPhrase(seconds) {
  if (seconds < 60) return 'обычно занимает меньше минуты';
  const minutes = Math.round(seconds / 60);
  return `обычно занимает около ${minutes} ${plural(minutes, 'минуты', 'минут', 'минут')}`;
}

function formMeta(form, typicalSeconds) {
  const requiredCount = form.fields.filter((field) => field.required).length;
  const parts = [`${form.fields.length} ${plural(form.fields.length, 'вопрос', 'вопроса', 'вопросов')}`];
  if (requiredCount) parts.push(`${requiredCount} обязательных`);
  if (typicalSeconds !== null) parts.push(typicalPhrase(typicalSeconds));
  return parts.join(' · ');
}

export function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function publicFormPage({ form, values, errors, visitId, typicalSeconds, preview = false }) {
  const requiredCount = form.fields.filter((field) => field.required).length;
  const fields = form.fields.map((field) => renderField(field, values[field.id] ?? (isMulti(field.type) ? [] : ''), errors[field.id])).join('\n');
  const errorCount = Object.keys(errors).length;

  const progress = requiredCount
    ? `<div class="progress" data-progress hidden>
<div class="progress-track"><span class="progress-fill" data-progress-fill style="width: 0%"></span></div>
<p class="progress-text">Заполнено обязательных: <b data-progress-done>0</b> из <b>${requiredCount}</b></p>
</div>`
    : '';

  const banner = preview
    ? '<div class="notice notice-info"><p>Предпросмотр. Так форму увидит студент, отправка здесь выключена.</p></div>'
    : '';

  const body = `${banner}
<article class="card form-card">
<header class="form-head">
<h1>${escapeHtml(form.title)}</h1>
${form.description ? `<p class="lead">${escapeHtml(form.description)}</p>` : ''}
<p class="meta">${escapeHtml(formMeta(form, typicalSeconds))}</p>
${requiredCount ? '<p class="meta"><span class="req">*</span> обязательное поле</p>' : ''}
</header>
${progress}
${errorCount ? errorBox([`Не отправлено: ${errorCount} ${plural(errorCount, 'поле требует', 'поля требуют', 'полей требуют')} внимания. Остальное сохранено.`]) : ''}
<form method="post" action="/f/${escapeHtml(form.id)}" id="public-form" novalidate data-draft="${escapeHtml(form.id)}" data-progress-url="/f/${escapeHtml(form.id)}/progress?v=${escapeHtml(visitId)}" data-started-url="/f/${escapeHtml(form.id)}/started?v=${escapeHtml(visitId)}">
<input type="hidden" name="visitId" value="${escapeHtml(visitId)}">
${fields}
<div class="actions">
<button type="submit"${preview ? ' disabled' : ''}>Отправить отклик</button>
</div>
</form>
</article>
${preview ? '' : '<script src="/form.js" defer></script>'}`;

  return page({ title: form.title, body, bodyClass: 'public' });
}

export function sentPage({ form }) {
  return page({
    title: 'Отклик отправлен',
    bodyClass: 'public',
    body: `<article class="card form-card" data-sent="${escapeHtml(form.id)}">
<h1>Отклик отправлен</h1>
<p class="lead">Спасибо, ваш отклик по форме «${escapeHtml(form.title)}» принят. Менеджер увидит его в админке.</p>
</article>
<script src="/form.js" defer></script>`
  });
}

export function notFoundPage() {
  return page({
    title: 'Страница не найдена',
    bodyClass: 'public',
    body: `<article class="card">
<h1>Страница не найдена</h1>
<p>Такой страницы нет. Если вы перешли по ссылке на форму, проверьте, что скопировали ее целиком, и спросите ссылку у менеджера: форму могли снять с публикации.</p>
<p><a href="/">На главную</a></p>
</article>`
  });
}

export function landingPage() {
  return page({
    title: 'Конструктор форм отклика',
    bodyClass: 'public',
    body: `<article class="card">
<h1>Конструктор форм отклика</h1>
<p class="lead">Менеджер собирает форму в админке и получает ссылку, студент заполняет форму по этой ссылке, менеджер видит ответы и аналитику заполнения.</p>
<p><a class="button" href="/admin">Перейти в админку</a></p>
</article>`
  });
}

export function errorPage(title, text) {
  return page({
    title,
    bodyClass: 'public',
    body: `<article class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></article>`
  });
}
