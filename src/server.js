import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { page } from './views.js';
import * as storage from './storage.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;

await storage.init();

const app = express();

app.use(express.static(path.join(rootDir, 'public')));

app.get('/', (req, res) => {
  res.type('html').send(page({
    title: 'Конструктор форм отклика',
    body: `<h1>Конструктор форм отклика</h1>
<p>Менеджер собирает форму в админке и получает ссылку, студент заполняет форму по этой ссылке.</p>
<p><a class="button" href="/admin">Перейти в админку</a></p>`
  }));
});

app.use((req, res) => {
  res.status(404).type('html').send(page({
    title: 'Страница не найдена',
    body: `<h1>Страница не найдена</h1>
<p>Такой страницы нет. Если вы перешли по ссылке на форму, проверьте, что скопировали ее целиком.</p>
<p><a href="/">На главную</a></p>`
  }));
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
