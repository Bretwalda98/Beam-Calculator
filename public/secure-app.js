"use strict";

const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const num = (id, fallback = 0) => {
  const n = Number($(id)?.value);
  return Number.isFinite(n) ? n : fallback;
};
const txt = (id, fallback = '') => String($(id)?.value ?? fallback).trim();
const fmt = (value, dp = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(dp) : '-';
const fmt3 = (value) => fmt(value, 3);
const fmtReadable = (value, dp = 0) => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-GB', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp
  });
};
const getVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const GRAVITY = 9.80665;

const API_BASE = 'https://beam-calculator-api.harrynixon98.workers.dev';
const WORKER_API_BASE = API_BASE;
const LOAD_CASES = ['G', 'Q1', 'Q2'];
const ACCENT_PALETTES = {
  blue: { accent: '#155eef', accentRgb: '21,94,239', accentStrong: '#1d4ed8', accentSoft: '#dbeafe' },
  purple: { accent: '#7c3aed', accentRgb: '124,58,237', accentStrong: '#6d28d9', accentSoft: '#ede9fe' },
  teal: { accent: '#0f9f9a', accentRgb: '15,159,154', accentStrong: '#0f766e', accentSoft: '#ccfbf1' },
  orange: { accent: '#ea580c', accentRgb: '234,88,12', accentStrong: '#c2410c', accentSoft: '#ffedd5' },
  red: { accent: '#dc2626', accentRgb: '220,38,38', accentStrong: '#b91c1c', accentSoft: '#fee2e2' }
};
const LOAD_TYPES = {
  uniform: { host: 'multiUniformRows', prefix: 'U', title: 'Uniform load', fields: [['q', 'q'], ['x1', 'x1'], ['x2', 'x2']] },
  point: { host: 'multiPointRows', prefix: 'P', title: 'Point load', fields: [['P', 'P'], ['x', 'x']] },
  moment: { host: 'multiMomentRows', prefix: 'M', title: 'Moment load', fields: [['M', 'M'], ['x', 'x']] },
  trap: { host: 'multiTrapRows', prefix: 'T', title: 'Trapezoidal load', fields: [['q1', 'q1'], ['q2', 'q2'], ['x1', 'x1'], ['x2', 'x2']] }
};

function defaultApiBase() {
  if ((window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') && window.location.port === '4173') return '';
  return WORKER_API_BASE;
}

const state = {
  apiBase: (window.BEAM_API_BASE_URL || document.querySelector('meta[name="beam-api-base-url"]')?.content || localStorage.getItem('beam_api_base_url') || defaultApiBase()).replace(/\/$/, ''),
  sections: [],
  sectionPreviewCache: new Map(),
  currentSectionPreview: null,
  last: null,
  settings: JSON.parse(localStorage.getItem('beam_ui_settings_v4') || '{}'),
  activeLoadCase: 'G',
  chartPayloads: new Map(),
  redrawHandle: 0,
  backendOk: false
};

function apiUrl(path) {
  return `${state.apiBase}${path}`;
}

async function api(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    let body = {};
    try {
      body = await safeJson(response, path);
    } catch (err) {
      throw err;
    }
    const message = body.error?.message || (path.includes('/calculate') ? 'Calculation service unavailable. Please try again.' : `Request failed (${response.status}).`);
    throw new Error(message);
  }
  return response;
}

async function safeJson(response, endpoint) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const text = await response.text().catch(() => '');
    console.error('API returned non-JSON response', {
      endpoint,
      status: response.status,
      contentType,
      preview: text.slice(0, 160)
    });
    throw new Error('Calculation service unavailable or misconfigured.');
  }
  return response.json();
}

function setSaveStatus(message, tone = 'ok') {
  const host = $('saveStatus');
  if (!host) return;
  host.className = `status-save ${tone === 'error' ? 'red' : tone === 'busy' ? 'muted' : 'green'}`;
  host.innerHTML = `<i class="bi ${tone === 'error' ? 'bi-exclamation-triangle' : tone === 'busy' ? 'bi-hourglass-split' : 'bi-check2'}"></i><span>${esc(message)}</span>`;
}

function showModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove('hide');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function hideModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.add('hide');
  modal.setAttribute('aria-hidden', 'true');
  if (!$$('.modal:not(.hide), .chart-modal:not(.hide), .start-screen:not(.hide)').length) document.body.classList.remove('modal-open');
}

function showStartScreen() {
  toggleMenu('fileMenu', 'fileMenuBtn', false);
  toggleMenu('moreMenu', 'moreMenuBtn', false);
  populateStartProjects();
  ensureStartBackendStatus(state.backendOk ? 'Calculation service connected.' : 'Checking calculation service...', state.backendOk ? 'ok' : 'muted');
  showModal('startScreen');
}

function hideStartScreen() {
  try { sessionStorage.setItem('beam_calc_session_started', '1'); } catch (err) {}
  hideModal('startScreen');
}

function shouldShowStartScreen() {
  try {
    return sessionStorage.getItem('beam_calc_session_started') !== '1';
  } catch (err) {
    return true;
  }
}

function ensureStartBackendStatus(message, tone = 'muted') {
  const branding = document.querySelector('.start-branding');
  if (!branding) return;
  let status = $('startBackendStatus');
  if (!status) {
    status = document.createElement('div');
    status.id = 'startBackendStatus';
    status.className = 'integration-note';
    status.setAttribute('aria-live', 'polite');
    branding.prepend(status);
  }
  status.className = `integration-note ${tone === 'error' ? 'red' : tone === 'ok' ? 'green' : ''}`;
  status.textContent = message;
}

function populateStartProjects() {
  const select = $('startProjectSelect');
  if (!select) return;
  const hasDraft = Boolean(localStorage.getItem('beam_project_secure_draft_v1') || localStorage.getItem('beam_local_draft_v1'));
  select.innerHTML = hasDraft
    ? '<option value="local-draft">Local browser draft</option>'
    : '<option value="">(no saved projects)</option>';
}

function startNewProject() {
  hideStartScreen();
  applyMetadata({ projectName: 'Untitled beam project', calculationTitle: 'Beam section check', date: new Date().toISOString().slice(0, 10) });
  clearLoadCards();
  initLoads();
  applyDefaultMetadata(true);
  recalculateDebounced();
  setSaveStatus('New project ready.', 'ok');
}

function detectLayout() {
  if (window.innerWidth < 700) return 'mobile';
  if (window.innerWidth < 1120) return 'tablet';
  return 'desktop';
}

function getBeamMode() {
  return $('analysisMode')?.value || state.settings.defaultMode || 'single';
}

function syncBeamModeUi() {
  const mode = getBeamMode();
  document.body.classList.toggle('mode-multi', mode === 'multi');
  document.body.classList.toggle('mode-single', mode !== 'multi');
}

function applySettings() {
  const themeMode = state.settings.theme || 'system';
  const theme = themeMode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : themeMode;
  document.documentElement.dataset.theme = theme;
  applyAccent();
  $('themeBadge') && ($('themeBadge').textContent = theme[0].toUpperCase() + theme.slice(1));
  const selected = state.settings.layoutMode || 'auto';
  const layout = selected === 'auto' ? detectLayout() : selected;
  document.documentElement.dataset.layoutMode = selected;
  document.documentElement.dataset.resolvedLayout = layout;
  document.body.dataset.layoutMode = selected;
  document.body.dataset.resolvedLayout = layout;
  ['mobile', 'tablet', 'desktop'].forEach((mode) => {
    document.body.classList.toggle(`layout-${mode}`, layout === mode);
    document.body.classList.toggle(`device-${mode}`, layout === mode);
  });
  $$('input[name="settingsTheme"]').forEach((el) => { el.checked = el.value === themeMode; });
  $$('input[name="settingsLayoutMode"]').forEach((el) => { el.checked = el.value === selected; });
  $$('input[name="settingsDensity"]').forEach((el) => { el.checked = el.value === (state.settings.density || 'compact'); });
  $$('input[name="settingsAccent"]').forEach((el) => { el.checked = el.value === (state.settings.accent || 'blue'); });
  setValue('settingsDefaultMode', state.settings.defaultMode || 'single');
  setValue('settingsDefaultUnit', state.settings.defaultUnit || 'tonne');
  setValue('settingsDefaultProjectName', state.settings.defaultProjectName || '');
  setValue('settingsDefaultCalculationTitle', state.settings.defaultCalculationTitle || '');
  setValue('settingsDefaultJobReference', state.settings.defaultJobReference || '');
  setValue('settingsDefaultCompany', state.settings.defaultCompany || '');
  setValue('settingsDefaultEngineer', state.settings.defaultEngineer || '');
  setValue('settingsDefaultCheckedBy', state.settings.defaultCheckedBy || '');
  if ($('settingsAutoRecalc')) $('settingsAutoRecalc').checked = state.settings.autoRecalc !== false;
  if ($('settingsOpenProject')) $('settingsOpenProject').checked = state.settings.openProject !== false;
  applySectionPreviewVisibility();
  syncBeamModeUi();
}

function applySectionPreviewVisibility() {
  const hidden = state.settings.sectionPreviewHidden === true;
  const panel = $('sectionPreviewPanel');
  const button = $('sectionPreviewToggle');
  panel?.classList.toggle('is-collapsed', hidden);
  if (button) {
    button.textContent = hidden ? 'Show' : 'Hide';
    button.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    button.setAttribute('title', hidden ? 'Show section preview' : 'Hide section preview');
  }
}

function applyAccent() {
  const key = Object.prototype.hasOwnProperty.call(ACCENT_PALETTES, state.settings.accent) ? state.settings.accent : 'blue';
  const palette = ACCENT_PALETTES[key];
  const root = document.documentElement;
  root.dataset.accent = key;
  root.style.setProperty('--accent', palette.accent);
  root.style.setProperty('--accent-rgb', palette.accentRgb);
  root.style.setProperty('--accent-strong', palette.accentStrong);
  root.style.setProperty('--accent-soft', palette.accentSoft);
  root.style.setProperty('--primary', palette.accent);
  root.style.setProperty('--chart-primary', palette.accent);
  root.style.setProperty('--section-accent', palette.accent);
  root.style.setProperty('--focus-ring', `0 0 0 3px rgba(${palette.accentRgb},.24)`);
}

function saveSettings() {
  localStorage.setItem('beam_ui_settings_v4', JSON.stringify(state.settings));
}

function setValue(id, value) {
  const el = $(id);
  if (el) el.value = value ?? '';
}

function setChecked(id, value) {
  const el = $(id);
  if (el) el.checked = Boolean(value);
}

function selectedSectionId() {
  return $('sec_size')?.selectedOptions?.[0]?.dataset.sectionId || '';
}

async function loadSections() {
  const res = await api('/api/sections');
  const data = await safeJson(res, '/api/sections');
  state.sections = data.sections || [];
  const familySelect = $('sec_series');
  familySelect.innerHTML = (data.families || []).map((family) => `<option value="${esc(family.family)}">${esc(family.family)} (${family.count})</option>`).join('');
  familySelect.value = (data.families || []).some((family) => family.family === 'HEA') ? 'HEA' : familySelect.value;
  populateSectionNames();
}

function populateSectionNames(preferredName = '') {
  const family = $('sec_series')?.value || '';
  const names = state.sections.filter((section) => section.family === family);
  const select = $('sec_size');
  select.innerHTML = names.map((section) => `<option value="${esc(section.designation)}" data-section-id="${esc(section.id)}">${esc(section.designation)}</option>`).join('');
  const preferred = preferredName || (family === 'HEA' ? 'HE 200 A' : '');
  if (preferred && names.some((section) => section.designation === preferred)) select.value = preferred;
  updateSectionPreview().catch((err) => setSaveStatus(err.message, 'error'));
}

async function getSectionPreview() {
  const id = selectedSectionId();
  if (!id) return null;
  if (state.sectionPreviewCache.has(id)) return state.sectionPreviewCache.get(id);
  const res = await api(`/api/sections/${encodeURIComponent(id)}/preview`);
  const body = await safeJson(res, `/api/sections/${id}/preview`);
  state.sectionPreviewCache.set(id, body.section);
  return body.section;
}

function sectionClassInfo() {
  const value = $('sec_class')?.value || '12';
  if (value === '3') return { number: 3, label: 'Class 3', basis: 'elastic' };
  if (value === '4') return { number: 4, label: 'Class 4', basis: 'effective' };
  return { number: 2, label: 'Class 1–2', basis: 'plastic' };
}

function chooseWForSectionClass(props = {}) {
  const info = sectionClassInfo();
  if (info.number <= 2) {
    if (Number(props.Wpl_y_mm3) > 0) return { ...info, value: props.Wpl_y_mm3, source: 'Wpl,y' };
    return { ...info, value: props.Wel_y_mm3, source: 'Wel,y fallback - Wpl,y unavailable' };
  }
  if (info.number === 3) return { ...info, value: props.Wel_y_mm3, source: 'Wel,y' };
  if (Number(props.Weff_y_mm3) > 0) return { ...info, value: props.Weff_y_mm3, source: 'Weff,y' };
  return { ...info, value: props.Wel_y_mm3, source: 'Wel,y fallback - Weff,y unavailable' };
}

function propText(value, unit, dp = 0) {
  return `${fmtReadable(value, dp)} ${unit}`;
}

function renderSectionUseSummary(section) {
  const host = $('sec_summary');
  if (!host) return;
  if (!section) {
    host.textContent = '';
    return;
  }
  const props = section.visibleProperties || {};
  const areaEffective = props.Aeff_mm2 ?? props.A_mm2;
  const wUsed = chooseWForSectionClass(props);
  const classLabel = `${wUsed.label} (${wUsed.basis})`;
  const source = section.source?.title || 'Source to be confirmed';
  const parts = [
    `Selected: <strong>${esc(section.designation || 'Section')}</strong>`,
    `h=${esc(propText(props.h_mm, 'mm'))}, b=${esc(propText(props.b_mm, 'mm'))}`,
    `mass=${esc(propText(props.mass_kg_m, 'kg/m', 2))}`,
    `A=${esc(propText(props.A_mm2, 'mm²'))}`,
    `Aeff=${esc(propText(areaEffective, 'mm²'))}`,
    `Wel,y=${esc(propText(props.Wel_y_mm3, 'mm³'))}`,
    `Wpl,y=${esc(propText(props.Wpl_y_mm3, 'mm³'))}`,
    `Weff,y=${esc(propText(props.Weff_y_mm3, 'mm³'))}`,
    `W used for My,Rd (${esc(classLabel)}) = ${esc(propText(wUsed.value, 'mm³'))} (${esc(wUsed.source)})`,
    `Av,z=${esc(propText(props.Avz_mm2, 'mm²'))}`,
    `Iy=${esc(propText(props.Iy_mm4, 'mm⁴'))}`,
    `LTB props: It=${esc(propText(props.It_mm4, 'mm⁴'))}, Iz=${esc(propText(props.Iz_mm4, 'mm⁴'))}, Iw=${esc(propText(props.Iw_mm6, 'mm⁶'))}`,
    `Source: ${esc(source)}`
  ];
  host.innerHTML = parts.join(' &bull; ');
}

async function updateSectionPreview() {
  if ($('sectionSourceMode')?.value === 'custom') {
    renderCustomSectionNotice();
    return;
  }
  const section = await getSectionPreview();
  if (!section) return;
  state.currentSectionPreview = section;
  $('sectionPreviewName').textContent = section.designation || 'Section';
  $('sectionPreviewType').textContent = section.family || 'Library';
  renderSectionUseSummary(section);
  const warnings = section.geometryWarnings || [];
  const warning = $('sectionPreviewWarning');
  if (warning) {
    warning.classList.toggle('hide', !warnings.length);
    warning.textContent = warnings.join(' ');
  }
  $('sectionProfilePreview').innerHTML = drawSectionSvg(section);
  const props = section.visibleProperties || {};
  $('sectionPreviewFacts').innerHTML = [
    ['h', props.h_mm, 'mm'],
    ['b', props.b_mm, 'mm'],
    ['tw', props.tw_mm, 'mm'],
    ['tf/t', props.tf_mm || props.t_mm, 'mm'],
    ['r', props.r_mm, 'mm'],
    ['A', props.A_mm2, 'mm2'],
    ['Mass', props.mass_kg_m, 'kg/m'],
    ['Wel,y', props.Wel_y_mm3, 'mm3']
  ].filter(([, value]) => value).map(([key, value, unit]) => `<div class="prop-chip"><strong>${esc(key)}</strong><span>${esc(fmt(value, key === 'Mass' ? 2 : 0))} ${esc(unit)}</span></div>`).join('');
}

function syncSectionSourceMode() {
  const custom = $('sectionSourceMode')?.value === 'custom';
  $('librarySectionControls')?.classList.toggle('hide', custom);
  $('customSectionPanel')?.classList.toggle('hide', !custom);
  if (custom) renderCustomSectionNotice();
  else updateSectionPreview().catch((err) => setSaveStatus(err.message, 'error'));
}

function initCustomSectionUi() {
  const type = $('customSectionType');
  if (type && !type.options.length) {
    type.innerHTML = [
      ['welded_i', 'Welded I / H section'],
      ['rhs', 'RHS / SHS'],
      ['chs', 'CHS'],
      ['channel', 'Channel'],
      ['angle', 'Angle']
    ].map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  }
  renderCustomSectionFields();
}

function renderCustomSectionFields() {
  const type = $('customSectionType')?.value || 'welded_i';
  const fields = {
    welded_i: [['h', 'Overall depth h', 300], ['b', 'Flange width b', 150], ['tw', 'Web thickness tw', 8], ['tf', 'Flange thickness tf', 12]],
    rhs: [['h', 'Outer depth h', 200], ['b', 'Outer width b', 100], ['t', 'Wall thickness t', 8]],
    chs: [['D', 'Outside diameter D', 168.3], ['t', 'Wall thickness t', 8]],
    channel: [['h', 'Overall depth h', 200], ['b', 'Flange width b', 75], ['tw', 'Web thickness tw', 8], ['tf', 'Flange thickness tf', 12]],
    angle: [['a', 'Long leg a', 100], ['b', 'Short leg b', 75], ['t', 'Thickness t', 8]]
  }[type] || [];
  const host = $('customSectionFields');
  if (host) {
    host.innerHTML = fields.map(([id, label, value]) => `<label>${esc(label)}<input data-custom-dim="${esc(id)}" type="number" min="0" step="0.1" value="${esc(value)}"></label>`).join('');
  }
  renderCustomSectionNotice();
}

function renderCustomSectionNotice() {
  state.currentSectionPreview = null;
  $('sectionPreviewName') && ($('sectionPreviewName').textContent = $('customSectionName')?.value || 'Custom section');
  $('sectionPreviewType') && ($('sectionPreviewType').textContent = 'Custom');
  const message = 'Custom section calculation is not enabled in this secure frontend until the backend custom-section endpoint is supplied.';
  if ($('sectionProfilePreview')) $('sectionProfilePreview').innerHTML = `<div class="micro-note">${esc(message)}</div>`;
  if ($('sectionPreviewFacts')) $('sectionPreviewFacts').innerHTML = '';
  if ($('customSectionSummary')) $('customSectionSummary').textContent = message;
  if ($('sec_summary')) $('sec_summary').textContent = message;
  const warning = $('sectionPreviewWarning');
  if (warning) {
    warning.classList.remove('hide');
    warning.textContent = message;
  }
}

function drawSectionSvg(section) {
  const g = section.geometry || {};
  if (!g.h_mm && !g.diameter_mm) return '<div class="micro-note">Geometry not available for this section.</div>';
  const W = 320, H = 250, cx = W / 2, cy = H / 2;
  const depth = g.h_mm || g.diameter_mm || 1;
  const width = g.b_mm || g.diameter_mm || depth;
  const scale = Math.min(150 / depth, 180 / width);
  const h = depth * scale;
  const b = width * scale;
  const tw = Math.max((g.tw_mm || g.t_mm || width * 0.08) * scale, 3);
  const tf = Math.max((g.tf_mm || g.t_mm || depth * 0.07) * scale, 4);
  const r = Math.max((g.r_mm || 0) * scale, 0);
  const x = cx - b / 2, y = cy - h / 2;
  const stroke = 'var(--section-line,#334155)';
  const fill = 'var(--section-steel,#dbe4ee)';
  const dim = 'var(--muted,#64748b)';
  let shape = '';
  if (g.type === 'chs') {
    const ro = Math.min(b, h) / 2;
    const ri = Math.max(ro - Math.max((g.t_mm || 0) * scale, 5), 4);
    shape = `<circle cx="${cx}" cy="${cy}" r="${ro}" fill="${fill}" stroke="${stroke}"/><circle cx="${cx}" cy="${cy}" r="${ri}" fill="var(--panel,#fff)" stroke="${stroke}"/>`;
  } else if (g.type === 'rhs') {
    const t = Math.max((g.t_mm || g.tw_mm || 0) * scale, 5);
    shape = `<rect x="${x}" y="${y}" width="${b}" height="${h}" rx="${Math.max(r, 2)}" fill="${fill}" stroke="${stroke}"/><rect x="${x + t}" y="${y + t}" width="${Math.max(1, b - 2 * t)}" height="${Math.max(1, h - 2 * t)}" rx="${Math.max(r - t, 0)}" fill="var(--panel,#fff)" stroke="${stroke}"/>`;
  } else if (g.type === 'channel') {
    shape = `<path d="M ${x} ${y} H ${x + b} V ${y + tf} H ${x + tw} V ${y + h - tf} H ${x + b} V ${y + h} H ${x} Z" fill="${fill}" stroke="${stroke}" stroke-linejoin="round"/>`;
  } else if (g.tw_mm && (g.tf_mm || g.t_mm)) {
    const wx1 = cx - tw / 2, wx2 = cx + tw / 2;
    const y1 = y + tf, y2 = y + h - tf;
    const rr = Math.min(r, tf * 0.8, (b - tw) * 0.22);
    shape = `<path d="
      M ${x} ${y} H ${x + b} V ${y + tf} H ${wx2 + rr}
      Q ${wx2} ${y + tf} ${wx2} ${y + tf + rr}
      V ${y2 - rr} Q ${wx2} ${y2} ${wx2 + rr} ${y2}
      H ${x + b} V ${y + h} H ${x} V ${y2} H ${wx1 - rr}
      Q ${wx1} ${y2} ${wx1} ${y2 - rr}
      V ${y + tf + rr} Q ${wx1} ${y + tf} ${wx1 - rr} ${y + tf}
      H ${x} Z" fill="${fill}" stroke="${stroke}" stroke-linejoin="round"/>`;
  } else {
    return '<div class="micro-note">Geometry not available for this section.</div>';
  }
  const labels = [
    `<text x="${cx}" y="24" text-anchor="middle">${esc(section.designation)}</text>`,
    `<text x="${cx}" y="${y + h + 28}" text-anchor="middle">b=${fmt(width, 2)} mm</text>`,
    `<text x="${x - 12}" y="${cy}" text-anchor="end">h=${fmt(depth, 2)} mm</text>`,
    g.tw_mm ? `<text x="${cx + 18}" y="${cy - 5}">tw=${fmt(g.tw_mm, 2)} mm</text>` : '',
    (g.tf_mm || g.t_mm) ? `<text x="${x + b + 12}" y="${y + tf + 4}">tf=${fmt(g.tf_mm || g.t_mm, 2)} mm</text>` : '',
    g.r_mm ? `<text x="${x + b + 12}" y="${y + tf + 24}">r=${fmt(g.r_mm, 2)} mm</text>` : ''
  ].join('');
  return `<svg class="section-svg section-svg-full" viewBox="0 0 ${W} ${H}" role="img" aria-label="Section drawing ${esc(section.designation)}">
    <style>.axis{stroke:#60a5fa;stroke-dasharray:4 3}.dim{stroke:${dim};fill:none}.label,text{font:10px Inter,Arial,sans-serif;fill:var(--text,#0f172a);font-weight:700}.centroid{fill:#ef4444}</style>
    ${shape}
    <line class="axis" x1="${cx}" y1="${y - 14}" x2="${cx}" y2="${y + h + 14}"/><line class="axis" x1="${x - 14}" y1="${cy}" x2="${x + b + 14}" y2="${cy}"/>
    <circle class="centroid" cx="${cx}" cy="${cy}" r="3"/><text x="${cx + 8}" y="${cy + 13}">centroid</text>
    <line class="dim" x1="${x}" y1="${y + h + 10}" x2="${x + b}" y2="${y + h + 10}"/><line class="dim" x1="${x - 10}" y1="${y}" x2="${x - 10}" y2="${y + h}"/>
    ${labels}
  </svg>`;
}

function normaliseLoadType(type) {
  return type === 'trapezoidal' ? 'trap' : type;
}

function countLoadCards(type, loadCase = state.activeLoadCase) {
  return $$(`.load-entry-card[data-load-type="${type}"][data-case="${loadCase}"]`).length;
}

function renumberLoadCards(type, loadCase = state.activeLoadCase) {
  const cfg = LOAD_TYPES[type];
  $$(`.load-entry-card[data-load-type="${type}"][data-case="${loadCase}"]`).forEach((card, index) => {
    card.dataset.row = String(index);
    const tag = card.querySelector('.tag');
    if (tag) tag.textContent = `${cfg.prefix}${index + 1}`;
    const remove = card.querySelector('.load-remove-btn');
    if (remove) remove.setAttribute('aria-label', `Remove ${cfg.prefix}${index + 1}`);
  });
}

function syncLoadCaseVisibility() {
  $$('[data-loadcase]').forEach((btn) => btn.classList.toggle('active', btn.dataset.loadcase === state.activeLoadCase));
  $$('.load-entry-card[data-case]').forEach((card) => {
    card.classList.toggle('is-loadcase-hidden', card.dataset.case !== state.activeLoadCase);
  });
  $$('[data-axial-case]').forEach((label) => {
    label.classList.toggle('is-active', label.dataset.axialCase === state.activeLoadCase);
  });
  if (!$('[data-axial-case].is-active')) {
    const fallback = $('[data-axial-case="G"]') || $('[data-axial-case]');
    fallback?.classList.add('is-active');
  }
}

function setActiveLoadCase(loadCase = 'G') {
  state.activeLoadCase = LOAD_CASES.includes(loadCase) ? loadCase : 'G';
  syncLoadCaseVisibility();
}

function addLoadCard(type, index = null, loadCase = state.activeLoadCase, values = {}, userAdded = false) {
  const cfg = LOAD_TYPES[type];
  const host = $(cfg.host);
  if (!host) return null;
  const rowIndex = index ?? countLoadCards(type, loadCase);
  const L = num('span', 6);
  const card = document.createElement('div');
  card.className = 'row load-entry-card';
  card.dataset.loadType = type;
  card.dataset.row = String(rowIndex);
  card.dataset.case = loadCase;
  if (userAdded) card.dataset.userAdded = 'true';
  const direction = ['Y', 'Z'].includes(String(values.direction || '').toUpperCase()) ? String(values.direction).toUpperCase() : 'Z';
  card.innerHTML = `<div class="load-entry-head"><div class="load-entry-title"><span class="tag">${cfg.prefix}${rowIndex + 1}</span><span>${esc(cfg.title)}</span></div>${rowIndex || userAdded ? `<button type="button" class="btn load-remove-btn" aria-label="Remove ${cfg.prefix}${rowIndex + 1}"><i class="bi bi-trash"></i></button>` : ''}</div>
    <div class="load-entry-fields">${cfg.fields.map(([field, label]) => {
      const fallback = (field === 'x2') ? L : 0;
      const value = values[field] ?? fallback;
      return `<div class="load-field"><label>${esc(label)}<small>${field.startsWith('x') ? 'position m' : 'value'}</small></label><input class="mini" type="number" step="0.01" data-load-type="${type}" data-field="${field}" data-case="${loadCase}" value="${esc(value)}"></div>`;
    }).join('')}<div class="load-field load-direction-field"><label>Direction<small>Y / Z</small></label><select data-load-type="${type}" data-field="direction" data-case="${loadCase}"><option value="Z"${direction === 'Z' ? ' selected' : ''}>Z</option><option value="Y"${direction === 'Y' ? ' selected' : ''}>Y</option></select></div></div><div class="metadata-note">Recorded for COLBEAM comparison; not yet used by calculation engine.</div><div class="load-validation-note"></div>`;
  card.classList.toggle('is-loadcase-hidden', loadCase !== state.activeLoadCase);
  card.querySelector('.load-remove-btn')?.addEventListener('click', () => {
    card.remove();
    renumberLoadCards(type, loadCase);
    recalculateDebounced();
  });
  host.appendChild(card);
  return card;
}

function initLoads() {
  LOAD_CASES.forEach((loadCase) => Object.keys(LOAD_TYPES).forEach((type) => addLoadCard(type, 0, loadCase)));
  syncLoadCaseVisibility();
}

function loadCaseValue(loadCase, type, field) {
  return Number($$(`[data-load-type="${type}"][data-field="${field}"][data-case="${loadCase}"]`).at(0)?.value || 0);
}

function loadField(card, field, fallback = 0) {
  const raw = card.querySelector(`[data-field="${field}"]`)?.value;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function loadDirection(card) {
  const value = String(card.querySelector('[data-field="direction"]')?.value || 'Z').toUpperCase();
  return value === 'Y' ? 'Y' : 'Z';
}

function setLoadError(card, errors) {
  card.classList.toggle('has-error', errors.length > 0);
  card.querySelectorAll('input').forEach((input) => input.setAttribute('aria-invalid', errors.length > 0 ? 'true' : 'false'));
  const note = card.querySelector('.load-validation-note');
  if (note) note.textContent = errors.join(' ');
}

function validateLoadCard(card, span) {
  const errors = [];
  const type = card.dataset.loadType;
  const checkPos = (field) => {
    const value = loadField(card, field, NaN);
    if (!Number.isFinite(value)) errors.push(`${field} must be a number.`);
    else if (value < 0 || value > span) errors.push(`${field} must be within 0 to ${fmt(span, 2)} m.`);
    return value;
  };
  if (type === 'uniform' || type === 'trap') {
    const x1 = checkPos('x1');
    const x2 = checkPos('x2');
    if (Number.isFinite(x1) && Number.isFinite(x2) && x2 <= x1) errors.push('x2 must be greater than x1.');
  }
  if (type === 'point' || type === 'moment') checkPos('x');
  setLoadError(card, errors);
  return errors;
}

function validateAllLoads(span) {
  const errors = [];
  $$('.load-entry-card').forEach((card) => errors.push(...validateLoadCard(card, span)));
  if (errors.length) throw new Error(errors[0]);
}

function readLoads() {
  const udls = [];
  const points = [];
  const trapSegments = 12;
  const span = num('span', 6);
  validateAllLoads(span);
  LOAD_CASES.forEach((lc) => {
    $$(`.load-entry-card[data-load-type="uniform"][data-case="${lc}"]`).forEach((card) => {
      const q = loadField(card, 'q', 0);
      if (!q && !card?.dataset.userAdded) return;
      udls.push({ label: `U${udls.length + 1}`, direction: loadDirection(card), x1: loadField(card, 'x1', 0), x2: loadField(card, 'x2', span), G: lc === 'G' ? q : 0, Q1: lc === 'Q1' ? q : 0, Q2: lc === 'Q2' ? q : 0 });
    });
    $$(`.load-entry-card[data-load-type="point"][data-case="${lc}"]`).forEach((card) => {
      const p = loadField(card, 'P', 0);
      if (!p && !card?.dataset.userAdded) return;
      points.push({ label: `P${points.length + 1}`, direction: loadDirection(card), x: loadField(card, 'x', 0), G: lc === 'G' ? p : 0, Q1: lc === 'Q1' ? p : 0, Q2: lc === 'Q2' ? p : 0 });
    });
    $$(`.load-entry-card[data-load-type="moment"][data-case="${lc}"]`).forEach((card) => {
      const m = loadField(card, 'M', 0);
      if (!m && !card?.dataset.userAdded) return;
      points.push({ label: `M${points.length + 1}`, direction: loadDirection(card), x: loadField(card, 'x', 0), M: m, momentCase: lc, G: 0, Q1: 0, Q2: 0 });
    });
    $$(`.load-entry-card[data-load-type="trap"][data-case="${lc}"]`).forEach((card) => {
      const q1 = loadField(card, 'q1', 0);
      const q2 = loadField(card, 'q2', 0);
      if (!q1 && !q2 && !card?.dataset.userAdded) return;
      const sourceLabel = `T${countLoadCards('trap', lc) ? Number(card.dataset.row || 0) + 1 : udls.length + 1}`;
      const x1 = loadField(card, 'x1', 0);
      const x2 = loadField(card, 'x2', span);
      const direction = loadDirection(card);
      const dx = (x2 - x1) / trapSegments;
      for (let i = 0; i < trapSegments; i += 1) {
        const xa = x1 + i * dx;
        const xb = xa + dx;
        const q = q1 + (q2 - q1) * ((i + 0.5) / trapSegments);
        udls.push({ label: `${sourceLabel}.${i + 1}`, sourceType: 'trap', reportLabel: sourceLabel, direction, q1, q2, loadCase: lc, reportX1: x1, reportX2: x2, x1: xa, x2: xb, G: lc === 'G' ? q : 0, Q1: lc === 'Q1' ? q : 0, Q2: lc === 'Q2' ? q : 0 });
      }
    });
  });
  return { udls, points };
}

function colbeamAuditInputDefaults() {
  return {
    customULSFactors: { G: num('customUlsG', 1.35), Q1: num('customUlsQ1', 1.5), Q2: num('customUlsQ2', 1.5) },
    customSLSFactors: { G: num('customSlsG', 1), Q1: num('customSlsQ1', 1), Q2: num('customSlsQ2', num('psi_q2', 0.7)) },
    perCheckEnvelope: $('perCheckEnvelope')?.checked === true,
    slsDeflectionBasis: $('slsDeflectionBasis')?.value || 'total',
    slsIncludeSelfWeight: $('slsIncludeSelfWeight')?.checked !== false
  };
}

function colbeamAuditSetupDefaults() {
  return {
    auditProfile: 'current',
    materialVariantLabel: $('materialVariantLabel')?.value || '',
    nationalAnnexLabel: txt('colbeamNationalAnnexLabel', txt('nationalAnnex', 'UK National Annex')),
    coefficientSource: txt('coefficientSource', 'Backend EN 1990/EN 1993 defaults'),
    autoSectionClassificationStatus: $('autoSectionClassificationStatus')?.value || 'manual',
    class4EffectivePropertiesMode: $('class4EffectivePropertiesMode')?.value || 'not_available',
    shearFactorEta: num('shearFactorEta', 1),
    class12ElasticDesign: $('class12ElasticDesign')?.checked === true,
    conservativeNMyMz: $('conservativeNMyMz')?.checked === true,
    flangeBucklingIgnored: $('flangeBucklingIgnored')?.checked === true,
    webBucklingIgnored: $('webBucklingIgnored')?.checked === true,
    ltbC3: num('ltbC3', 0),
    ltbKw: num('ltbKw', 1),
    ltbLoadHeight: $('colbeamLtbLoadHeight')?.value || 'shear_centre',
    ltbShearCentreConvention: txt('ltbShearCentreConvention', 'not_applied'),
    ltbRestraintModel: $('ltbRestraintModel')?.value || 'current',
    ltbMomentGradientMethod: $('ltbMomentGradientMethod')?.value || 'manual',
    lambdaLT0: num('lambdaLT0', 0.4),
    beta: num('ltbBeta', 0.75),
    memberBucklingInteractionMethod: $('memberBucklingInteractionMethod')?.value || 'current',
    colbeamInteractionMethodLabel: txt('colbeamInteractionMethodLabel', 'Source to be confirmed'),
    supportBearingModel: txt('supportBearingModel', 'current_screening'),
    webBearingModel: txt('webBearingModel', 'current_screening'),
    stiffenerModel: txt('stiffenerModel', 'current_screening'),
    modalAnalysisStatus: txt('modalAnalysisStatus', 'not implemented')
  };
}

function readMetadata() {
  return {
    projectName: txt('projectName', 'Untitled beam project'),
    clientName: txt('clientName'),
    companyName: txt('companyName'),
    companyLogoUrl: txt('companyLogo'),
    jobReference: txt('jobReference'),
    calculationTitle: txt('calculationTitle', 'Beam section check'),
    beamMark: txt('memberMark'),
    revision: txt('projectRevision'),
    revisionDescription: txt('revisionDescription'),
    engineerName: txt('engineerName'),
    checkedBy: txt('checkedBy'),
    approvedBy: txt('approvedBy'),
    date: txt('projectDate', new Date().toISOString().slice(0, 10)),
    designCode: txt('designCode', 'EN 1993-1-1'),
    nationalAnnex: txt('nationalAnnex', 'UK National Annex'),
    notes: txt('projectNotes')
  };
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function fmtCoeff(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

function buildCombinationPreview() {
  const key = $('load_combo')?.value || 'en1990_610';
  const psi1 = clamp01($('psi_q1')?.value, 0.7);
  const psi2 = clamp01($('psi_q2')?.value, 0.7);
  const psiText = (value) => Number(value).toFixed(1);
  const applied = (cG, cQ1, cQ2) => `${fmtCoeff(cG)}G + ${fmtCoeff(cQ1)}Q1 + ${fmtCoeff(cQ2)}Q2`;
  const basis = {
    source: 'BS EN 1990 load-combination selector implemented by the backend calculation service.',
    use: 'ULS actions are used for resistance checks; SLS actions are used for deflection/serviceability checks.',
    validation: 'Checks use the code-check ratio format IR = E_d / R_d. PASS when IR < 1.0.'
  };

  if (key === 'basic') {
    return {
      name: 'Basic loads',
      source: 'Direct characteristic load summation, for checking/debugging rather than Eurocode design.',
      use: basis.use,
      validation: basis.validation,
      lines: [
        'Selected: Basic loads',
        'ULS strength checks: LC_ULS = G + Q1 + Q2',
        'SLS deflection checks: LC_SLS = G + Q1 + Q2',
        `Applied coefficients: ${applied(1, 1, 1)}`
      ]
    };
  }

  if (key === 'uls_sls') {
    return {
      name: 'ULS/SLS',
      source: 'App preset combination for simple ULS/SLS comparison.',
      use: basis.use,
      validation: basis.validation,
      lines: [
        'Selected: ULS/SLS',
        'ULS strength checks: LC_ULS = 1.00G + 1.30Q1 + 0.70Q2',
        'SLS deflection checks: LC_SLS = 1.00G + 1.00Q1 + 1.00Q2',
        `Applied ULS coefficients: ${applied(1, 1.3, 0.7)}`,
        `Applied SLS coefficients: ${applied(1, 1, 1)}`
      ]
    };
  }

  if (key === 'en1990_610a') {
    return {
      name: 'EN 1990 Eq 6.10a',
      source: 'BS EN 1990 Eq 6.10a for ULS; Eq 6.14a style SLS serviceability combination.',
      use: basis.use,
      validation: basis.validation,
      lines: [
        'Selected: EN 1990 Eq 6.10a',
        `ULS strength checks: LC_ULS = 1.35G + 1.5ψ1Q1 + 1.5ψ2Q2`,
        `Substitution: LC_ULS = 1.35G + 1.5×${psiText(psi1)}Q1 + 1.5×${psiText(psi2)}Q2`,
        `Applied ULS coefficients: ${applied(1.35, 1.5 * psi1, 1.5 * psi2)}`,
        `SLS deflection checks: LC_SLS = G + Q1 + ψ2Q2 = ${applied(1, 1, psi2)}`
      ]
    };
  }

  if (key === 'en1990_610b') {
    return {
      name: 'EN 1990 Eq 6.10b',
      source: 'BS EN 1990 Eq 6.10b for ULS; Eq 6.14a style SLS serviceability combination.',
      use: basis.use,
      validation: basis.validation,
      lines: [
        'Selected: EN 1990 Eq 6.10b',
        `ULS strength checks: LC_ULS = 0.925×1.35G + 1.5Q1 + 1.5ψ2Q2`,
        `Substitution: LC_ULS = 0.925×1.35G + 1.5Q1 + 1.5×${psiText(psi2)}Q2`,
        `Applied ULS coefficients: ${applied(0.925 * 1.35, 1.5, 1.5 * psi2)}`,
        `SLS deflection checks: LC_SLS = G + Q1 + ψ2Q2 = ${applied(1, 1, psi2)}`
      ]
    };
  }

  if (key === 'en1990_610ab') {
    return {
      name: 'EN 1990 Eq 6.10a/b',
      source: 'BS EN 1990 Eq 6.10a and Eq 6.10b alternatives for ULS; Eq 6.14a style SLS serviceability combination.',
      use: 'The backend evaluates both ULS alternatives for beam load effects and uses the governing response. SLS actions are used for deflection/serviceability checks.',
      validation: basis.validation,
      lines: [
        'Selected: EN 1990 Eq 6.10a/b',
        `ULS option A: LC_ULS,a = 1.35G + 1.5ψ1Q1 + 1.5ψ2Q2`,
        `Substitution A: LC_ULS,a = 1.35G + 1.5×${psiText(psi1)}Q1 + 1.5×${psiText(psi2)}Q2 = ${applied(1.35, 1.5 * psi1, 1.5 * psi2)}`,
        `ULS option B: LC_ULS,b = 0.925×1.35G + 1.5Q1 + 1.5ψ2Q2`,
        `Substitution B: LC_ULS,b = 0.925×1.35G + 1.5Q1 + 1.5×${psiText(psi2)}Q2 = ${applied(0.925 * 1.35, 1.5, 1.5 * psi2)}`,
        `SLS deflection checks: LC_SLS = G + Q1 + ψ2Q2 = ${applied(1, 1, psi2)}`
      ]
    };
  }

  if (key === 'custom_colbeam') {
    const custom = colbeamAuditInputDefaults();
    return {
      name: 'Custom / COLBEAM audit factors',
      source: 'User-entered custom ULS/SLS factors for COLBEAM comparison. These factors are engine-wired only in this custom mode.',
      use: 'ULS custom factors are used for resistance checks; SLS custom factors are used for deflection/serviceability checks, then adjusted by the selected SLS deflection basis.',
      validation: basis.validation,
      lines: [
        'Selected: Custom / COLBEAM audit factors',
        `ULS strength checks: LC_ULS = ${fmtCoeff(custom.customULSFactors.G)}G + ${fmtCoeff(custom.customULSFactors.Q1)}Q1 + ${fmtCoeff(custom.customULSFactors.Q2)}Q2`,
        `SLS deflection checks: LC_SLS = ${fmtCoeff(custom.customSLSFactors.G)}G + ${fmtCoeff(custom.customSLSFactors.Q1)}Q1 + ${fmtCoeff(custom.customSLSFactors.Q2)}Q2`,
        `SLS basis: ${custom.slsDeflectionBasis}; self-weight ${custom.slsIncludeSelfWeight ? 'included' : 'excluded'} for SLS deflection`,
        `Per-check 6.10a/b envelope: ${custom.perCheckEnvelope ? 'recorded only, not engine-wired' : 'off'}`
      ]
    };
  }

  return {
    name: 'EN 1990 Eq 6.10',
    source: 'BS EN 1990 Eq 6.10 for ULS; Eq 6.14a style SLS serviceability combination.',
    use: basis.use,
    validation: basis.validation,
    lines: [
      'Selected: EN 1990 Eq 6.10',
      `ULS strength checks: LC_ULS = 1.35G + 1.5Q1 + 1.5ψ2Q2`,
      `Substitution: LC_ULS = 1.35G + 1.5Q1 + 1.5×${psiText(psi2)}Q2`,
      `Applied ULS coefficients: ${applied(1.35, 1.5, 1.5 * psi2)}`,
      `SLS deflection checks: LC_SLS = G + Q1 + ψ2Q2 = ${applied(1, 1, psi2)}`
    ]
  };
}

function updateLCPreview() {
  const preview = buildCombinationPreview();
  const box = $('lc_preview');
  if (box) box.value = preview.lines.join('\n');
  const custom = colbeamAuditInputDefaults();
  const customFormula = $('customCombinationFormula');
  if (customFormula) {
    customFormula.innerHTML = `<span class="metadata-chip">Metadata-only</span> Active custom formula: ULS = ${fmtCoeff(custom.customULSFactors.G)}G + ${fmtCoeff(custom.customULSFactors.Q1)}Q1 + ${fmtCoeff(custom.customULSFactors.Q2)}Q2; SLS = ${fmtCoeff(custom.customSLSFactors.G)}G + ${fmtCoeff(custom.customSLSFactors.Q1)}Q1 + ${fmtCoeff(custom.customSLSFactors.Q2)}Q2. Per-check envelope: ${custom.perCheckEnvelope ? 'recorded on' : 'off'}.`;
  }
  const meta = $('lc_preview_meta');
  if (meta) {
    meta.innerHTML = [
      ['Source', preview.source],
      ['Use', preview.use],
      ['Validation', preview.validation]
    ].map(([key, value]) => `<div class="kv"><div class="k">${esc(key)}</div><div class="v">${esc(value)}</div><div></div></div>`).join('');
  }
}

function buildRequest() {
  if ($('sectionSourceMode')?.value === 'custom') {
    throw new Error('Custom section calculations require backend custom-section support. Select a library section for this secure build.');
  }
  return {
    version: 1,
    metadata: readMetadata(),
    section: { family: $('sec_series')?.value, name: $('sec_size')?.value },
    material: { grade: $('material')?.value || 'S355' },
    units: $('loadUnit')?.value || 'tonne',
    model: {
      span: num('span', 6),
      supportType: $('supportType')?.value || 'ss',
      includeSelfWeight: $('includeSW')?.checked !== false,
      springLeftPct: num('springLeftPct', 100),
      springRightPct: num('springRightPct', 100),
      colbeamSupportMappingLabel: txt('colbeamSupportMappingLabel', 'Current support mapping'),
      supportEquivalenceNote: `${txt('supportEquivalenceNote', 'Support equivalence to COLBEAM EC3 has not been independently verified.')} ${txt('springEquivalenceNote', '')}`.trim()
    },
    combination: { combination: $('load_combo')?.value || 'en1990_610', psiQ1: num('psi_q1', 0.7), psiQ2: num('psi_q2', 0.7), ...colbeamAuditInputDefaults() },
    settings: {
      sectionClass: Number($('sec_class')?.value === '12' ? 2 : $('sec_class')?.value || 2),
      gammaM0: num('gammaM0', 1),
      gammaM1: num('gammaM1', 1),
      deflectionLimit: num('deflLimit', 300),
      enableLTB: $('enableLTB')?.checked !== false,
      ltbRestraints: num('ltbRestraints', 0),
      ltbK: num('ltbK', 1),
      ltbC1: num('ltbC1', 1),
      ltbC2: num('ltbC2', 0),
      ltbLoadLevel: $('ltbLoadLevel')?.value || 'shear_centre',
      ltbModel: $('ltbModel')?.value || 'ec3_simplified',
      bucklingKy: num('bucklingKy', 1),
      bucklingKz: num('bucklingKz', 1),
      bucklingCurveY: $('bucklingCurveY')?.value || 'auto',
      bucklingCurveZ: $('bucklingCurveZ')?.value || 'auto',
      endPostType: $('endPostType')?.value || 'flexible',
      webStiffener: $('webStiffener')?.value || 'none',
      stiffenerA: num('stiffenerA', 5000),
      colbeamAudit: colbeamAuditSetupDefaults()
    },
    axial: { G: num('axialG', 0), Q1: num('axialQ1', 0), Q2: num('axialQ2', 0), signConvention: $('axialSignConvention')?.value || 'positive_compression' },
    loads: readLoads()
  };
}

async function calculate() {
  setSaveStatus('Calculating on secure backend...', 'busy');
  const input = buildRequest();
  const response = await api('/api/calculate', { method: 'POST', body: JSON.stringify(input) });
  const result = await safeJson(response, '/api/calculate');
  state.last = { input, result };
  renderResult(input, result);
  setSaveStatus(`Server calculation complete: ${result.status}`, result.status === 'PASS' ? 'ok' : 'error');
}

let calcTimer = null;
function recalculateDebounced() {
  clearTimeout(calcTimer);
  calcTimer = setTimeout(() => calculate().catch((err) => {
    setSaveStatus(err.message || 'Calculation service unavailable. Please try again.', 'error');
    renderUnavailable(err.message);
  }), 450);
}

function statusClass(value) {
  const status = String(value || '').trim().toUpperCase();
  if (status === 'PASS') return 'status-pass';
  if (status === 'FAIL') return 'status-fail';
  return '';
}

function statusMarkup(value) {
  const status = String(value || '').trim().toUpperCase();
  const cls = statusClass(status);
  return cls ? `<span class="${cls}">${esc(status)}</span>` : esc(value);
}

function card(k, v, tone = '') {
  const valueHtml = statusClass(v) ? statusMarkup(v) : esc(v);
  return `<div class="metric-card ${tone}"><div class="metric-label">${esc(k)}</div><div class="metric-value">${valueHtml}</div></div>`;
}

function renderResult(input, result) {
  const s = result.summary || {};
  const support = result.inputEcho?.supportLabel || input.model.supportType;
  const section = `${input.section.family} ${input.section.name}`;
  if ($('workspaceSummary')) {
    $('workspaceSummary').innerHTML = [
      section,
      result.source?.title,
      input.material.grade,
      `L = ${fmt(input.model.span, 2)} m`,
      `Max M = ${fmt(s.maxMoment, 2)} ${s.momentUnit || ''}`,
      `Max V = ${fmt(s.maxShear, 2)} ${s.forceUnit || ''}`,
      `IR = ${fmt(s.governingIR, 3)}`,
      result.status
    ].filter(Boolean).map((item) => `<span>${statusClass(item) ? statusMarkup(item) : esc(item)}</span>`).join('');
  }
  if ($('summaryResults')) {
    $('summaryResults').innerHTML = [
      card('Status', result.status, result.status === 'PASS' ? 'good' : 'bad'),
      card('Governing IR', fmt(s.governingIR, 3)),
      card(`Max moment [${s.momentUnit || ''}]`, fmt(s.maxMoment, 2)),
      card(`Max shear [${s.forceUnit || ''}]`, fmt(s.maxShear, 2)),
      card(`Axial force [${s.forceUnit || ''}]`, fmt(result.checks?.axial?.axialEd || 0, 2)),
      card('Deflection [mm]', fmt(s.deflection, 2)),
      card('Max reaction', `${fmt(s.maxReaction, 2)} ${s.forceUnit || ''}`),
      card('Support condition', support),
      card('Section', section)
    ].join('');
  }
  if ($('verdict')) {
    $('verdict').innerHTML = statusMarkup(result.status === 'PASS' ? 'PASS' : 'FAIL');
    $('verdict').className = statusClass(result.status);
  }
  renderChecks(result);
  renderDetails(result);
  renderTables(result);
  renderWarnings(result);
  renderColbeamAudit(input, result);
  setChartPayloads(result.diagrams?.series || [], s);
  queueVisualRedraw('calculation');
}

function renderUnavailable(message) {
  const html = `<div class="result-block bad">${esc(message || 'Calculation service unavailable. Please try again.')}</div>`;
  ['summaryResults', 'detailResults', 'codeChecks', 'warningsPanelContent', 'centreTables', 'colbeamAuditOutput'].forEach((id) => { if ($(id)) $(id).innerHTML = html; });
}

function auditValue(value, fallback = 'Not available') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  return value;
}

function auditRows(rows) {
  return `<table class="audit-table"><tbody>${rows.map(([key, value]) => `<tr><th>${esc(key)}</th><td>${esc(String(auditValue(value)))}</td></tr>`).join('')}</tbody></table>`;
}

function auditSection(title, rows) {
  return `<section class="audit-section"><h4>${esc(title)}</h4>${auditRows(rows)}</section>`;
}

function auditListSection(title, rows, headers) {
  const body = rows.length
    ? rows.map((row) => `<tr>${headers.map((header) => `<td>${esc(String(auditValue(row[header], '')))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">Not available</td></tr>`;
  return `<section class="audit-section"><h4>${esc(title)}</h4><table class="audit-table"><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></section>`;
}

function uniqueTrapLoads(udls = []) {
  const seen = new Set();
  return (udls || []).filter((load) => load.sourceType === 'trap').map((load) => {
    const key = `${load.reportLabel || load.label}|${load.loadCase || ''}|${load.reportX1}|${load.reportX2}|${load.q1}|${load.q2}|${load.direction}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return {
      id: load.reportLabel || load.label,
      case: load.loadCase || 'Not available',
      direction: load.direction || 'Z',
      q1: load.q1,
      q2: load.q2,
      x1: load.reportX1 ?? load.x1,
      x2: load.reportX2 ?? load.x2
    };
  }).filter(Boolean);
}

function getCalcObject(result, id) {
  return (result.calculationPackage?.calculations || []).find((calculation) => calculation.id === id) || {};
}

function buildColbeamAuditPayload(input = {}, result = {}) {
  const audit = result.inputEcho?.colbeamAudit || result.calculationPackage?.colbeamAudit || {};
  const setup = audit.settings || {};
  const comboAudit = audit.combination || {};
  const modelAudit = audit.model || {};
  const rawLoads = result.loads?.raw || { udls: [], points: [] };
  const summary = result.summary || {};
  const checks = result.checks || {};
  const units = result.loads?.units || {};
  const combination = input.combination || {};
  const settings = input.settings || {};
  const ltbCalc = getCalcObject(result, 'ltb');
  const memberCalc = getCalcObject(result, 'member-buckling');
  const momentCalc = getCalcObject(result, 'bending-resistance');
  const shearCalc = getCalcObject(result, 'shear-resistance');
  const axialCalc = getCalcObject(result, 'axial-resistance');
  const warnings = [...(result.calculationPackage?.warnings || []), ...(result.sectionProperties?.dimensions?.warnings || [])];
  return {
    generatedAt: result.generatedAt || new Date().toISOString(),
    general: {
      engineProfile: setup.auditProfile || 'current',
      colbeamComparisonReference: setup.colbeamInteractionMethodLabel || 'Source to be confirmed',
      nationalAnnexLabel: setup.nationalAnnexLabel || input.metadata?.nationalAnnex || 'Not available',
      coefficientSource: setup.coefficientSource || 'Not available',
      engineVersion: 'v34.3.0',
      metadataOnlyWarnings: warnings
    },
    sectionMaterial: {
      family: input.section?.family || result.inputEcho?.section?.family,
      section: input.section?.name || result.inputEcho?.section?.name,
      steelGrade: input.material?.grade || result.inputEcho?.material,
      materialVariant: setup.materialVariantLabel || 'Other / unknown',
      sectionClass: settings.sectionClass,
      autoClassificationStatus: setup.autoSectionClassificationStatus,
      class4EffectivePropertiesMode: setup.class4EffectivePropertiesMode
    },
    geometrySupport: {
      span: input.model?.span || result.inputEcho?.span,
      supportType: input.model?.supportType || result.inputEcho?.supportType,
      colbeamSupportMappingLabel: modelAudit.colbeamSupportMappingLabel,
      supportEquivalenceNote: modelAudit.supportEquivalenceNote,
      springLeftPct: input.model?.springLeftPct,
      springRightPct: input.model?.springRightPct,
      endSupportAssumptions: `${settings.endPostType || 'Not available'}; web stiffener ${settings.webStiffener || 'Not available'}`,
      supportBearingModel: setup.supportBearingModel,
      webBearingModel: setup.webBearingModel,
      stiffenerModel: setup.stiffenerModel
    },
    loadsActions: {
      udls: (rawLoads.udls || []).filter((load) => load.sourceType !== 'trap').map((load) => ({
        label: load.label,
        direction: load.direction || 'Z',
        x1: load.x1,
        x2: load.x2,
        G: load.G,
        Q1: load.Q1,
        Q2: load.Q2,
        selfWeight: Boolean(load.isSelf)
      })),
      points: (rawLoads.points || []).filter((load) => !Number(load.M || 0)).map((load) => ({
        label: load.label,
        direction: load.direction || 'Z',
        x: load.x,
        G: load.G,
        Q1: load.Q1,
        Q2: load.Q2
      })),
      moments: (rawLoads.points || []).filter((load) => Number(load.M || 0)).map((load) => ({
        label: load.label,
        direction: load.direction || 'Z',
        x: load.x,
        M: load.M,
        momentCase: load.momentCase
      })),
      trapezoidal: uniqueTrapLoads(rawLoads.udls || []),
      axial: { ...(input.axial || {}), NEd: checks.axial?.axialEd, signConvention: audit.axial?.signConvention || input.axial?.signConvention },
      selfWeight: input.model?.includeSelfWeight !== false,
      designActions: {
        NEd: checks.axial?.axialEd,
        MyEd: summary.maxMoment,
        MzEd: 'Not available',
        VyEd: 'Not available',
        VzEd: summary.maxShear,
        units: { force: summary.forceUnit || units.force, moment: summary.momentUnit || units.moment }
      }
    },
    loadCombinations: {
      type: input.combination?.combination || result.inputEcho?.combination,
      en1990Mode: result.inputEcho?.combination || input.combination?.combination,
      customULSFactorsConfigured: comboAudit.customULSFactors || combination.customULSFactors,
      customSLSFactorsConfigured: comboAudit.customSLSFactors || combination.customSLSFactors,
      ulsFactorsUsed: result.loads?.combinations?.ulsCoefficients || 'Not available',
      slsFactorsUsed: result.loads?.combinations?.slsCoefficients || 'Not available',
      psiQ1: combination.psiQ1,
      psiQ2: combination.psiQ2,
      perCheckEnvelope: comboAudit.perCheckEnvelope,
      perCheckEnvelopeEngineWired: result.loads?.combinations?.perCheckEnvelopeEngineWired === true,
      activeULSFormula: result.loads?.combinations?.uls,
      activeSLSFormula: result.loads?.combinations?.sls,
      governingCombinationEffect: result.actions?.ulsNote || result.loads?.combinations?.uls || 'Not available'
    },
    deflection: {
      enabled: true,
      limit: settings.deflectionLimit,
      slsDeflectionBasis: result.loads?.combinations?.slsDeflectionBasis || comboAudit.slsDeflectionBasis,
      slsSelfWeightIncluded: result.loads?.combinations?.slsIncludeSelfWeight ?? comboAudit.slsIncludeSelfWeight,
      calculatedDeflection: summary.deflection,
      deflectionLimit: summary.deflectionLimit,
      utilisation: checks.deflection?.ir,
      pass: checks.deflection?.pass
    },
    ec3Factors: {
      gammaM0: { value: settings.gammaM0, status: 'engine-wired' },
      gammaM1: { value: settings.gammaM1, status: 'engine-wired' },
      shearFactorEta: { value: setup.shearFactorEta, status: 'metadata-only' }
    },
    bucklingLtb: {
      Ky: settings.bucklingKy,
      Kz: settings.bucklingKz,
      bucklingCurveY: settings.bucklingCurveY,
      bucklingCurveZ: settings.bucklingCurveZ,
      ltbEnabled: settings.enableLTB,
      ltbK: settings.ltbK,
      C1: settings.ltbC1,
      C2: settings.ltbC2,
      C3: setup.ltbC3,
      kw: setup.ltbKw,
      loadHeight: setup.ltbLoadHeight,
      shearCentreConvention: setup.ltbShearCentreConvention,
      restraintModel: setup.ltbRestraintModel,
      momentGradientMethod: setup.ltbMomentGradientMethod,
      lambdaLT0: setup.lambdaLT0,
      beta: setup.beta,
      engineValues: checks.ltb || {},
      formula: ltbCalc.equation || 'Not available',
      codeReference: ltbCalc.codeReference || 'Not available',
      warnings: ltbCalc.warnings || []
    },
    interactionSectionControl: {
      memberBucklingInteractionMethod: setup.memberBucklingInteractionMethod,
      colbeamInteractionMethodLabel: setup.colbeamInteractionMethodLabel,
      class12ElasticDesign: setup.class12ElasticDesign,
      conservativeNMyMz: setup.conservativeNMyMz,
      flangeBucklingIgnored: setup.flangeBucklingIgnored,
      webBucklingIgnored: setup.webBucklingIgnored,
      modalAnalysisStatus: setup.modalAnalysisStatus,
      memberBucklingEngineValues: checks.memberBuckling || {},
      formula: memberCalc.equation || 'Not available',
      codeReference: memberCalc.codeReference || 'Not available'
    },
    resistancesChecks: {
      NRd: axialCalc.resistance || 'Not available',
      MyRd: checks.moment?.resistance,
      MzRd: 'Not available',
      VyRd: 'Not available',
      VzRd: checks.shear?.resistance,
      bucklingResistances: memberCalc.resistance || 'Not available',
      ltbResistance: ltbCalc.resistance || 'Not available',
      utilisationRatios: {
        moment: checks.moment?.ir,
        shear: checks.shear?.ir,
        axial: checks.axial?.ir,
        deflection: checks.deflection?.ir,
        combined: checks.combined?.ir,
        memberBuckling: checks.memberBuckling?.ir,
        ltb: checks.ltb?.ir,
        governing: summary.governingIR
      },
      governingCheck: result.status,
      formulas: (result.calculationPackage?.calculations || []).map((calculation) => ({
        id: calculation.id,
        title: calculation.title,
        codeReference: calculation.codeReference,
        equation: calculation.equation,
        result: calculation.result,
        resistance: calculation.resistance,
        utilisation: calculation.utilisation,
        status: calculation.status
      })),
      momentFormula: momentCalc.equation || 'Not available',
      shearFormula: shearCalc.equation || 'Not available'
    }
  };
}

function renderColbeamAudit(input, result) {
  const host = $('colbeamAuditOutput');
  if (!host) return;
  const payload = buildColbeamAuditPayload(input, result);
  window._lastColbeamAuditPayload = payload;
  const warnings = payload.general.metadataOnlyWarnings || [];
  host.innerHTML = [
    auditSection('1. General audit info', [
      ['Engine/profile', payload.general.engineProfile],
      ['COLBEAM comparison mode/reference', payload.general.colbeamComparisonReference],
      ['National Annex label', payload.general.nationalAnnexLabel],
      ['Coefficient source', payload.general.coefficientSource],
      ['Engine version', payload.general.engineVersion],
      ['Metadata-only warnings', warnings.length ? warnings.join(' | ') : 'None']
    ]),
    auditSection('2. Section/material', Object.entries(payload.sectionMaterial)),
    auditSection('3. Geometry/support', Object.entries(payload.geometrySupport)),
    auditListSection('4a. UDL loads', payload.loadsActions.udls, ['label', 'direction', 'x1', 'x2', 'G', 'Q1', 'Q2', 'selfWeight']),
    auditListSection('4b. Point loads', payload.loadsActions.points, ['label', 'direction', 'x', 'G', 'Q1', 'Q2']),
    auditListSection('4c. Moment loads', payload.loadsActions.moments, ['label', 'direction', 'x', 'M', 'momentCase']),
    auditListSection('4d. Trapezoidal loads', payload.loadsActions.trapezoidal, ['id', 'case', 'direction', 'q1', 'q2', 'x1', 'x2']),
    auditSection('4e. Actions', [
      ['Axial sign convention', payload.loadsActions.axial.signConvention],
      ['Selfweight on/off', payload.loadsActions.selfWeight ? 'On' : 'Off'],
      ['NEd', payload.loadsActions.designActions.NEd],
      ['MyEd', payload.loadsActions.designActions.MyEd],
      ['MzEd', payload.loadsActions.designActions.MzEd],
      ['VyEd', payload.loadsActions.designActions.VyEd],
      ['VzEd', payload.loadsActions.designActions.VzEd],
      ['Units', JSON.stringify(payload.loadsActions.designActions.units)]
    ]),
    auditSection('5. Load combinations', [
      ['Load combination type', payload.loadCombinations.type],
      ['EN 1990 mode', payload.loadCombinations.en1990Mode],
      ['Custom ULS factors configured', JSON.stringify(payload.loadCombinations.customULSFactorsConfigured || {})],
      ['Custom SLS factors configured', JSON.stringify(payload.loadCombinations.customSLSFactorsConfigured || {})],
      ['ULS factors used', JSON.stringify(payload.loadCombinations.ulsFactorsUsed || {})],
      ['SLS factors used', JSON.stringify(payload.loadCombinations.slsFactorsUsed || {})],
      ['psiQ1', payload.loadCombinations.psiQ1],
      ['psiQ2', payload.loadCombinations.psiQ2],
      ['Per-check 6.10a/b envelope', payload.loadCombinations.perCheckEnvelope],
      ['Per-check envelope engine-wired', payload.loadCombinations.perCheckEnvelopeEngineWired],
      ['Active ULS formula', payload.loadCombinations.activeULSFormula],
      ['Active SLS formula', payload.loadCombinations.activeSLSFormula],
      ['Governing combination/effect', payload.loadCombinations.governingCombinationEffect]
    ]),
    auditSection('6. Deflection', Object.entries(payload.deflection)),
    auditSection('7. EC3 factors', [
      ['gammaM0', `${payload.ec3Factors.gammaM0.value} (${payload.ec3Factors.gammaM0.status})`],
      ['gammaM1', `${payload.ec3Factors.gammaM1.value} (${payload.ec3Factors.gammaM1.status})`],
      ['shear factor eta', `${payload.ec3Factors.shearFactorEta.value} (${payload.ec3Factors.shearFactorEta.status})`]
    ]),
    auditSection('8. Buckling and LTB', Object.entries(payload.bucklingLtb).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : value])),
    auditSection('9. Interaction and section control', Object.entries(payload.interactionSectionControl).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : value])),
    auditSection('10. Resistances and checks', [
      ['NRd', payload.resistancesChecks.NRd],
      ['MyRd', payload.resistancesChecks.MyRd],
      ['MzRd', payload.resistancesChecks.MzRd],
      ['VyRd', payload.resistancesChecks.VyRd],
      ['VzRd', payload.resistancesChecks.VzRd],
      ['Buckling resistances', payload.resistancesChecks.bucklingResistances],
      ['LTB resistance', payload.resistancesChecks.ltbResistance],
      ['Utilisation ratios', JSON.stringify(payload.resistancesChecks.utilisationRatios)],
      ['Governing check/status', payload.resistancesChecks.governingCheck],
      ['Moment formula', payload.resistancesChecks.momentFormula],
      ['Shear formula', payload.resistancesChecks.shearFormula],
      ['Formula/check objects', `${payload.resistancesChecks.formulas.length} available in exported JSON`]
    ])
  ].join('');
}

function checkStatus(check) {
  if (!check || check.pass === undefined) return 'INFO';
  return check.pass ? 'PASS' : 'FAIL';
}

function checkPanel(title, rows, status = 'INFO') {
  return `<div class="panel ${status === 'FAIL' ? 'bad' : status === 'PASS' ? 'good' : ''}">
    <div class="deflection-control-title">${esc(title)}</div>
    <div class="deflection-control-equation">${rows.filter(Boolean).map((row) => `<div>${row}</div>`).join('')}</div>
  </div>`;
}

function irLine(label, check, extra = '') {
  const ir = check?.ir;
  const status = checkStatus(check);
  const irText = ir === null || ir === undefined ? '-' : fmt(ir, 3);
  return `<strong>${esc(label)}</strong>: IR = ${esc(irText)} ${extra} <strong>${statusMarkup(status)}</strong>`;
}

function comparisonForIr(ir) {
  const n = Number(ir);
  if (!Number.isFinite(n)) return '';
  return n < 1 ? '< 1.0' : '> 1.0';
}

function fallbackCodeCheckControls(result) {
  const c = result.checks || {};
  const s = result.summary || {};
  const span = Number(state.last?.input?.model?.span || 0);
  const deflectionRatio = Number(s.deflectionLimit || 0) > 0 ? Math.round(span * 1000 / Number(s.deflectionLimit)) : num('deflLimit', 300);
  const f1 = (value) => fmt(value, 1);
  const r2 = (value) => fmt(value, 2);
  const ratioLine = (prefix, ir, pass, suffix) => ({
    kind: 'ratio',
    prefix,
    ratio: r2(ir),
    pass: Boolean(pass),
    suffix
  });
  const sectionLines = [
    ratioLine(`IR = My,Ed/My,Rd = ${f1(s.maxMoment)}/${f1(c.moment?.resistance)} = `, c.moment?.ir, c.moment?.pass, ` ${comparisonForIr(c.moment?.ir)} (Ch 6.2.5)`)
  ];
  if (Math.abs(Number(c.axial?.axialEd || 0)) > 1e-9) {
    sectionLines.push(ratioLine(`IR = NEd/NRd+My,Ed/My,Rd = ${f1(c.axial?.axialEd)}/NRd+${f1(s.maxMoment)}/${f1(c.moment?.resistance)} = `, c.combined?.ir, c.combined?.pass, ` ${comparisonForIr(c.combined?.ir)} (Ch 6.2.1/6.2.9)`));
  }
  sectionLines.push(ratioLine(`IR = Vz,Ed/Vz,Rd = ${f1(s.maxShear)}/${f1(c.shear?.resistance)} = `, c.shear?.ir, c.shear?.pass, ` ${comparisonForIr(c.shear?.ir)} (Ch 6.2.6)`));
  const bucklingLines = [];
  if (c.memberBuckling?.active && c.memberBuckling?.available) {
    bucklingLines.push(ratioLine('IR = member buckling interaction = ', c.memberBuckling.ir, c.memberBuckling.pass, ` ${comparisonForIr(c.memberBuckling.ir)} (Ch 6.3.3)`));
  } else if (c.memberBuckling?.message) {
    bucklingLines.push({ kind: 'info', text: c.memberBuckling.message });
  } else {
    bucklingLines.push({ kind: 'info', text: 'No axial compression applied, so compression member buckling interaction is not required.' });
  }
  if (c.ltb?.available) bucklingLines.push(ratioLine('IR = My,Ed/(χLT*My,Rd) = ', c.ltb.ir, c.ltb.pass, ` ${comparisonForIr(c.ltb.ir)} (Ch 6.3.2)`));
  else if (c.ltb?.message) bucklingLines.push({ kind: 'info', text: c.ltb.message });
  return {
    title: 'Results',
    sections: [
      { heading: 'SECTION CONTROL:', lines: sectionLines },
      { heading: 'BUCKLING CONTROL: (incl Lateral Torsional Buckling)', lines: bucklingLines },
      { heading: `DEFLECTION CONTROL: (L/${deflectionRatio})`, lines: [ratioLine(`IR = dz/dzMax = ${f1(s.deflection)}/${f1(s.deflectionLimit)} = `, c.deflection?.ir, c.deflection?.pass, ` ${comparisonForIr(c.deflection?.ir)}`)] }
    ]
  };
}

function renderCodeCheckControls(result) {
  const controls = result.codeCheckControls || fallbackCodeCheckControls(result);
  const sections = controls.sections || [];
  return `<div class="results-fieldset" role="group" aria-label="Code checks">
    <div class="results-controls-body">
      ${sections.map((section) => `<section class="check-section">
        <div class="check-heading">${esc(section.heading || '')}</div>
        ${(section.lines || []).map((line) => {
          if (line.kind === 'info') return `<div class="check-line check-line-info">${esc(line.text || '')}</div>`;
          const cls = line.pass ? 'check-ratio-pass' : 'check-ratio-fail';
          return `<div class="check-line">${esc(line.prefix || '')}<span class="${cls}">${esc(line.ratio ?? '-')}</span>${esc(line.suffix || '')}</div>`;
        }).join('')}
      </section>`).join('')}
    </div>
  </div>`;
}

function renderChecks(result) {
  if ($('codeChecks')) $('codeChecks').innerHTML = renderCodeCheckControls(result);
}

function renderDetails(result) {
  if (!$('detailResults')) return;
  const props = result.sectionProperties || {};
  $('detailResults').innerHTML = `<table class="data-table"><tbody>${[
    ['Area A', `${fmt(props.A_mm2, 0)} mm2`],
    ['Iy', `${fmt(props.Iy_mm4, 0)} mm4`],
    ['Iz', `${fmt(props.Iz_mm4, 0)} mm4`],
    ['Wel,y', `${fmt(props.Wel_y_mm3, 0)} mm3`],
    ['Wpl,y', `${fmt(props.Wpl_y_mm3, 0)} mm3`],
    ['Av,z', `${fmt(props.Avz_mm2, 0)} mm2`],
    ['Mass', `${fmt(props.mass_kg_m, 2)} kg/m`],
    ['Classification', props.classification || '-'],
    ['Axial N,Ed', `${fmt(result.checks?.axial?.axialEd || 0, 3)} ${result.summary?.forceUnit || ''}`]
  ].map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</tbody></table>`;
}

function renderTables(result) {
  const reactions = result.actions?.reactions || [];
  $('centreTables').innerHTML = `<table class="data-table"><thead><tr><th>Support</th><th>x [m]</th><th>V</th><th>M</th></tr></thead><tbody>${reactions.map((r) => `<tr><td>${r.support}</td><td>${fmt(r.x, 3)}</td><td>${fmt(r.vertical, 3)}</td><td>${fmt(r.moment, 3)}</td></tr>`).join('') || '<tr><td colspan="4">No reactions returned.</td></tr>'}</tbody></table>`;
}

function renderWarnings(result) {
  if (!$('warningsPanelContent')) return;
  const warnings = [...(result.calculationPackage?.warnings || []), ...(result.sectionProperties?.dimensions?.warnings || [])];
  $('warningsPanelContent').innerHTML = warnings.length ? warnings.map((warning) => `<div class="warning-box">${esc(warning)}</div>`).join('') : '<div class="result-block good">No warnings returned by the calculation service.</div>';
}

function drawFixedSupport(ctx, x, y, left = true, color = '#334155') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 24);
  ctx.lineTo(x, y + 24);
  ctx.stroke();
  for (let k = 0; k < 7; k += 1) {
    ctx.beginPath();
    if (left) { ctx.moveTo(x - 12, y - 24 + k * 8); ctx.lineTo(x, y - 19 + k * 8); }
    else { ctx.moveTo(x + 12, y - 24 + k * 8); ctx.lineTo(x, y - 19 + k * 8); }
    ctx.stroke();
  }
}

function drawRollerSupport(ctx, x, y, color = '#334155') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 12, y + 14);
  ctx.lineTo(x, y);
  ctx.lineTo(x + 12, y + 14);
  ctx.closePath();
  ctx.stroke();
  [-5, 5].forEach((dx) => {
    ctx.beginPath();
    ctx.arc(x + dx, y + 18, 3, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function drawPinnedSupport(ctx, x, y, color = '#334155') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 12, y + 16);
  ctx.lineTo(x, y);
  ctx.lineTo(x + 12, y + 16);
  ctx.closePath();
  ctx.stroke();
}

function drawSpringSupport(ctx, x, y, left = true, color = '#334155') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  const top = y, bot = y + 24;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top + 4);
  ctx.stroke();
  const zig = left ? [-6, 6, -6, 6, -6] : [6, -6, 6, -6, 6];
  let yy = top + 4;
  ctx.beginPath();
  ctx.moveTo(x, yy);
  zig.forEach((dx) => { yy += 4; ctx.lineTo(x + dx, yy); });
  ctx.lineTo(x, bot);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 12, bot + 3);
  ctx.lineTo(x + 12, bot + 3);
  ctx.stroke();
}

function drawBeamSketch(input, result) {
  const canvas = $('beamSketch');
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  const rect = canvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  const L = Math.max(Number(input.model.span) || 1, 1e-6);
  const rawLoads = result.loads?.raw || { udls: [], points: [], supportXs: [0, L] };
  const supportXs = rawLoads.supportXs?.length ? rawLoads.supportXs : [0, L];
  const left = 40, right = W - 30, y = H * 0.58;
  const mapX = (x) => left + (Number(x || 0) / L) * (right - left);
  const line = getVar('--text') || '#1f2937';
  const muted = getVar('--muted') || '#64748b';
  const primary = getVar('--chart-primary') || getVar('--primary') || '#2563eb';
  const danger = getVar('--danger') || '#ef4444';
  const accent = getVar('--accent') || '#7c3aed';
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = getVar('--panel') || '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  ctx.stroke();

  if (input.model.supportType === 'cantilever') {
    drawFixedSupport(ctx, left, y, true, line);
  } else if (input.model.supportType === 'fixed_fixed') {
    drawFixedSupport(ctx, left, y, true, line);
    drawFixedSupport(ctx, right, y, false, line);
  } else if (input.model.supportType === 'fixed_roller') {
    drawFixedSupport(ctx, left, y, true, line);
    drawRollerSupport(ctx, right, y, line);
  } else if (input.model.supportType === 'spring_spring') {
    drawSpringSupport(ctx, left, y, true, line);
    drawSpringSupport(ctx, right, y, false, line);
  } else if (input.model.supportType === 'spring_roller') {
    drawSpringSupport(ctx, left, y, true, line);
    drawRollerSupport(ctx, right, y, line);
  } else {
    supportXs.forEach((sx, index) => {
      const xx = mapX(sx);
      if (index === supportXs.length - 1) drawRollerSupport(ctx, xx, y, line);
      else drawPinnedSupport(ctx, xx, y, line);
    });
  }

  ctx.strokeStyle = primary;
  ctx.fillStyle = primary;
  ctx.lineWidth = 1.5;
  (rawLoads.udls || []).filter((u) => !u.isSelf).forEach((u) => {
    const q = Number(u.G || 0) + Number(u.Q1 || 0) + Number(u.Q2 || 0);
    if (Math.abs(q) <= 1e-12) return;
    const xa = mapX(u.x1), xb = mapX(u.x2), yTop = y - 34;
    ctx.beginPath();
    ctx.moveTo(xa, yTop);
    ctx.lineTo(xb, yTop);
    ctx.stroke();
    const n = Math.max(3, Math.round((xb - xa) / 40));
    for (let i = 0; i <= n; i += 1) {
      const xx = xa + (xb - xa) * i / n;
      ctx.beginPath();
      ctx.moveTo(xx, yTop);
      ctx.lineTo(xx, y - 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xx - 3, y - 7);
      ctx.lineTo(xx, y - 2);
      ctx.lineTo(xx + 3, y - 7);
      ctx.stroke();
    }
    ctx.font = '700 10px system-ui, -apple-system, Segoe UI';
    ctx.fillText(`${u.reportLabel || u.label || 'U'} ${fmt(q, 2)} ${result.summary?.forceUnit || ''}/m`, Math.max(4, xa), yTop - 8);
  });

  ctx.strokeStyle = danger;
  ctx.fillStyle = danger;
  ctx.lineWidth = 2;
  (rawLoads.points || []).forEach((p) => {
    const P = Number(p.G || 0) + Number(p.Q1 || 0) + Number(p.Q2 || 0);
    if (Math.abs(P) <= 1e-12) return;
    const xx = mapX(p.x);
    ctx.beginPath();
    ctx.moveTo(xx, y - 56);
    ctx.lineTo(xx, y - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(xx - 4, y - 8);
    ctx.lineTo(xx, y - 2);
    ctx.lineTo(xx + 4, y - 8);
    ctx.stroke();
    ctx.font = '700 11px system-ui, -apple-system, Segoe UI';
    ctx.fillText(`${p.label || 'P'} ${fmt(P, 2)} ${result.summary?.forceUnit || ''}`, Math.max(4, Math.min(xx - 24, W - 90)), y - 62);
  });

  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  (rawLoads.points || []).filter((p) => Math.abs(Number(p.M || 0)) > 1e-12).forEach((p) => {
    const xx = mapX(p.x);
    const clockwise = Number(p.M) > 0;
    const cy = y - 25, radius = 17;
    const start = clockwise ? -Math.PI * 0.25 : Math.PI * 1.25;
    const end = clockwise ? Math.PI * 1.25 : -Math.PI * 0.25;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(xx, cy, radius, start, end, !clockwise);
    ctx.stroke();
    const tangent = end + (clockwise ? Math.PI / 2 : -Math.PI / 2);
    const ex = xx + Math.cos(end) * radius;
    const ey = cy + Math.sin(end) * radius;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 8 * Math.cos(tangent - 0.42), ey - 8 * Math.sin(tangent - 0.42));
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 8 * Math.cos(tangent + 0.42), ey - 8 * Math.sin(tangent + 0.42));
    ctx.stroke();
    ctx.font = '700 10px system-ui, -apple-system, Segoe UI';
    ctx.fillText(`${p.label || 'M'} ${fmt(p.M, 2)} ${result.summary?.momentUnit || ''}`, Math.max(4, Math.min(xx - 28, W - 116)), cy - radius - 7);
  });

  const axial = Number(input.axial?.G || 0) + Number(input.axial?.Q1 || 0) + Number(input.axial?.Q2 || 0);
  if (Math.abs(axial) > 1e-12) {
    const compression = axial > 0;
    const ay = Math.max(22, y - 91);
    const arrow = (fromX, toX) => {
      ctx.beginPath(); ctx.moveTo(fromX, ay); ctx.lineTo(toX, ay); ctx.stroke();
      const dir = Math.sign(toX - fromX) || 1;
      ctx.beginPath();
      ctx.moveTo(toX, ay);
      ctx.lineTo(toX - dir * 8, ay - 5);
      ctx.moveTo(toX, ay);
      ctx.lineTo(toX - dir * 8, ay + 5);
      ctx.stroke();
    };
    ctx.strokeStyle = accent;
    ctx.fillStyle = accent;
    ctx.lineWidth = 2;
    if (compression) { arrow(left + 2, left + 42); arrow(right - 2, right - 42); }
    else { arrow(left + 42, left + 2); arrow(right - 42, right - 2); }
    const label = `N = ${fmt(Math.abs(axial), 2)} ${result.summary?.forceUnit || ''} (${compression ? 'compression' : 'tension'})`;
    ctx.font = '700 10px system-ui, -apple-system, Segoe UI';
    ctx.fillText(label, Math.max(4, (W - ctx.measureText(label).width) / 2), ay - 8);
  }

  ctx.fillStyle = muted;
  ctx.font = '700 11px system-ui, -apple-system, Segoe UI';
  ctx.fillText('0', left - 4, y + 40);
  ctx.fillText(`L = ${fmt(L, 2)} m`, (left + right) / 2 - 24, y + 40);
  ctx.fillText(fmt(L, 2), right - 20, y + 40);
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return ctx;
}

function forceFromBase(value, forceUnit) {
  return forceUnit === 't' ? value / GRAVITY : value;
}

function momentFromBase(value, momentUnit) {
  return momentUnit === 't m' ? value / GRAVITY : value;
}

function setChartPayloads(series, summary = {}) {
  const displaySeries = (series || []).map((p) => ({
    x: Number(p.x) || 0,
    shear: forceFromBase(Number(p.shear) || 0, summary.forceUnit || 'kN'),
    moment: momentFromBase(Number(p.moment) || 0, summary.momentUnit || 'kNm'),
    deflection: Number(p.deflection) || 0
  }));
  state.chartPayloads.clear();
  [
    ['chartV', 'shear', `Shear Force V(x) - ${summary.forceUnit || ''}`, null],
    ['chartVFocus', 'shear', `Shear Force V(x) - ${summary.forceUnit || ''}`, null],
    ['chartM', 'moment', `Bending Moment M(x) - ${summary.momentUnit || ''}`, null],
    ['chartMFocus', 'moment', `Bending Moment M(x) - ${summary.momentUnit || ''}`, null],
    ['chartY', 'deflection', 'Deflection y(x) - mm', '#15803d'],
    ['chartYFocus', 'deflection', 'Deflection y(x) - mm', '#15803d']
  ].forEach(([id, key, title, color]) => state.chartPayloads.set(id, { series: displaySeries, key, title, color }));
  updateChartPeakReadouts(displaySeries, summary);
}

function updateChartPeakReadouts(series, summary = {}) {
  const write = (id, key, unit) => {
    const host = $(id);
    if (!host) return;
    if (!series.length) {
      host.textContent = 'No analysis series returned.';
      return;
    }
    const peak = series.reduce((best, point) => Math.abs(Number(point[key]) || 0) > Math.abs(Number(best[key]) || 0) ? point : best, series[0]);
    host.textContent = `Peak ${fmt3(peak[key])} ${unit || ''} at x = ${fmt(peak.x, 2)} m`;
  };
  write('peakV', 'shear', summary.forceUnit || '');
  write('peakVFocus', 'shear', summary.forceUnit || '');
  write('peakM', 'moment', summary.momentUnit || '');
  write('peakMFocus', 'moment', summary.momentUnit || '');
  write('peakY', 'deflection', 'mm');
  write('peakYFocus', 'deflection', 'mm');
}

function queueVisualRedraw(reason = 'redraw') {
  if (state.redrawHandle) cancelAnimationFrame(state.redrawHandle);
  state.redrawHandle = requestAnimationFrame(() => {
    state.redrawHandle = 0;
    redrawAllVisuals(reason);
  });
}

function redrawAllVisuals(reason = 'redraw', attempt = 0) {
  if (!state.last) return;
  drawBeamSketch(state.last.input, state.last.result);
  state.chartPayloads.forEach((payload, id) => drawChart(id, payload.series, payload.key, payload.title, payload.color));
  const waiting = Array.from(state.chartPayloads.keys()).some((id) => $(id)?.dataset.needsRedraw === 'true');
  if (waiting && attempt < 4) setTimeout(() => redrawAllVisuals(reason, attempt + 1), 80);
}

function drawAllCharts(series, summary) {
  setChartPayloads(series, summary);
  queueVisualRedraw('legacy-chart-call');
}

function chartInterpY(xs, ys, x) {
  if (!xs.length) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < xs.length; i += 1) {
    if (x <= xs[i]) {
      const dx = xs[i] - xs[i - 1] || 1;
      const t = (x - xs[i - 1]) / dx;
      return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
    }
  }
  return ys[ys.length - 1];
}

function setChartReadout(canvas, text) {
  const readout = canvas.dataset.readout ? $(canvas.dataset.readout) : canvas.closest('.chart-card, .panel')?.querySelector('.chart-readout');
  if (readout) readout.textContent = text || '';
}

function installChartInteractions(canvas) {
  if (!canvas || canvas.dataset.interactionsInstalled === 'true') return;
  canvas.dataset.interactionsInstalled = 'true';
  canvas.addEventListener('pointermove', (event) => {
    const payload = canvas._chartPayload;
    const meta = canvas._plotMeta;
    if (!payload || !meta) return;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const clamped = Math.max(meta.padL, Math.min(meta.W - meta.padR, px));
    const x = meta.xmin + (clamped - meta.padL) / (meta.W - meta.padL - meta.padR || 1) * (meta.xmax - meta.xmin);
    const y = chartInterpY(payload.xs, payload.ys, x);
    canvas._hoverPoint = { x, y };
    setChartReadout(canvas, `x = ${fmt(x, 2)} m, ${payload.axisSymbol} = ${fmt3(y)} ${payload.unit || ''}`);
    drawChart(canvas.id, payload.series, payload.key, payload.title, payload.color);
  });
  canvas.addEventListener('pointerleave', () => {
    canvas._hoverPoint = null;
    setChartReadout(canvas, '');
    const payload = canvas._chartPayload;
    if (payload) drawChart(canvas.id, payload.series, payload.key, payload.title, payload.color);
  });
  canvas.addEventListener('click', () => openChartModal(canvas.id));
}

function drawChart(id, series, key, title, color) {
  const canvas = $(id);
  if (!canvas) return;
  if (id !== 'chartModalCanvas') state.chartPayloads.set(id, { series, key, title, color });
  canvas.dataset.chartKey = id;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  if (W < 24 || H < 24 || getComputedStyle(canvas).display === 'none') {
    canvas.dataset.needsRedraw = 'true';
    return;
  }
  canvas.dataset.needsRedraw = 'false';
  const ctx = setupCanvas(canvas);
  const padL = 54, padR = 16, padT = 34, padB = 40;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = getVar('--panel') || '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = getVar('--text') || '#111827';
  ctx.font = '900 13px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  ctx.fillText(title, padL, 22);
  if (!series.length) return;
  const xs = series.map((p) => Number(p.x) || 0);
  const ys = series.map((p) => Number(p[key]) || 0);
  const unit = title.includes(' - ') ? title.split(' - ').pop().trim() : '';
  const axisSymbol = key === 'shear' ? 'V' : key === 'moment' ? 'M' : 'y';
  canvas._chartPayload = { series, key, title, color, xs, ys, unit, axisSymbol };
  installChartInteractions(canvas);
  let xmin = Math.min(...xs), xmax = Math.max(...xs);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) { ymin = -1; ymax = 1; }
  if (Math.abs(ymax - ymin) < 1e-9) { ymin -= 1; ymax += 1; }
  const ypad = 0.1 * (ymax - ymin);
  ymin -= ypad; ymax += ypad;
  const X = (x) => padL + (x - xmin) / (xmax - xmin || 1) * (W - padL - padR);
  const Y = (y) => padT + (1 - (y - ymin) / (ymax - ymin || 1)) * (H - padT - padB);
  canvas._plotMeta = { padL, padR, padT, padB, W, H, xmin, xmax, ymin, ymax };
  ctx.strokeStyle = getVar('--line') || '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i <= 4; i += 1) {
    const y = padT + i * (H - padT - padB) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (ymin <= 0 && ymax >= 0) {
    ctx.strokeStyle = getVar('--line') || '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(padL, Y(0));
    ctx.lineTo(W - padR, Y(0));
    ctx.stroke();
  }
  const fill = color || getVar('--chart-primary') || getVar('--primary') || '#2563eb';
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(X(xs[0]), Y(0));
  xs.forEach((x, i) => ctx.lineTo(X(x), Y(ys[i])));
  ctx.lineTo(X(xs[xs.length - 1]), Y(0));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.globalAlpha = key === 'deflection' ? 0.08 : 0.12;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = fill;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  xs.forEach((x, i) => {
    const px = X(x), py = Y(ys[i]);
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  });
  ctx.stroke();
  const peakIndex = ys.reduce((best, y, i) => Math.abs(y) > Math.abs(ys[best]) ? i : best, 0);
  const peak = { x: xs[peakIndex], y: ys[peakIndex] };
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(X(peak.x), Y(peak.y), 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = getVar('--muted') || '#64748b';
  ctx.font = '700 11px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  ctx.fillText('x [m]', W - padR - 36, H - 12);
  ctx.save();
  ctx.translate(14, padT + (H - padT - padB) / 2);
  ctx.rotate(-Math.PI / 2);
  const axisLabel = key === 'shear' ? `V [${unit || '-'}]` : key === 'moment' ? `M [${unit || '-'}]` : 'y [mm]';
  ctx.fillText(axisLabel, 0, 0);
  ctx.restore();
  ctx.fillStyle = getVar('--text') || '#111827';
  ctx.font = '700 11px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  ctx.fillText(`peak ${fmt3(peak.y)} at x=${fmt(peak.x, 2)} m`, padL, H - 10);
  if (canvas._hoverPoint) {
    const hp = canvas._hoverPoint;
    const hx = X(hp.x), hy = Y(hp.y);
    ctx.save();
    ctx.strokeStyle = getVar('--accent') || '#7c3aed';
    ctx.fillStyle = getVar('--accent') || '#7c3aed';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(hx, padT);
    ctx.lineTo(hx, H - padB);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function openChartModal(chartId) {
  const payload = state.chartPayloads.get(chartId);
  if (!payload) return;
  $('chartModalTitle') && ($('chartModalTitle').textContent = payload.title);
  showModal('chartModal');
  requestAnimationFrame(() => {
    drawChart('chartModalCanvas', payload.series, payload.key, payload.title, payload.color);
    setTimeout(() => drawChart('chartModalCanvas', payload.series, payload.key, payload.title, payload.color), 80);
  });
}

async function ensureFresh() {
  const current = JSON.stringify(buildRequest());
  if (!state.last || JSON.stringify(state.last.input) !== current) await calculate();
  return state.last;
}

async function openReport() {
  await ensureFresh();
  const res = await api('/api/report', { method: 'POST', body: JSON.stringify({ input: state.last.input, result: state.last.result, metadata: state.last.input.metadata }) });
  const html = await res.text();
  $('reportFrame').srcdoc = html;
  window._lastReportHtml = html;
  showModal('reportModal');
}

async function openHandCalculation() {
  await ensureFresh();
  const res = await api('/api/hand-calculation', { method: 'POST', body: JSON.stringify({ input: state.last.input, result: state.last.result, metadata: state.last.input.metadata }) });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/pdf')) {
    const text = await res.text();
    $('latexSourceBox').value = 'The calculation service returned LaTeX source instead of a compiled PDF. Deploy the updated backend /api/hand-calculation endpoint, or use /api/report/latex for source export.\n\n' + text;
    $('latexFrame').removeAttribute('src');
    $('latexFrame').srcdoc = `<pre style="white-space:pre-wrap;font:12px/1.45 ui-monospace,Consolas,monospace;padding:18px">${esc($('latexSourceBox').value)}</pre>`;
    showModal('latexModal');
    throw new Error('Hand Calculation PDF endpoint is not deployed yet.');
  }
  const blob = await res.blob();
  if (window._lastHandCalculationPdfUrl) URL.revokeObjectURL(window._lastHandCalculationPdfUrl);
  window._lastHandCalculationPdfBlob = blob;
  window._lastHandCalculationPdfUrl = URL.createObjectURL(blob);
  $('latexSourceBox').value = 'Compiled Hand Calculation PDF is ready.\n\nThe raw LaTeX source remains available from the backend /api/report/latex endpoint for development/internal export.';
  $('latexFrame').removeAttribute('srcdoc');
  $('latexFrame').src = window._lastHandCalculationPdfUrl;
  showModal('latexModal');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function colbeamAuditJsonBlob() {
  const payload = window._lastColbeamAuditPayload || (state.last ? buildColbeamAuditPayload(state.last.input, state.last.result) : null);
  if (!payload) throw new Error('Run a calculation before exporting COLBEAM audit output.');
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

function saveLocalProject() {
  const payload = { schemaVersion: 3, savedAt: new Date().toISOString(), input: buildRequest(), result: state.last?.result || null };
  localStorage.setItem('beam_project_secure_draft_v1', JSON.stringify(payload));
  if ($('projectStatus')) $('projectStatus').textContent = `Saved locally ${new Date().toLocaleTimeString()}`;
  setSaveStatus('Project saved locally. Cloud save requires sign-in/backend storage.', 'ok');
}

function loadLocalProject() {
  const raw = localStorage.getItem('beam_project_secure_draft_v1') || localStorage.getItem('beam_local_draft_v1');
  if (!raw) throw new Error('No local project is saved in this browser.');
  const payload = JSON.parse(raw);
  applyInput(payload.input || payload.latestInput || payload);
  recalculateDebounced();
}

function applyInput(input = {}) {
  applyMetadata(input.metadata || input.project || input);
  if (input.section?.family) {
    $('sec_series').value = input.section.family;
    populateSectionNames(input.section.name);
  }
  if (input.material?.grade) $('material').value = input.material.grade;
  if (input.units) $('loadUnit').value = input.units;
  if (input.model?.span) $('span').value = input.model.span;
  if (input.model?.supportType) $('supportType').value = input.model.supportType;
  $('includeSW').checked = input.model?.includeSelfWeight !== false;
  if (input.settings?.deflectionLimit) $('deflLimit').value = input.settings.deflectionLimit;
  if (input.settings?.sectionClass) $('sec_class').value = Number(input.settings.sectionClass) <= 2 ? '12' : String(input.settings.sectionClass);
  if (input.settings?.gammaM0) $('gammaM0').value = input.settings.gammaM0;
  if (input.settings?.gammaM1) $('gammaM1').value = input.settings.gammaM1;
  if (input.combination?.combination) $('load_combo').value = input.combination.combination;
  if (input.combination?.psiQ1 !== undefined) $('psi_q1').value = input.combination.psiQ1;
  if (input.combination?.psiQ2 !== undefined) $('psi_q2').value = input.combination.psiQ2;
  if (input.combination?.customULSFactors) {
    setValue('customUlsG', input.combination.customULSFactors.G ?? 1.35);
    setValue('customUlsQ1', input.combination.customULSFactors.Q1 ?? 1.5);
    setValue('customUlsQ2', input.combination.customULSFactors.Q2 ?? 1.5);
  }
  if (input.combination?.customSLSFactors) {
    setValue('customSlsG', input.combination.customSLSFactors.G ?? 1);
    setValue('customSlsQ1', input.combination.customSLSFactors.Q1 ?? 1);
    setValue('customSlsQ2', input.combination.customSLSFactors.Q2 ?? 0.7);
  }
  setChecked('perCheckEnvelope', input.combination?.perCheckEnvelope === true);
  if (input.combination?.slsDeflectionBasis) setValue('slsDeflectionBasis', input.combination.slsDeflectionBasis);
  setChecked('slsIncludeSelfWeight', input.combination?.slsIncludeSelfWeight !== false);
  if (input.model?.colbeamSupportMappingLabel) setValue('colbeamSupportMappingLabel', input.model.colbeamSupportMappingLabel);
  if (input.model?.supportEquivalenceNote) setValue('supportEquivalenceNote', input.model.supportEquivalenceNote);
  const audit = input.settings?.colbeamAudit || input.settings?.audit || {};
  setValue('materialVariantLabel', audit.materialVariantLabel || '');
  setValue('colbeamNationalAnnexLabel', audit.nationalAnnexLabel || input.metadata?.nationalAnnex || 'UK National Annex');
  setValue('coefficientSource', audit.coefficientSource || 'Backend EN 1990/EN 1993 defaults');
  setValue('autoSectionClassificationStatus', audit.autoSectionClassificationStatus || 'manual');
  setValue('class4EffectivePropertiesMode', audit.class4EffectivePropertiesMode || 'not_available');
  setValue('shearFactorEta', audit.shearFactorEta ?? 1);
  setChecked('class12ElasticDesign', audit.class12ElasticDesign === true);
  setChecked('conservativeNMyMz', audit.conservativeNMyMz === true);
  setChecked('flangeBucklingIgnored', audit.flangeBucklingIgnored === true);
  setChecked('webBucklingIgnored', audit.webBucklingIgnored === true);
  setValue('ltbC3', audit.ltbC3 ?? 0);
  setValue('ltbKw', audit.ltbKw ?? 1);
  setValue('colbeamLtbLoadHeight', audit.ltbLoadHeight || 'shear_centre');
  setValue('ltbShearCentreConvention', audit.ltbShearCentreConvention || 'not_applied');
  setValue('ltbRestraintModel', audit.ltbRestraintModel || 'current');
  setValue('ltbMomentGradientMethod', audit.ltbMomentGradientMethod || 'manual');
  setValue('lambdaLT0', audit.lambdaLT0 ?? 0.4);
  setValue('ltbBeta', audit.beta ?? 0.75);
  setValue('memberBucklingInteractionMethod', audit.memberBucklingInteractionMethod || 'current');
  setValue('colbeamInteractionMethodLabel', audit.colbeamInteractionMethodLabel || 'Source to be confirmed');
  setValue('supportBearingModel', audit.supportBearingModel || 'current_screening');
  setValue('webBearingModel', audit.webBearingModel || 'current_screening');
  setValue('stiffenerModel', audit.stiffenerModel || 'current_screening');
  setValue('modalAnalysisStatus', audit.modalAnalysisStatus || 'not implemented');
  updateLCPreview();
  if (input.axial) {
    setValue('axialG', input.axial.G || 0);
    setValue('axialQ1', input.axial.Q1 || 0);
    setValue('axialQ2', input.axial.Q2 || 0);
    setValue('axialSignConvention', input.axial.signConvention || 'positive_compression');
  }
  applyLoads(input.loads || {});
}

function applyMetadata(metadata = {}) {
  const map = {
    projectName: metadata.projectName || metadata.project || metadata.name,
    calculationTitle: metadata.calculationTitle || metadata.title,
    jobReference: metadata.jobReference || metadata.reference || metadata.jobNumber,
    clientName: metadata.clientName || metadata.client,
    memberMark: metadata.beamMark || metadata.memberMark,
    projectRevision: metadata.revision,
    revisionDescription: metadata.revisionDescription,
    projectDate: metadata.date,
    companyName: metadata.companyName || metadata.company,
    companyLogo: metadata.companyLogoUrl || metadata.logo,
    engineerName: metadata.engineerName || metadata.preparedBy,
    checkedBy: metadata.checkedBy,
    approvedBy: metadata.approvedBy,
    designCode: metadata.designCode,
    nationalAnnex: metadata.nationalAnnex,
    projectNotes: metadata.notes || metadata.comments
  };
  Object.entries(map).forEach(([id, value]) => {
    if (value !== undefined && value !== null && $(id)) $(id).value = value;
  });
}

function clearLoadCards() {
  Object.values(LOAD_TYPES).forEach((cfg) => {
    const host = $(cfg.host);
    if (host) host.innerHTML = '';
  });
}

function applyLoads(loads = {}) {
  clearLoadCards();
  LOAD_CASES.forEach((loadCase) => Object.keys(LOAD_TYPES).forEach((type) => addLoadCard(type, 0, loadCase)));
  const span = num('span', 6);
  const rows = {
    uniform: { G: [], Q1: [], Q2: [] },
    point: { G: [], Q1: [], Q2: [] },
    moment: { G: [], Q1: [], Q2: [] },
    trap: { G: [], Q1: [], Q2: [] }
  };
  (loads.udls || []).forEach((load) => {
    if (load.sourceType === 'trap' && load.segmentIndex && load.segmentIndex !== 1) return;
    if (load.sourceType === 'trap') {
      const lc = load.loadCase || 'G';
      if (rows.trap[lc]) rows.trap[lc].push({ q1: load.q1 || 0, q2: load.q2 || 0, x1: load.reportX1 ?? load.x1 ?? 0, x2: load.reportX2 ?? load.x2 ?? span, direction: load.direction || 'Z' });
      return;
    }
    LOAD_CASES.forEach((lc) => {
      const q = Number(load[lc] || 0);
      if (q && rows.uniform[lc]) rows.uniform[lc].push({ q, x1: load.x1 ?? 0, x2: load.x2 ?? span, direction: load.direction || 'Z' });
    });
  });
  (loads.points || []).forEach((load) => {
    if (Number(load.M || 0)) {
      const lc = load.momentCase || 'G';
      if (rows.moment[lc]) rows.moment[lc].push({ M: load.M, x: load.x ?? 0, direction: load.direction || 'Z' });
      return;
    }
    LOAD_CASES.forEach((lc) => {
      const P = Number(load[lc] || 0);
      if (P && rows.point[lc]) rows.point[lc].push({ P, x: load.x ?? 0, direction: load.direction || 'Z' });
    });
  });
  Object.entries(rows).forEach(([type, byCase]) => {
    Object.entries(byCase).forEach(([loadCase, values]) => {
      const host = $(LOAD_TYPES[type].host);
      host?.querySelectorAll(`.load-entry-card[data-case="${loadCase}"]`).forEach((card) => card.remove());
      if (!values.length) addLoadCard(type, 0, loadCase);
      values.forEach((value, index) => addLoadCard(type, index, loadCase, value, index > 0));
    });
  });
  syncLoadCaseVisibility();
}

function initTabs() {
  $$('[data-tab-group][data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    const group = btn.dataset.tabGroup;
    $$(`[data-tab-group="${group}"]`).forEach((el) => {
      if (el.matches('button')) el.classList.toggle('active', el === btn);
      else el.classList.toggle('active', el.id === btn.dataset.tab);
    });
    $(btn.dataset.tab)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    requestAnimationFrame(() => queueVisualRedraw('tab-change'));
  }));
}

function activateSettingsPane(id) {
  $$('[data-settings-tab]').forEach((btn) => {
    const active = btn.dataset.settingsTab === id;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $$('.settings-pane').forEach((pane) => pane.classList.toggle('active', pane.id === id));
}

function collectSettingsForm() {
  state.settings.theme = document.querySelector('input[name="settingsTheme"]:checked')?.value || state.settings.theme || 'system';
  state.settings.layoutMode = document.querySelector('input[name="settingsLayoutMode"]:checked')?.value || state.settings.layoutMode || 'auto';
  state.settings.density = document.querySelector('input[name="settingsDensity"]:checked')?.value || state.settings.density || 'compact';
  state.settings.accent = document.querySelector('input[name="settingsAccent"]:checked')?.value || state.settings.accent || 'blue';
  state.settings.defaultMode = $('settingsDefaultMode')?.value || 'single';
  state.settings.defaultUnit = $('settingsDefaultUnit')?.value || 'tonne';
  state.settings.defaultProjectName = txt('settingsDefaultProjectName');
  state.settings.defaultCalculationTitle = txt('settingsDefaultCalculationTitle');
  state.settings.defaultJobReference = txt('settingsDefaultJobReference');
  state.settings.defaultCompany = txt('settingsDefaultCompany');
  state.settings.defaultEngineer = txt('settingsDefaultEngineer');
  state.settings.defaultCheckedBy = txt('settingsDefaultCheckedBy');
  state.settings.autoRecalc = $('settingsAutoRecalc')?.checked !== false;
  state.settings.openProject = $('settingsOpenProject')?.checked !== false;
}

function applyDefaultMetadata(force = false) {
  const defaults = {
    projectName: state.settings.defaultProjectName,
    calculationTitle: state.settings.defaultCalculationTitle,
    jobReference: state.settings.defaultJobReference,
    companyName: state.settings.defaultCompany,
    engineerName: state.settings.defaultEngineer,
    checkedBy: state.settings.defaultCheckedBy
  };
  Object.entries(defaults).forEach(([id, value]) => {
    const el = $(id);
    if (el && value && (force || !el.value || ['Untitled beam project', 'Beam section check'].includes(el.value))) el.value = value;
  });
  if ($('loadUnit') && state.settings.defaultUnit) $('loadUnit').value = state.settings.defaultUnit;
}

function toggleMenu(menuId, buttonId, open) {
  const menu = $(menuId);
  const button = $(buttonId);
  if (!menu) return;
  const nextOpen = open ?? menu.classList.contains('hide');
  menu.classList.toggle('hide', !nextOpen);
  button?.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
}

function handleMoreAction(action) {
  toggleMenu('moreMenu', 'moreMenuBtn', false);
  if (action === 'save') return saveLocalProject();
  if (action === 'recalculate') return calculate().catch((err) => setSaveStatus(err.message, 'error'));
  if (action === 'help') return $('helpBtn')?.click();
  if (action === 'settings') return showModal('settingsModal');
  if (action === 'download') return $('downloadProjectBtn')?.click();
  if (action === 'about') {
    activateSettingsPane('settingsAbout');
    return showModal('settingsModal');
  }
}

function handleRailTarget(btn) {
  const target = btn.dataset.railTarget;
  $$('.rail-button').forEach((item) => item.classList.toggle('active', item === btn));
  if (target === 'settingsModal') return showModal('settingsModal');
  if (target?.startsWith('stage')) {
    document.querySelector(`[data-tab-group="stageTabs"][data-tab="${CSS.escape(target)}"]`)?.click();
  }
  const el = $(target);
  if (el?.tagName === 'DETAILS') el.open = true;
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function activateExportTab(tab) {
  const modal = $('latexModal');
  modal?.classList.toggle('source-active', tab === 'source');
  $$('[data-export-tab]').forEach((btn) => {
    const active = btn.dataset.exportTab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function initSplitters() {
  const root = document.documentElement;
  const bind = (id, cssVar, min, max) => {
    const splitter = $(id);
    if (!splitter) return;
    splitter.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      splitter.classList.add('dragging');
      splitter.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        const width = id === 'leftDockSplitter'
          ? Math.min(max, Math.max(min, moveEvent.clientX - (document.querySelector('.container')?.getBoundingClientRect().left || 0)))
          : Math.min(max, Math.max(min, window.innerWidth - moveEvent.clientX - 18));
        root.style.setProperty(cssVar, `${Math.round(width)}px`);
      };
      const up = () => {
        splitter.classList.remove('dragging');
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', up);
        saveSettings();
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up);
    });
  };
  bind('leftDockSplitter', '--left-panel-w', 280, 620);
  bind('rightInspectorSplitter', '--right-panel-w', 260, 520);
}

function initCanvasObservers() {
  if (!('ResizeObserver' in window)) return;
  const observer = new ResizeObserver(() => queueVisualRedraw('canvas-resize'));
  ['beamSketch', 'chartV', 'chartVFocus', 'chartM', 'chartMFocus', 'chartY', 'chartYFocus', 'chartModalCanvas'].forEach((id) => {
    const el = $(id);
    if (el) observer.observe(el);
  });
}

function bindEvents() {
  initCustomSectionUi();
  $('sectionSourceMode')?.addEventListener('change', () => {
    syncSectionSourceMode();
    recalculateDebounced();
  });
  $('analysisMode')?.addEventListener('change', () => {
    syncBeamModeUi();
    syncLoadCaseVisibility();
    recalculateDebounced();
  });
  $('customSectionType')?.addEventListener('change', renderCustomSectionFields);
  $('customSectionName')?.addEventListener('input', renderCustomSectionNotice);
  $('saveCustomSectionBtn')?.addEventListener('click', () => setSaveStatus('Custom sections require backend storage before they can be saved in this secure build.', 'error'));
  $('deleteCustomSectionBtn')?.addEventListener('click', () => setSaveStatus('No backend custom-section storage is configured yet.', 'error'));
  $('resetCustomSectionBtn')?.addEventListener('click', renderCustomSectionFields);
  $('sec_series')?.addEventListener('change', () => { populateSectionNames(); recalculateDebounced(); });
  $('sec_size')?.addEventListener('change', () => { updateSectionPreview(); recalculateDebounced(); });
  $('sec_class')?.addEventListener('change', () => renderSectionUseSummary(state.currentSectionPreview));
  ['load_combo', 'psi_q1', 'psi_q2', 'customUlsG', 'customUlsQ1', 'customUlsQ2', 'customSlsG', 'customSlsQ1', 'customSlsQ2', 'perCheckEnvelope'].forEach((id) => {
    $(id)?.addEventListener('input', updateLCPreview);
    $(id)?.addEventListener('change', updateLCPreview);
  });
  $$('input,select,textarea').forEach((el) => {
    if (el.closest('.settings-panel') || el.closest('.modal')) return;
    el.addEventListener('change', () => { if (state.settings.autoRecalc !== false) recalculateDebounced(); });
    el.addEventListener('input', () => {
      if ((el.type === 'number' || el.tagName === 'TEXTAREA') && state.settings.autoRecalc !== false) recalculateDebounced();
    });
  });
  $$('[data-add-load]').forEach((btn) => btn.addEventListener('click', () => {
    const type = normaliseLoadType(btn.dataset.addLoad);
    addLoadCard(type, null, state.activeLoadCase, {}, true);
    syncLoadCaseVisibility();
  }));
  $$('[data-loadcase]').forEach((btn) => {
    btn.onclick = () => setActiveLoadCase(btn.dataset.loadcase);
  });
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-loadcase]');
    if (!btn) return;
    setActiveLoadCase(btn.dataset.loadcase);
  });
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-more-results]');
    if (!btn) return;
    $('codeChecksPanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('recalcBtn')?.addEventListener('click', () => calculate().catch((err) => setSaveStatus(err.message, 'error')));
  $('reportBtn')?.addEventListener('click', () => openReport().catch((err) => setSaveStatus(err.message, 'error')));
  $('latexBtn')?.addEventListener('click', () => openHandCalculation().catch((err) => setSaveStatus(err.message, 'error')));
  $('latexRefreshBtn')?.addEventListener('click', () => openHandCalculation().catch((err) => setSaveStatus(err.message, 'error')));
  $('latexDownloadBtn')?.addEventListener('click', () => {
    const blob = window._lastHandCalculationPdfBlob;
    if (blob) return downloadBlob(blob, 'beam-hand-calculation.pdf');
    return openHandCalculation().catch((err) => setSaveStatus(err.message, 'error'));
  });
  $('reportDownloadBtn')?.addEventListener('click', () => downloadBlob(new Blob([window._lastReportHtml || $('reportFrame').srcdoc || ''], { type: 'text/html' }), 'beam-calculation-report.html'));
  $('reportPrintBtn')?.addEventListener('click', () => $('reportFrame')?.contentWindow?.print());
  $('reportModalClose')?.addEventListener('click', () => hideModal('reportModal'));
  $('latexModalClose')?.addEventListener('click', () => hideModal('latexModal'));
  $('helpBtn')?.addEventListener('click', () => { $('helpModalBody').innerHTML = '<p>This production build uses the secure backend for calculations, reports and hand calculations. Enter beam data, press Recalculate, then review returned checks and diagrams.</p>'; showModal('helpModal'); });
  $('helpModalClose')?.addEventListener('click', () => hideModal('helpModal'));
  $('themeBtn')?.addEventListener('click', () => showModal('settingsModal'));
  $('railToggleBtn')?.addEventListener('click', () => document.body.classList.toggle('inputs-collapsed'));
  $('inputRailToggle')?.addEventListener('click', () => document.body.classList.toggle('inputs-collapsed'));
  $('sectionPreviewToggle')?.addEventListener('click', () => {
    state.settings.sectionPreviewHidden = state.settings.sectionPreviewHidden !== true;
    saveSettings();
    applySectionPreviewVisibility();
  });
  $$('[data-rail-target]').forEach((btn) => btn.addEventListener('click', () => handleRailTarget(btn)));
  $('settingsClose')?.addEventListener('click', () => hideModal('settingsModal'));
  $('settingsCancel')?.addEventListener('click', () => hideModal('settingsModal'));
  $('settingsSave')?.addEventListener('click', () => {
    collectSettingsForm();
    saveSettings();
    applySettings();
    applyDefaultMetadata();
    if (state.settings.openProject !== false && $('projectAccordion')) $('projectAccordion').open = true;
    hideModal('settingsModal');
    queueVisualRedraw('settings-save');
  });
  $('settingsReset')?.addEventListener('click', () => {
    state.settings = { theme: 'system', layoutMode: 'auto', density: 'compact', accent: 'blue', autoRecalc: true, openProject: true };
    saveSettings();
    applySettings();
    queueVisualRedraw('settings-reset');
  });
  $$('[data-settings-tab]').forEach((btn) => btn.addEventListener('click', () => activateSettingsPane(btn.dataset.settingsTab)));
  $$('input[name="settingsTheme"]').forEach((el) => el.addEventListener('change', () => { state.settings.theme = el.value; saveSettings(); applySettings(); queueVisualRedraw('theme-change'); }));
  $$('input[name="settingsLayoutMode"]').forEach((el) => el.addEventListener('change', () => { state.settings.layoutMode = el.value; saveSettings(); applySettings(); queueVisualRedraw('layout-change'); }));
  $$('input[name="settingsDensity"], input[name="settingsAccent"]').forEach((el) => el.addEventListener('change', () => {
    collectSettingsForm();
    saveSettings();
    applySettings();
    queueVisualRedraw('density-accent-change');
  }));
  ['settingsDefaultMode', 'settingsDefaultUnit', 'settingsDefaultProjectName', 'settingsDefaultCalculationTitle', 'settingsDefaultJobReference', 'settingsDefaultCompany', 'settingsDefaultEngineer', 'settingsDefaultCheckedBy', 'settingsAutoRecalc', 'settingsOpenProject'].forEach((id) => {
    $(id)?.addEventListener('change', () => { collectSettingsForm(); saveSettings(); });
  });
  $('saveToolbarBtn')?.addEventListener('click', saveLocalProject);
  $('saveProjectBtn')?.addEventListener('click', saveLocalProject);
  $('newProjectBtn')?.addEventListener('click', startNewProject);
  $('openProjectBtn')?.addEventListener('click', showStartScreen);
  $('downloadProjectBtn')?.addEventListener('click', () => downloadBlob(new Blob([JSON.stringify({ input: buildRequest(), result: state.last?.result || null }, null, 2)], { type: 'application/json' }), 'beam-project.json'));
  $('copyColbeamAuditJson')?.addEventListener('click', async () => {
    const blob = colbeamAuditJsonBlob();
    const text = await blob.text();
    await navigator.clipboard.writeText(text);
    setSaveStatus('COLBEAM audit JSON copied.', 'ok');
  });
  $('downloadColbeamAuditJson')?.addEventListener('click', () => {
    downloadBlob(colbeamAuditJsonBlob(), 'colbeam-audit-output.json');
    setSaveStatus('COLBEAM audit JSON downloaded.', 'ok');
  });
  $('projectFileInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    const payload = JSON.parse(await file.text());
    applyInput(payload.input || payload);
    hideStartScreen();
    recalculateDebounced();
  });
  $('installProjectBtn')?.addEventListener('click', () => $('projectFileInput')?.click());
  $('startNewProject')?.addEventListener('click', startNewProject);
  $('startLoadProject')?.addEventListener('click', () => {
    if ($('startProjectSelect')?.value) {
      try { loadLocalProject(); hideStartScreen(); } catch (err) { setSaveStatus(err.message, 'error'); ensureStartBackendStatus(err.message, 'error'); }
    } else {
      $('projectFileInput')?.click();
    }
  });
  $('startSettings')?.addEventListener('click', () => { hideStartScreen(); activateSettingsPane('settingsGeneral'); showModal('settingsModal'); });
  $('startOpenSelected')?.addEventListener('click', () => {
    if (!$('startProjectSelect')?.value) return ensureStartBackendStatus('No local project is saved in this browser.', 'error');
    try { loadLocalProject(); hideStartScreen(); } catch (err) { setSaveStatus(err.message, 'error'); ensureStartBackendStatus(err.message, 'error'); }
  });
  $('startInstallProject')?.addEventListener('click', () => $('projectFileInput')?.click());
  $('startDeleteProject')?.addEventListener('click', () => {
    localStorage.removeItem('beam_project_secure_draft_v1');
    localStorage.removeItem('beam_local_draft_v1');
    populateStartProjects();
    ensureStartBackendStatus('Local browser draft deleted.', 'ok');
  });
  $('startContinue')?.addEventListener('click', hideStartScreen);
  $('fileMenuBtn')?.addEventListener('click', () => $('fileMenu')?.classList.toggle('hide'));
  $('moreMenuBtn')?.addEventListener('click', () => toggleMenu('moreMenu', 'moreMenuBtn'));
  $$('[data-more-action]').forEach((btn) => btn.addEventListener('click', () => handleMoreAction(btn.dataset.moreAction)));
  $('chartModalClose')?.addEventListener('click', () => hideModal('chartModal'));
  $$('[data-export-tab]').forEach((btn) => btn.addEventListener('click', () => activateExportTab(btn.dataset.exportTab)));
  $('accountModalClose')?.addEventListener('click', () => hideModal('accountModal'));
  $('fileAccountBtn')?.addEventListener('click', () => showModal('accountModal'));
  $('googleSignInBtn')?.addEventListener('click', () => api('/api/auth/google/start').then((r) => r.json()).then((b) => { if (b.url) location.href = b.url; }).catch((err) => $('accountStatus').textContent = err.message));
  $('appleSignInBtn')?.addEventListener('click', () => api('/api/auth/apple/start').then((r) => r.json()).then((b) => { if (b.url) location.href = b.url; }).catch((err) => $('accountStatus').textContent = err.message));
  initSplitters();
  initCanvasObservers();
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.file-menu-wrap')) toggleMenu('fileMenu', 'fileMenuBtn', false);
    if (!event.target.closest('.more-menu-wrap')) toggleMenu('moreMenu', 'moreMenuBtn', false);
    if (event.target.classList.contains('modal')) hideModal(event.target.id);
    if (event.target.classList.contains('chart-modal')) hideModal(event.target.id);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') $$('.modal:not(.hide), .chart-modal:not(.hide)').forEach((modal) => hideModal(modal.id));
  });
  window.addEventListener('resize', () => { applySettings(); queueVisualRedraw('resize'); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { applySettings(); queueVisualRedraw('system-theme-change'); });
}

async function loadSources() {
  const res = await api('/api/sections/sources');
  const data = await safeJson(res, '/api/sections/sources');
  const host = $('sectionSourceIndex');
  if (!host) return;
  host.innerHTML = `<h3>Section Data Sources</h3>${(data.sources || []).map((src) => `<div class="source-item"><strong>${esc(src.sourceName)}</strong><div>${esc(src.edition)} - ${esc(src.region)}</div><div>${esc((src.sectionTypes || []).join(', '))}</div><small>${esc(src.reference)}</small></div>`).join('')}`;
}

async function init() {
  applySettings();
  initTabs();
  initLoads();
  bindEvents();
  updateLCPreview();
  applyDefaultMetadata();
  if (state.settings.openProject !== false && $('projectAccordion')) $('projectAccordion').open = true;
  $('projectDate') && ($('projectDate').value = new Date().toISOString().slice(0, 10));
  if (shouldShowStartScreen()) showStartScreen();
  try {
    const health = await api('/api/health');
    await safeJson(health, '/api/health');
    state.backendOk = true;
    ensureStartBackendStatus('Calculation service connected.', 'ok');
    await loadSections();
    loadSources().catch((err) => {
      const host = $('sectionSourceIndex');
      if (host) host.innerHTML = `<h3>Section Data Sources</h3><p>${esc(err.message || 'Source index unavailable.')}</p>`;
    });
    await calculate();
  } catch (err) {
    state.backendOk = false;
    setSaveStatus(err.message || 'Calculation service unavailable. Please try again.', 'error');
    ensureStartBackendStatus(`${err.message || 'Calculation service unavailable.'} Use the deployed site or an allowed local backend origin.`, 'error');
    renderUnavailable(err.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
