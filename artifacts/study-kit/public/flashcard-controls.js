(() => {
  const STYLE_ID = 'study-kit-flashcard-controls';
  const FLIP_CLASS = 'study-kit-flip-card';
  const CARD_SELECTOR = '[data-testid="button-reveal-card"]';
  let animationTimer = 0;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${FLIP_CLASS} {
        animation: study-kit-card-flip 560ms cubic-bezier(.22,.61,.36,1);
        transform-origin: center;
        backface-visibility: hidden;
      }
      @keyframes study-kit-card-flip {
        0% { transform: perspective(1200px) rotateY(0deg); }
        45% { transform: perspective(1200px) rotateY(90deg); }
        50% { transform: perspective(1200px) rotateY(90deg); }
        100% { transform: perspective(1200px) rotateY(0deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .${FLIP_CLASS} { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function getRevealButton() {
    return document.querySelector(CARD_SELECTOR);
  }

  function getFlashcardSurface() {
    const button = getRevealButton();
    return button?.closest('.paper-surface') || null;
  }

  function flipCard() {
    const button = getRevealButton();
    const surface = getFlashcardSurface();
    if (!button || !surface) return;

    window.clearTimeout(animationTimer);
    surface.classList.remove(FLIP_CLASS);
    void surface.offsetWidth;
    surface.classList.add(FLIP_CLASS);
    button.click();
    animationTimer = window.setTimeout(() => surface.classList.remove(FLIP_CLASS), 600);
  }

  function moveCard(direction) {
    const surface = getFlashcardSurface();
    if (!surface) return;
    const testId = direction < 0 ? 'button-previous-card' : 'button-next-card';
    const button = document.querySelector(`[data-testid="${testId}"]`);
    if (button instanceof HTMLButtonElement && !button.disabled) button.click();
  }

  function isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    return target.matches('input, textarea, select, [contenteditable="true"]');
  }

  function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const surface = getFlashcardSurface();
    if (!surface || !surface.contains(target)) return;
    if (target.closest('button')) return;
    flipCard();
  }

  function handleKeyDown(event) {
    if (isTypingTarget(event.target)) return;
    if (!getFlashcardSurface()) return;

    if (event.code === 'Space') {
      event.preventDefault();
      flipCard();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveCard(-1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveCard(1);
    }
  }

  function init() {
    injectStyles();
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
