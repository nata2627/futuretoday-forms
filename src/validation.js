// All validation lives on the server: the admin panel and the public form send plain HTML
// forms, so browser attributes are a hint for the user, not a guarantee for us.

export const FIELD_TYPES = [
  { value: 'text', label: 'Короткий текст' },
  { value: 'textarea', label: 'Длинный текст' },
  { value: 'email', label: 'Email' },
  { value: 'select', label: 'Выбор из списка' }
];

const TYPE_VALUES = FIELD_TYPES.map((type) => type.value);

export const LIMITS = {
  title: 200,
  description: 1000,
  label: 200,
  option: 200,
  options: 20,
  fields: 20,
  value: 2000
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
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
    type: text(body.type),
    required: body.required === 'on' || body.required === 'true',
    optionsText: typeof body.options === 'string' ? body.options : ''
  };
  const errors = {};

  if (!values.label) errors.label = 'Введите подпись поля';
  else if (values.label.length > LIMITS.label) errors.label = `Подпись длиннее ${LIMITS.label} символов`;

  if (!TYPE_VALUES.includes(values.type)) errors.type = 'Выберите тип поля из списка';

  const options = values.optionsText
    .split('\n')
    .map((option) => option.trim())
    .filter(Boolean);

  if (values.type === 'select') {
    if (options.length === 0) errors.options = 'Для выбора из списка нужен хотя бы один вариант, по одному в строке';
    else if (options.length > LIMITS.options) errors.options = `Вариантов больше ${LIMITS.options}`;
    else if (options.some((option) => option.length > LIMITS.option)) {
      errors.options = `Вариант длиннее ${LIMITS.option} символов`;
    }
  }

  const field = {
    label: values.label,
    type: values.type,
    required: values.required,
    options: values.type === 'select' ? options : []
  };

  return { values, field, errors };
}

export function validateFormForPublish(form) {
  if (!form.fields.length) return 'В форме нет ни одного поля, студенту нечего заполнять';
  return null;
}

// Answers are keyed by server-generated field ids, so a POST with unknown keys simply loses them.
export function validateAnswer(form, body) {
  const values = {};
  const errors = {};

  for (const field of form.fields) {
    const raw = body[field.id];
    const value = text(Array.isArray(raw) ? raw[0] : raw);
    values[field.id] = value;

    if (!value) {
      if (field.required) errors[field.id] = 'Это поле обязательное';
      continue;
    }
    if (value.length > LIMITS.value) {
      errors[field.id] = `Не длиннее ${LIMITS.value} символов`;
      continue;
    }
    if (field.type === 'email' && !EMAIL.test(value)) {
      errors[field.id] = 'Похоже, это не электронная почта';
      continue;
    }
    if (field.type === 'select' && !field.options.includes(value)) {
      errors[field.id] = 'Выберите вариант из списка';
    }
  }

  return { values, errors };
}
