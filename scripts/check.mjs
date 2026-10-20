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
  await step('сервис поднялся и отвечает на /', async () => {
    await waitForServer(base, child);
    const response = await fetch(base);
    assert(response.status === 200, `ожидали 200, получили ${response.status}`);
    return 'код 200';
  });

  await step('несуществующий маршрут дает 404', async () => {
    const response = await fetch(`${base}/nothing-here`);
    assert(response.status === 404, `ожидали 404, получили ${response.status}`);
    const html = await response.text();
    assert(!/at\s+\S+:\d+:\d+/.test(html), 'в ответе видна трассировка стека');
    return 'код 404, трассировки нет';
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
