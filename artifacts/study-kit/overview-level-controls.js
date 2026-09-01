const STORAGE_KEY = 'study-kit-overview-level';
const LAST_KIT_KEY = 'study-kit-last-options';
const KIT_OPTIONS_KEY = 'study-kit-content-options-by-id';
const LEVELS = [
  { value: 'beginner', label: 'Beginner', description: 'Simpler vocabulary and brief explanations for unfamiliar terms.', instruction: 'Use simple vocabulary. Define unavoidable academic terms in plain language the first time they appear. Prefer short sentences and concrete explanations.' },
  { value: 'standard', label: 'Standard', description: 'Normal academic language with brief explanations when needed.', instruction: 'Use normal academic vocabulary. Briefly define specialized terms when they are important to understanding the concept.' },
  { value: 'advanced', label: 'Advanced', description: 'More precise terminology, nuance, and deeper connections.', instruction: 'Use precise academic terminology, nuanced explanations, and deeper connections between concepts. Do not oversimplify established terms.' }
];
const CONTENT_OPTIONS = [
  { key: 'overview', label: 'Overview', description: 'Concept map and chapter explanations' },
  { key: 'plan', label: 'Review plan', description: 'A day-by-day study schedule' },
  { key: 'flashcards', label: 'Flashcards', description: 'Question-and-answer recall cards' },
  { key: 'quiz', label: 'Practice quiz', description: 'Multiple-choice practice questions' },
];

let selectedLevel = localStorage.getItem(STORAGE_KEY) || 'standard';
if (!LEVELS.some((level) => level.value === selectedLevel)) selectedLevel = 'standard';
let selectedOptions = allOptions();

function allOptions() {
  return Object.fromEntries(CONTENT_OPTIONS.map(({ key }) => [key, true]));
}

function readKitOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(KIT_OPTIONS_KEY) || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function saveKitOptions(id, options, planDays) {
  if (!id) return;
  const all = readKitOptions();
  all[id] = { ...allOptions(), ...options, planDays: Number(planDays) || 7 };
  localStorage.setItem(KIT_OPTIONS_KEY, JSON.stringify(all));
}

function getKitIdFromPath() {
  const match = location.pathname.match(/\/kit\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getLocalKits() {
  try {
    const saved = JSON.parse(localStorage.getItem('lecture-study-kits') || 'null');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function persistLocalDelete(id) {
  const kits = getLocalKits().filter((kit) => kit?.id !== id);
  localStorage.setItem('lecture-study-kits', JSON.stringify(kits));
  localStorage.removeItem(`lecture-study-progress-${id}`);
  const options = readKitOptions();
  delete options[id];
  localStorage.setItem(KIT_OPTIONS_KEY, JSON.stringify(options));
}

// Add the selected difficulty/content configuration to the generation request.
// This is deliberately limited to POST requests that look like kit generation.
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  let generationConfig = null;
  try {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'POST' && init?.body && typeof init.body === 'string') {
      const body = JSON.parse(init.body);
      if (body && Array.isArray(body.materials) && body.planDays) {
        const level = LEVELS.find((item) => item.value === selectedLevel) || LEVELS[1];
        body.overviewLevel = selectedLevel;
        body.include = { ...selectedOptions };
        body.syllabus = `${body.syllabus || ''}\n\nEXPLANATION LEVEL PREFERENCE: ${level.label}. ${level.instruction}`.trim();
        generationConfig = { id: body.id, title: body.title, planDays: Number(body.planDays), include: { ...selectedOptions } };
        init = { ...init, body: JSON.stringify(body) };
      }
    }
  } catch {}

  const response = await originalFetch(input, init);
  if (!generationConfig) return response;

  try {
    const data = await response.clone().json();
    const generatedId = data.id || generationConfig.id || generationConfig.title;
    saveKitOptions(generatedId, generationConfig.include, generationConfig.planDays);
    sessionStorage.setItem(LAST_KIT_KEY, JSON.stringify({ ...generationConfig, generatedId, generatedTitle: data.title || generationConfig.title }));
    data.contentOptions = { ...generationConfig.include };
    return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch {
    return response;
  }
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
    row.querySelectorAll('button').forEach((button) => { button.style.cssText = buttonStyle(button.dataset.level === selectedLevel); });
    description.textContent = (LEVELS.find((level) => level.value === selectedLevel) || LEVELS[1]).description;
  };
  LEVELS.forEach((level) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = level.label; button.dataset.level = level.value;
    button.addEventListener('click', () => { selectedLevel = level.value; localStorage.setItem(STORAGE_KEY, selectedLevel); refresh(); });
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

  selectedOptions = allOptions();
  CONTENT_OPTIONS.forEach(({ key, label, description: copy }) => {
    const item = document.createElement('label');
    item.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid #e4e4e7;border-radius:10px;background:rgba(255,255,255,.35);cursor:pointer;';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.dataset.contentKey = key;
    checkbox.style.cssText = 'margin-top:2px;accent-color:#18181b;';
    checkbox.addEventListener('change', () => {
      const checkedCount = Object.values(selectedOptions).filter(Boolean).length;
      if (!checkbox.checked && checkedCount <= 1) { checkbox.checked = true; includeStatus.textContent = 'Keep at least one part of the kit selected.'; return; }
      selectedOptions[key] = checkbox.checked; includeStatus.textContent = '';
    });
    const text = document.createElement('span');
    text.innerHTML = `<strong style="display:block;font-size:12px;color:#18181b;font-weight:600">${label}</strong><span style="display:block;margin-top:3px;font-size:10px;line-height:1.4;color:#71717a">${copy}</span>`;
    item.append(checkbox, text); includeGrid.appendChild(item);
  });
  include.append(includeTitle, includeHelp, includeGrid, includeStatus);
  wrapper.appendChild(include);
  daysLabel.parentElement.insertAdjacentElement('afterend', wrapper);
  refresh();
}

let lastAppliedKit = null;
function applyKitControls() {
  if (!location.pathname.startsWith('/kit/')) return;
  const kitId = getKitIdFromPath();
  if (!kitId || kitId === lastAppliedKit) return;

  const savedOptions = readKitOptions()[kitId];
  const selected = savedOptions && typeof savedOptions === 'object' ? { ...allOptions(), ...savedOptions } : allOptions();
  const tabs = {
    overview: document.querySelector('[data-testid="button-tab-overview"]'),
    plan: document.querySelector('[data-testid="button-tab-plan"]'),
    flashcards: document.querySelector('[data-testid="button-tab-flashcards"]'),
    quiz: document.querySelector('[data-testid="button-tab-exam"]'),
  };
  if (!Object.values(tabs).some(Boolean)) return;

  Object.entries(tabs).forEach(([key, button]) => {
    if (button) button.style.display = selected[key] === false ? 'none' : '';
  });
  if (tabs.plan && selected.plan !== false) {
    const label = `${Number(savedOptions?.planDays) || 7}-day plan`;
    if (tabs.plan.textContent !== label) tabs.plan.textContent = label;
  }

  lastAppliedKit = kitId;
  if (tabs.overview?.style.display === 'none') {
    const first = Object.entries(tabs).find(([, button]) => button && button.style.display !== 'none');
    if (first?.[1]) first[1].click();
  }
}

function resetRouteState() {
  if (!location.pathname.startsWith('/kit/')) lastAppliedKit = null;
  if (location.pathname.endsWith('/new')) {
    lastAppliedKit = null;
    selectedOptions = allOptions();
  }
}

// The previous implementation observed every DOM mutation and then changed the
// DOM from inside the observer. That creates a feedback loop and can make the
// app appear frozen. This observer only schedules a single lightweight pass.
let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    resetRouteState();
    addControl();
    applyKitControls();
    patchNavigationAndDelete();
  });
});
observer.observe(document.documentElement, { childList: true, subtree: true });

let lastPathname = location.pathname;
setInterval(() => {
  if (location.pathname !== lastPathname) {
    lastPathname = location.pathname;
    resetRouteState();
    addControl();
    applyKitControls();
  }
  patchNavigationAndDelete();
}, 250);

function patchNavigationAndDelete() {
  if (document.documentElement.dataset.studyKitHandlers === 'true') return;
  document.documentElement.dataset.studyKitHandlers = 'true';

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target) return;

    const openMatch = target.getAttribute('data-testid')?.match(/^button-open-kit-(.+)$/);
    if (openMatch) {
      const id = openMatch[1];
      const kits = getLocalKits();
      const kitExists = kits.some((kit) => kit?.id === id);
      if (kitExists) {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.location.assign(`/kit/${encodeURIComponent(id)}`);
        return;
      }
    }

    const removeMatch = target.getAttribute('data-testid')?.match(/^button-remove-kit-(.+)$/);
    if (removeMatch) {
      const id = removeMatch[1];
      event.preventDefault();
      event.stopImmediatePropagation();
      const confirmed = window.confirm('Permanently delete this study kit?');
      if (!confirmed) return;
      persistLocalDelete(id);
      window.location.reload();
    }
  }, true);
}

addControl();
applyKitControls();
patchNavigationAndDelete();
