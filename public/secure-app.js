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

const WORKER_API_BASE = 'https://beam-calculator-api.harrynixon98.workers.dev';

function defaultApiBase() {
  const host = window.location.hostname;
  if (host === 'beam-calculator.pages.dev' || host === 'beamcalculatorstudio.com' || host === 'www.beamcalculatorstudio.com') return WORKER_API_BASE;
  return '';
}

const state = {
  apiBase: (window.BEAM_API_BASE_URL || document.querySelector('meta[name="beam-api-base-url"]')?.content || localStorage.getItem('beam_api_base_url') || defaultApiBase()).replace(/\/$/, ''),
  sections: [],
  sectionPreviewCache: new Map(),
  last: null,
  settings: JSON.parse(localStorage.getItem('beam_ui_settings_v4') || '{}'),
  activeLoadCase: 'G'
};

function apiUrl(path) {
  return `${state.apiBase}${path}`;
}

async function api(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
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

function detectLayout() {
  if (window.innerWidth < 700) return 'mobile';
  if (window.innerWidth < 1120) return 'tablet';
  return 'desktop';
}

function applySettings() {
  const themeMode = state.settings.theme || 'system';
  const theme = themeMode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : themeMode;
  document.documentElement.dataset.theme = theme;
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
}

function saveSettings() {
  localStorage.setItem('beam_ui_settings_v4', JSON.stringify(state.settings));
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

async function updateSectionPreview() {
  const section = await getSectionPreview();
  if (!section) return;
  $('sectionPreviewName').textContent = section.designation || 'Section';
  $('sectionPreviewType').textContent = section.family || 'Library';
  $('sec_summary').textContent = `${section.designation} - ${section.source?.title || 'Source to be confirmed'}`;
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

function addLoadCard(type, index = 0) {
  const cfg = {
    uniform: { host: 'multiUniformRows', prefix: 'U', fields: [['q', 'q'], ['x1', 'x1'], ['x2', 'x2']] },
    point: { host: 'multiPointRows', prefix: 'P', fields: [['P', 'P'], ['x', 'x']] },
    moment: { host: 'multiMomentRows', prefix: 'M', fields: [['M', 'M'], ['x', 'x']] },
    trap: { host: 'multiTrapRows', prefix: 'T', fields: [['q1', 'q1'], ['q2', 'q2'], ['x1', 'x1'], ['x2', 'x2']] }
  }[type];
  const host = $(cfg.host);
  const L = num('span', 6);
  const card = document.createElement('div');
  card.className = 'row load-entry-card';
  card.dataset.loadType = type;
  card.dataset.row = String(index);
  card.dataset.case = state.activeLoadCase;
  card.innerHTML = `<div class="load-entry-head"><div class="load-entry-title"><span class="tag">${cfg.prefix}${index + 1}</span><span>${type[0].toUpperCase() + type.slice(1)} load</span></div>${index ? `<button type="button" class="btn load-remove-btn" aria-label="Remove ${cfg.prefix}${index + 1}"><i class="bi bi-trash"></i></button>` : ''}</div>
    <div class="load-entry-fields">${cfg.fields.map(([field, label]) => {
      const value = (field === 'x2') ? L : 0;
      return `<div class="load-field"><label>${label}<small>${field.startsWith('x') ? 'position m' : 'value'}</small></label><input class="mini" type="number" step="0.01" data-load-type="${type}" data-field="${field}" data-case="${state.activeLoadCase}" value="${value}"></div>`;
    }).join('')}</div><div class="load-validation-note"></div>`;
  card.querySelector('.load-remove-btn')?.addEventListener('click', () => { card.remove(); recalculateDebounced(); });
  host.appendChild(card);
}

function initLoads() {
  ['uniform', 'point', 'moment', 'trap'].forEach((type) => addLoadCard(type, 0));
}

function loadCaseValue(loadCase, type, field) {
  return Number($$(`[data-load-type="${type}"][data-field="${field}"][data-case="${loadCase}"]`).at(0)?.value || 0);
}

function readLoads() {
  const udls = [];
  const points = [];
  const trapSegments = 12;
  ['G', 'Q1', 'Q2'].forEach((lc) => {
    $$(`[data-load-type="uniform"][data-case="${lc}"]`).forEach((el) => {
      if (el.dataset.field !== 'q') return;
      const card = el.closest('.load-entry-card');
      const q = Number(el.value || 0);
      if (!q && !card?.dataset.userAdded) return;
      udls.push({ label: `U${udls.length + 1}`, x1: Number(card.querySelector('[data-field="x1"]').value || 0), x2: Number(card.querySelector('[data-field="x2"]').value || num('span', 6)), G: lc === 'G' ? q : 0, Q1: lc === 'Q1' ? q : 0, Q2: lc === 'Q2' ? q : 0 });
    });
    $$(`[data-load-type="point"][data-case="${lc}"]`).forEach((el) => {
      if (el.dataset.field !== 'P') return;
      const card = el.closest('.load-entry-card');
      const p = Number(el.value || 0);
      if (!p && !card?.dataset.userAdded) return;
      points.push({ label: `P${points.length + 1}`, x: Number(card.querySelector('[data-field="x"]').value || 0), G: lc === 'G' ? p : 0, Q1: lc === 'Q1' ? p : 0, Q2: lc === 'Q2' ? p : 0 });
    });
    $$(`[data-load-type="moment"][data-case="${lc}"]`).forEach((el) => {
      if (el.dataset.field !== 'M') return;
      const card = el.closest('.load-entry-card');
      const m = Number(el.value || 0);
      if (!m && !card?.dataset.userAdded) return;
      points.push({ label: `M${points.length + 1}`, x: Number(card.querySelector('[data-field="x"]').value || 0), M: m, momentCase: lc, G: 0, Q1: 0, Q2: 0 });
    });
    $$(`[data-load-type="trap"][data-case="${lc}"]`).forEach((el) => {
      if (el.dataset.field !== 'q1') return;
      const card = el.closest('.load-entry-card');
      const q1 = Number(el.value || 0);
      const q2 = Number(card.querySelector('[data-field="q2"]').value || 0);
      if (!q1 && !q2 && !card?.dataset.userAdded) return;
      const x1 = Number(card.querySelector('[data-field="x1"]').value || 0);
      const x2 = Number(card.querySelector('[data-field="x2"]').value || num('span', 6));
      const dx = (x2 - x1) / trapSegments;
      for (let i = 0; i < trapSegments; i += 1) {
        const xa = x1 + i * dx;
        const xb = xa + dx;
        const q = q1 + (q2 - q1) * ((i + 0.5) / trapSegments);
        udls.push({ label: `T${i + 1}`, x1: xa, x2: xb, G: lc === 'G' ? q : 0, Q1: lc === 'Q1' ? q : 0, Q2: lc === 'Q2' ? q : 0 });
      }
    });
  });
  return { udls, points };
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

function buildRequest() {
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
      springRightPct: num('springRightPct', 100)
    },
    combination: { combination: $('load_combo')?.value || 'en1990_610', psiQ1: num('psi_q1', 0.7), psiQ2: num('psi_q2', 0.7) },
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
      bucklingKy: num('bucklingKy', 1),
      bucklingKz: num('bucklingKz', 1),
      endPostType: $('endPostType')?.value || 'flexible',
      webStiffener: $('webStiffener')?.value || 'none'
    },
    axial: { G: num('axialG', 0), Q1: num('axialQ1', 0), Q2: num('axialQ2', 0) },
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

function card(k, v, tone = '') {
  return `<div class="result-card ${tone}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
}

function renderResult(input, result) {
  const s = result.summary || {};
  const support = result.inputEcho?.supportLabel || input.model.supportType;
  const section = `${input.section.family} ${input.section.name}`;
  $('workspaceSummary').innerHTML = [
    section,
    result.source?.title,
    input.material.grade,
    `L = ${fmt(input.model.span, 2)} m`,
    `Max M = ${fmt(s.maxMoment, 2)} ${s.momentUnit || ''}`,
    `Max V = ${fmt(s.maxShear, 2)} ${s.forceUnit || ''}`,
    `IR = ${fmt(s.governingIR, 3)}`,
    result.status
  ].filter(Boolean).map((item) => `<span>${esc(item)}</span>`).join('');
  $('summaryResults').innerHTML = [
    card('Status', result.status, result.status === 'PASS' ? 'good' : 'bad'),
    card('Governing IR', fmt(s.governingIR, 3)),
    card(`Max moment [${s.momentUnit || ''}]`, fmt(s.maxMoment, 2)),
    card(`Max shear [${s.forceUnit || ''}]`, fmt(s.maxShear, 2)),
    card('Deflection [mm]', fmt(s.deflection, 2)),
    card('Max reaction', `${fmt(s.maxReaction, 2)} ${s.forceUnit || ''}`),
    card('Support condition', support),
    card('Section', section)
  ].join('');
  $('verdict').textContent = result.status === 'PASS' ? 'PASS' : 'FAIL';
  $('verdict').className = result.status === 'PASS' ? 'green' : 'red';
  renderChecks(result);
  renderDetails(result);
  renderTables(result);
  renderWarnings(result);
  drawBeamSketch(input, result);
  drawAllCharts(result.diagrams?.series || [], s);
}

function renderUnavailable(message) {
  const html = `<div class="result-block bad">${esc(message || 'Calculation service unavailable. Please try again.')}</div>`;
  ['summaryResults', 'detailResults', 'codeChecks', 'warningsPanelContent', 'centreTables'].forEach((id) => { if ($(id)) $(id).innerHTML = html; });
}

function renderChecks(result) {
  const checks = result.checks || {};
  $('codeChecks').innerHTML = Object.entries(checks).map(([name, check]) => {
    const pass = check.pass === undefined ? 'INFO' : check.pass ? 'PASS' : 'FAIL';
    return `<div class="panel ${pass === 'FAIL' ? 'bad' : ''}"><div class="deflection-control-title">${esc(name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()))}</div><div class="deflection-control-equation">IR = ${esc(check.ir ?? '-')} ${esc(check.label || check.message || '')} <strong>${pass}</strong></div></div>`;
  }).join('');
}

function renderDetails(result) {
  const props = result.sectionProperties || {};
  $('detailResults').innerHTML = `<table class="data-table"><tbody>${[
    ['Area A', `${fmt(props.A_mm2, 0)} mm2`],
    ['Iy', `${fmt(props.Iy_mm4, 0)} mm4`],
    ['Iz', `${fmt(props.Iz_mm4, 0)} mm4`],
    ['Wel,y', `${fmt(props.Wel_y_mm3, 0)} mm3`],
    ['Wpl,y', `${fmt(props.Wpl_y_mm3, 0)} mm3`],
    ['Av,z', `${fmt(props.Avz_mm2, 0)} mm2`],
    ['Mass', `${fmt(props.mass_kg_m, 2)} kg/m`],
    ['Classification', props.classification || '-']
  ].map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</tbody></table>`;
}

function renderTables(result) {
  const reactions = result.actions?.reactions || [];
  $('centreTables').innerHTML = `<table class="data-table"><thead><tr><th>Support</th><th>x [m]</th><th>V</th><th>M</th></tr></thead><tbody>${reactions.map((r) => `<tr><td>${r.support}</td><td>${fmt(r.x, 3)}</td><td>${fmt(r.vertical, 3)}</td><td>${fmt(r.moment, 3)}</td></tr>`).join('') || '<tr><td colspan="4">No reactions returned.</td></tr>'}</tbody></table>`;
}

function renderWarnings(result) {
  const warnings = [...(result.calculationPackage?.warnings || []), ...(result.sectionProperties?.dimensions?.warnings || [])];
  $('warningsPanelContent').innerHTML = warnings.length ? warnings.map((warning) => `<div class="warning-box">${esc(warning)}</div>`).join('') : '<div class="result-block good">No warnings returned by the calculation service.</div>';
}

function drawBeamSketch(input, result) {
  const canvas = $('beamSketch');
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  const W = canvas.width, H = canvas.height, left = 55, right = W - 40, y = H * 0.55;
  ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  ctx.fillStyle = '#334155'; ctx.font = '14px Inter,Arial';
  ctx.fillText('0', left - 5, y + 34); ctx.fillText(fmt(input.model.span, 2), right - 18, y + 34);
  ctx.fillText(`L = ${fmt(input.model.span, 2)} m`, (left + right) / 2 - 34, y + 34);
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(left - 14, y + 24); ctx.lineTo(left, y); ctx.lineTo(left + 14, y + 24); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.arc(right, y + 18, 10, 0, Math.PI * 2); ctx.stroke();
  (result.loads?.raw?.udls || []).filter((u) => !u.isSelf).forEach((u) => {
    const x1 = left + (u.x1 / input.model.span) * (right - left);
    const x2 = left + (u.x2 / input.model.span) * (right - left);
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1.5;
    for (let x = x1; x <= x2 + 1; x += Math.max(20, (x2 - x1) / 8)) {
      ctx.beginPath(); ctx.moveTo(x, y - 52); ctx.lineTo(x, y - 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 4, y - 12); ctx.lineTo(x, y - 5); ctx.lineTo(x + 4, y - 12); ctx.stroke();
    }
  });
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel') || '#fff';
  ctx.fillRect(0, 0, rect.width, rect.height);
  canvas.width = rect.width;
  canvas.height = rect.height;
  return canvas.getContext('2d');
}

function drawAllCharts(series, summary) {
  drawChart('chartV', series, 'shear', `Shear Force V(x) - ${summary.forceUnit || ''}`, '#2563eb');
  drawChart('chartVFocus', series, 'shear', `Shear Force V(x) - ${summary.forceUnit || ''}`, '#2563eb');
  drawChart('chartM', series, 'moment', `Bending Moment M(x) - ${summary.momentUnit || ''}`, '#155eef');
  drawChart('chartMFocus', series, 'moment', `Bending Moment M(x) - ${summary.momentUnit || ''}`, '#155eef');
  drawChart('chartY', series, 'deflection', 'Deflection y(x) - mm', '#15803d');
  drawChart('chartYFocus', series, 'deflection', 'Deflection y(x) - mm', '#15803d');
}

function drawChart(id, series, key, title, color) {
  const canvas = $(id);
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  const W = canvas.width, H = canvas.height, L = 46, R = 20, T = 34, B = 34;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel') || '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text') || '#0f172a';
  ctx.font = '700 13px Inter,Arial'; ctx.fillText(title, L, 20);
  if (!series.length) return;
  const maxX = Math.max(...series.map((p) => Number(p.x) || 0), 1);
  const maxY = Math.max(...series.map((p) => Math.abs(Number(p[key]) || 0)), 1e-9);
  const midY = T + (H - T - B) / 2;
  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = T + i * (H - T - B) / 4;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
  }
  ctx.strokeStyle = '#64748b'; ctx.beginPath(); ctx.moveTo(L, midY); ctx.lineTo(W - R, midY); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
  series.forEach((p, i) => {
    const x = L + (Number(p.x) / maxX) * (W - L - R);
    const y = midY - (Number(p[key]) / maxY) * ((H - T - B) * 0.42);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.stroke();
  const peak = series.reduce((best, p) => Math.abs(Number(p[key]) || 0) > Math.abs(Number(best[key]) || 0) ? p : best, series[0]);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text') || '#0f172a';
  ctx.font = '12px Inter,Arial'; ctx.fillText(`peak ${fmt(peak[key], 3)} at x=${fmt(peak.x, 2)} m`, L, H - 10);
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
  const tex = await res.text();
  $('latexSourceBox').value = tex;
  $('latexFrame').srcdoc = `<pre style="white-space:pre-wrap;font:12px/1.45 ui-monospace,Consolas,monospace;padding:18px">${esc(tex)}</pre>`;
  showModal('latexModal');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function saveLocalProject() {
  const payload = { schemaVersion: 3, savedAt: new Date().toISOString(), input: buildRequest(), result: state.last?.result || null };
  localStorage.setItem('beam_project_secure_draft_v1', JSON.stringify(payload));
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
}

function initTabs() {
  $$('[data-tab-group][data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    const group = btn.dataset.tabGroup;
    $$(`[data-tab-group="${group}"]`).forEach((el) => {
      if (el.matches('button')) el.classList.toggle('active', el === btn);
      else el.classList.toggle('active', el.id === btn.dataset.tab);
    });
    $(btn.dataset.tab)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }));
}

function bindEvents() {
  $('sec_series')?.addEventListener('change', () => { populateSectionNames(); recalculateDebounced(); });
  $('sec_size')?.addEventListener('change', () => { updateSectionPreview(); recalculateDebounced(); });
  $$('input,select,textarea').forEach((el) => {
    if (el.closest('.settings-panel') || el.closest('.modal')) return;
    el.addEventListener('change', recalculateDebounced);
    el.addEventListener('input', () => { if (el.type === 'number' || el.tagName === 'TEXTAREA') recalculateDebounced(); });
  });
  $$('[data-add-load]').forEach((btn) => btn.addEventListener('click', () => {
    const type = btn.dataset.addLoad === 'trapezoidal' ? 'trap' : btn.dataset.addLoad;
    const count = $$(`[data-load-type="${type}"]`).length;
    addLoadCard(type, count);
  }));
  $$('[data-loadcase]').forEach((btn) => btn.addEventListener('click', () => {
    state.activeLoadCase = btn.dataset.loadcase;
    $$('[data-loadcase]').forEach((b) => b.classList.toggle('active', b === btn));
    $$('[data-case]').forEach((el) => el.closest('.load-entry-card')?.classList.toggle('is-loadcase-hidden', el.dataset.case !== state.activeLoadCase));
  }));
  $('recalcBtn')?.addEventListener('click', () => calculate().catch((err) => setSaveStatus(err.message, 'error')));
  $('reportBtn')?.addEventListener('click', () => openReport().catch((err) => setSaveStatus(err.message, 'error')));
  $('latexBtn')?.addEventListener('click', () => openHandCalculation().catch((err) => setSaveStatus(err.message, 'error')));
  $('latexRefreshBtn')?.addEventListener('click', () => openHandCalculation().catch((err) => setSaveStatus(err.message, 'error')));
  $('latexDownloadBtn')?.addEventListener('click', () => downloadBlob(new Blob([$('latexSourceBox').value], { type: 'application/x-tex' }), 'beam-hand-calculation.tex'));
  $('reportDownloadBtn')?.addEventListener('click', () => downloadBlob(new Blob([window._lastReportHtml || $('reportFrame').srcdoc || ''], { type: 'text/html' }), 'beam-calculation-report.html'));
  $('reportPrintBtn')?.addEventListener('click', () => $('reportFrame')?.contentWindow?.print());
  $('reportModalClose')?.addEventListener('click', () => hideModal('reportModal'));
  $('latexModalClose')?.addEventListener('click', () => hideModal('latexModal'));
  $('helpBtn')?.addEventListener('click', () => { $('helpModalBody').innerHTML = '<p>This production build uses the secure backend for calculations, reports and hand calculations. Enter beam data, press Recalculate, then review returned checks and diagrams.</p>'; showModal('helpModal'); });
  $('helpModalClose')?.addEventListener('click', () => hideModal('helpModal'));
  $('themeBtn')?.addEventListener('click', () => showModal('settingsModal'));
  $('settingsClose')?.addEventListener('click', () => hideModal('settingsModal'));
  $('settingsCancel')?.addEventListener('click', () => hideModal('settingsModal'));
  $('settingsSave')?.addEventListener('click', () => { saveSettings(); applySettings(); hideModal('settingsModal'); });
  $$('input[name="settingsTheme"]').forEach((el) => el.addEventListener('change', () => { state.settings.theme = el.value; saveSettings(); applySettings(); }));
  $$('input[name="settingsLayoutMode"]').forEach((el) => el.addEventListener('change', () => { state.settings.layoutMode = el.value; saveSettings(); applySettings(); }));
  $('saveToolbarBtn')?.addEventListener('click', saveLocalProject);
  $('saveProjectBtn')?.addEventListener('click', saveLocalProject);
  $('openProjectBtn')?.addEventListener('click', () => { try { loadLocalProject(); } catch (err) { setSaveStatus(err.message, 'error'); } });
  $('downloadProjectBtn')?.addEventListener('click', () => downloadBlob(new Blob([JSON.stringify({ input: buildRequest(), result: state.last?.result || null }, null, 2)], { type: 'application/json' }), 'beam-project.json'));
  $('projectFileInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    const payload = JSON.parse(await file.text());
    applyInput(payload.input || payload);
    recalculateDebounced();
  });
  $('installProjectBtn')?.addEventListener('click', () => $('projectFileInput')?.click());
  $('fileMenuBtn')?.addEventListener('click', () => $('fileMenu')?.classList.toggle('hide'));
  $('accountModalClose')?.addEventListener('click', () => hideModal('accountModal'));
  $('fileAccountBtn')?.addEventListener('click', () => showModal('accountModal'));
  $('googleSignInBtn')?.addEventListener('click', () => api('/api/auth/google/start').then((r) => r.json()).then((b) => { if (b.url) location.href = b.url; }).catch((err) => $('accountStatus').textContent = err.message));
  $('appleSignInBtn')?.addEventListener('click', () => api('/api/auth/apple/start').then((r) => r.json()).then((b) => { if (b.url) location.href = b.url; }).catch((err) => $('accountStatus').textContent = err.message));
  window.addEventListener('resize', () => { applySettings(); if (state.last) drawAllCharts(state.last.result.diagrams?.series || [], state.last.result.summary || {}); });
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
  $('projectDate') && ($('projectDate').value = new Date().toISOString().slice(0, 10));
  try {
    await loadSections();
    await loadSources();
    await calculate();
  } catch (err) {
    setSaveStatus(err.message || 'Calculation service unavailable. Please try again.', 'error');
    renderUnavailable(err.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
