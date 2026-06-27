const $ = (selector) => document.querySelector(selector);
const api = async (url, options = {}) => {
  const res = await fetch(url, {
    credentials: 'include',
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
      nationalAnnex: form.get('nationalAnnex') || 'UK National Annex / project default',
      notes: form.get('notes')
    },
    section: { family: form.get('sectionFamily'), name: form.get('sectionName') },
    material: { grade: form.get('material') },
    units: form.get('units'),
    model: {
      span,
      supportType: form.get('supportType'),
      includeSelfWeight: form.get('includeSelfWeight') === 'on'
    },
    combination: { combination: form.get('combination'), psiQ1: 0.7, psiQ2: 0.7 },
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
      webStiffener: 'none'
    },
    axial: { G: Number(form.get('axialG') || 0), Q1: 0, Q2: 0 },
    loads: {
      udls: [{ label: 'Full-span UDL', x1: 0, x2: span, G: Number(form.get('udlG') || 0), Q1: Number(form.get('udlQ1') || 0), Q2: 0 }],
      points: pointLoad > 0 ? [{ label: 'Point Q1', x: pointX, G: 0, Q1: pointLoad, Q2: 0 }] : []
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

function renderResult(result) {
  $('#resultStatus').textContent = result.status;
  $('#resultIR').textContent = result.summary.governingIR;
  $('#resultMoment').textContent = `${result.summary.maxMoment} ${result.summary.momentUnit}`;
  $('#resultShear').textContent = `${result.summary.maxShear} ${result.summary.forceUnit}`;
  $('#resultDeflection').textContent = `${result.summary.deflection} mm`;
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

function drawDiagram(series) {
  const canvas = $('#diagramCanvas');
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = css.getPropertyValue('--panel-2').trim();
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!series.length) return;
  drawSeries(ctx, series, 'moment', 30, 150, css.getPropertyValue('--accent').trim(), 'Moment');
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
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
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
  if (!state.lastResult) await calculate();
  try {
    const body = {
      name: state.lastResult.input.metadata.projectName,
      metadata: state.lastResult.input.metadata,
      input: state.lastResult.input,
      result: state.lastResult.result
    };
    const res = await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
    const saved = await res.json();
    setStatus(`Saved server project ${saved.project.name}`, 'ok');
  } catch (err) {
    localStorage.setItem('beam_local_draft_v1', JSON.stringify(state.lastResult));
    setStatus(`${err.message} Local draft saved in this browser.`, 'error');
  }
}

async function downloadPdf() {
  if (!state.lastResult) await calculate();
  const res = await api('/api/pdf', {
    method: 'POST',
    body: JSON.stringify({ input: state.lastResult.input, result: state.lastResult.result, metadata: state.lastResult.input.metadata })
  });
  const blob = await res.blob();
  downloadBlob(blob, 'beam-calculation.pdf');
}

async function openHtmlReport() {
  if (!state.lastResult) await calculate();
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
  if (!state.lastResult) await calculate();
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
$('#openReport').addEventListener('click', () => openHtmlReport().catch((err) => setStatus(err.message, 'error')));
$('#downloadLatex').addEventListener('click', () => downloadLatex().catch((err) => setStatus(err.message, 'error')));
$('#downloadPdf').addEventListener('click', () => downloadPdf().catch((err) => setStatus(err.message, 'error')));
$('#loadSources').addEventListener('click', () => loadSources().catch((err) => setStatus(err.message, 'error')));
addEventListener('resize', applySettings);
$('[name="date"]').value = new Date().toISOString().slice(0, 10);
applySettings();
Promise.all([loadFamilies(), loadSources(), refreshSession()])
  .then(() => calculate())
  .catch((err) => setStatus(err.message, 'error'));
