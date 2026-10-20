// Progressive enhancement for the public form. Everything here is optional: the form submits,
// validates and stores answers with JavaScript switched off.

const DRAFT_PREFIX = 'otklik-draft-';

const sent = document.querySelector('[data-sent]');
if (sent) {
  try {
    localStorage.removeItem(DRAFT_PREFIX + sent.dataset.sent);
  } catch {
    // Private mode or blocked storage: there is simply no draft to clean up.
  }
}

const form = document.getElementById('public-form');

if (form) {
  const fields = [...form.querySelectorAll('[data-field]')];
  const draftKey = DRAFT_PREFIX + form.dataset.draft;

  const controls = (block) => [...block.querySelectorAll('input, textarea, select')]
    .filter((control) => control.type !== 'hidden');

  const isFilled = (block) => controls(block).some((control) => (
    control.type === 'checkbox' || control.type === 'radio' ? control.checked : control.value.trim() !== ''
  ));

  const progressBox = form.parentElement.querySelector('[data-progress]');
  const progressFill = progressBox && progressBox.querySelector('[data-progress-fill]');
  const progressDone = progressBox && progressBox.querySelector('[data-progress-done]');
  const requiredFields = fields.filter((block) => block.dataset.required === '1');

  function paintProgress() {
    if (!progressBox || !requiredFields.length) return;
    const done = requiredFields.filter(isFilled).length;
    progressBox.hidden = false;
    progressDone.textContent = String(done);
    progressFill.style.width = `${Math.round((done / requiredFields.length) * 100)}%`;
  }

  function readDraft() {
    try {
      return JSON.parse(localStorage.getItem(draftKey) || 'null');
    } catch {
      return null;
    }
  }

  function saveDraft() {
    const draft = {};
    for (const block of fields) {
      const values = controls(block)
        .filter((control) => (control.type === 'checkbox' || control.type === 'radio' ? control.checked : control.value !== ''))
        .map((control) => control.value);
      if (values.length) draft[block.dataset.field] = values;
    }
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // Storage can be full or blocked. The draft is a convenience, the form works without it.
    }
  }

  // Only restore into an untouched page: a page re-rendered with validation errors already
  // carries what the student typed, and overwriting it would undo their last edit.
  function restoreDraft() {
    if (fields.some(isFilled)) return;
    const draft = readDraft();
    if (!draft) return;

    for (const block of fields) {
      const values = draft[block.dataset.field];
      if (!values) continue;
      for (const control of controls(block)) {
        if (control.type === 'checkbox' || control.type === 'radio') control.checked = values.includes(control.value);
        else control.value = values[0];
      }
    }
  }

  let lastFieldId = null;
  let startReported = false;
  let submitting = false;

  function reportStart() {
    if (startReported) return;
    startReported = true;
    navigator.sendBeacon(form.dataset.startedUrl);
  }

  function reportProgress() {
    if (submitting || !lastFieldId) return;
    const filled = fields.filter(isFilled).length;
    navigator.sendBeacon(`${form.dataset.progressUrl}&field=${encodeURIComponent(lastFieldId)}&filled=${filled}`);
  }

  for (const block of fields) {
    for (const control of controls(block)) {
      control.addEventListener('focus', () => { lastFieldId = block.dataset.field; });
    }
  }

  form.addEventListener('input', () => {
    reportStart();
    paintProgress();
    saveDraft();
  });

  form.addEventListener('change', () => {
    reportStart();
    paintProgress();
    saveDraft();
  });

  form.addEventListener('submit', () => { submitting = true; });

  // pagehide fires on tab close and on navigation away, which is exactly the moment a student
  // abandons the form. visibilitychange covers the mobile case of switching apps.
  window.addEventListener('pagehide', reportProgress);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') reportProgress();
  });

  restoreDraft();
  paintProgress();
}
