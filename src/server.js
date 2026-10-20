import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as storage from './storage.js';
import * as views from './views.js';
import {
  FIELD_TYPES,
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
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

function html(res, body, status = 200) {
  res.status(status).type('html').send(body);
}

function publicLink(req, formId) {
  return `${req.protocol}://${req.get('host')}/f/${formId}`;
}

function notFound(res) {
  html(res, views.page({
    title: 'Страница не найдена',
    body: `<h1>Страница не найдена</h1>
<p>Такой страницы нет. Если вы перешли по ссылке на форму, проверьте, что скопировали ее целиком, и спросите ссылку у менеджера: форму могли снять с публикации.</p>
<p><a href="/">На главную</a></p>`
  }), 404);
}

app.get('/', (req, res) => {
  html(res, views.page({
    title: 'Конструктор форм отклика',
    body: `<h1>Конструктор форм отклика</h1>
<p>Менеджер собирает форму в админке и получает ссылку, студент заполняет форму по этой ссылке.</p>
<p><a class="button" href="/admin">Перейти в админку</a></p>`
  }));
});

app.get('/admin', async (req, res) => {
  const forms = await storage.listForms();
  const answerCounts = await storage.countAnswers();
  html(res, views.adminListPage({ forms, answerCounts, values: { title: '', description: '' } }));
});

app.post('/admin/forms', async (req, res) => {
  const { values, errors } = validateFormDraft(req.body);

  if (Object.keys(errors).length) {
    const forms = await storage.listForms();
    const answerCounts = await storage.countAnswers();
    html(res, views.adminListPage({ forms, answerCounts, values, errors }), 400);
    return;
  }

  const form = await storage.addForm({
    id: storage.newId(),
    title: values.title,
    description: values.description,
    fields: [],
    published: false,
    createdAt: new Date().toISOString()
  });

  res.redirect(`/admin/forms/${form.id}`);
});

async function renderAdminForm(req, res, form, extra = {}) {
  const answers = await storage.listAnswers(form.id);
  html(res, views.adminFormPage({
    form,
    link: publicLink(req, form.id),
    answers,
    fieldTypes: FIELD_TYPES,
    ...extra
  }), extra.status || 200);
}

app.get('/admin/forms/:id', async (req, res) => {
  const form = await storage.getForm(req.params.id);
  if (!form) return notFound(res);
  await renderAdminForm(req, res, form);
});

app.post('/admin/forms/:id/fields', async (req, res) => {
  const form = await storage.getForm(req.params.id);
  if (!form) return notFound(res);

  const { values, field, errors } = validateField(req.body);
  if (form.fields.length >= 20) errors.label = 'В форме уже 20 полей, больше студент не осилит';

  if (Object.keys(errors).length) {
    await renderAdminForm(req, res, form, { fieldValues: values, fieldErrors: errors, status: 400 });
    return;
  }

  const updated = await storage.updateForm(form.id, (current) => {
    current.fields.push({ id: storage.newFieldId(), ...field });
  });

  await renderAdminForm(req, res, updated);
});

app.post('/admin/forms/:id/fields/:fieldId/delete', async (req, res) => {
  const updated = await storage.updateForm(req.params.id, (form) => {
    const index = form.fields.findIndex((field) => field.id === req.params.fieldId);
    if (index !== -1) form.fields.splice(index, 1);
  });
  if (!updated) return notFound(res);
  res.redirect(`/admin/forms/${updated.id}`);
});

app.post('/admin/forms/:id/publish', async (req, res) => {
  const form = await storage.getForm(req.params.id);
  if (!form) return notFound(res);

  const problem = validateFormForPublish(form);
  if (problem) {
    await renderAdminForm(req, res, form, { formErrors: [problem], status: 400 });
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

app.get('/f/:id', async (req, res) => {
  const form = await publishedForm(req.params.id);
  if (!form) return notFound(res);

  html(res, views.publicFormPage({
    form,
    values: {},
    errors: {}
  }));
});

app.post('/f/:id', async (req, res) => {
  const form = await publishedForm(req.params.id);
  if (!form) return notFound(res);

  const { values, errors } = validateAnswer(form, req.body);

  if (Object.keys(errors).length) {
    html(res, views.publicFormPage({
      form,
      values,
      errors
    }), 400);
    return;
  }

  await storage.addAnswer({
    id: storage.newId(),
    formId: form.id,
    values,
    createdAt: new Date().toISOString()
  });

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
    html(res, views.page({
      title: 'Слишком большой запрос',
      body: '<h1>Слишком большой запрос</h1><p>Сократите текст в полях и отправьте форму еще раз.</p>'
    }), 413);
    return;
  }
  console.error('Необработанная ошибка запроса:', error);
  html(res, views.page({
    title: 'Ошибка на сервере',
    body: '<h1>Что-то пошло не так</h1><p>Попробуйте повторить действие. Если повторяется, посмотрите вывод сервиса в консоли.</p>'
  }), 500);
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
