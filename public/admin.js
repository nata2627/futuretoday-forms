// Copy button only: the admin panel works without JavaScript, this just saves a selection.
document.querySelectorAll('[data-copy]').forEach((button) => {
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
});
