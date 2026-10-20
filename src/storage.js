// Storage is a few JSON files inside the project: no native modules, so `npm install` cannot
// fail on another machine. Forms, answers and events live in separate files, so a growing
// answers file never rewrites the forms file.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data'));

const FORMS = 'forms.json';
const ANSWERS = 'answers.json';

// One write queue per file: two requests arriving together would otherwise read the same
// state and the slower write would drop the faster one.
const queues = new Map();

function serialize(file, task) {
  const previous = queues.get(file) || Promise.resolve();
  const next = previous.then(task, task);
  queues.set(file, next.catch(() => {}));
  return next;
}

async function readFile(file) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, file), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// Temp file plus rename: a crash in the middle leaves the previous file intact instead of a
// half-written one.
async function writeFile(file, value) {
  const target = path.join(dataDir, file);
  const temp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2));
  await fs.rename(temp, target);
}

function update(file, change) {
  return serialize(file, async () => {
    const items = await readFile(file);
    const result = change(items);
    await writeFile(file, items);
    return result;
  });
}

export async function init() {
  await fs.mkdir(dataDir, { recursive: true });
}

// 16 random bytes: a public link must not be guessable by trying neighbouring numbers.
export function newId() {
  return crypto.randomBytes(16).toString('base64url');
}

export function newFieldId() {
  return crypto.randomBytes(4).toString('hex');
}

export function listForms() {
  return readFile(FORMS);
}

export async function getForm(id) {
  const forms = await readFile(FORMS);
  return forms.find((form) => form.id === id) || null;
}

export function addForm(form) {
  return update(FORMS, (forms) => {
    forms.push(form);
    return form;
  });
}

// The change runs inside the write queue, so a form read here cannot be stale.
export function updateForm(id, change) {
  return update(FORMS, (forms) => {
    const form = forms.find((item) => item.id === id);
    if (!form) return null;
    change(form);
    return form;
  });
}

export async function removeForm(id) {
  const removed = await update(FORMS, (forms) => {
    const index = forms.findIndex((form) => form.id === id);
    if (index === -1) return false;
    forms.splice(index, 1);
    return true;
  });
  if (removed) {
    await update(ANSWERS, (answers) => {
      for (let index = answers.length - 1; index >= 0; index -= 1) {
        if (answers[index].formId === id) answers.splice(index, 1);
      }
    });
  }
  return removed;
}

export function addAnswer(answer) {
  return update(ANSWERS, (answers) => {
    answers.push(answer);
    return answer;
  });
}

export async function listAnswers(formId) {
  const answers = await readFile(ANSWERS);
  return answers.filter((answer) => answer.formId === formId);
}

export async function countAnswers() {
  const answers = await readFile(ANSWERS);
  return answers.reduce((counts, answer) => {
    counts[answer.formId] = (counts[answer.formId] || 0) + 1;
    return counts;
  }, {});
}

export function dataLocation() {
  return dataDir;
}
