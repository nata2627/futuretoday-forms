// Two conveniences for the manager. The builder itself is plain HTML forms and works without
// JavaScript: these only save a selection and hide inputs the chosen type does not use.

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const input = document.getElementById(button.dataset.copy);
    input.select();
    try {
      await navigator.clipboard.writeText(input.value);
      button.textContent = 'Скопировано';
      setTimeout(() => { button.textContent = 'Скопировать'; }, 2000);
    } catch {
      document.execCommand('copy');
    }
  });
}

const typeSelect = document.querySelector('[data-type-select]');

if (typeSelect) {
  const conditional = [...document.querySelectorAll('[data-when]')];
  const hints = [...document.querySelectorAll('.type-hint')];

  const apply = () => {
    for (const block of conditional) {
      block.hidden = !block.dataset.when.split(' ').includes(typeSelect.value);
    }
    for (const hint of hints) {
      hint.hidden = hint.dataset.for !== typeSelect.value;
    }
  };

  typeSelect.addEventListener('change', apply);
  apply();
}
