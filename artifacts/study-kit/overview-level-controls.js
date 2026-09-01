const STORAGE_KEY = 'study-kit-overview-level';
const OPTIONS_KEY = 'study-kit-content-options';
const LAST_KIT_KEY = 'study-kit-last-options';
const LEVELS = [
  { value: 'beginner', label: 'Beginner', description: 'Simpler vocabulary and brief explanations for unfamiliar terms.' },
  { value: 'standard', label: 'Standard', description: 'Normal academic language with brief explanations when needed.' },
  { value: 'advanced', label: 'Advanced', description: 'More precise terminology, nuance, and deeper connections.' }
];
const CONTENT_OPTIONS = [
  { key: 'overview', label: 'Overview', description: 'Concept map and chapter explanations' },
  { key: 'plan', label: 'Review plan', description: 'A day-by-day study schedule' },
  { key: 'flashcards', label: 'Flashcards', description: 'Question-and-answer recall cards' },
  { key: 'quiz', label: 'Practice quiz', description: 'Multiple-choice practice questions' },
];

let selectedLevel = localStorage.getItem(STORAGE_KEY) || 'standard';
if (!LEVELS.some((level) => level.value === selectedLevel)) selectedLevel = 'standard';
let selectedOptions = readOptions();

function readOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return Object.fromEntries(CONTENT_OPTIONS.map(({ key }) => [key, saved[key] !== false]));
    }
  } catch {}
  return Object.fromEntries(CONTENT_OPTIONS.map(({ key }) => [key, true]));
}

function saveOptions() {
  localStorage.setItem(OPTIONS_KEY, JSON.stringify(selectedOptions));
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  let generationConfig = null;
  try {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'POST' && init?.body && typeof init.body === 'string') {
      const body = JSON.parse(init.body);
      if (body && Array.isArray(body.materials) && body.planDays) {
        body.overviewLevel = selectedLevel;
        body.include = { ...selectedOptions };
        generationConfig = { title: body.title, planDays: Number(body.planDays), include: { ...selectedOptions } };
        init = { ...init, body: JSON.stringify(body) };
      }
    }
  } catch {}

  const response = await originalFetch(input, init);
  if (generationConfig) {
    try {
      const clone = response.clone();
      const data = await clone.json();
      sessionStorage.setItem(LAST_KIT_KEY, JSON.stringify({ ...generationConfig, generatedTitle: data.title || generationConfig.title }));
    } catch {}
  }
  return response;
};

function buttonStyle(active) {
  return `border:1px solid ${active ? '#18181b' : '#e4e4e7'};border-radius:999px;padding:7px 12px;font-size:12px;background:${active ? '#18181b' : 'transparent'};color:${active ? '#fafafa' : '#18181b'};cursor:pointer;transition:.15s ease;`;
}

function addControl() {
  if (!location.pathname.endsWith('/new') || document.getElementById('overview-level-control')) return;
  const labels = Array.from(document.querySelectorAll('label'));
  const daysLabel = labels.find((label) => label.textContent?.includes('How many days do you have?'));
  if (!daysLabel?.parentElement) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'overview-level-control';
  wrapper.style.cssText = 'margin-top:32px;';

  const title = document.createElement('div');
  title.textContent = 'How should your kit explain things?';
  title.style.cssText = 'margin-bottom:8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:#71717a;';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

  const description = document.createElement('div');
  description.style.cssText = 'margin-top:8px;font-size:11px;line-height:1.5;color:#71717a;';

  const refresh = () => {
    row.querySelectorAll('button').forEach((button) => {
      button.style.cssText = buttonStyle(button.dataset.level === selectedLevel);
    });
    description.textContent = (LEVELS.find((level) => level.value === selectedLevel) || LEVELS[1]).description;
  };

  LEVELS.forEach((level) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = level.label;
    button.dataset.level = level.value;
    button.addEventListener('click', () => {
      selectedLevel = level.value;
      localStorage.setItem(STORAGE_KEY, selectedLevel);
      refresh();
    });
    row.appendChild(button);
  });

  wrapper.append(title, row, description);

  const include = document.createElement('div');
  include.id = 'study-kit-content-control';
  include.style.cssText = 'margin-top:28px;border-top:1px solid #e4e4e7;padding-top:24px;';
  const includeTitle = document.createElement('div');
  includeTitle.textContent = 'What should be included?';
  includeTitle.style.cssText = 'margin-bottom:4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:#71717a;';
  const includeHelp = document.createElement('div');
  includeHelp.textContent = 'Choose the parts you actually want in this kit.';
  includeHelp.style.cssText = 'margin-bottom:12px;font-size:11px;color:#71717a;';
  const includeGrid = document.createElement('div');
  includeGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;';
  const includeStatus = document.createElement('div');
  includeStatus.style.cssText = 'margin-top:8px;font-size:11px;color:#b45309;min-height:16px;';

  CONTENT_OPTIONS.forEach(({ key, label, description: copy }) => {
    const item = document.createElement('label');
    item.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid #e4e4e7;border-radius:10px;background:rgba(255,255,255,.35);cursor:pointer;';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedOptions[key];
    checkbox.dataset.contentKey = key;
    checkbox.style.cssText = 'margin-top:2px;accent-color:#18181b;';
    checkbox.addEventListener('change', () => {
      const checkedCount = Object.values(selectedOptions).filter(Boolean).length;
      if (!checkbox.checked && checkedCount <= 1) {
        checkbox.checked = true;
        includeStatus.textContent = 'Keep at least one part of the kit selected.';
        return;
      }
      selectedOptions[key] = checkbox.checked;
      saveOptions();
      includeStatus.textContent = '';
    });
    const text = document.createElement('span');
    text.innerHTML = `<strong style="display:block;font-size:12px;color:#18181b;font-weight:600">${label}</strong><span style="display:block;margin-top:3px;font-size:10px;line-height:1.4;color:#71717a">${copy}</span>`;
    item.append(checkbox, text);
    includeGrid.appendChild(item);
  });

  include.append(includeTitle, includeHelp, includeGrid, includeStatus);
  wrapper.appendChild(include);
  daysLabel.parentElement.insertAdjacentElement('afterend', wrapper);
  refresh();
}

function applyKitControls() {
  if (location.pathname.startsWith('/new') || !location.pathname.startsWith('/kit/')) return;
  let config = null;
  try { config = JSON.parse(sessionStorage.getItem(LAST_KIT_KEY) || 'null'); } catch {}
  if (!config) return;

  const tabs = {
    overview: document.querySelector('[data-testid="button-tab-overview"]'),
    plan: document.querySelector('[data-testid="button-tab-plan"]'),
    flashcards: document.querySelector('[data-testid="button-tab-flashcards"]'),
    quiz: document.querySelector('[data-testid="button-tab-exam"]'),
  };
  const selected = config.include || {};
  Object.entries(tabs).forEach(([key, button]) => {
    if (!button) return;
    const enabled = selected[key] !== false;
    button.parentElement?.toggleAttribute('hidden', !enabled);
    if (button.parentElement) button.parentElement.style.display = enabled ? '' : 'none';
  });

  if (tabs.plan && selected.plan !== false) tabs.plan.textContent = `${config.planDays}-day plan`;

  const currentVisible = Object.entries(tabs).find(([key, button]) => selected[key] !== false && button && button.parentElement?.style.display !== 'none');
  const overviewEnabled = selected.overview !== false;
  if (!overviewEnabled && currentVisible?.[1]) currentVisible[1].click();
}

const observer = new MutationObserver(() => {
  addControl();
  applyKitControls();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
addControl();
applyKitControls();
