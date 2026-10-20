// Scenario check: starts the service the same way `npm start` does and walks the key path.
// Fails with exit code 1 on the first broken step, so a red run points at one place.

import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const steps = [];
let failed = null;

async function step(title, run) {
  if (failed) return;
  try {
    const detail = await run();
    steps.push({ title, detail });
    console.log(`  ok  ${title}${detail ? `: ${detail}` : ''}`);
  } catch (error) {
    failed = { title, message: error.message };
    console.error(`  FAIL ${title}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForServer(base, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`сервер завершился с кодом ${child.exitCode}`);
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Server is not listening yet, this is the normal state right after spawn.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('сервер не ответил за 15 секунд');
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'futuretoday-check-'));

const child = spawn(process.execPath, ['src/server.js'], {
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe']
});

const serverOutput = [];
child.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
child.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));

console.log(`Проверка сценария, порт ${port}, данные в ${dataDir}`);

try {
  let formId = null;
  let visitId = null;
  const fieldIds = {};

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString()
    });
  }

  await step('сервис поднялся и отвечает на /', async () => {
    await waitForServer(base, child);
    const response = await fetch(base);
    assert(response.status === 200, `ожидали 200, получили ${response.status}`);
    return 'код 200';
  });

  await step('админка на пустой базе показывает подсказку', async () => {
    const response = await fetch(`${base}/admin`);
    assert(response.status === 200, `ожидали 200, получили ${response.status}`);
    const html = await response.text();
    assert(html.includes('Форм пока нет'), 'нет пустого состояния с подсказкой');
    return 'код 200, подсказка на месте';
  });

  await step('форма без названия отклоняется', async () => {
    const response = await post(`${base}/admin/forms`, { title: '   ' });
    assert(response.status === 400, `ожидали 400, получили ${response.status}`);
    const html = await response.text();
    assert(html.includes('Введите название формы'), 'нет текста ошибки');
    return 'код 400 и текст ошибки';
  });

  await step('менеджер создал форму', async () => {
    const response = await post(`${base}/admin/forms`, {
      title: 'Стажировка в аналитике, лето 2026',
      description: 'Отклик занимает две минуты'
    });
    assert(response.status === 302, `ожидали 302, получили ${response.status}`);
    formId = response.headers.get('location').split('/').pop();
    assert(formId && formId.length >= 20, `идентификатор формы подозрительно короткий: ${formId}`);
    return `идентификатор длиной ${formId.length} символов`;
  });

  await step('форму без полей опубликовать нельзя', async () => {
    const response = await post(`${base}/admin/forms/${formId}/publish`, {});
    assert(response.status === 400, `ожидали 400, получили ${response.status}`);
    const html = await response.text();
    assert(html.includes('нет ни одного поля'), 'нет объяснения, почему нельзя');
    return 'код 400 и объяснение';
  });

  await step('поле выбора без вариантов отклоняется', async () => {
    const response = await post(`${base}/admin/forms/${formId}/fields`, {
      label: 'Курс',
      type: 'select',
      options: '   '
    });
    assert(response.status === 400, `ожидали 400, получили ${response.status}`);
    return 'код 400';
  });

  await step('менеджер добавил четыре поля', async () => {
    const fields = [
      { label: 'Имя и фамилия', type: 'text', required: 'on' },
      { label: 'Почта', type: 'email', required: 'on' },
      { label: 'Курс', type: 'select', options: 'Бакалавриат\nМагистратура' },
      { label: '<script>alert(1)</script>', type: 'textarea' }
    ];
    for (const field of fields) {
      const response = await post(`${base}/admin/forms/${formId}/fields`, field);
      assert(response.status === 200, `поле «${field.label}» дало ${response.status}`);
    }
    const page = await (await fetch(`${base}/admin/forms/${formId}`)).text();
    for (const match of page.matchAll(/\/fields\/([0-9a-f]{8})\/delete/g)) {
      fieldIds[Object.keys(fieldIds).length] = match[1];
    }
    assert(Object.keys(fieldIds).length === 4, `в форме ${Object.keys(fieldIds).length} полей вместо 4`);
    return '4 поля, идентификаторы выдал сервер';
  });

  await step('менеджер опубликовал форму и получил ссылку', async () => {
    const response = await post(`${base}/admin/forms/${formId}/publish`, {});
    assert(response.status === 302, `ожидали 302, получили ${response.status}`);
    const page = await (await fetch(`${base}/admin/forms/${formId}`)).text();
    assert(page.includes(`/f/${formId}`), 'ссылки на публичную форму нет в админке');
    return `ссылка /f/${formId.slice(0, 6)}...`;
  });

  await step('студент открыл форму по ссылке, подписи экранированы', async () => {
    const response = await fetch(`${base}/f/${formId}`);
    assert(response.status === 200, `ожидали 200, получили ${response.status}`);
    const html = await response.text();
    assert(html.includes('Имя и фамилия'), 'подписей полей нет на странице');
    assert(!html.includes('<script>alert(1)</script>'), 'подпись поля попала в HTML как разметка');
    assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'подпись поля не отрисована текстом');
    visitId = html.match(/name="visitId" value="([^"]+)"/)?.[1];
    assert(visitId, 'на странице нет идентификатора открытия, воронку считать не по чему');
    return 'код 200, скрипт в подписи выведен текстом';
  });

  await step('первый ввод засчитан один раз', async () => {
    const first = await post(`${base}/f/${formId}/started?v=${visitId}`, {});
    assert(first.status === 204, `ожидали 204, получили ${first.status}`);
    const second = await post(`${base}/f/${formId}/started?v=${visitId}`, {});
    assert(second.status === 204, `повтор дал ${second.status}`);
    return 'код 204, повтор не создает второе событие';
  });

  await step('пустая отправка отклоняется, введенное не теряется', async () => {
    const response = await post(`${base}/f/${formId}`, {
      [fieldIds[0]]: 'Наталия Гордеева',
      [fieldIds[1]]: ''
    });
    assert(response.status === 400, `ожидали 400, получили ${response.status}`);
    const html = await response.text();
    assert(html.includes('Это поле обязательное'), 'нет ошибки у обязательного поля');
    assert(html.includes('Наталия Гордеева'), 'введенное значение потерялось');
    return 'код 400, значение сохранено';
  });

  await step('битая почта отклоняется', async () => {
    const response = await post(`${base}/f/${formId}`, {
      [fieldIds[0]]: 'Наталия Гордеева',
      [fieldIds[1]]: 'abc'
    });
    assert(response.status === 400, `ожидали 400, получили ${response.status}`);
    const html = await response.text();
    assert(html.includes('не электронная почта'), 'нет сообщения про почту');
    return 'код 400';
  });

  await step('студент отправил корректный отклик', async () => {
    const response = await post(`${base}/f/${formId}`, {
      [fieldIds[0]]: 'Наталия Гордеева',
      [fieldIds[1]]: 'student@example.com',
      [fieldIds[2]]: 'Магистратура',
      [fieldIds[3]]: 'Хочу в аналитику',
      visitId,
      lishnee_pole: 'ЭТОГО_БЫТЬ_НЕ_ДОЛЖНО'
    });
    assert(response.status === 302, `ожидали 302, получили ${response.status}`);
    const sent = await fetch(`${base}/f/${formId}/sent`);
    assert(sent.status === 200, `страница подтверждения дала ${sent.status}`);
    return 'код 302 и страница подтверждения';
  });

  await step('менеджер видит ответ в админке', async () => {
    const html = await (await fetch(`${base}/admin/forms/${formId}`)).text();
    assert(html.includes('student@example.com'), 'ответа нет в таблице');
    assert(html.includes('Магистратура'), 'значение выбора не показано');
    assert(!html.includes('ЭТОГО_БЫТЬ_НЕ_ДОЛЖНО'), 'лишнее поле запроса попало в хранилище');
    return 'ответ в таблице, лишнее поле отброшено';
  });

  await step('воронка в админке сходится с тем, что произошло', async () => {
    const html = await (await fetch(`${base}/admin/forms/${formId}`)).text();
    const number = (label) => {
      const match = html.match(new RegExp(`<td>${label}</td><td>(\\d+)</td>`));
      assert(match, `в воронке нет строки «${label}»`);
      return Number(match[1]);
    };
    const opened = number('Открыли форму');
    const started = number('Начали заполнять');
    const submitted = number('Отправили отклик');
    assert(opened === 1, `открытий ${opened} вместо 1`);
    assert(started === 1, `начал заполнять ${started} вместо 1`);
    assert(submitted === 1, `отправок ${submitted} вместо 1`);
    assert(html.includes('1 из 1'), 'доля показана без знаменателя');
    return 'открыли 1, начали 1, отправили 1, знаменатель на месте';
  });

  await step('чужая ссылка дает 404', async () => {
    const response = await fetch(`${base}/f/${formId.slice(0, -1)}X`);
    assert(response.status === 404, `ожидали 404, получили ${response.status}`);
    const html = await response.text();
    assert(!/at\s+\S+:\d+:\d+/.test(html), 'в ответе видна трассировка стека');
    return 'код 404 без трассировки';
  });

  await step('попытка выйти из папки данных дает 404', async () => {
    const response = await fetch(`${base}/f/..%2F..%2Fpackage.json`);
    assert(response.status === 404, `ожидали 404, получили ${response.status}`);
    const html = await response.text();
    assert(!html.includes('futuretoday-forms@'), 'в ответе содержимое файла проекта');
    return 'код 404';
  });

  await step('снятая с публикации форма дает 404', async () => {
    const response = await post(`${base}/admin/forms/${formId}/unpublish`, {});
    assert(response.status === 302, `ожидали 302, получили ${response.status}`);
    const page = await fetch(`${base}/f/${formId}`);
    assert(page.status === 404, `ожидали 404, получили ${page.status}`);
    return 'код 404';
  });

  await step('несуществующий маршрут дает 404', async () => {
    const response = await fetch(`${base}/nothing-here`);
    assert(response.status === 404, `ожидали 404, получили ${response.status}`);
    return 'код 404';
  });
} finally {
  child.kill();
  await fs.rm(dataDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`\nПроверка упала на шаге: ${failed.title}`);
  if (serverOutput.length) console.error(`Вывод сервера:\n${serverOutput.join('')}`);
  process.exit(1);
}

console.log(`\nПроверка пройдена, шагов: ${steps.length}`);
