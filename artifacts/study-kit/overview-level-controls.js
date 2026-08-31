const STORAGE_KEY = 'study-kit-overview-level';
const LEVELS = [
  { value: 'beginner', label: 'Beginner', description: 'Simpler vocabulary and brief explanations for unfamiliar terms.' },
  { value: 'standard', label: 'Standard', description: 'Normal academic language with brief explanations when needed.' },
  { value: 'advanced', label: 'Advanced', description: 'More precise terminology, nuance, and deeper connections.' }
];

let selectedLevel = localStorage.getItem(STORAGE_KEY) || 'standard';
if (!LEVELS.some((level) => level.value === selectedLevel)) selectedLevel = 'standard';

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  try {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'POST' && init?.body && typeof init.body === 'string') {
      const body = JSON.parse(init.body);
      if (body && Array.isArray(body.materials) && body.planDays) {
        body.overviewLevel = selectedLevel;
        init = { ...init, body: JSON.stringify(body) };
      }
    }
  } catch {}
  return originalFetch(input, init);
};

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
      const active = button.dataset.level === selectedLevel;
      button.style.borderColor = active ? '#18181b' : '#e4e4e7';
      button.style.background = active ? '#18181b' : 'transparent';
      button.style.color = active ? '#fafafa' : '#18181b';
    });
    description.textContent = (LEVELS.find((level) => level.value === selectedLevel) || LEVELS[1]).description;
  };

  LEVELS.forEach((level) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = level.label;
    button.dataset.level = level.value;
    button.style.cssText = 'border:1px solid #e4e4e7;border-radius:999px;padding:7px 12px;font-size:12px;background:transparent;color:#18181b;cursor:pointer;transition:.15s ease;';
    button.addEventListener('click', () => {
      selectedLevel = level.value;
      localStorage.setItem(STORAGE_KEY, selectedLevel);
      refresh();
    });
    row.appendChild(button);
  });

  wrapper.append(title, row, description);
  daysLabel.parentElement.insertAdjacentElement('afterend', wrapper);
  refresh();
}

const observer = new MutationObserver(addControl);
observer.observe(document.documentElement, { childList: true, subtree: true });
addControl();
