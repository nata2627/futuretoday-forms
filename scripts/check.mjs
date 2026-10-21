// Scenario check: starts the service the same way `npm start` does and walks the key path end
// to end. Fails with exit code 1 on the first broken step, so a red run points at one place.

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
    steps.push(title);
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

function body(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params.toString();
}

function post(url, values = {}) {
  return fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body(values)
  });
}

const text = (response) => response.text();

try {
  let formId = null;
  let visitId = null;
  let fieldIds = [];
  const byLabel = new Map();

  const FIELDS = [
    { label: 'Имя и фамилия', type: 'text', required: 'on', hint: 'Как к вам обращаться' },
    { label: 'Почта для связи', type: 'email', required: 'on', hint: 'На нее придет ответ' },
    { label: 'Телефон', type: 'tel' },
    { label: 'Часов в неделю', type: 'number', required: 'on', min: '1', max: '40' },
    { label: 'Когда можете начать', type: 'date' },
    { label: 'Курс обучения', type: 'select', required: 'on', options: 'Бакалавриат\nМагистратура\nНе обучаюсь' },
    { label: 'Формат работы', type: 'radio', required: 'on', options: 'Офис\nУдаленно\nГибрид' },
    { label: 'Направления', type: 'checkbox', required: 'on', options: 'Аналитика\nРазработка\nДизайн' },
    { label: '<script>alert(1)</script>', type: 'textarea' },
    { label: 'Согласие на обработку данных', type: 'consent', required: 'on' }
  ];

  async function readFieldIds() {
    const page = await text(await fetch(`${base}/admin/forms/${formId}`));
    fieldIds = [...page.matchAll(/\/fields\/([0-9a-f]{8})\/delete/g)].map((match) => match[1]);
    return page;
  }

  await step('сервис поднялся и отвечает на /', async () => {
    await waitForServer(base, child);
    const response = await fetch(base);
    assert(response.status === 200, `ожидали 200, получили ${response.status}`);
    return 'код 200';
  });

  await step('админка на пустой базе показывает подсказку', async () => {
    const page = await text(await fetch(`${base}/admin`));
    assert(page.includes('Форм пока нет'), 'нет пустого состояния с подсказкой');
    return 'подсказка на месте';
  });

  await step('форма без названия отклоняется', async () => {
    const response = await post(`${base}/admin/forms`, { title: '   ' });
    assert(response.status === 400, `ожидали 400, получили ${response.status}`);
    assert((await text(response)).includes('Введите название формы'), 'нет текста ошибки');
    return 'код 400 и текст ошибки';
  });

  await step('менеджер создал форму', async () => {
    const response = await post(`${base}/admin/forms`, {
      title: 'Стажировка в аналитике, лето 2026',
      description: 'Отклик занимает пару минут'
    });
    assert(response.status === 302, `ожидали 302, получили ${response.status}`);
    formId = response.headers.get('location').split('/').pop();
    assert(formId && formId.length >= 20, `идентификатор формы подозрительно короткий: ${formId}`);
    return `идентификатор длиной ${formId.length} символов`;
  });

  await step('форму без вопросов опубликовать нельзя', async () => {
    const response = await post(`${base}/admin/forms/${formId}/publish`);
    assert(response.status === 400, `ожидали 400, получили ${response.status}`);
    assert((await text(response)).includes('нет ни одного поля'), 'нет объяснения, почему нельзя');
    return 'код 400 и объяснение';
  });

  await step('список с одним вариантом отклоняется', async () => {
    const response = await post(`${base}/admin/forms/${formId}/fields`, {
      label: 'Курс', type: 'select', options: 'Только один'
    });
    assert(response.status === 400, `ожидали 400, получили ${response.status}`);
    assert((await text(response)).includes('не меньше двух вариантов'), 'нет текста ошибки');
    return 'код 400';
  });

  await step('границы числа задом наперед отклоняются', async () => {
    const response = await post(`${base}/admin/forms/${formId}/fields`, {
      label: 'Часы', type: 'number', min: '40', max: '10'
    });
    assert(response.status === 400, `ожидали 400, получили ${response.status}`);
    return 'код 400';
  });

  await step('менеджер собрал форму из десяти вопросов всех типов', async () => {
    for (const field of FIELDS) {
      const response = await post(`${base}/admin/forms/${formId}/fields`, field);
      assert(response.status === 302, `вопрос «${field.label}» дал ${response.status}`);
    }
    await readFieldIds();
    assert(fieldIds.length === FIELDS.length, `в форме ${fieldIds.length} вопросов вместо ${FIELDS.length}`);
    FIELDS.forEach((field, index) => byLabel.set(field.label, fieldIds[index]));
    return `${fieldIds.length} вопросов, идентификаторы выдал сервер`;
  });

  await step('вопрос двигается по форме', async () => {
    const second = fieldIds[1];
    const response = await post(`${base}/admin/forms/${formId}/fields/${second}/move`, { direction: 'up' });
    assert(response.status === 302, `ожидали 302, получили ${response.status}`);
    let order = await readFieldIds();
    assert(fieldIds[0] === second, 'вопрос не поднялся наверх');
    await post(`${base}/admin/forms/${formId}/fields/${second}/move`, { direction: 'down' });
    order = await readFieldIds();
    assert(fieldIds[1] === second, 'вопрос не вернулся на место');
    const nonsense = await post(`${base}/admin/forms/${formId}/fields/${second}/move`, { direction: 'вбок' });
    assert(nonsense.status === 400, `неизвестное направление дало ${nonsense.status} вместо 400`);
    await readFieldIds();
    assert(fieldIds[1] === second, 'вопрос сдвинулся от неизвестного направления');
    return 'вверх и вниз работают, неизвестное направление дает 400';
  });

  await step('предпросмотр доступен до публикации, отправка в нем выключена', async () => {
    const response = await fetch(`${base}/admin/forms/${formId}/preview`);
    assert(response.status === 200, `ожидали 200, получили ${response.status}`);
    const page = await text(response);
    assert(page.includes('Предпросмотр'), 'нет пометки о предпросмотре');
    assert(page.includes('disabled'), 'кнопка отправки не выключена');
    const closed = await fetch(`${base}/f/${formId}`);
    assert(closed.status === 404, `неопубликованная форма отдала ${closed.status}`);
    return 'код 200, публичная ссылка пока 404';
  });

  await step('менеджер опубликовал форму и получил ссылку', async () => {
    const response = await post(`${base}/admin/forms/${formId}/publish`);
    assert(response.status === 302, `ожидали 302, получили ${response.status}`);
    const page = await text(await fetch(`${base}/admin/forms/${formId}`));
    assert(page.includes(`/f/${formId}`), 'ссылки на публичную форму нет в админке');
    return `ссылка /f/${formId.slice(0, 6)}...`;
  });

  await step('студент открыл форму, подписи экранированы', async () => {
    const response = await fetch(`${base}/f/${formId}`);
    assert(response.status === 200, `ожидали 200, получили ${response.status}`);
    const page = await text(response);
    assert(page.includes('Имя и фамилия'), 'подписей вопросов нет на странице');
    assert(page.includes('На нее придет ответ'), 'подсказка под полем не выведена');
    assert(!page.includes('<script>alert(1)</script>'), 'подпись вопроса попала в HTML как разметка');
    assert(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'подпись вопроса не отрисована текстом');
    assert(page.includes('type="date"') && page.includes('type="tel"') && page.includes('type="number"'),
      'не все типы полей отрисованы своими элементами');
    visitId = page.match(/name="visitId" value="([^"]+)"/)?.[1];
    assert(visitId, 'на странице нет идентификатора открытия, аналитику считать не по чему');
    return 'код 200, скрипт в подписи выведен текстом';
  });

  await step('первый ввод засчитан один раз', async () => {
    const first = await post(`${base}/f/${formId}/started?v=${visitId}`);
    assert(first.status === 204, `ожидали 204, получили ${first.status}`);
    const second = await post(`${base}/f/${formId}/started?v=${visitId}`);
    assert(second.status === 204, `повтор дал ${second.status}`);
    return 'код 204, повтор не создает второе событие';
  });

  await step('пустая отправка отклоняется, введенное не теряется', async () => {
    const response = await post(`${base}/f/${formId}`, {
      visitId,
      [byLabel.get('Имя и фамилия')]: 'Наталия Гордеева'
    });
    assert(response.status === 400, `ожидали 400, получили ${response.status}`);
    const page = await text(response);
    assert(page.includes('Это поле обязательное'), 'нет ошибки у обязательного поля');
    assert(page.includes('value="Наталия Гордеева"'), 'введенное значение потерялось');
    assert(page.includes('Отметьте хотя бы один вариант'), 'нет ошибки у множественного выбора');
    assert(page.includes('Отметьте согласие'), 'нет ошибки у согласия');
    return 'код 400, значение сохранено';
  });

  await step('каждый тип поля проверяется на сервере', async () => {
    const cases = [
      ['Почта для связи', 'abc', 'не электронная почта'],
      ['Телефон', '+7 999', 'цифр'],
      ['Часов в неделю', '99', 'Не больше 40'],
      ['Когда можете начать', '2026-02-31', 'Такой даты не существует'],
      ['Курс обучения', 'Аспирантура', 'Выберите вариант из списка'],
      ['Формат работы', 'Из кафе', 'Выберите вариант из списка']
    ];
    for (const [label, value, expected] of cases) {
      const response = await post(`${base}/f/${formId}`, { visitId, [byLabel.get(label)]: value });
      assert(response.status === 400, `«${label}» со значением «${value}» дало ${response.status}`);
      const page = await text(response);
      assert(page.includes(expected), `для «${label}» нет сообщения «${expected}»`);
    }
    return `${cases.length} типов отклонили битое значение`;
  });

  function validAnswer() {
    return {
      [byLabel.get('Имя и фамилия')]: 'Наталия Гордеева',
      [byLabel.get('Почта для связи')]: 'student@example.com',
      [byLabel.get('Телефон')]: '+7 (916) 123-45-67',
      [byLabel.get('Часов в неделю')]: '20',
      [byLabel.get('Когда можете начать')]: '2026-06-01',
      [byLabel.get('Курс обучения')]: 'Магистратура',
      [byLabel.get('Формат работы')]: 'Гибрид',
      [byLabel.get('Направления')]: ['Аналитика', 'Дизайн', 'Чужое направление'],
      [byLabel.get('<script>alert(1)</script>')]: 'Хочу в аналитику',
      [byLabel.get('Согласие на обработку данных')]: 'да'
    };
  }

  async function openVisit() {
    const page = await text(await fetch(`${base}/f/${formId}`));
    const match = page.match(/name="visitId" value="([^"]+)"/);
    assert(match, 'на публичной странице нет идентификатора открытия');
    return { page, visitId: match[1] };
  }

  await step('студент отправил корректный отклик', async () => {
    const response = await post(`${base}/f/${formId}`, {
      visitId,
      ...validAnswer(),
      lishnee_pole: 'ЭТОГО_БЫТЬ_НЕ_ДОЛЖНО'
    });
    assert(response.status === 302, `ожидали 302, получили ${response.status}`);
    const sent = await fetch(`${base}/f/${formId}/sent`);
    assert(sent.status === 200, `страница подтверждения дала ${sent.status}`);
    return 'код 302 и страница подтверждения';
  });

  await step('менеджер видит отклик во вкладке ответов', async () => {
    const page = await text(await fetch(`${base}/admin/forms/${formId}/answers`));
    assert(page.includes('student@example.com'), 'ответа нет в таблице');
    assert(page.includes('Аналитика, Дизайн'), 'множественный выбор показан неверно');
    assert(!page.includes('Чужое направление'), 'чужой вариант множественного выбора попал в ответ');
    assert(page.includes('01 июня 2026'), 'дата показана не по-человечески');
    assert(!page.includes('ЭТОГО_БЫТЬ_НЕ_ДОЛЖНО'), 'лишнее поле запроса попало в хранилище');
    return 'ответ в таблице, чужие значения отброшены';
  });

  await step('ответы выгружаются в CSV', async () => {
    const response = await fetch(`${base}/admin/forms/${formId}/answers.csv`);
    assert(response.status === 200, `ожидали 200, получили ${response.status}`);
    assert(response.headers.get('content-disposition')?.includes('attachment'), 'файл не отдается на скачивание');
    // fetch strips the BOM while decoding, so the marker is checked in raw bytes.
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      'нет метки кодировки, Excel откроет кириллицу мусором');
    const csv = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '');
    const [header, row] = csv.trimEnd().split('\r\n');
    assert(header.split(';').length === 11, `столбцов ${header.split(';').length} вместо 11, разделитель не точка с запятой`);
    assert(csv.includes('student@example.com'), 'в выгрузке нет ответа');
    assert(csv.includes('Аналитика, Дизайн'), 'множественный выбор склеен неверно');
    const when = row.split(';')[0];
    assert(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(when), `дата в файле выглядит как «${when}», ждали местный формат`);
    assert(!when.includes('T') && !when.includes('Z'), 'в файл ушла ISO-строка с часовым поясом');
    assert(csv.includes("'+7 (916) 123-45-67"), 'телефон с плюсом уйдет в Excel как формула');
    return 'код 200, точка с запятой, местная дата, формулы обезврежены';
  });

  await step('правка вопроса не теряет собранные ответы', async () => {
    const fieldId = byLabel.get('Телефон');
    const response = await post(`${base}/admin/forms/${formId}/fields/${fieldId}`, {
      label: 'Телефон для связи', hint: 'Чтобы договориться о собеседовании', type: 'text'
    });
    assert(response.status === 302, `ожидали 302, получили ${response.status}`);
    const page = await text(await fetch(`${base}/admin/forms/${formId}/answers`));
    assert(page.includes('Телефон для связи'), 'новая подпись не появилась');
    assert(page.includes('+7 (916) 123-45-67'), 'ответ на переименованный вопрос пропал');
    return 'подпись сменилась, ответ на месте';
  });

  await step('браузер сообщил, на каком вопросе остановился ушедший студент', async () => {
    const page = await text(await fetch(`${base}/f/${formId}`));
    const otherVisit = page.match(/name="visitId" value="([^"]+)"/)[1];
    const fieldId = byLabel.get('Часов в неделю');
    const response = await post(`${base}/f/${formId}/progress?v=${otherVisit}&field=${fieldId}&filled=3`);
    assert(response.status === 204, `ожидали 204, получили ${response.status}`);
    const foreign = await post(`${base}/f/${formId}/progress?v=${otherVisit}&field=nosuchfield&filled=3`);
    assert(foreign.status === 404, `чужой идентификатор вопроса дал ${foreign.status}`);
    return 'код 204, чужой вопрос дает 404';
  });

  await step('аналитика сходится с тем, что произошло', async () => {
    const page = await text(await fetch(`${base}/admin/forms/${formId}/analytics`));
    const number = (label) => {
      const match = page.match(new RegExp(`<td>${label}</td><td class="num">(\\d+)</td>`));
      assert(match, `в воронке нет строки «${label}»`);
      return Number(match[1]);
    };
    assert(number('Открыли форму') === 2, `открытий ${number('Открыли форму')} вместо 2`);
    assert(number('Начали заполнять') === 1, `начавших ${number('Начали заполнять')} вместо 1`);
    assert(number('Отправили отклик') === 1, `отправок ${number('Отправили отклик')} вместо 1`);
    assert(page.includes('1 из 2'), 'доля показана без знаменателя');
    assert(page.includes('Часов в неделю'), 'в разделе про уход нет вопроса, на котором остановились');
    assert(page.includes('Почта для связи'), 'в разделе про отказы сервера нет вопроса с ошибкой');
    assert(page.includes('Магистратура'), 'нет распределения ответов по вариантам');
    return 'открыли 2, начали 1, отправили 1, знаменатели на месте';
  });

  await step('типичное время остается на странице после ошибки валидации', async () => {
    // Строка о времени показывается от пяти принятых откликов, один уже есть.
    for (let index = 0; index < 4; index += 1) {
      const visit = await openVisit();
      const response = await post(`${base}/f/${formId}`, { visitId: visit.visitId, ...validAnswer() });
      assert(response.status === 302, `отклик ${index + 2} дал ${response.status}`);
    }
    const fresh = await openVisit();
    assert(fresh.page.includes('обычно занимает'), 'на свежей форме нет строки о типичном времени');
    const broken = await post(`${base}/f/${formId}`, { visitId: fresh.visitId });
    assert(broken.status === 400, `ожидали 400, получили ${broken.status}`);
    assert((await text(broken)).includes('обычно занимает'), 'после ошибки валидации строка о времени пропала');
    return 'строка на месте и до ошибки, и после';
  });

  await step('битое значение PORT не проглатывается', async () => {
    const broken = spawn(process.execPath, ['src/server.js'], {
      env: { ...process.env, PORT: 'ne-port', DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const said = [];
    broken.stdout.on('data', (chunk) => said.push(chunk.toString()));
    broken.stderr.on('data', (chunk) => said.push(chunk.toString()));
    const code = await new Promise((resolve) => broken.on('close', resolve));
    assert(code === 1, `ожидали код выхода 1, получили ${code}`);
    assert(said.join('').includes('PORT'), 'в выводе нет объяснения, что не так со значением PORT');
    return 'код выхода 1 и одна понятная строка';
  });

  await step('чужая ссылка дает 404', async () => {
    const response = await fetch(`${base}/f/${formId.slice(0, -1)}X`);
    assert(response.status === 404, `ожидали 404, получили ${response.status}`);
    const page = await text(response);
    assert(!/at\s+\S+:\d+:\d+/.test(page), 'в ответе видна трассировка стека');
    return 'код 404 без трассировки';
  });

  await step('попытка выйти из папки данных дает 404', async () => {
    const response = await fetch(`${base}/f/..%2F..%2Fpackage.json`);
    assert(response.status === 404, `ожидали 404, получили ${response.status}`);
    assert(!(await text(response)).includes('futuretoday-forms@'), 'в ответе содержимое файла проекта');
    return 'код 404';
  });

  await step('снятая с публикации форма дает 404', async () => {
    const response = await post(`${base}/admin/forms/${formId}/unpublish`);
    assert(response.status === 302, `ожидали 302, получили ${response.status}`);
    const page = await fetch(`${base}/f/${formId}`);
    assert(page.status === 404, `ожидали 404, получили ${page.status}`);
    return 'код 404';
  });

  await step('удаление формы уносит ее ответы и события', async () => {
    const response = await post(`${base}/admin/forms/${formId}/delete`);
    assert(response.status === 302, `ожидали 302, получили ${response.status}`);
    const gone = await fetch(`${base}/admin/forms/${formId}`);
    assert(gone.status === 404, `страница формы дала ${gone.status}`);
    const answers = await fs.readFile(path.join(dataDir, 'answers.json'), 'utf8');
    const events = await fs.readFile(path.join(dataDir, 'events.json'), 'utf8');
    assert(!answers.includes(formId), 'ответы удаленной формы остались в файле');
    assert(!events.includes(formId), 'события удаленной формы остались в файле');
    return 'форма 404, ответов и событий не осталось';
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
