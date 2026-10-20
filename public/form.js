// Reports the first keystroke once per page open. The form itself submits without JavaScript,
// so a student with scripts off still gets counted at "opened" and "submitted".
const form = document.getElementById('public-form');

if (form) {
  let reported = false;
  form.addEventListener('input', () => {
    if (reported) return;
    reported = true;
    navigator.sendBeacon(form.dataset.started);
  });
}
