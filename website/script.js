function renderRedactionBoxes() {
  document.querySelectorAll('[data-redaction-demo]').forEach((demo) => {
    const body = demo.querySelector('.window-body');
    if (!body) return;

    body.querySelectorAll('.redaction-box').forEach((el) => el.remove());
    const bodyRect = body.getBoundingClientRect();

    body.querySelectorAll('.pii-target').forEach((target) => {
      const rect = target.getBoundingClientRect();
      const box = document.createElement('div');
      box.className = 'redaction-box';
      box.textContent = '[REDACTED]';
      box.style.left = `${rect.left - bodyRect.left}px`;
      box.style.top = `${rect.top - bodyRect.top - 1}px`;
      box.style.width = `${Math.max(100, rect.width)}px`;
      box.style.height = `${Math.max(18, rect.height + 2)}px`;
      body.appendChild(box);
    });
  });
}

window.addEventListener('resize', renderRedactionBoxes);
window.addEventListener('DOMContentLoaded', () => {
  renderRedactionBoxes();
  setupCapabilityFlow();
});

function setupCapabilityFlow() {
  const steps = Array.from(document.querySelectorAll('.flow-step'));
  const detail = document.getElementById('flowDetail');
  if (!steps.length || !detail) return;

  const setActive = (step) => {
    steps.forEach((item) => item.classList.remove('active'));
    step.classList.add('active');
    detail.textContent = step.dataset.detail || '';
  };

  steps.forEach((step) => {
    step.addEventListener('mouseenter', () => setActive(step));
    step.addEventListener('focus', () => setActive(step));
    step.addEventListener('click', () => setActive(step));
  });
}
