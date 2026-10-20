import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as storage from './storage.js';
import * as views from './views.js';
import * as admin from './admin-views.js';
import { answersToCsv, contentDisposition } from './csv.js';
import { buildAnalytics, typicalFillSeconds } from './analytics.js';
import {
  LIMITS,
  validateAnswer,
  validateField,
  validateFormDraft,
  validateFormForPublish
} from './validation.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;

await storage.init();

const app = express();

app.use(express.static(path.join(rootDir, 'public')));
app.use(express.urlencoded({ extended: false, limit: '128kb' }));

function html(res, body, status = 200) {
  res.status(status).type('html').send(body);
}

function notFound(res) {
  html(res, views.notFoundPage(), 404);
}

function publicLink(req, formId) {
  return `${req.protocol}://${req.get('host')}/f/${formId}`;
}

function fieldValuesFrom(field) {
  return {
    type: field.type,
    label: field.label,
    hint: field.hint || '',
    optionsText: field.options.join('\n'),
    min: field.min === null ? '' : String(field.min),
    max: field.max === null ? '' : String(field.max),
    required: field.required
  };
}

async function loadForm(req, res) {
  const form = await storage.getForm(req.params.id);
  if (!form) {
    notFound(res);
    return null;
  }
  return form;
}

app.get('/', (req, res) => html(res, views.landingPage()));

app.get('/admin', async (req, res) => {
  const forms = await storage.listForms();
  const answerCounts = await storage.countAnswers();
  html(res, admin.adminListPage({ forms, answerCounts, values: { title: '', description: '' } }));
});

app.post('/admin/forms', async (req, res) => {
  const { values, errors } = validateFormDraft(req.body);

  if (Object.keys(errors).length) {
    const forms = await storage.listForms();
    const answerCounts = await storage.countAnswers();
    html(res, admin.adminListPage({ forms, answerCounts, values, errors }), 400);
    return;
  }

  const form = await storage.addForm({
    id: storage.newId(),
    title: values.title,
    description: values.description,
    fields: [],
    published: false,
    createdAt: new Date().toISOString(),
    updatedAt: null
  });

  res.redirect(`/admin/forms/${form.id}`);
});

async function renderBuilder(req, res, form, extra = {}) {
  const answers = await storage.listAnswers(form.id);
  html(res, admin.builderPage({
    form,
    link: publicLink(req, form.id),
    answerCount: answers.length,
    ...extra
  }), extra.status || 200);
}

app.get('/admin/forms/:id', async (req, res) => {
  const form = await loadForm(req, res);
  if (form) await renderBuilder(req, res, form);
});

app.get('/admin/forms/:id/answers', async (req, res) => {
  const form = await loadForm(req, res);
  if (!form) return;
  const answers = await storage.listAnswers(form.id);
  html(res, admin.answersPage({ form, answers, answerCount: answers.length }));
});

app.get('/admin/forms/:id/answers.csv', async (req, res) => {
  const form = await loadForm(req, res);
  if (!form) return;
  const answers = await storage.listAnswers(form.id);
  res.type('text/csv; charset=utf-8');
  res.setHeader('content-disposition', contentDisposition(form));
  res.send(answersToCsv(form, answers));
});

app.get('/admin/forms/:id/analytics', async (req, res) => {
  const form = await loadForm(req, res);
  if (!form) return;
  const [answers, events] = await Promise.all([storage.listAnswers(form.id), storage.listEvents()]);
  html(res, admin.analyticsPage({
    form,
    analytics: buildAnalytics({ form, events, answers }),
    answerCount: answers.length
  }));
});

app.get('/admin/forms/:id/preview', async (req, res) => {
  const form = await loadForm(req, res);
  if (!form) return;
  html(res, views.publicFormPage({
    form,
    values: {},
    errors: {},
    visitId: 'preview',
    typicalSeconds: null,
    preview: true
  }));
});

app.post('/admin/forms/:id/fields', async (req, res) => {
  const form = await loadForm(req, res);
  if (!form) return;

  const { values, field, errors } = validateField(req.body);
  if (form.fields.length >= LIMITS.fields) {
    errors.label = `В форме уже ${LIMITS.fields} вопросов, больше студент не осилит`;
  }

  if (Object.keys(errors).length) {
    await renderBuilder(req, res, form, { fieldValues: values, fieldErrors: errors, status: 400 });
    return;
  }

  await storage.updateForm(form.id, (current) => {
    current.fields.push({ id: storage.newFieldId(), ...field });
    current.updatedAt = new Date().toISOString();
  });

  res.redirect(`/admin/forms/${form.id}`);
});

app.get('/admin/forms/:id/fields/:fieldId/edit', async (req, res) => {
  const form = await loadForm(req, res);
  if (!form) return;
  const field = form.fields.find((item) => item.id === req.params.fieldId);
  if (!field) return notFound(res);

  const answers = await storage.listAnswers(form.id);
  html(res, admin.fieldEditPage({
    form,
    field,
    answerCount: answers.length,
    values: fieldValuesFrom(field),
    errors: {}
  }));
});

// The field keeps its id, so answers collected earlier stay attached to it.
app.post('/admin/forms/:id/fields/:fieldId', async (req, res) => {
  const form = await loadForm(req, res);
  if (!form) return;
  const current = form.fields.find((item) => item.id === req.params.fieldId);
  if (!current) return notFound(res);

  const { values, field, errors } = validateField({ ...req.body, type: current.type });

  if (Object.keys(errors).length) {
    const answers = await storage.listAnswers(form.id);
    html(res, admin.fieldEditPage({
      form,
      field: current,
      answerCount: answers.length,
      values: { ...values, type: current.type },
      errors
    }), 400);
    return;
  }

  await storage.updateForm(form.id, (stored) => {
    const target = stored.fields.find((item) => item.id === req.params.fieldId);
    Object.assign(target, field, { id: target.id, type: target.type });
    stored.updatedAt = new Date().toISOString();
  });

  res.redirect(`/admin/forms/${form.id}`);
});

app.post('/admin/forms/:id/fields/:fieldId/move', async (req, res) => {
  const direction = req.body.direction === 'up' ? -1 : 1;
  const updated = await storage.updateForm(req.params.id, (form) => {
    const index = form.fields.findIndex((field) => field.id === req.params.fieldId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= form.fields.length) return;
    const [field] = form.fields.splice(index, 1);
    form.fields.splice(target, 0, field);
    form.updatedAt = new Date().toISOString();
  });
  if (!updated) return notFound(res);
  res.redirect(`/admin/forms/${updated.id}`);
});

app.post('/admin/forms/:id/fields/:fieldId/delete', async (req, res) => {
  const updated = await storage.updateForm(req.params.id, (form) => {
    const index = form.fields.findIndex((field) => field.id === req.params.fieldId);
    if (index !== -1) {
      form.fields.splice(index, 1);
      form.updatedAt = new Date().toISOString();
    }
  });
  if (!updated) return notFound(res);
  res.redirect(`/admin/forms/${updated.id}`);
});

app.post('/admin/forms/:id/publish', async (req, res) => {
  const form = await loadForm(req, res);
  if (!form) return;

  const problem = validateFormForPublish(form);
  if (problem) {
    await renderBuilder(req, res, form, { formErrors: [problem], status: 400 });
    return;
  }

  await storage.updateForm(form.id, (current) => {
    current.published = true;
  });
  res.redirect(`/admin/forms/${form.id}`);
});

app.post('/admin/forms/:id/unpublish', async (req, res) => {
  const updated = await storage.updateForm(req.params.id, (form) => {
    form.published = false;
  });
  if (!updated) return notFound(res);
  res.redirect(`/admin/forms/${updated.id}`);
});

app.post('/admin/forms/:id/delete', async (req, res) => {
  const removed = await storage.removeForm(req.params.id);
  if (!removed) return notFound(res);
  res.redirect('/admin');
});

async function publishedForm(id) {
  const form = await storage.getForm(id);
  return form && form.published ? form : null;
}

function event(formId, visitId, type, extra = {}) {
  return { formId, visitId, type, at: new Date().toISOString(), ...extra };
}

app.get('/f/:id', async (req, res) => {
  const form = await publishedForm(req.params.id);
  if (!form) return notFound(res);

  const visitId = storage.newId();
  const events = await storage.listEvents();
  await storage.addEventOnce(event(form.id, visitId, 'opened'));

  html(res, views.publicFormPage({
    form,
    values: {},
    errors: {},
    visitId,
    typicalSeconds: typicalFillSeconds(buildAnalytics({ form, events, answers: [] }))
  }));
});

// Sent by the page script on the first keystroke and when the tab closes. No body, no cookies:
// the visit id is the one the server put into this page, and it says nothing about the student.
app.post('/f/:id/started', async (req, res) => {
  const form = await publishedForm(req.params.id);
  const visitId = typeof req.query.v === 'string' ? req.query.v : '';
  if (!form || !visitId) return res.status(404).end();

  await storage.addEventOnce(event(form.id, visitId, 'started'));
  res.status(204).end();
});

app.post('/f/:id/progress', async (req, res) => {
  const form = await publishedForm(req.params.id);
  const visitId = typeof req.query.v === 'string' ? req.query.v : '';
  const fieldId = typeof req.query.field === 'string' ? req.query.field : '';
  if (!form || !visitId || !form.fields.some((field) => field.id === fieldId)) return res.status(404).end();

  const filled = Number(req.query.filled);
  await storage.replaceEvent(event(form.id, visitId, 'progress', {
    fieldId,
    filled: Number.isFinite(filled) ? filled : 0
  }));
  res.status(204).end();
});

app.post('/f/:id', async (req, res) => {
  const form = await publishedForm(req.params.id);
  if (!form) return notFound(res);

  const { values, errors } = validateAnswer(form, req.body);
  // The visit id travels in a hidden field, so a retry after a validation error stays one visit.
  const visitId = typeof req.body.visitId === 'string' && req.body.visitId ? req.body.visitId : storage.newId();

  await storage.addEvent(event(form.id, visitId, 'attempt'));

  if (Object.keys(errors).length) {
    for (const fieldId of Object.keys(errors)) {
      await storage.addEvent(event(form.id, visitId, 'rejected', { fieldId }));
    }
    html(res, views.publicFormPage({
      form,
      values,
      errors,
      visitId,
      typicalSeconds: null
    }), 400);
    return;
  }

  await storage.addAnswer({
    id: storage.newId(),
    formId: form.id,
    visitId,
    values,
    createdAt: new Date().toISOString()
  });
  await storage.addEventOnce(event(form.id, visitId, 'submitted'));

  res.redirect(`/f/${form.id}/sent`);
});

app.get('/f/:id/sent', async (req, res) => {
  const form = await publishedForm(req.params.id);
  if (!form) return notFound(res);
  html(res, views.sentPage({ form }));
});

app.use((req, res) => notFound(res));

app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') {
    html(res, views.errorPage('Слишком большой запрос', 'Сократите текст в полях и отправьте форму еще раз.'), 413);
    return;
  }
  console.error('Необработанная ошибка запроса:', error);
  html(res, views.errorPage('Что-то пошло не так', 'Попробуйте повторить действие. Если повторяется, посмотрите вывод сервиса в консоли.'), 500);
});

// express 5 calls the listen callback on failure too, so the success line is bound to 'listening'.
const server = app.listen(port);

server.on('listening', () => {
  console.log(`Сервис запущен на http://localhost:${port}, админка на http://localhost:${port}/admin`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Порт ${port} занят. Освободите его или запустите на другом порту: PORT=4000 npm start`);
    process.exit(1);
  }
  throw error;
});
