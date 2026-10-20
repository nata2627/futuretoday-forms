// All validation lives on the server: the admin panel and the public form send plain HTML
// forms, so browser attributes are a hint for the person, not a guarantee for us.

export const FIELD_TYPES = [
  { value: 'text', label: 'Короткий текст', hint: 'Имя, город, название вуза' },
  { value: 'textarea', label: 'Длинный текст', hint: 'Рассказ о себе, ссылка на проект' },
  { value: 'email', label: 'Почта', hint: 'Проверяется формат адреса' },
  { value: 'tel', label: 'Телефон', hint: 'Проверяется количество цифр' },
  { value: 'number', label: 'Число', hint: 'Можно задать границы, например часы в неделю' },
  { value: 'date', label: 'Дата', hint: 'Календарь в браузере, на сервере проверяется реальность даты' },
  { value: 'select', label: 'Список', hint: 'Один вариант из выпадающего списка' },
  { value: 'radio', label: 'Один из вариантов', hint: 'Все варианты видны сразу' },
  { value: 'checkbox', label: 'Несколько из вариантов', hint: 'Студент отмечает сколько угодно' },
  { value: 'consent', label: 'Согласие', hint: 'Одна галочка, например согласие на обработку данных' }
];

const TYPE_VALUES = FIELD_TYPES.map((type) => type.value);
const WITH_OPTIONS = new Set(['select', 'radio', 'checkbox']);
const MULTI = new Set(['checkbox']);

export const LIMITS = {
  title: 200,
  description: 1000,
  label: 200,
  hint: 200,
  option: 200,
  options: 30,
  fields: 30,
  value: 2000,
  longValue: 4000,
  digits: { min: 10, max: 15 }
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_SHAPE = /^\+?[\d\s()-]+$/;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function hasOptions(type) {
  return WITH_OPTIONS.has(type);
}

export function isMulti(type) {
  return MULTI.has(type);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseOptions(raw) {
  return String(raw ?? '')
    .split('\n')
    .map((option) => option.trim())
    .filter(Boolean);
}

export function validateFormDraft(body) {
  const values = {
    title: text(body.title),
    description: text(body.description)
  };
  const errors = {};

  if (!values.title) errors.title = 'Введите название формы';
  else if (values.title.length > LIMITS.title) errors.title = `Название длиннее ${LIMITS.title} символов`;
  if (values.description.length > LIMITS.description) {
    errors.description = `Описание длиннее ${LIMITS.description} символов`;
  }

  return { values, errors };
}

export function validateField(body) {
  const values = {
    label: text(body.label),
    hint: text(body.hint),
    type: text(body.type),
    required: body.required === 'on' || body.required === 'true',
    optionsText: typeof body.options === 'string' ? body.options : '',
    min: text(body.min),
    max: text(body.max)
  };
  const errors = {};

  if (!values.label) errors.label = 'Введите подпись поля';
  else if (values.label.length > LIMITS.label) errors.label = `Подпись длиннее ${LIMITS.label} символов`;
  if (values.hint.length > LIMITS.hint) errors.hint = `Подсказка длиннее ${LIMITS.hint} символов`;
  if (!TYPE_VALUES.includes(values.type)) errors.type = 'Выберите тип поля из списка';

  const options = parseOptions(values.optionsText);
  if (hasOptions(values.type)) {
    if (options.length < 2) errors.options = 'Нужно не меньше двух вариантов, по одному в строке';
    else if (options.length > LIMITS.options) errors.options = `Вариантов больше ${LIMITS.options}`;
    else if (options.some((option) => option.length > LIMITS.option)) {
      errors.options = `Вариант длиннее ${LIMITS.option} символов`;
    } else if (new Set(options).size !== options.length) {
      errors.options = 'Варианты повторяются, у студента они будут неразличимы';
    }
  }

  let min = null;
  let max = null;
  if (values.type === 'number') {
    if (values.min) {
      min = Number(values.min);
      if (!Number.isFinite(min)) errors.min = 'Нижняя граница должна быть числом';
    }
    if (values.max) {
      max = Number(values.max);
      if (!Number.isFinite(max)) errors.max = 'Верхняя граница должна быть числом';
    }
    if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
      errors.max = 'Верхняя граница меньше нижней';
    }
  }

  const field = {
    type: values.type,
    label: values.label,
    hint: values.hint,
    required: values.required,
    options: hasOptions(values.type) ? options : [],
    min: values.type === 'number' ? min : null,
    max: values.type === 'number' ? max : null
  };

  return { values, field, errors };
}

export function validateFormForPublish(form) {
  if (!form.fields.length) return 'В форме нет ни одного поля, студенту нечего заполнять';
  return null;
}

function countDigits(value) {
  return (value.match(/\d/g) || []).length;
}

function checkValue(field, value) {
  switch (field.type) {
    case 'email':
      return EMAIL.test(value) ? null : 'Похоже, это не электронная почта';
    case 'tel': {
      if (!PHONE_SHAPE.test(value)) return 'В телефоне есть лишние символы, оставьте цифры, плюс и скобки';
      const digits = countDigits(value);
      if (digits < LIMITS.digits.min || digits > LIMITS.digits.max) {
        return `В номере должно быть от ${LIMITS.digits.min} до ${LIMITS.digits.max} цифр`;
      }
      return null;
    }
    case 'number': {
      const number = Number(value.replace(',', '.'));
      if (!Number.isFinite(number)) return 'Введите число';
      if (field.min !== null && number < field.min) return `Не меньше ${field.min}`;
      if (field.max !== null && number > field.max) return `Не больше ${field.max}`;
      return null;
    }
    case 'date': {
      if (!DATE_SHAPE.test(value)) return 'Введите дату в формате ГГГГ-ММ-ДД';
      // Date() rolls 31 February over into March, so the parts are compared back one by one.
      const [year, month, day] = value.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      const same = date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
      return same ? null : 'Такой даты не существует';
    }
    case 'select':
    case 'radio':
      return field.options.includes(value) ? null : 'Выберите вариант из списка';
    case 'consent':
      return value === 'да' ? null : 'Отметьте согласие, чтобы отправить форму';
    default:
      return null;
  }
}

// Answers are keyed by server-generated field ids, so a POST with unknown keys simply loses them.
export function validateAnswer(form, body) {
  const values = {};
  const errors = {};

  for (const field of form.fields) {
    const raw = body[field.id];

    if (isMulti(field.type)) {
      const chosen = (Array.isArray(raw) ? raw : [raw])
        .map((item) => text(item))
        .filter((item) => field.options.includes(item));
      values[field.id] = chosen;
      if (!chosen.length && field.required) errors[field.id] = 'Отметьте хотя бы один вариант';
      continue;
    }

    if (field.type === 'consent') {
      const checked = text(Array.isArray(raw) ? raw[0] : raw) !== '';
      values[field.id] = checked ? 'да' : '';
      if (!checked && field.required) errors[field.id] = 'Отметьте согласие, чтобы отправить форму';
      continue;
    }

    const value = text(Array.isArray(raw) ? raw[0] : raw);
    values[field.id] = value;

    if (!value) {
      if (field.required) errors[field.id] = 'Это поле обязательное';
      continue;
    }

    const limit = field.type === 'textarea' ? LIMITS.longValue : LIMITS.value;
    if (value.length > limit) {
      errors[field.id] = `Не длиннее ${limit} символов`;
      continue;
    }

    const problem = checkValue(field, value);
    if (problem) errors[field.id] = problem;
  }

  return { values, errors };
}
