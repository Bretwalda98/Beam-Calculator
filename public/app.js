const $ = (selector) => document.querySelector(selector);
const LEGACY_PREFIX = 'col' + 'beam';
const LEGACY_AUDIT_KEY = `${LEGACY_PREFIX}Audit`;
const LEGACY_SUPPORT_KEY = `${LEGACY_PREFIX}SupportMappingLabel`;
const LEGACY_INTERACTION_LABEL_KEY = `${LEGACY_PREFIX}InteractionMethodLabel`;
const api = async (url, options = {}) => {
  const res = await fetch(url, {
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Request failed (${res.status})`);
  }
  return res;
};

const state = {
  lastResult: null,
  settings: JSON.parse(localStorage.getItem('beam_ui_settings_v3') || '{}')
};

function detectLayout() {
  if (innerWidth < 720) return 'mobile';
  if (innerWidth < 1180) return 'tablet';
  return 'desktop';
}

function applySettings() {
  const themeMode = state.settings.theme || 'system';
  const theme = themeMode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : themeMode;
  document.documentElement.dataset.theme = theme;
  const layoutChoice = state.settings.layout || 'auto';
  const layout = layoutChoice === 'auto' ? detectLayout() : layoutChoice;
  document.body.classList.toggle('layout-mobile', layout === 'mobile');
  document.body.classList.toggle('layout-tablet', layout === 'tablet');
  document.body.classList.toggle('layout-desktop', layout === 'desktop');
  $('#layoutBadge').textContent = `${layoutChoice} / ${layout}`;
  $('#layoutMode').value = layoutChoice;
  $('#themeMode').value = themeMode;
}

function saveSettings() {
  localStorage.setItem('beam_ui_settings_v3', JSON.stringify(state.settings));
}

function setStatus(message, type = '') {
  const el = $('#status');
  el.textContent = message;
  el.className = `status ${type}`.trim();
}

async function loadFamilies() {
  const res = await api('/api/sections');
  const data = await res.json();
  const select = $('#sectionFamily');
  select.innerHTML = data.families.map((item) => `<option value="${escapeHtml(item.family)}">${escapeHtml(item.family)} (${item.count})</option>`).join('');
  select.value = data.families.some((item) => item.family === 'HEA') ? 'HEA' : data.families[0]?.family || '';
  await loadSectionNames();
}

async function loadSectionNames() {
  const family = $('#sectionFamily').value;
  const res = await api(`/api/sections/${encodeURIComponent(family)}`);
  const data = await res.json();
  const select = $('#sectionName');
  select.innerHTML = data.sections.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  const preferred = ['HE 200 A', 'IPE 200'].find((name) => data.sections.includes(name));
  if (preferred) select.value = preferred;
}

function readForm() {
  const form = new FormData($('#calcForm'));
  const span = Number(form.get('span'));
  const pointLoad = Number(form.get('pointQ1') || 0);
  const pointX = Number(form.get('pointX') || 0);
  const reportDate = form.get('date') || new Date().toISOString().slice(0, 10);
  const includeSelfWeight = form.get('includeSelfWeight') === 'on';
  const nationalAnnex = form.get('nationalAnnex') || 'UK National Annex / project default';
  return {
    metadata: {
      projectName: form.get('projectName'),
      clientName: form.get('clientName'),
      companyName: form.get('companyName'),
      companyLogoUrl: form.get('companyLogoUrl'),
      jobReference: form.get('jobReference'),
      calculationTitle: form.get('calculationTitle') || 'Beam section check',
      beamMark: form.get('beamMark'),
      revision: form.get('revision'),
      revisionDescription: form.get('revisionDescription'),
      engineerName: form.get('engineerName'),
      checkedBy: form.get('checkedBy'),
      approvedBy: form.get('approvedBy'),
      date: reportDate,
      designCode: form.get('designCode') || 'EN 1993-1-1',
      nationalAnnex,
      notes: form.get('notes')
    },
    section: { family: form.get('sectionFamily'), name: form.get('sectionName') },
    material: { grade: form.get('material') },
    units: form.get('units'),
    model: {
      span,
      supportType: form.get('supportType'),
      includeSelfWeight,
      [LEGACY_SUPPORT_KEY]: 'Current support mapping',
      supportEquivalenceNote: 'Support equivalence to the reference EC3 workflow has not been independently verified.'
    },
    combination: {
      combination: form.get('combination'),
      psiQ1: 0.7,
      psiQ2: 0.7,
      customULSFactors: { G: 1.35, Q1: 1.5, Q2: 1.5 },
      customSLSFactors: { G: 1, Q1: 1, Q2: 0.7 },
      perCheckEnvelope: false,
      slsDeflectionBasis: 'total',
      slsIncludeSelfWeight: includeSelfWeight
    },
    settings: {
      sectionClass: Number(form.get('sectionClass')),
      gammaM0: Number(form.get('gammaM0')),
      gammaM1: Number(form.get('gammaM1')),
      deflectionLimit: Number(form.get('deflectionLimit')),
      enableLTB: form.get('enableLTB') === 'on',
      ltbRestraints: Number(form.get('ltbRestraints')),
      ltbK: 1,
      ltbC1: 1,
      ltbC2: 0,
      ltbModel: 'rolled',
      endPostType: 'flexible',
      webStiffener: 'none',
      [LEGACY_AUDIT_KEY]: {
        auditProfile: 'current',
        materialVariantLabel: '',
        nationalAnnexLabel: nationalAnnex,
        coefficientSource: 'Backend EN 1990/EN 1993 defaults',
        autoSectionClassificationStatus: 'manual',
        class4EffectivePropertiesMode: 'not_available',
        shearFactorEta: 1,
        class12ElasticDesign: false,
        conservativeNMyMz: false,
        flangeBucklingIgnored: false,
        webBucklingIgnored: false,
        ltbC3: 0,
        ltbKw: 1,
        ltbLoadHeight: 'shear_centre',
        ltbShearCentreConvention: 'not_applied',
        ltbRestraintModel: 'current',
        ltbMomentGradientMethod: 'manual',
        lambdaLT0: 0.4,
        beta: 0.75,
        memberBucklingInteractionMethod: 'current',
        [LEGACY_INTERACTION_LABEL_KEY]: 'Source to be confirmed',
        supportBearingModel: 'current_screening',
        webBearingModel: 'current_screening',
        stiffenerModel: 'current_screening',
        modalAnalysisStatus: 'not implemented'
      }
    },
    axial: { G: Number(form.get('axialG') || 0), Q1: 0, Q2: 0, signConvention: 'positive_compression' },
    loads: {
      udls: [{ label: 'Full-span UDL', direction: 'Y', x1: 0, x2: span, G: Number(form.get('udlG') || 0), Q1: Number(form.get('udlQ1') || 0), Q2: 0 }],
      points: pointLoad > 0 ? [{ label: 'Point Q1', direction: 'Y', x: pointX, G: 0, Q1: pointLoad, Q2: 0 }] : []
    }
  };
}

async function calculate(event) {
  event?.preventDefault();
  setStatus('Calculating on backend...', '');
  const input = readForm();
  const res = await api('/api/calculate', { method: 'POST', body: JSON.stringify(input) });
  const result = await res.json();
  state.lastResult = { input, result };
  renderResult(result);
  setStatus(`Server calculation complete: ${result.status}`, result.status === 'PASS' ? 'ok' : 'error');
}

async function ensureFreshCalculation() {
  const input = readForm();
  if (!state.lastResult || JSON.stringify(input) !== JSON.stringify(state.lastResult.input)) {
    await calculate();
  }
  return state.lastResult;
}

function renderResult(result) {
  $('#resultStatus').textContent = result.status;
  $('#resultIR').textContent = result.summary.governingIR;
  $('#resultMoment').textContent = joinUnit(result.summary.maxMoment, result.summary.momentUnit);
  $('#resultShear').textContent = joinUnit(result.summary.maxShear, result.summary.forceUnit);
  $('#resultDeflection').textContent = joinUnit(result.summary.deflection, 'mm');
  $('#resultSource').textContent = result.source.title;
  const checks = result.checks;
  $('#checksTable tbody').innerHTML = Object.entries(checks).map(([name, check]) => {
    const ir = check.ir ?? '-';
    const pass = check.pass === undefined ? '-' : (check.pass ? 'PASS' : 'FAIL');
    const detail = check.message || check.label || (check.available === false ? 'Unavailable' : '');
    return `<tr><td>${escapeHtml(titleCase(name))}</td><td>${escapeHtml(ir)}</td><td>${escapeHtml(pass)}</td><td>${escapeHtml(detail)}</td></tr>`;
  }).join('');
  drawDiagram(result.diagrams.series || []);
}

function themeValue(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function joinUnit(value, unit) {
  return `${value}\u00a0${String(unit || '').replace(/\s+/g, '\u00a0')}`.trim();
}

function drawDiagram(series) {
  const canvas = $('#diagramCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = themeValue('--surface-2', '#f8fafc');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!series.length) return;
  drawSeries(ctx, series, 'moment', 30, 150, themeValue('--accent', '#2563eb'), 'Moment');
  drawSeries(ctx, series, 'shear', 190, 150, '#dc2626', 'Shear');
  drawSeries(ctx, series, 'deflection', 350, 140, '#15803d', 'Deflection');
}

function drawSeries(ctx, rows, key, top, height, color, label) {
  const left = 56;
  const right = ctx.canvas.width - 24;
  const maxX = Math.max(...rows.map((row) => row.x), 1);
  const maxY = Math.max(...rows.map((row) => Math.abs(row[key] || 0)), 1e-9);
  const mid = top + height / 2;
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, mid);
  ctx.lineTo(right, mid);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = left + (row.x / maxX) * (right - left);
    const y = mid - ((row[key] || 0) / maxY) * (height * .42);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = themeValue('--text', '#18202a');
  ctx.font = '18px system-ui';
  ctx.fillText(label, left, top - 8);
}

async function loadSources() {
  const res = await api('/api/sections/sources');
  const data = await res.json();
  $('#sourcesTable tbody').innerHTML = data.sources.map((row) => `
    <tr>
      <td>${escapeHtml(row.sourceName)}</td>
      <td>${escapeHtml(row.region)}</td>
      <td>${escapeHtml(row.edition)}</td>
      <td>${escapeHtml(row.sectionTypes.join(', '))}</td>
      <td>${escapeHtml(row.reference)}</td>
    </tr>`).join('');
}

async function refreshSession() {
  const res = await api('/api/auth/session');
  const session = await res.json();
  $('#accountState').textContent = session.authenticated ? `${session.user.name || session.user.email}` : 'Local guest';
}

async function startAuth(provider) {
  try {
    const res = await api(`/api/auth/${provider}/start`);
    const body = await res.json();
    if (body.url) location.href = body.url;
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

async function saveProject() {
  await ensureFreshCalculation();
  localStorage.setItem('beam_local_draft_v1', JSON.stringify(state.lastResult));
  try {
    const body = {
      name: state.lastResult.input.metadata.projectName,
      metadata: state.lastResult.input.metadata,
      input: state.lastResult.input,
      result: state.lastResult.result
    };
    const res = await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
    const saved = await res.json();
    setStatus(`Saved server project ${saved.project.name}. Local draft also updated.`, 'ok');
  } catch (err) {
    setStatus(`${err.message} Local draft saved in this browser.`, 'error');
  }
}

function setFieldValue(name, value) {
  const el = document.querySelector(`[name="${name}"]`);
  if (!el) return;
  if (el.type === 'checkbox') {
    el.checked = Boolean(value);
    return;
  }
  el.value = value ?? '';
}

async function applyInputToForm(input) {
  const meta = input.metadata || {};
  [
    'projectName', 'clientName', 'companyName', 'companyLogoUrl', 'jobReference',
    'calculationTitle', 'beamMark', 'revision', 'revisionDescription', 'engineerName',
    'checkedBy', 'approvedBy', 'date', 'designCode', 'nationalAnnex', 'notes'
  ].forEach((name) => setFieldValue(name, name === 'date' ? (meta[name] || new Date().toISOString().slice(0, 10)) : meta[name]));
  setFieldValue('units', input.units || 'kn');
  setFieldValue('span', input.model?.span ?? 6);
  setFieldValue('supportType', input.model?.supportType || 'ss');
  setFieldValue('includeSelfWeight', input.model?.includeSelfWeight !== false);
  setFieldValue('material', input.material?.grade || 'S355');
  setFieldValue('sectionClass', input.settings?.sectionClass ?? 2);
  setFieldValue('deflectionLimit', input.settings?.deflectionLimit ?? 300);
  setFieldValue('gammaM0', input.settings?.gammaM0 ?? 1);
  setFieldValue('gammaM1', input.settings?.gammaM1 ?? 1);
  setFieldValue('enableLTB', input.settings?.enableLTB !== false);
  setFieldValue('ltbRestraints', input.settings?.ltbRestraints ?? 0);
  setFieldValue('combination', input.combination?.combination || 'en1990_610');
  const firstUdl = input.loads?.udls?.[0] || {};
  setFieldValue('udlG', firstUdl.G ?? 0);
  setFieldValue('udlQ1', firstUdl.Q1 ?? 0);
  const firstPoint = input.loads?.points?.[0] || {};
  setFieldValue('pointQ1', firstPoint.Q1 ?? 0);
  setFieldValue('pointX', firstPoint.x ?? (input.model?.span ? input.model.span / 2 : 3));
  setFieldValue('axialG', input.axial?.G ?? 0);
  if (input.section?.family) {
    $('#sectionFamily').value = input.section.family;
    await loadSectionNames();
    if ([...$('#sectionName').options].some((option) => option.value === input.section.name)) {
      $('#sectionName').value = input.section.name;
    }
  }
}

async function loadLocalDraft() {
  const raw = localStorage.getItem('beam_local_draft_v1');
  if (!raw) {
    setStatus('No local draft is saved in this browser.', 'error');
    return;
  }
  const draft = JSON.parse(raw);
  if (!draft?.input) throw new Error('Saved local draft is not a valid beam project.');
  await applyInputToForm(draft.input);
  if (draft.result) {
    state.lastResult = draft;
    renderResult(draft.result);
    setStatus('Loaded local draft. Recalculate before issuing a report if inputs have changed.', 'ok');
  } else {
    await calculate();
  }
}

async function exportProjectJson() {
  await ensureFreshCalculation();
  const payload = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    input: state.lastResult.input,
    result: state.lastResult.result
  };
  const name = String(state.lastResult.input.metadata.projectName || 'beam-project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'beam-project';
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${name}.json`);
  setStatus('Project JSON exported from the current server calculation.', 'ok');
}

async function downloadPdf() {
  await ensureFreshCalculation();
  const res = await api('/api/pdf', {
    method: 'POST',
    body: JSON.stringify({ input: state.lastResult.input, result: state.lastResult.result, metadata: state.lastResult.input.metadata })
  });
  const blob = await res.blob();
  downloadBlob(blob, 'beam-calculation.pdf');
}

async function openHtmlReport() {
  await ensureFreshCalculation();
  const res = await api('/api/report/html', {
    method: 'POST',
    body: JSON.stringify({ input: state.lastResult.input, result: state.lastResult.result, metadata: state.lastResult.input.metadata })
  });
  const html = await res.text();
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener');
  if (!win) downloadBlob(blob, 'beam-calculation-report.html');
  setStatus('Report package generated. Use browser print to create the final PDF.', 'ok');
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function downloadLatex() {
  await ensureFreshCalculation();
  const res = await api('/api/report/latex', {
    method: 'POST',
    body: JSON.stringify({ input: state.lastResult.input, result: state.lastResult.result, metadata: state.lastResult.input.metadata })
  });
  const blob = await res.blob();
  downloadBlob(blob, 'beam-calculation-report.tex');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function titleCase(value) {
  return String(value).replace(/([A-Z])/g, ' $1').replace(/^./, (ch) => ch.toUpperCase());
}

$('#calcForm').addEventListener('submit', (event) => calculate(event).catch((err) => setStatus(err.message, 'error')));
$('#sectionFamily').addEventListener('change', () => loadSectionNames().catch((err) => setStatus(err.message, 'error')));
$('#layoutMode').addEventListener('change', (event) => { state.settings.layout = event.target.value; saveSettings(); applySettings(); });
$('#themeMode').addEventListener('change', (event) => { state.settings.theme = event.target.value; saveSettings(); applySettings(); drawDiagram(state.lastResult?.result?.diagrams?.series || []); });
$('#themeToggle').addEventListener('click', () => { state.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; saveSettings(); applySettings(); });
$('#googleSignIn').addEventListener('click', () => startAuth('google'));
$('#appleSignIn').addEventListener('click', () => startAuth('apple'));
$('#signOut').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); await refreshSession(); });
$('#saveProject').addEventListener('click', () => saveProject().catch((err) => setStatus(err.message, 'error')));
$('#loadLocalDraft').addEventListener('click', () => loadLocalDraft().catch((err) => setStatus(err.message, 'error')));
$('#openReport').addEventListener('click', () => openHtmlReport().catch((err) => setStatus(err.message, 'error')));
$('#downloadLatex').addEventListener('click', () => downloadLatex().catch((err) => setStatus(err.message, 'error')));
$('#downloadPdf').addEventListener('click', () => downloadPdf().catch((err) => setStatus(err.message, 'error')));
$('#exportProject').addEventListener('click', () => exportProjectJson().catch((err) => setStatus(err.message, 'error')));
$('#loadSources').addEventListener('click', () => loadSources().catch((err) => setStatus(err.message, 'error')));
addEventListener('resize', applySettings);
$('[name="date"]').value = new Date().toISOString().slice(0, 10);
applySettings();
Promise.all([loadFamilies(), loadSources(), refreshSession()])
  .then(() => calculate())
  .catch((err) => setStatus(err.message, 'error'));
