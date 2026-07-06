const { version } = require('../../package.json');

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function escAttr(value) {
  return escHtml(value).replace(/`/g, '&#96;');
}

function escLatex(value) {
  return String(value ?? '').replace(/[\\{}$&#_%^~]/g, (ch) => ({
    '\\': '\\textbackslash{}',
    '{': '\\{',
    '}': '\\}',
    '$': '\\$',
    '&': '\\&',
    '#': '\\#',
    '_': '\\_',
    '%': '\\%',
    '^': '\\textasciicircum{}',
    '~': '\\textasciitilde{}'
  }[ch]));
}

function pdfSafeText(value) {
  return String(value ?? '')
    .replace(/[–—]/g, '-')
    .replace(/[·•]/g, '*')
    .replace(/×/g, 'x')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/ψ/g, 'psi')
    .replace(/χ/g, 'chi')
    .replace(/γ/g, 'gamma')
    .replace(/δ/g, 'delta')
    .replace(/λ/g, 'lambda')
    .replace(/φ/g, 'phi')
    .replace(/π/g, 'pi')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/⁴/g, '^4')
    .replace(/⁶/g, '^6')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

function escPdf(value) {
  return pdfSafeText(value).replace(/[\\()]/g, '\\$&').replace(/\r?\n/g, ' ');
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, dp = 3) {
  const n = finite(value);
  if (n === null) return '-';
  return n.toLocaleString('en-GB', {
    maximumFractionDigits: dp,
    minimumFractionDigits: 0
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(value, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function mergeMetadata(input = {}, supplied = {}) {
  const meta = { ...(input.metadata || {}), ...(supplied || {}) };
  return {
    projectName: cleanText(meta.projectName, 'Untitled beam project'),
    clientName: cleanText(meta.clientName, '-'),
    companyName: cleanText(meta.companyName, '-'),
    companyLogoUrl: cleanText(meta.companyLogoUrl, ''),
    jobReference: cleanText(meta.jobReference, '-'),
    calculationTitle: cleanText(meta.calculationTitle, 'Beam section check'),
    beamMark: cleanText(meta.beamMark, '-'),
    revision: cleanText(meta.revision, '-'),
    revisionDescription: cleanText(meta.revisionDescription, 'Current calculation issue'),
    engineerName: cleanText(meta.engineerName || meta.preparedBy, '-'),
    checkedBy: cleanText(meta.checkedBy, '-'),
    approvedBy: cleanText(meta.approvedBy, '-'),
    date: cleanText(meta.date, today()),
    designCode: cleanText(meta.designCode, 'EN 1993-1-1'),
    nationalAnnex: cleanText(meta.nationalAnnex, 'UK National Annex / project default'),
    notes: cleanText(meta.notes || meta.comments, '-'),
    softwareVersion: cleanText(meta.softwareVersion, version),
    paperSize: ['A4', 'A3', 'Letter'].includes(meta.paperSize) ? meta.paperSize : 'A4'
  };
}

function titleCase(value) {
  return String(value || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (ch) => ch.toUpperCase());
}

function getCheckStatus(check = {}) {
  if (check.pass === true) return 'PASS';
  if (check.pass === false) return 'FAIL';
  if (check.available === false) return 'WARNING';
  return 'INFO';
}

function inferGoverningCheck(result = {}) {
  const checks = Object.entries(result.checks || {})
    .map(([name, check]) => ({ name, check, ir: finite(check?.ir) }))
    .filter((row) => row.ir !== null);
  checks.sort((a, b) => Math.abs(b.ir) - Math.abs(a.ir));
  const first = checks[0];
  return first ? {
    title: titleCase(first.name),
    ir: first.ir,
    status: getCheckStatus(first.check)
  } : {
    title: 'Not available',
    ir: finite(result.summary?.governingIR) ?? null,
    status: result.status || 'INFO'
  };
}

function rowsToHtml(headers, rows, className = '') {
  return `<table${className ? ` class="${escAttr(className)}"` : ''}>
    <thead><tr>${headers.map((header) => `<th>${escHtml(header)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
}

function definitionTableHtml(rows, className = '') {
  return rowsToHtml(['Item', 'Value'], rows, className);
}

function makeLogo(meta) {
  if (meta.companyLogoUrl && meta.companyLogoUrl !== '-') {
    return `<img src="${escAttr(meta.companyLogoUrl)}" alt="${escAttr(meta.companyName)} logo">`;
  }
  const letters = meta.companyName && meta.companyName !== '-'
    ? meta.companyName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    : 'LOGO';
  return `<div class="logo-placeholder">${escHtml(letters)}</div>`;
}

function scaleProfile(geometry) {
  const h = finite(geometry?.h_mm) || 220;
  const b = finite(geometry?.b_mm) || h * 0.55;
  const width = 270;
  const height = 230;
  const s = Math.min(width / Math.max(b, 1), height / Math.max(h, 1));
  const pxH = h * s;
  const pxB = b * s;
  const x0 = 260 - pxB / 2;
  const y0 = 155 - pxH / 2;
  return { h, b, s, pxH, pxB, x0, y0, cx: 260, cy: 155 };
}

function dimLine(x1, y1, x2, y2, label, tx, ty) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="dim"/>
  <text x="${tx}" y="${ty}" class="dim-text">${escHtml(label)}</text>`;
}

function axisLine(x1, y1, x2, y2, label, tx, ty) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="axis"/>
  <text x="${tx}" y="${ty}" class="axis-text">${escHtml(label)}</text>`;
}

function buildSectionSvg(sectionProperties = {}) {
  const g = sectionProperties.dimensions || {};
  const type = g.type || 'i';
  const scaled = scaleProfile(g);
  const tf = (finite(g.tf_mm) || finite(g.t_mm) || scaled.h * 0.08) * scaled.s;
  const tw = (finite(g.tw_mm) || finite(g.t_mm) || scaled.b * 0.08) * scaled.s;
  const r = (finite(g.r_mm) || 0) * scaled.s;
  const { h, b, s, pxH, pxB, x0, y0, cx, cy } = scaled;
  let shape = '';

  if (type === 'rhs') {
    const t = Math.max(4, (finite(g.t_mm) || finite(g.tf_mm) || Math.min(h, b) * 0.06) * s);
    shape = `<rect x="${x0}" y="${y0}" width="${pxB}" height="${pxH}" rx="${Math.max(0, r)}" class="section-fill"/>
      <rect x="${x0 + t}" y="${y0 + t}" width="${Math.max(1, pxB - 2 * t)}" height="${Math.max(1, pxH - 2 * t)}" rx="${Math.max(0, r - t)}" class="section-hole"/>
      ${dimLine(x0 + pxB + 36, y0, x0 + pxB + 36, y0 + pxH, `h = ${round(g.h_mm, 1)} mm`, x0 + pxB + 46, cy)}
      ${dimLine(x0, y0 + pxH + 36, x0 + pxB, y0 + pxH + 36, `b = ${round(g.b_mm, 1)} mm`, cx - 44, y0 + pxH + 58)}
      ${dimLine(x0 + pxB - t, y0 + 24, x0 + pxB, y0 + 24, `t = ${round(g.t_mm || g.tf_mm, 1)} mm`, x0 + pxB + 8, y0 + 30)}`;
  } else if (type === 'channel') {
    const path = [
      `M ${x0} ${y0}`,
      `H ${x0 + pxB}`,
      `V ${y0 + tf}`,
      `H ${x0 + tw}`,
      `V ${y0 + pxH - tf}`,
      `H ${x0 + pxB}`,
      `V ${y0 + pxH}`,
      `H ${x0}`,
      'Z'
    ].join(' ');
    shape = `<path d="${path}" class="section-fill"/>
      ${dimLine(x0 + pxB + 36, y0, x0 + pxB + 36, y0 + pxH, `h = ${round(g.h_mm, 1)} mm`, x0 + pxB + 46, cy)}
      ${dimLine(x0, y0 + pxH + 36, x0 + pxB, y0 + pxH + 36, `b = ${round(g.b_mm, 1)} mm`, cx - 44, y0 + pxH + 58)}
      ${dimLine(x0, y0 + 26, x0 + tw, y0 + 26, `tw = ${round(g.tw_mm, 1)} mm`, x0 + 4, y0 + 48)}
      ${dimLine(x0 + pxB - 72, y0, x0 + pxB - 72, y0 + tf, `tf = ${round(g.tf_mm, 1)} mm`, x0 + pxB - 66, y0 + 18)}`;
  } else if (type === 'angle') {
    const t = Math.max(4, (finite(g.t_mm) || finite(g.tf_mm) || Math.min(h, b) * 0.08) * s);
    const path = [
      `M ${x0} ${y0}`,
      `H ${x0 + t}`,
      `V ${y0 + pxH - t}`,
      `H ${x0 + pxB}`,
      `V ${y0 + pxH}`,
      `H ${x0}`,
      'Z'
    ].join(' ');
    shape = `<path d="${path}" class="section-fill"/>
      ${dimLine(x0 + pxB + 36, y0, x0 + pxB + 36, y0 + pxH, `h = ${round(g.h_mm, 1)} mm`, x0 + pxB + 46, cy)}
      ${dimLine(x0, y0 + pxH + 36, x0 + pxB, y0 + pxH + 36, `b = ${round(g.b_mm, 1)} mm`, cx - 44, y0 + pxH + 58)}
      ${dimLine(x0, y0 + pxH - t - 18, x0 + t, y0 + pxH - t - 18, `t = ${round(g.t_mm || g.tf_mm, 1)} mm`, x0 + 4, y0 + pxH - t - 26)}`;
  } else {
    shape = `<rect x="${x0}" y="${y0}" width="${pxB}" height="${tf}" class="section-fill"/>
      <rect x="${cx - tw / 2}" y="${y0 + tf}" width="${tw}" height="${Math.max(1, pxH - 2 * tf)}" class="section-fill"/>
      <rect x="${x0}" y="${y0 + pxH - tf}" width="${pxB}" height="${tf}" class="section-fill"/>
      ${r > 0 ? `<path d="M ${cx - tw / 2} ${y0 + tf + r} A ${r} ${r} 0 0 1 ${cx - tw / 2 - r} ${y0 + tf}" class="radius"/>
        <text x="${cx - tw / 2 - 88}" y="${y0 + tf + 14}" class="dim-text">r = ${escHtml(round(g.r_mm, 1))} mm</text>` : ''}
      ${dimLine(x0 + pxB + 36, y0, x0 + pxB + 36, y0 + pxH, `h = ${round(g.h_mm, 1)} mm`, x0 + pxB + 46, cy)}
      ${dimLine(x0, y0 + pxH + 36, x0 + pxB, y0 + pxH + 36, `b = ${round(g.b_mm, 1)} mm`, cx - 44, y0 + pxH + 58)}
      ${dimLine(cx - tw / 2, y0 + pxH / 2, cx + tw / 2, y0 + pxH / 2, `tw = ${round(g.tw_mm, 1)} mm`, cx + tw / 2 + 8, y0 + pxH / 2 - 8)}
      ${dimLine(x0 + pxB - 72, y0, x0 + pxB - 72, y0 + tf, `tf = ${round(g.tf_mm, 1)} mm`, x0 + pxB - 66, y0 + 18)}`;
  }

  return `<svg viewBox="0 0 520 340" role="img" aria-label="Beam section geometry">
    <defs>
      <style>
        .section-fill{fill:#dbeafe;stroke:#1e3a8a;stroke-width:2}
        .section-hole{fill:#fff;stroke:#1e3a8a;stroke-width:2}
        .dim{stroke:#334155;stroke-width:1.2;marker-start:url(#arr);marker-end:url(#arr)}
        .axis{stroke:#b91c1c;stroke-width:1.3;stroke-dasharray:5 4;marker-end:url(#arr)}
        .radius{fill:none;stroke:#334155;stroke-width:1.2}
        text{font-family:Arial,sans-serif}
        .dim-text{font-size:14px;fill:#0f172a}
        .axis-text{font-size:14px;fill:#b91c1c;font-weight:700}
      </style>
      <marker id="arr" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
        <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#334155"/>
      </marker>
    </defs>
    <rect x="1" y="1" width="518" height="338" fill="#fff" stroke="#cbd5e1"/>
    ${shape}
    ${axisLine(88, cy, 432, cy, 'local y-y axis', 334, cy - 10)}
    ${axisLine(cx, 292, cx, 36, 'local z-z axis', cx + 10, 48)}
  </svg>`;
}

function loadLabel(load) {
  const parts = [];
  if (finite(load.G)) parts.push(`G ${round(load.G, 3)}`);
  if (finite(load.Q1)) parts.push(`Q1 ${round(load.Q1, 3)}`);
  if (finite(load.Q2)) parts.push(`Q2 ${round(load.Q2, 3)}`);
  if (finite(load.M) && Math.abs(load.M) > 0) parts.push(`M ${round(load.M, 3)}`);
  return `${load.label || 'Load'} (${parts.join(', ') || '0'})`;
}

function buildLoadingSvg(input = {}, result = {}) {
  const L = finite(result.inputEcho?.span) || finite(input.model?.span) || 1;
  const raw = result.loads?.raw || input.loads || { udls: [], points: [], supportXs: [0, L] };
  const supportType = result.inputEcho?.supportType || input.model?.supportType || 'ss';
  const xMap = (x) => 84 + (Number(x || 0) / Math.max(L, 1e-9)) * 720;
  const yBeam = 128;
  const supports = raw.supportXs || [0, L];
  const supportShapes = supports.map((x, idx) => {
    const sx = xMap(x);
    if (supportType === 'cantilever' && idx === 0) {
      return `<rect x="${sx - 9}" y="${yBeam - 36}" width="18" height="72" fill="#475569"/>
        ${Array.from({ length: 6 }, (_, i) => `<line x1="${sx - 22}" y1="${yBeam - 34 + i * 14}" x2="${sx - 9}" y2="${yBeam - 46 + i * 14}" stroke="#475569"/>`).join('')}`;
    }
    return `<path d="M ${sx} ${yBeam + 8} L ${sx - 17} ${yBeam + 42} L ${sx + 17} ${yBeam + 42} Z" fill="#e2e8f0" stroke="#334155"/>
      <line x1="${sx - 25}" y1="${yBeam + 42}" x2="${sx + 25}" y2="${yBeam + 42}" stroke="#334155"/>`;
  }).join('');
  const udls = (raw.udls || []).map((u, idx) => {
    const x1 = xMap(u.x1);
    const x2 = xMap(u.x2);
    const width = Math.max(1, x2 - x1);
    const arrowCount = Math.max(2, Math.min(10, Math.round(width / 60)));
    const arrows = Array.from({ length: arrowCount }, (_, i) => {
      const x = x1 + (i + 0.5) * width / arrowCount;
      return `<line x1="${x}" y1="45" x2="${x}" y2="${yBeam - 8}" class="load-arrow"/>`;
    }).join('');
    return `<g>
      <rect x="${x1}" y="42" width="${width}" height="18" fill="${u.isSelf ? '#fef3c7' : '#fee2e2'}" stroke="#991b1b"/>
      ${arrows}
      <text x="${x1 + 4}" y="${35 - (idx % 3) * 16}" class="load-label">${escHtml(loadLabel(u))}</text>
      <text x="${(x1 + x2) / 2 - 34}" y="${yBeam + 68}" class="dim-text">${escHtml(round(u.x1, 2))} to ${escHtml(round(u.x2, 2))} m</text>
    </g>`;
  }).join('');
  const points = (raw.points || []).map((p, idx) => {
    const x = xMap(p.x);
    if (Math.abs(Number(p.M || 0)) > 1e-12) {
      return `<g>
        <path d="M ${x - 23} ${yBeam - 34} A 23 23 0 1 1 ${x + 19} ${yBeam - 16}" fill="none" stroke="#7c2d12" stroke-width="2.4" marker-end="url(#loadArr)"/>
        <text x="${x + 10}" y="${yBeam - 52 - (idx % 3) * 14}" class="load-label">${escHtml(loadLabel(p))}</text>
      </g>`;
    }
    return `<g>
      <line x1="${x}" y1="30" x2="${x}" y2="${yBeam - 8}" class="load-arrow"/>
      <text x="${x + 8}" y="${25 - (idx % 3) * 14}" class="load-label">${escHtml(loadLabel(p))}</text>
      <text x="${x - 22}" y="${yBeam + 68}" class="dim-text">x=${escHtml(round(p.x, 2))} m</text>
    </g>`;
  }).join('');
  const reactions = (result.actions?.reactions || []).map((r) => {
    const x = xMap(r.x);
    return `<g>
      <line x1="${x}" y1="${yBeam + 86}" x2="${x}" y2="${yBeam + 48}" class="reaction-arrow"/>
      <text x="${x - 34}" y="${yBeam + 104}" class="reaction-label">R${escHtml(r.support)} = ${escHtml(round(r.vertical, 3))} ${escHtml(result.summary?.forceUnit || 'kN')}</text>
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 900 250" role="img" aria-label="Loading diagram">
    <defs>
      <style>
        text{font-family:Arial,sans-serif}
        .beam{stroke:#0f172a;stroke-width:5;stroke-linecap:round}
        .dim{stroke:#334155;stroke-width:1.1;marker-start:url(#dimArr);marker-end:url(#dimArr)}
        .load-arrow{stroke:#991b1b;stroke-width:2.2;marker-end:url(#loadArr)}
        .reaction-arrow{stroke:#166534;stroke-width:2.2;marker-end:url(#reactArr)}
        .load-label,.reaction-label,.dim-text{font-size:12px;fill:#0f172a}
      </style>
      <marker id="dimArr" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="#334155"/></marker>
      <marker id="loadArr" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#991b1b"/></marker>
      <marker id="reactArr" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#166534"/></marker>
    </defs>
    <rect x="1" y="1" width="898" height="248" fill="#fff" stroke="#cbd5e1"/>
    <line x1="${xMap(0)}" y1="${yBeam}" x2="${xMap(L)}" y2="${yBeam}" class="beam"/>
    ${supportShapes}
    ${udls}
    ${points}
    ${reactions}
    <line x1="${xMap(0)}" y1="${yBeam + 94}" x2="${xMap(L)}" y2="${yBeam + 94}" class="dim"/>
    <text x="${xMap(L / 2) - 38}" y="${yBeam + 120}" class="dim-text">Span L = ${escHtml(round(L, 3))} m</text>
  </svg>`;
}

function buildGraphSvg(series = [], key, title, unit, stroke) {
  const rows = Array.isArray(series) ? series : [];
  const width = 900;
  const height = 260;
  const left = 72;
  const right = 858;
  const top = 42;
  const bottom = 208;
  const maxX = Math.max(...rows.map((row) => Number(row.x || 0)), 1);
  const values = rows.map((row) => Number(row[key] || 0));
  const maxAbs = Math.max(...values.map((value) => Math.abs(value)), 1e-9);
  const yMap = (value) => top + (bottom - top) / 2 - (value / maxAbs) * ((bottom - top) * 0.44);
  const xMap = (x) => left + (Number(x || 0) / maxX) * (right - left);
  const path = rows.map((row, index) => `${index ? 'L' : 'M'} ${xMap(row.x).toFixed(2)} ${yMap(row[key] || 0).toFixed(2)}`).join(' ');
  const y0 = yMap(0);
  const peak = rows.reduce((best, row) => Math.abs(Number(row[key] || 0)) > Math.abs(Number(best?.[key] || 0)) ? row : best, rows[0] || {});
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escAttr(title)}">
    <defs>
      <style>
        text{font-family:Arial,sans-serif}
        .axis{stroke:#334155;stroke-width:1.2}
        .grid{stroke:#e2e8f0;stroke-width:1}
        .plot{fill:none;stroke:${stroke};stroke-width:2.4}
        .title{font-size:16px;font-weight:700;fill:#0f172a}
        .label{font-size:12px;fill:#334155}
      </style>
    </defs>
    <rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="#fff" stroke="#cbd5e1"/>
    <text x="28" y="26" class="title">${escHtml(title)}</text>
    ${[0, 0.25, 0.5, 0.75, 1].map((p) => `<line x1="${left}" y1="${top + p * (bottom - top)}" x2="${right}" y2="${top + p * (bottom - top)}" class="grid"/>`).join('')}
    <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="axis"/>
    <line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" class="axis"/>
    <line x1="${left}" y1="${y0}" x2="${right}" y2="${y0}" class="axis"/>
    <path d="${path}" class="plot"/>
    <text x="${left}" y="${height - 20}" class="label">x (m)</text>
    <text x="18" y="${top + 12}" class="label">${escHtml(unit)}</text>
    <text x="${Math.max(left, Math.min(right - 190, xMap(peak.x || 0)))}" y="${Math.max(top + 16, yMap(peak[key] || 0) - 10)}" class="label">Peak ${escHtml(round(peak[key], 3))} ${escHtml(unit)} at ${escHtml(round(peak.x, 3))} m</text>
  </svg>`;
}

function buildUtilisationSvg(result = {}) {
  const entries = Object.entries(result.checks || {})
    .map(([name, check]) => ({ name: titleCase(name), ir: finite(check?.ir), status: getCheckStatus(check) }))
    .filter((row) => row.ir !== null);
  const maxIr = Math.max(1, ...entries.map((row) => Math.abs(row.ir))) * 1.08;
  const rows = entries.map((row, i) => {
    const y = 54 + i * 30;
    const bar = Math.min(650, Math.abs(row.ir) / maxIr * 650);
    const colour = row.status === 'FAIL' ? '#dc2626' : row.status === 'WARNING' ? '#b45309' : '#155eef';
    return `<text x="30" y="${y + 14}" class="label">${escHtml(row.name)}</text>
      <rect x="190" y="${y}" width="650" height="18" fill="#e2e8f0"/>
      <rect x="190" y="${y}" width="${bar}" height="18" fill="${colour}"/>
      <text x="${Math.min(846, 198 + bar)}" y="${y + 14}" class="label">${escHtml(round(row.ir, 5))}</text>`;
  }).join('');
  const limitX = 190 + 650 / maxIr;
  return `<svg viewBox="0 0 900 ${Math.max(140, entries.length * 30 + 78)}" role="img" aria-label="Utilisation diagram">
    <style>text{font-family:Arial,sans-serif}.title{font-size:16px;font-weight:700;fill:#0f172a}.label{font-size:12px;fill:#0f172a}</style>
    <rect x="1" y="1" width="898" height="${Math.max(138, entries.length * 30 + 76)}" fill="#fff" stroke="#cbd5e1"/>
    <text x="28" y="28" class="title">Utilisation Ratios</text>
    <line x1="${limitX}" y1="45" x2="${limitX}" y2="${Math.max(108, entries.length * 30 + 48)}" stroke="#dc2626" stroke-dasharray="5 4"/>
    <text x="${limitX + 5}" y="42" class="label">IR = 1.0</text>
    ${rows}
  </svg>`;
}

function formatCheckRows(result = {}) {
  return Object.entries(result.checks || {}).map(([name, check]) => [
    titleCase(name),
    check.ir ?? '-',
    getCheckStatus(check),
    check.resistance ?? check.label ?? check.message ?? (check.available === false ? 'Unavailable' : '-')
  ]);
}

function axisValue(value, unit = '', dp = 3) {
  const n = finite(value);
  if (n === null) return 'Not available';
  return `${round(n, dp)}${unit ? ` ${unit}` : ''}`;
}

function formatDirectionOverviewRows(result = {}) {
  const axis = result.actions?.axis || {};
  const checks = result.checks || {};
  const summary = result.summary || {};
  const force = summary.forceUnit || '';
  const moment = summary.momentUnit || '';
  const hasZ = axis.hasZDirectionLoads === true || Math.abs(Number(axis.MyEd || 0)) > 1e-9 || Math.abs(Number(axis.VzEd || 0)) > 1e-9;
  const hasY = axis.hasYDirectionLoads === true || Math.abs(Number(axis.MzEd || 0)) > 1e-9 || Math.abs(Number(axis.VyEd || 0)) > 1e-9;
  const zStatus = hasZ ? (Number(axis.MyIR || checks.moment?.ir || 0) < 1 && Number(axis.VzIR || checks.shear?.ir || 0) < 1 ? 'PASS' : 'FAIL') : 'Not governing';
  const yStatus = hasY
    ? checks.minorAxis?.available === true
      ? (Number(axis.MzIR || checks.minorAxis?.ir || 0) < 1 && (axis.VyIR === null || Number(axis.VyIR || 0) < 1) ? 'PASS' : 'FAIL')
      : 'Unavailable'
    : 'Not governing';
  return {
    convention: axis.axisConvention || 'X is the member longitudinal axis. Z-direction loading produces My/Vz. Y-direction loading produces Mz/Vy.',
    zRows: [
      ['My,Ed', axisValue(axis.MyEd || 0, moment)],
      ['Vz,Ed', axisValue(axis.VzEd || 0, force)],
      ['z-deflection', axisValue(axis.zDeflection ?? summary.deflection ?? 0, 'mm')],
      ['My,Rd', axisValue(axis.MyRd ?? checks.moment?.resistance, moment)],
      ['Vz,Rd', axisValue(axis.VzRd ?? checks.shear?.resistance, force)],
      ['My utilisation', axisValue(hasZ ? (axis.MyIR ?? checks.moment?.ir) : 0, '', 3)],
      ['Vz utilisation', axisValue(hasZ ? (axis.VzIR ?? checks.shear?.ir) : 0, '', 3)],
      ['Basis', axis.bendingResistanceBasis?.MyRdBasis || checks.moment?.label || 'Not available'],
      ['Status', zStatus],
      ['Message', hasZ ? '-' : 'No Z-direction load applied; strong-axis demand is not governing.']
    ],
    yRows: [
      ['Mz,Ed', axisValue(axis.MzEd || 0, moment)],
      ['Vy,Ed', axisValue(axis.VyEd || 0, force)],
      ['y-deflection', hasY ? axisValue(axis.yDeflection, 'mm') : '0 mm'],
      ['Mz,Rd', hasY ? axisValue(axis.MzRd ?? checks.minorAxis?.momentResistance, moment) : 'Not governing'],
      ['Vy,Rd', hasY ? axisValue(axis.VyRd ?? checks.minorAxis?.shearResistance, force) : 'Not governing'],
      ['Mz utilisation', axisValue(hasY ? (axis.MzIR ?? checks.minorAxis?.ir) : 0, '', 3)],
      ['Vy utilisation', axisValue(hasY ? axis.VyIR : 0, '', 3)],
      ['Basis', hasY ? (axis.bendingResistanceBasis?.MzRdBasis || 'Not available') : 'Not governing'],
      ['Status', yStatus],
      ['Message', hasY ? '-' : 'No Y-direction load applied; weak-axis demand is not governing.']
    ],
    combinedRows: [
      ['Governing direction', axis.governingDirection === 'Y' ? 'Y-direction loading / weak-axis Mz' : 'Z-direction loading / strong-axis My'],
      ['Governing utilisation', axisValue(summary.governingIR, '', 3)],
      ['Combined N + My + Mz interaction', checks.conservativeInteraction?.enabled ? axisValue(checks.conservativeInteraction?.ir, '', 3) : 'Off'],
      ['Overall status', result.status || '-']
    ]
  };
}

function formatSectionRows(props = {}) {
  const rows = [
    ['A', props.A_mm2 ?? props.area, 'mm2'],
    ['Iy', props.Iy_mm4 ?? props.inertiaY, 'mm4'],
    ['Iz', props.Iz_mm4, 'mm4'],
    ['Wel,y', props.Wel_y_mm3, 'mm3'],
    ['Wel,z', props.Wel_z_mm3, 'mm3'],
    ['Wpl,y', props.Wpl_y_mm3, 'mm3'],
    ['Wpl,z', props.Wpl_z_mm3, 'mm3'],
    ['Av,z', props.Avz_mm2, 'mm2'],
    ['Mass', props.mass_kg_m, 'kg/m'],
    ['Classification', props.classification, '']
  ];
  const g = props.dimensions || {};
  [
    ['h', g.h_mm, 'mm'],
    ['b', g.b_mm, 'mm'],
    ['tw', g.tw_mm, 'mm'],
    ['tf', g.tf_mm, 'mm'],
    ['t', g.t_mm, 'mm'],
    ['r', g.r_mm, 'mm']
  ].forEach((row) => rows.push(row));
  return rows.map(([name, value, unit]) => [name, value === null || value === undefined || value === 0 && name !== 't' ? '-' : round(value, 3), unit]);
}

function formatLoadRows(result = {}) {
  const raw = result.loads?.raw || { udls: [], points: [] };
  const udls = (raw.udls || []).map((u) => [
    u.label || 'UDL',
    'UDL',
    `${round(u.x1, 3)} to ${round(u.x2, 3)} m`,
    `G ${round(u.G, 3)}, Q1 ${round(u.Q1, 3)}, Q2 ${round(u.Q2, 3)}${u.isSelf ? ' (self weight)' : ''}`
  ]);
  const points = (raw.points || []).map((p) => [
    p.label || 'Point',
    Math.abs(Number(p.M || 0)) > 1e-12 ? 'Moment' : 'Point load',
    `${round(p.x, 3)} m`,
    `G ${round(p.G, 3)}, Q1 ${round(p.Q1, 3)}, Q2 ${round(p.Q2, 3)}${Math.abs(Number(p.M || 0)) > 1e-12 ? `, M ${round(p.M, 3)}` : ''}`
  ]);
  return [...udls, ...points];
}

function buildReportModel(input = {}, result = {}, suppliedMetadata = {}) {
  input = input || {};
  result = result || {};
  const meta = mergeMetadata(input, suppliedMetadata);
  const governing = inferGoverningCheck(result);
  const source = result.source || result.sectionProperties?.sourceReference || {};
  const packageData = result.calculationPackage || {
    designCode: meta.designCode,
    nationalAnnex: meta.nationalAnnex,
    assumptions: ['Calculation package objects were not available in this saved result. Recalculate to populate detailed hand calculations.'],
    revisionHistory: [],
    warnings: [],
    calculations: []
  };
  const warnings = [
    ...(packageData.warnings || []),
    ...(result.sectionProperties?.dimensions?.warnings || []),
    !meta.companyLogoUrl || meta.companyLogoUrl === '-' ? 'Company logo not supplied in project metadata.' : null,
    !source.title || source.title === 'Source to be confirmed' ? 'Section data source to be confirmed.' : null
  ].filter(Boolean);
  const series = result.diagrams?.series || [];
  return {
    meta,
    result,
    packageData,
    governing,
    source,
    warnings: [...new Set(warnings)],
    sectionSvg: buildSectionSvg(result.sectionProperties || {}),
    loadingSvg: buildLoadingSvg(input, result),
    graphs: {
      shear: buildGraphSvg(series, 'shear', 'Shear Force Diagram', result.summary?.forceUnit || 'kN', '#dc2626'),
      moment: buildGraphSvg(series, 'moment', 'Bending Moment Diagram', result.summary?.momentUnit || 'kN m', '#155eef'),
      deflection: buildGraphSvg(series, 'deflection', 'Deflection Diagram', 'mm', '#15803d'),
      utilisation: buildUtilisationSvg(result)
    },
    checksRows: formatCheckRows(result),
    sectionRows: formatSectionRows(result.sectionProperties || {}),
    loadRows: formatLoadRows(result),
    directionOverview: formatDirectionOverviewRows(result)
  };
}

function calculationHtml(calc) {
  const variables = calc.variables?.length
    ? rowsToHtml(['Symbol', 'Value'], calc.variables.map((row) => [row.symbol, row.value]), 'compact')
    : '<p class="muted">No variables recorded.</p>';
  const derivations = calc.derivations?.length
    ? rowsToHtml(
      ['Variable', 'How it is derived', 'Formula', 'Substitution', 'Result', 'Source'],
      calc.derivations.map((row) => [row.symbol, row.description, row.formula, row.substitution, row.result, row.source || '-']),
      'compact derivations'
    )
    : '';
  const warnings = calc.warnings?.length
    ? `<div class="warning-box">${calc.warnings.map((warning) => `<p>${escHtml(warning)}</p>`).join('')}</div>`
    : '';
  return `<article class="calc-block">
    <div class="calc-head">
      <h3>${escHtml(calc.title)}</h3>
      <span class="status-pill ${escAttr(String(calc.status || 'INFO').toLowerCase())}">${escHtml(calc.status || 'INFO')}</span>
    </div>
    <p class="code-ref">${escHtml(calc.codeReference || 'Reference to be confirmed')}</p>
    <div class="equation">${escHtml(calc.equation || '-')}</div>
    ${variables}
    ${derivations ? `<h4>Variable derivation</h4>${derivations}` : ''}
    <dl class="calc-steps">
      <dt>Numerical substitution</dt><dd>${escHtml(calc.substitution || '-')}</dd>
      <dt>Unit conversion</dt><dd>${escHtml(calc.unitConversion || '-')}</dd>
      <dt>Result</dt><dd>${escHtml(calc.result || '-')}</dd>
      <dt>Resistance</dt><dd>${escHtml(calc.resistance || '-')}</dd>
      <dt>Utilisation</dt><dd>${escHtml(calc.utilisation || '-')}</dd>
    </dl>
    ${warnings}
  </article>`;
}

function buildReportHtml(input = {}, result = {}, suppliedMetadata = {}) {
  input = input || {};
  result = result || {};
  const model = buildReportModel(input, result, suppliedMetadata);
  const { meta, packageData, source, governing } = model;
  const support = result.inputEcho?.supportLabel || result.inputEcho?.supportType || input.model?.supportType || '-';
  const sectionName = [result.inputEcho?.section?.family, result.inputEcho?.section?.name].filter(Boolean).join(' ') || '-';
  const material = result.inputEcho?.material || input.material?.grade || '-';
  const paper = meta.paperSize === 'Letter' ? 'Letter' : meta.paperSize;
  const execRows = [
    ['Overall status', result.status || '-'],
    ['Governing utilisation ratio', round(result.summary?.governingIR, 5)],
    ['Governing design check', `${governing.title} (${round(governing.ir, 5)})`],
    ['Beam section', sectionName],
    ['Steel grade', material],
    ['Span', `${round(result.inputEcho?.span || input.model?.span, 3)} m`],
    ['Support condition', support],
    ['Maximum moment', `${round(result.summary?.maxMoment, 5)} ${result.summary?.momentUnit || ''}`],
    ['Maximum shear', `${round(result.summary?.maxShear, 5)} ${result.summary?.forceUnit || ''}`],
    ['Maximum axial load', `${round(result.checks?.axial?.axialEd, 5)} ${result.summary?.forceUnit || ''}`],
    ['Maximum deflection', `${round(result.summary?.deflection, 5)} mm`]
  ];
  const projectRows = [
    ['Company', meta.companyName],
    ['Client', meta.clientName],
    ['Project', meta.projectName],
    ['Job/reference', meta.jobReference],
    ['Calculation title', meta.calculationTitle],
    ['Beam/member mark', meta.beamMark],
    ['Revision', meta.revision],
    ['Revision description', meta.revisionDescription],
    ['Prepared by', meta.engineerName],
    ['Checked by', meta.checkedBy],
    ['Approved by', meta.approvedBy],
    ['Date', meta.date],
    ['Software version', meta.softwareVersion],
    ['Design code', packageData.designCode || meta.designCode],
    ['National Annex', packageData.nationalAnnex || meta.nationalAnnex]
  ];
  const revisionRows = (packageData.revisionHistory || []).map((row) => [
    row.revision || '-',
    row.date || '-',
    row.description || '-',
    row.preparedBy || '-',
    row.checkedBy || '-',
    row.approvedBy || '-'
  ]);
  const references = [
    ['Section database', source.title || 'Source to be confirmed', source.reference || source.url || 'Source to be confirmed'],
    ['Material database', 'Server material library', `Grade ${material}; project design code ${meta.designCode}`],
    ['Design standard', packageData.designCode || meta.designCode, packageData.nationalAnnex || meta.nationalAnnex],
    ['Load combinations', result.inputEcho?.combination || '-', result.loads?.combinations?.uls || '-']
  ];
  const assumptions = (packageData.assumptions || []).map((item) => [item]);
  const calculations = (packageData.calculations || []).map(calculationHtml).join('');
  const warningBlock = model.warnings.length
    ? `<div class="warning-box">${model.warnings.map((warning) => `<p>${escHtml(warning)}</p>`).join('')}</div>`
    : '<p>No report warnings recorded.</p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(meta.projectName)} - ${escHtml(meta.calculationTitle)}</title>
  <style>
    @page { size: ${paper}; margin: 16mm 14mm 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #0f172a; background: #f8fafc; font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.38; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; }
    header.report-header, footer.report-footer { position: fixed; left: 14mm; right: 14mm; color: #475569; font-size: 8.5pt; }
    header.report-header { top: 6mm; display: flex; justify-content: space-between; border-bottom: 1px solid #cbd5e1; padding-bottom: 3mm; }
    footer.report-footer { bottom: 6mm; display: flex; justify-content: space-between; border-top: 1px solid #cbd5e1; padding-top: 3mm; }
    .page { min-height: 100vh; padding: 20mm 12mm 16mm; page-break-after: always; background: #fff; }
    .page:last-child { page-break-after: auto; }
    .title-page { display: grid; gap: 12mm; align-content: start; }
    .title-block { border: 2px solid #0f172a; display: grid; grid-template-columns: 180px 1fr; }
    .logo-cell { border-right: 2px solid #0f172a; padding: 8mm; display: grid; place-items: center; min-height: 120px; }
    .logo-cell img { max-width: 145px; max-height: 88px; object-fit: contain; }
    .logo-placeholder { width: 116px; height: 72px; border: 2px solid #334155; display: grid; place-items: center; font-weight: 700; color: #334155; }
    .title-main { padding: 8mm; }
    h1 { margin: 0 0 5mm; font-size: 22pt; letter-spacing: 0; }
    h2 { margin: 0 0 4mm; font-size: 16pt; color: #0f172a; border-bottom: 2px solid #1e3a8a; padding-bottom: 2mm; }
    h3 { margin: 0; font-size: 12pt; }
    .muted, .code-ref { color: #475569; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; align-items: start; }
    .graphics-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 5mm; }
    .status-banner { padding: 5mm; border: 2px solid #15803d; background: #f0fdf4; font-size: 16pt; font-weight: 700; text-align: center; }
    .status-banner.fail { border-color: #dc2626; background: #fef2f2; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 5mm; table-layout: fixed; }
    th, td { border: 1px solid #cbd5e1; padding: 2.4mm 2.6mm; vertical-align: top; word-wrap: break-word; }
    th { background: #e2e8f0; color: #0f172a; font-weight: 700; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    .compact th, .compact td { padding: 1.8mm 2mm; font-size: 9.5pt; }
    .figure { margin: 0 0 6mm; page-break-inside: avoid; }
    .figure svg { display: block; width: 100%; height: auto; }
    .caption { margin-top: 1.5mm; color: #475569; font-size: 9pt; }
    .calc-block { border: 1px solid #cbd5e1; padding: 4mm; margin: 0 0 5mm; page-break-inside: avoid; }
    .calc-head { display: flex; justify-content: space-between; gap: 4mm; align-items: center; margin-bottom: 1.5mm; }
    .calc-block h4 { margin: 3mm 0 1.5mm; font-size: 9.5pt; color: #1e3a8a; }
    .status-pill { display: inline-block; min-width: 62px; text-align: center; border: 1px solid #64748b; padding: 1mm 2mm; font-size: 8.5pt; font-weight: 700; }
    .status-pill.pass { color: #166534; border-color: #15803d; background: #f0fdf4; }
    .status-pill.fail { color: #991b1b; border-color: #dc2626; background: #fef2f2; }
    .status-pill.warning { color: #92400e; border-color: #b45309; background: #fffbeb; }
    .equation { font-family: "Courier New", monospace; background: #f8fafc; border: 1px solid #cbd5e1; padding: 2.5mm; margin: 2mm 0; }
    .derivations th, .derivations td { font-size: 8.5pt; padding: 1.3mm 1.6mm; }
    .calc-steps { display: grid; grid-template-columns: 38mm 1fr; gap: 1mm 3mm; margin: 3mm 0 0; }
    .calc-steps dt { font-weight: 700; color: #334155; }
    .calc-steps dd { margin: 0; }
    .warning-box { border: 1px solid #b45309; background: #fffbeb; padding: 3mm; margin: 3mm 0 5mm; }
    .warning-box p { margin: 0 0 1.5mm; }
    .warning-box p:last-child { margin-bottom: 0; }
    .signature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; margin-top: 10mm; }
    .signature { border: 1px solid #94a3b8; height: 30mm; padding: 3mm; }
    @media print {
      body { background: #fff; }
      main { max-width: none; }
      .page { min-height: auto; }
      a { color: inherit; text-decoration: none; }
    }
    @media screen {
      body { padding: 18px; }
      main { box-shadow: 0 18px 60px rgba(15,23,42,.18); }
      .page { min-height: 1120px; border-bottom: 12px solid #e2e8f0; }
    }
  </style>
</head>
<body>
  <header class="report-header">
    <span>${escHtml(meta.projectName)} / ${escHtml(meta.calculationTitle)}</span>
    <span>Revision ${escHtml(meta.revision)} / ${escHtml(meta.date)}</span>
  </header>
  <footer class="report-footer">
    <span>${escHtml(meta.companyName)}</span>
    <span>Page <span class="page-number"></span></span>
  </footer>
  <main>
    <section class="page title-page">
      <div class="title-block">
        <div class="logo-cell">${makeLogo(meta)}</div>
        <div class="title-main">
          <h1>${escHtml(meta.calculationTitle)}</h1>
          ${definitionTableHtml(projectRows)}
        </div>
      </div>
      <div class="status-banner ${String(result.status).toLowerCase() === 'fail' ? 'fail' : ''}">Overall ${escHtml(result.status || '-')} - Governing IR ${escHtml(round(result.summary?.governingIR, 5))}</div>
      <div class="grid-2">
        <div>
          <h2>Executive Summary</h2>
          ${definitionTableHtml(execRows)}
        </div>
        <div>
          <h2>Warnings</h2>
          ${warningBlock}
        </div>
      </div>
      <h2>Direction-Based Design Overview</h2>
      <p class="muted">${escHtml(model.directionOverview.convention)}</p>
      <div class="grid-2">
        <div>
          <h3>Z-direction loading - strong-axis bending My / shear Vz</h3>
          ${definitionTableHtml(model.directionOverview.zRows, 'compact')}
        </div>
        <div>
          <h3>Y-direction loading - weak-axis bending Mz / shear Vy</h3>
          ${definitionTableHtml(model.directionOverview.yRows, 'compact')}
        </div>
      </div>
      <h3>Combined / governing overview</h3>
      ${definitionTableHtml(model.directionOverview.combinedRows, 'compact')}
    </section>

    <section class="page">
      <h2>Input Data</h2>
      ${definitionTableHtml([
        ['Section', sectionName],
        ['Material', material],
        ['Support condition', support],
        ['Span', `${round(result.inputEcho?.span || input.model?.span, 3)} m`],
        ['Effective lengths', `LTB/restraint assumptions recorded in calculation checks; member span ${round(result.inputEcho?.span || input.model?.span, 3)} m.`],
        ['Load combination', result.inputEcho?.combination || '-'],
        ['Self weight', (result.loads?.raw?.udls || []).some((u) => u.isSelf) ? 'Included' : 'Not included'],
        ['LTB assumptions', packageData.assumptions?.find((item) => item.includes('LTB')) || '-'],
        ['Design assumptions', packageData.assumptions?.join(' ') || '-'],
        ['Notes/comments', meta.notes]
      ])}
      <h2>Load Data</h2>
      ${rowsToHtml(['Load', 'Type', 'Position', 'Magnitude'], model.loadRows.length ? model.loadRows : [['-', '-', '-', '-']])}
      <div class="figure">${model.loadingSvg}<p class="caption">Figure 1. Loading diagram with supports, dimensions, input load components and ULS reactions.</p></div>
    </section>

    <section class="page">
      <h2>Beam Section Data</h2>
      <div class="grid-2">
        <div class="figure">${model.sectionSvg}<p class="caption">Figure 2. Section profile generated from stored section geometry. Derived dimensions are flagged in warnings.</p></div>
        <div>
          ${rowsToHtml(['Property', 'Value', 'Unit'], model.sectionRows)}
        </div>
      </div>
      <h2>Source / Index Reference</h2>
      ${definitionTableHtml([
        ['Source name', source.title || 'Source to be confirmed'],
        ['Standard/catalogue/reference', source.reference || source.url || 'Source to be confirmed'],
        ['Region', source.region || 'Source to be confirmed'],
        ['Version/date', source.edition || source.date || 'Source to be confirmed'],
        ['Section types', result.inputEcho?.section?.family || 'Source to be confirmed'],
        ['Assumptions/limitations', source.detail || 'Source to be confirmed']
      ])}
    </section>

    <section class="page">
      <h2>Structural Graphs</h2>
      <div class="graphics-grid">
        <div class="figure">${model.graphs.shear}<p class="caption">Figure 3. Shear force diagram.</p></div>
        <div class="figure">${model.graphs.moment}<p class="caption">Figure 4. Bending moment diagram.</p></div>
        <div class="figure">${model.graphs.deflection}<p class="caption">Figure 5. Deflection diagram.</p></div>
        <div class="figure">${model.graphs.utilisation}<p class="caption">Figure 6. Utilisation diagram for active checks.</p></div>
      </div>
    </section>

    <section class="page">
      <h2>Engineering Calculations</h2>
      ${calculations || '<p>No detailed calculation objects were recorded. Recalculate the project to regenerate the report package.</p>'}
    </section>

    <section class="page">
      <h2>Pass / Fail Checks</h2>
      ${rowsToHtml(['Check', 'IR', 'Status', 'Detail'], model.checksRows.length ? model.checksRows : [['-', '-', '-', '-']])}
      <h2>Assumptions</h2>
      ${rowsToHtml(['Assumption'], assumptions.length ? assumptions : [['-']])}
      <h2>Revision History</h2>
      ${rowsToHtml(['Revision', 'Date', 'Description', 'Prepared by', 'Checked by', 'Approved by'], revisionRows.length ? revisionRows : [[meta.revision, meta.date, meta.revisionDescription, meta.engineerName, meta.checkedBy, meta.approvedBy]])}
      <h2>References</h2>
      ${rowsToHtml(['Reference type', 'Source', 'Details'], references)}
    </section>

    <section class="page">
      <h2>Appendix A - Section Property Table</h2>
      ${rowsToHtml(['Property', 'Value', 'Unit'], model.sectionRows)}
      <h2>Appendix B - Load and Combination Tables</h2>
      ${rowsToHtml(['Load', 'Type', 'Position', 'Magnitude'], model.loadRows.length ? model.loadRows : [['-', '-', '-', '-']])}
      ${definitionTableHtml([
        ['ULS combination', result.loads?.combinations?.uls || result.actions?.ulsNote || '-'],
        ['SLS combination', result.loads?.combinations?.sls || result.actions?.slsNote || '-']
      ])}
      <h2>Final Summary</h2>
      ${definitionTableHtml([
        ['Overall status', result.status || '-'],
        ['Governing utilisation', round(result.summary?.governingIR, 5)],
        ['Critical design check', governing.title],
        ['Warnings', model.warnings.length ? model.warnings.join('; ') : 'None'],
        ['Engineer comments', meta.notes],
        ['Checker comments', '-']
      ])}
      <div class="signature-grid">
        <div class="signature"><strong>Prepared by</strong><br>${escHtml(meta.engineerName)}</div>
        <div class="signature"><strong>Checked by</strong><br>${escHtml(meta.checkedBy)}</div>
        <div class="signature"><strong>Approved by</strong><br>${escHtml(meta.approvedBy)}</div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function calculationLatex(calc) {
  const variables = (calc.variables || []).map((row) => `${escLatex(row.symbol)} & ${escLatex(row.value)} \\\\`).join('\n');
  const derivations = (calc.derivations || []).map((row) => [
    row.symbol,
    row.description,
    row.formula,
    row.substitution,
    row.result,
    row.source || '-'
  ].map(escLatex).join(' & ') + ' \\\\').join('\n');
  const warnings = (calc.warnings || []).length ? `\\textbf{Warnings:} ${escLatex(calc.warnings.join('; '))}\n` : '';
  return `\\subsection{${escLatex(calc.title)}}
\\textbf{Code reference:} ${escLatex(calc.codeReference || 'Reference to be confirmed')}\\\\
\\textbf{Status:} ${escLatex(calc.status || 'INFO')}

\\[
${escLatex(calc.equation || '-')}
\\]

\\begin{longtable}{p{0.28\\linewidth}p{0.62\\linewidth}}
\\textbf{Variable} & \\textbf{Value} \\\\
${variables || '- & - \\\\'}
\\end{longtable}

\\textbf{Variable derivation trail}
\\begin{longtable}{p{0.12\\linewidth}p{0.21\\linewidth}p{0.20\\linewidth}p{0.20\\linewidth}p{0.13\\linewidth}p{0.10\\linewidth}}
\\textbf{Variable} & \\textbf{Derived from} & \\textbf{Formula} & \\textbf{Substitution} & \\textbf{Result} & \\textbf{Source} \\\\
${derivations || '- & - & - & - & - & - \\\\'}
\\end{longtable}

\\textbf{Numerical substitution:} ${escLatex(calc.substitution || '-')}\\\\
\\textbf{Unit conversion:} ${escLatex(calc.unitConversion || '-')}\\\\
\\textbf{Result:} ${escLatex(calc.result || '-')}\\\\
\\textbf{Resistance:} ${escLatex(calc.resistance || '-')}\\\\
\\textbf{Utilisation:} ${escLatex(calc.utilisation || '-')}\\\\
${warnings}
`;
}

function buildLatexReport(input = {}, result = {}, suppliedMetadata = {}) {
  input = input || {};
  result = result || {};
  const model = buildReportModel(input, result, suppliedMetadata);
  const { meta, packageData, source, governing } = model;
  const sectionName = [result.inputEcho?.section?.family, result.inputEcho?.section?.name].filter(Boolean).join(' ') || '-';
  const execRows = [
    ['Overall status', result.status || '-'],
    ['Governing utilisation ratio', round(result.summary?.governingIR, 5)],
    ['Governing design check', governing.title],
    ['Beam section', sectionName],
    ['Steel grade', result.inputEcho?.material || '-'],
    ['Span', `${round(result.inputEcho?.span || input.model?.span, 3)} m`],
    ['Maximum moment', `${round(result.summary?.maxMoment, 5)} ${result.summary?.momentUnit || ''}`],
    ['Maximum shear', `${round(result.summary?.maxShear, 5)} ${result.summary?.forceUnit || ''}`],
    ['Maximum deflection', `${round(result.summary?.deflection, 5)} mm`]
  ];
  const tableRows = (rows) => rows.map((row) => `${escLatex(row[0])} & ${escLatex(row[1])} \\\\`).join('\n');
  const zDirectionRows = tableRows(model.directionOverview.zRows);
  const yDirectionRows = tableRows(model.directionOverview.yRows);
  const combinedDirectionRows = tableRows(model.directionOverview.combinedRows);
  const sectionRows = model.sectionRows.map((row) => `${escLatex(row[0])} & ${escLatex(row[1])} & ${escLatex(row[2])} \\\\`).join('\n');
  const checkRows = model.checksRows.map((row) => `${escLatex(row[0])} & ${escLatex(row[1])} & ${escLatex(row[2])} & ${escLatex(row[3])} \\\\`).join('\n');
  return `\\documentclass[11pt,a4paper]{article}
\\usepackage[margin=18mm]{geometry}
\\usepackage{longtable}
\\usepackage{array}
\\usepackage{xcolor}
\\usepackage{fancyhdr}
\\pagestyle{fancy}
\\fancyhf{}
\\lhead{${escLatex(meta.projectName)}}
\\rhead{Revision ${escLatex(meta.revision)}}
\\cfoot{\\thepage}
\\begin{document}

\\begin{titlepage}
\\centering
{\\Large ${escLatex(meta.companyName)}\\\\[6mm]}
{\\LARGE\\bfseries ${escLatex(meta.calculationTitle)}\\\\[6mm]}
{\\large ${escLatex(meta.projectName)}\\\\[3mm]}
\\begin{longtable}{p{0.35\\linewidth}p{0.55\\linewidth}}
Client & ${escLatex(meta.clientName)} \\\\
Job/reference & ${escLatex(meta.jobReference)} \\\\
Beam/member mark & ${escLatex(meta.beamMark)} \\\\
Revision & ${escLatex(meta.revision)} \\\\
Revision description & ${escLatex(meta.revisionDescription)} \\\\
Prepared by & ${escLatex(meta.engineerName)} \\\\
Checked by & ${escLatex(meta.checkedBy)} \\\\
Approved by & ${escLatex(meta.approvedBy)} \\\\
Date & ${escLatex(meta.date)} \\\\
Software version & ${escLatex(meta.softwareVersion)} \\\\
Design code & ${escLatex(packageData.designCode || meta.designCode)} \\\\
National Annex & ${escLatex(packageData.nationalAnnex || meta.nationalAnnex)} \\\\
\\end{longtable}
\\vfill
{\\Huge\\bfseries Overall ${escLatex(result.status || '-')}\\\\[3mm]}
{\\Large Governing IR ${escLatex(round(result.summary?.governingIR, 5))}}
\\end{titlepage}

\\section{Executive Summary}
\\begin{longtable}{p{0.38\\linewidth}p{0.52\\linewidth}}
\\textbf{Item} & \\textbf{Value} \\\\
${tableRows(execRows)}
\\end{longtable}

\\section{Axis Convention and Direction Overview}
${escLatex(model.directionOverview.convention)}

\\subsection{Z-direction loading -- strong-axis bending My / shear Vz}
\\begin{longtable}{p{0.38\\linewidth}p{0.52\\linewidth}}
\\textbf{Item} & \\textbf{Value} \\\\
${zDirectionRows}
\\end{longtable}

\\subsection{Y-direction loading -- weak-axis bending Mz / shear Vy}
\\begin{longtable}{p{0.38\\linewidth}p{0.52\\linewidth}}
\\textbf{Item} & \\textbf{Value} \\\\
${yDirectionRows}
\\end{longtable}

\\subsection{Combined / governing overview}
\\begin{longtable}{p{0.38\\linewidth}p{0.52\\linewidth}}
\\textbf{Item} & \\textbf{Value} \\\\
${combinedDirectionRows}
\\end{longtable}

\\section{Input Data}
\\begin{longtable}{p{0.38\\linewidth}p{0.52\\linewidth}}
Section & ${escLatex(sectionName)} \\\\
Material & ${escLatex(result.inputEcho?.material || '-')} \\\\
Support condition & ${escLatex(result.inputEcho?.supportLabel || '-')} \\\\
Load combination & ${escLatex(result.inputEcho?.combination || '-')} \\\\
Notes/comments & ${escLatex(meta.notes)} \\\\
\\end{longtable}

\\section{Section Properties}
\\begin{longtable}{p{0.30\\linewidth}p{0.30\\linewidth}p{0.20\\linewidth}}
\\textbf{Property} & \\textbf{Value} & \\textbf{Unit} \\\\
${sectionRows}
\\end{longtable}

\\section{Engineering Calculations}
${(packageData.calculations || []).map(calculationLatex).join('\n')}

\\section{Pass Fail Checks}
\\begin{longtable}{p{0.24\\linewidth}p{0.15\\linewidth}p{0.15\\linewidth}p{0.36\\linewidth}}
\\textbf{Check} & \\textbf{IR} & \\textbf{Status} & \\textbf{Detail} \\\\
${checkRows}
\\end{longtable}

\\section{Assumptions}
\\begin{itemize}
${(packageData.assumptions || []).map((item) => `\\item ${escLatex(item)}`).join('\n')}
\\end{itemize}

\\section{References}
\\begin{longtable}{p{0.28\\linewidth}p{0.62\\linewidth}}
Section database & ${escLatex(source.title || 'Source to be confirmed')} - ${escLatex(source.reference || source.url || 'Source to be confirmed')} \\\\
Design standard & ${escLatex(packageData.designCode || meta.designCode)} / ${escLatex(packageData.nationalAnnex || meta.nationalAnnex)} \\\\
Material database & ${escLatex(result.inputEcho?.material || '-')} from server material library \\\\
\\end{longtable}

\\section{Final Summary}
Overall ${escLatex(result.status || '-')} with governing utilisation ${escLatex(round(result.summary?.governingIR, 5))}. Critical design check: ${escLatex(governing.title)}.

\\end{document}
`;
}

function buildPdfBuffer(pages) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  const kids = [];
  pages.forEach((lines, index) => {
    const pageObj = objects.length + 1;
    const fontObj = 3;
    const contentObj = pageObj + 1;
    kids.push(`${pageObj} 0 R`);
    const content = [
      'BT',
      '/F1 10 Tf',
      '42 800 Td',
      ...lines.slice(0, 48).flatMap((line, lineIndex) => [
        lineIndex === 0 ? '' : '0 -15 Td',
        `(${escPdf(line).slice(0, 115)}) Tj`
      ]).filter(Boolean),
      'ET'
    ].join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentObj} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function pdfColour(hex) {
  const value = String(hex || '#000000').replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return `${roundPdf(r)} ${roundPdf(g)} ${roundPdf(b)}`;
}

function roundPdf(value) {
  return Number(value || 0).toFixed(3).replace(/\.?0+$/, '') || '0';
}

function pdfLiteral(value) {
  return String(value ?? '').replace(/[\\()]/g, '\\$&').replace(/\r?\n/g, ' ');
}

function cleanEngineeringText(value, fallback = '-') {
  let text = String(value ?? '').trim();
  if (!text) return fallback;
  return text
    .replace(/Ï‡/g, 'chi')
    .replace(/Î³/g, 'gamma')
    .replace(/Î´/g, 'delta')
    .replace(/Î”/g, 'Delta')
    .replace(/Î»/g, 'lambda')
    .replace(/χ/g, 'chi')
    .replace(/γ/g, 'gamma')
    .replace(/δ/g, 'delta')
    .replace(/Δ/g, 'Delta')
    .replace(/λ/g, 'lambda')
    .replace(/â‰¤/g, '<=')
    .replace(/â‰¥/g, '>=')
    .replace(/Ã—/g, 'x')
    .replace(/IR_NM/g, 'N+M utilisation')
    .replace(/IR_LT/g, 'LTB utilisation')
    .replace(/delta_IR/g, 'delta utilisation')
    .replace(/delta_max/g, 'delta max')
    .replace(/delta_allow/g, 'Delta allow')
    .replace(/gammaM0/g, 'gammaM0')
    .replace(/gammaM1/g, 'gammaM1')
    .replace(/chiLT/g, 'chiLT')
    .replace(/lambdaLT/g, 'lambdaLT')
    .replace(/My,Ed/g, 'MEd,y')
    .replace(/My,Rd/g, 'MRd,y')
    .replace(/Mz,Ed/g, 'MEd,z')
    .replace(/Vz,Ed/g, 'VEd,z')
    .replace(/Vz,Rd/g, 'VRd,z')
    .replace(/NEd/g, 'NEd')
    .replace(/NRd/g, 'NRd')
    .replace(/Nb,y,Rd/g, 'Nb,Rd,y')
    .replace(/Nb,z,Rd/g, 'Nb,Rd,z')
    .replace(/dzMax/g, 'Delta max')
    .replace(/dz/g, 'delta')
    .replace(/_/g, '')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
}

function extractRatio(value) {
  const n = finite(value);
  if (n !== null) return n;
  const matches = String(value ?? '').match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!matches || !matches.length) return null;
  return finite(matches[matches.length - 1]);
}

function formatPercent(value) {
  const ratio = extractRatio(value);
  if (ratio === null) return '-';
  const percent = ratio * 100;
  const dp = Math.abs(percent) < 10 && Math.abs(percent) > 0 ? 1 : 0;
  return `${round(percent, dp)} %`;
}

function pdfStatus(pass) {
  if (pass === true || String(pass).toUpperCase() === 'PASS') return 'PASS';
  if (pass === false || String(pass).toUpperCase() === 'FAIL') return 'FAIL';
  return cleanEngineeringText(pass || 'INFO');
}

function checkStatusFromRow(row = {}) {
  if (row.pass === true) return 'PASS';
  if (row.pass === false) return 'FAIL';
  if (row.available === false) return 'NOTE';
  return 'INFO';
}

function getCheckClause(text) {
  const match = String(text || '').match(/Ch\s+([0-9.]+)/i);
  return match ? `EN 1993-1-1 ${match[1]}` : '-';
}

function pdfTextWidth(text, size = 9, bold = false) {
  return String(text ?? '').length * size * (bold ? 0.58 : 0.52);
}

function wrapPdfText(value, maxWidth, size = 9, bold = false) {
  const text = cleanEngineeringText(value);
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (pdfTextWidth(test, size, bold) <= maxWidth || !line) {
      line = test;
    } else {
      lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : ['-'];
}

function pdfRichSegments(text) {
  return [{ font: 'F1', text: pdfSafeText(cleanEngineeringText(text)) }];
}

function buildPdfFromOperations(pages) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
  ];
  const kids = [];
  pages.forEach((content) => {
    const pageObj = objects.length + 1;
    const contentObj = pageObj + 1;
    kids.push(`${pageObj} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function buildHandCalculationRows(input = {}, result = {}, model = {}) {
  const checks = result.checks || {};
  const summary = result.summary || {};
  const forceUnit = summary.forceUnit || result.loads?.units?.force || 'kN';
  const momentUnit = summary.momentUnit || result.loads?.units?.moment || 'kN m';
  const sectionName = [result.inputEcho?.section?.family, result.inputEcho?.section?.name].filter(Boolean).join(' ') || '-';
  const support = result.inputEcho?.supportLabel || input.model?.supportType || '-';
  const status = (check) => checkStatusFromRow(check);
  const summaryRows = [
    ['Shear', `${round(checks.shear?.resistance, 2)} ${forceUnit}`, `${round(summary.maxShear, 2)} ${forceUnit}`, formatPercent(checks.shear?.ir), status(checks.shear)],
    ['Bending moment', `${round(checks.moment?.resistance, 2)} ${momentUnit}`, `${round(summary.maxMoment, 2)} ${momentUnit}`, formatPercent(checks.moment?.ir), status(checks.moment)],
    ['Total deflection', `${round(summary.deflectionLimit, 2)} mm`, `${round(summary.deflection, 2)} mm`, formatPercent(checks.deflection?.ir), status(checks.deflection)]
  ];
  if (Math.abs(Number(checks.axial?.axialEd || 0)) > 1e-9) {
    summaryRows.splice(2, 0, ['Axial force', '-', `${round(checks.axial?.axialEd, 2)} ${forceUnit}`, formatPercent(checks.axial?.ir), status(checks.axial)]);
  }
  if (checks.ltb?.enabled) {
    if (checks.ltb.available === false) {
      summaryRows.push(['Buckling / LTB', 'Short note', checks.ltb.message || 'Not available for this case', '-', 'NOTE']);
    } else {
      summaryRows.push(['Buckling / LTB', 'See Eurocode check', `${round(summary.maxMoment, 2)} ${momentUnit}`, formatPercent(checks.ltb?.ir), status(checks.ltb)]);
    }
  }
  if (checks.memberBuckling?.active) {
    if (checks.memberBuckling.available === false) {
      summaryRows.push(['Member buckling', 'Short note', checks.memberBuckling.message || 'Not available for this case', '-', 'NOTE']);
    } else {
      summaryRows.push(['Member buckling', 'See Eurocode check', `${round(checks.axial?.axialEd, 2)} ${forceUnit}`, formatPercent(checks.memberBuckling?.ir), status(checks.memberBuckling)]);
    }
  }
  return {
    summaryRows,
    sectionName,
    support,
    spanRows: [
      ['Effective span L', `${round(result.inputEcho?.span || input.model?.span, 3)} m`],
      ['Support condition', support],
      ['Deflection limit', `L/${round(input.settings?.deflectionLimit || (summary.deflectionLimit ? (Number(result.inputEcho?.span || input.model?.span || 0) * 1000 / Number(summary.deflectionLimit)) : 0), 0)}`],
      ['Steel grade', result.inputEcho?.material || input.material?.grade || '-'],
      ['Design code', model.packageData?.designCode || model.meta?.designCode || '-'],
      ['National Annex', model.packageData?.nationalAnnex || model.meta?.nationalAnnex || '-'],
      ['gammaM0', round(input.settings?.gammaM0, 2)],
      ['gammaM1', round(input.settings?.gammaM1, 2)],
      ['Self weight', input.model?.includeSelfWeight === false ? 'Excluded' : 'Included as full-span permanent UDL']
    ],
    reactionRows: (result.actions?.reactions || []).map((r) => [
      `Support ${r.support}`,
      `${round(r.x, 3)} m`,
      `${round(r.vertical, 3)} ${forceUnit}`,
      `${round(r.moment, 3)} ${momentUnit}`
    ])
  };
}

function buildPdfLoadRows(input = {}, result = {}) {
  const loads = input.loads || {};
  const rows = [];
  const seenTraps = new Set();
  const activeValues = (load) => ['G', 'Q1', 'Q2'].filter((key) => Math.abs(Number(load[key] || 0)) > 1e-12).map((key) => `${key}=${round(load[key], 3)}`).join(', ');

  (loads.udls || []).forEach((load, index) => {
    if (load.sourceType === 'trap') {
      const id = load.reportLabel || String(load.label || `T${index + 1}`).split('.')[0];
      const key = `${id}-${load.loadCase || 'G'}-${load.reportX1 ?? load.x1}-${load.reportX2 ?? load.x2}`;
      if (seenTraps.has(key)) return;
      seenTraps.add(key);
      rows.push([
        id,
        'Trapezoidal UDL',
        `${load.loadCase || 'G'}: q1=${round(load.q1, 3)} to q2=${round(load.q2, 3)}`,
        `${round(load.reportX1 ?? load.x1, 3)} m`,
        `${round(load.reportX2 ?? load.x2, 3)} m`,
        'Linear crossfall shown in loading sketch'
      ]);
      return;
    }
    if (!activeValues(load)) return;
    rows.push([
      load.label || `U${index + 1}`,
      load.isSelf ? 'Self weight UDL' : 'Uniform UDL',
      activeValues(load),
      `${round(load.x1, 3)} m`,
      `${round(load.x2, 3)} m`,
      load.isSelf ? 'Section self-weight' : '-'
    ]);
  });

  (loads.points || []).forEach((load, index) => {
    const isMoment = Math.abs(Number(load.M || 0)) > 1e-12;
    const values = isMoment
      ? `${load.momentCase || 'G'} ${round(load.M, 3)}`
      : activeValues(load);
    if (!values) return;
    rows.push([
      load.label || (isMoment ? `M${index + 1}` : `P${index + 1}`),
      isMoment ? 'Applied moment' : 'Point load',
      values,
      `${round(load.x, 3)} m`,
      '-',
      '-'
    ]);
  });

  const rawSelfWeight = (result.loads?.raw?.udls || []).find((load) => load.isSelf);
  if (rawSelfWeight && !rows.some((row) => row[1] === 'Self weight UDL')) {
    rows.push([
      rawSelfWeight.label || 'Self-weight',
      'Self weight UDL',
      `G=${round(rawSelfWeight.G, 3)}`,
      `${round(rawSelfWeight.x1, 3)} m`,
      `${round(rawSelfWeight.x2, 3)} m`,
      'Section self-weight'
    ]);
  }

  return rows.length ? rows : [['-', 'No active loads recorded', '-', '-', '-', '-']];
}

function buildPdfCheckRows(result = {}) {
  const rows = [];
  (result.codeCheckControls?.sections || []).forEach((section) => {
    const heading = cleanEngineeringText(section.heading || 'Code check');
    (section.lines || []).forEach((line) => {
      if (line.kind === 'ratio') {
        const expression = `${line.prefix || ''}${line.ratio || '-'}${line.suffix || ''}`;
        rows.push([
          heading.replace(/:$/, ''),
          cleanEngineeringText(expression),
          getCheckClause(line.suffix),
          formatPercent(line.ratio),
          pdfStatus(line.pass)
        ]);
      } else if (line.text) {
        rows.push([
          heading.replace(/:$/, ''),
          cleanEngineeringText(line.text),
          '-',
          '-',
          'NOTE'
        ]);
      }
    });
  });
  return rows.length ? rows : formatCheckRows(result).map((row) => [
    cleanEngineeringText(row[0]),
    cleanEngineeringText(row[3]),
    '-',
    formatPercent(row[1]),
    cleanEngineeringText(row[2])
  ]);
}

function buildPdfLoadSketchItems(input = {}, result = {}) {
  const items = { udls: [], traps: [], points: [], moments: [], axial: [] };
  const span = finite(result.inputEcho?.span) || finite(input.model?.span) || 1;
  const seenTraps = new Set();
  (input.loads?.udls || []).forEach((load, index) => {
    if (load.sourceType === 'trap') {
      const id = load.reportLabel || String(load.label || `T${index + 1}`).split('.')[0];
      const key = `${id}-${load.loadCase || 'G'}-${load.reportX1 ?? load.x1}-${load.reportX2 ?? load.x2}`;
      if (seenTraps.has(key)) return;
      seenTraps.add(key);
      items.traps.push({
        id,
        x1: Number(load.reportX1 ?? load.x1 ?? 0),
        x2: Number(load.reportX2 ?? load.x2 ?? span),
        q1: Number(load.q1 || 0),
        q2: Number(load.q2 || 0),
        loadCase: load.loadCase || 'G'
      });
      return;
    }
    const total = Math.abs(Number(load.G || 0)) + Math.abs(Number(load.Q1 || 0)) + Math.abs(Number(load.Q2 || 0));
    if (!total && !load.isSelf) return;
    items.udls.push({
      id: load.label || `U${index + 1}`,
      x1: Number(load.x1 || 0),
      x2: Number(load.x2 ?? span),
      text: `${load.label || `U${index + 1}`}: ${['G', 'Q1', 'Q2'].filter((key) => Number(load[key] || 0)).map((key) => `${key}=${round(load[key], 2)}`).join(', ') || '0'}`
    });
  });
  (input.loads?.points || []).forEach((load, index) => {
    if (Math.abs(Number(load.M || 0)) > 1e-12) {
      items.moments.push({ id: load.label || `M${index + 1}`, x: Number(load.x || 0), text: `${load.label || `M${index + 1}`}: ${round(load.M, 2)}` });
      return;
    }
    const total = Math.abs(Number(load.G || 0)) + Math.abs(Number(load.Q1 || 0)) + Math.abs(Number(load.Q2 || 0));
    if (!total) return;
    items.points.push({ id: load.label || `P${index + 1}`, x: Number(load.x || 0), text: `${load.label || `P${index + 1}`}: ${['G', 'Q1', 'Q2'].filter((key) => Number(load[key] || 0)).map((key) => `${key}=${round(load[key], 2)}`).join(', ')}` });
  });
  const axial = input.axial || {};
  const axialTotal = Math.abs(Number(axial.G || 0)) + Math.abs(Number(axial.Q1 || 0)) + Math.abs(Number(axial.Q2 || 0));
  if (axialTotal > 1e-12) {
    items.axial.push({ text: `N: ${['G', 'Q1', 'Q2'].filter((key) => Number(axial[key] || 0)).map((key) => `${key}=${round(axial[key], 2)}`).join(', ')}` });
  }
  return items;
}

function buildStructuredHandPdf(input = {}, result = {}, model = {}) {
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 38;
  const contentWidth = pageWidth - margin * 2;
  const pages = [];
  let ops = [];
  let y = 0;
  let pageNo = 0;
  const meta = model.meta || {};
  const rows = buildHandCalculationRows(input, result, model);
  const forceUnit = result.summary?.forceUnit || 'kN';
  const momentUnit = result.summary?.momentUnit || 'kN m';

  const add = (op) => ops.push(op);
  const stroke = (hex) => add(`${pdfColour(hex)} RG`);
  const fill = (hex) => add(`${pdfColour(hex)} rg`);
  const rect = (x, topY, w, h, options = {}) => {
    if (options.fill) {
      fill(options.fill);
      add(`${roundPdf(x)} ${roundPdf(topY - h)} ${roundPdf(w)} ${roundPdf(h)} re f`);
    }
    if (options.stroke !== false) {
      stroke(options.stroke || '#cbd5e1');
      add(`${roundPdf(x)} ${roundPdf(topY - h)} ${roundPdf(w)} ${roundPdf(h)} re S`);
    }
  };
  const line = (x1, y1, x2, y2, colour = '#334155', width = 0.7) => {
    stroke(colour);
    add(`${roundPdf(width)} w ${roundPdf(x1)} ${roundPdf(y1)} m ${roundPdf(x2)} ${roundPdf(y2)} l S`);
  };
  const text = (value, x, baseline, options = {}) => {
    const size = options.size || 9;
    const font = options.bold ? 'F2' : 'F1';
    fill(options.color || '#0f172a');
    let cx = x;
    pdfRichSegments(value).forEach((segment) => {
      const segmentFont = segment.symbol ? 'F3' : font;
      add(`BT /${segmentFont} ${roundPdf(size)} Tf 1 0 0 1 ${roundPdf(cx)} ${roundPdf(baseline)} Tm (${pdfLiteral(segment.text)}) Tj ET`);
      cx += pdfTextWidth(segment.text, size, options.bold || segment.symbol);
    });
  };
  const paragraph = (value, x, startY, width, options = {}) => {
    const size = options.size || 8.5;
    const lineHeight = options.lineHeight || size + 3;
    const lines = wrapPdfText(value, width, size, Boolean(options.bold));
    lines.forEach((lineText, index) => text(lineText, x, startY - index * lineHeight, options));
    return lines.length * lineHeight;
  };
  const finishPage = () => {
    if (!ops.length) return;
    pages.push(ops);
  };
  const header = () => {
    pageNo += 1;
    ops = [];
    y = pageHeight - 34;
    text(meta.companyName || 'Beam Calculator Studio', margin, y, { size: 10, bold: true });
    text(`Project: ${meta.projectName || '-'}`, 210, y, { size: 8 });
    text(`Ref: ${meta.jobReference || '-'}`, 420, y, { size: 8 });
    y -= 13;
    text(meta.calculationTitle || 'Beam calculation', margin, y, { size: 8 });
    text(`Client: ${meta.clientName || '-'}`, 210, y, { size: 8 });
    text(`Date: ${meta.date || today()}`, 420, y, { size: 8 });
    line(margin, y - 8, pageWidth - margin, y - 8, '#94a3b8', 0.6);
    y -= 27;
  };
  const ensure = (height) => {
    if (y - height < 58) {
      finishPage();
      header();
    }
  };
  const section = (title) => {
    ensure(28);
    y -= 5;
    text(title, margin, y, { size: 12, bold: true, color: '#1e3a8a' });
    line(margin, y - 5, pageWidth - margin, y - 5, '#1e3a8a', 0.9);
    y -= 17;
  };
  const table = (headers, bodyRows, widths, options = {}) => {
    const size = options.size || 8;
    const headerHeight = 18;
    const drawHeader = () => {
      ensure(headerHeight + 4);
      rect(margin, y, contentWidth, headerHeight, { fill: options.headerFill || '#e2e8f0', stroke: '#94a3b8' });
      let x = margin;
      headers.forEach((headerText, index) => {
        paragraph(headerText, x + 4, y - 12, widths[index] - 8, { size, bold: true, lineHeight: size + 2 });
        if (index > 0) line(x, y, x, y - headerHeight, '#94a3b8', 0.45);
        x += widths[index];
      });
      y -= headerHeight;
    };
    drawHeader();
    (bodyRows || []).forEach((row, rowIndex) => {
      const wrapped = row.map((cell, index) => wrapPdfText(cell, widths[index] - 8, size, false));
      const rowHeight = Math.max(18, Math.max(...wrapped.map((lines) => lines.length)) * (size + 2) + 8);
      if (y - rowHeight < 58) {
        finishPage();
        header();
        drawHeader();
      }
      rect(margin, y, contentWidth, rowHeight, { fill: rowIndex % 2 ? '#ffffff' : '#f8fafc', stroke: '#cbd5e1' });
      let x = margin;
      row.forEach((cell, index) => {
        const color = /FAIL/i.test(String(cell)) ? '#b91c1c' : /PASS|OK/i.test(String(cell)) ? '#15803d' : '#0f172a';
        wrapped[index].forEach((lineText, lineIndex) => text(lineText, x + 4, y - 12 - lineIndex * (size + 2), { size, color, bold: index === row.length - 1 && /PASS|FAIL|OK/i.test(String(cell)) }));
        if (index > 0) line(x, y, x, y - rowHeight, '#e2e8f0', 0.35);
        x += widths[index];
      });
      y -= rowHeight;
    });
    y -= 8;
  };
  const drawCalculationDerivations = () => {
    const calculations = (model.packageData?.calculations || []).filter((calc) => (calc.derivations || []).length);
    section('Detailed variable derivations');
    if (!calculations.length) {
      table(['Item', 'Note'], [['Variable derivations', 'No derivation objects were recorded. Recalculate the project with the current backend.']], [130, 404], { size: 7.5 });
      return;
    }
    calculations.forEach((calc) => {
      ensure(70);
      text(`${calc.title || 'Code check'} - ${calc.status || 'INFO'}`, margin, y, { size: 9, bold: true, color: '#0f172a' });
      y -= 11;
      paragraph(`Reference: ${calc.codeReference || 'Reference to be confirmed'}; control formula: ${calc.equation || '-'}`, margin, y, contentWidth, { size: 6.8, color: '#475569', lineHeight: 8.5 });
      y -= Math.max(10, wrapPdfText(`Reference: ${calc.codeReference || 'Reference to be confirmed'}; control formula: ${calc.equation || '-'}`, contentWidth, 6.8, false).length * 8.5) + 2;
      const rows = (calc.derivations || []).map((row) => [
        row.symbol || '-',
        `${row.description || '-'}${row.source ? ` Source: ${row.source}` : ''}`,
        row.formula || '-',
        row.substitution || '-',
        String(row.result ?? '-')
      ]);
      table(['Variable', 'How derived', 'Formula', 'Substitution', 'Result'], rows, [58, 134, 126, 132, 84], { size: 6.25, headerFill: '#eef2ff' });
    });
  };
  const titleBlock = () => {
    rect(margin, y, contentWidth, 82, { fill: '#ffffff', stroke: '#94a3b8' });
    text('Structural Engineering Beam Calculation', margin + 10, y - 18, { size: 15, bold: true, color: '#0f172a' });
    text(`Status: ${result.status || '-'}`, margin + 10, y - 40, { size: 12, bold: true, color: result.status === 'FAIL' ? '#b91c1c' : '#15803d' });
    text(`Governing utilisation: ${formatPercent(result.summary?.governingIR)} (${round(result.summary?.governingIR, 3)})`, margin + 160, y - 40, { size: 10, bold: true });
    text(`Beam/member: ${meta.beamMark || '-'}`, margin + 365, y - 40, { size: 9 });
    text(`Prepared: ${meta.engineerName || '-'}    Checked: ${meta.checkedBy || '-'}    Approved: ${meta.approvedBy || '-'}`, margin + 10, y - 62, { size: 8 });
    y -= 96;
  };
  const drawLoadingDiagram = () => {
    ensure(150);
    const top = y;
    const h = 138;
    const left = margin;
    const right = margin + contentWidth;
    const beamY = top - 76;
    const span = finite(result.inputEcho?.span) || finite(input.model?.span) || 1;
    const xMap = (xValue) => left + 36 + (Number(xValue || 0) / Math.max(span, 1e-9)) * (contentWidth - 72);
    rect(left, top, contentWidth, h, { fill: '#ffffff', stroke: '#cbd5e1' });
    text('Loading diagram', left + 8, top - 14, { size: 9, bold: true });
    line(xMap(0), beamY, xMap(span), beamY, '#0f172a', 2);
    line(xMap(0), beamY, xMap(0) - 10, beamY - 18, '#0f172a', 1);
    line(xMap(0), beamY, xMap(0) + 10, beamY - 18, '#0f172a', 1);
    line(xMap(span), beamY, xMap(span) - 10, beamY - 18, '#0f172a', 1);
    line(xMap(span), beamY, xMap(span) + 10, beamY - 18, '#0f172a', 1);
    const sketch = buildPdfLoadSketchItems(input, result);
    sketch.udls.forEach((load, index) => {
      const x1 = xMap(load.x1);
      const x2 = xMap(load.x2);
      rect(x1, beamY + 48 - index * 5, Math.max(4, x2 - x1), 14, { fill: '#dbeafe', stroke: '#2563eb' });
      const count = Math.max(2, Math.min(12, Math.round((x2 - x1) / 28)));
      for (let i = 0; i < count; i += 1) {
        const x = x1 + (i + 0.5) * (x2 - x1) / count;
        line(x, beamY + 48 - index * 5, x, beamY + 10, '#2563eb', 0.7);
      }
      text(load.text, x1, beamY + 54 - index * 8, { size: 6.5, color: '#1d4ed8' });
    });
    sketch.traps.forEach((load, index) => {
      const x1 = xMap(load.x1);
      const x2 = xMap(load.x2);
      const maxQ = Math.max(Math.abs(load.q1), Math.abs(load.q2), 1);
      const top1 = beamY + 12 + 44 * Math.abs(load.q1) / maxQ;
      const top2 = beamY + 12 + 44 * Math.abs(load.q2) / maxQ;
      fill('#fee2e2');
      stroke('#b91c1c');
      add(`${roundPdf(x1)} ${roundPdf(beamY + 8)} m ${roundPdf(x1)} ${roundPdf(top1)} l ${roundPdf(x2)} ${roundPdf(top2)} l ${roundPdf(x2)} ${roundPdf(beamY + 8)} l h f`);
      line(x1, top1, x2, top2, '#b91c1c', 0.9);
      const count = Math.max(3, Math.min(14, Math.round((x2 - x1) / 24)));
      for (let i = 0; i < count; i += 1) {
        const t = (i + 0.5) / count;
        const x = x1 + t * (x2 - x1);
        const yTop = top1 + t * (top2 - top1);
        line(x, yTop, x, beamY + 9, '#b91c1c', 0.65);
      }
      text(`${load.id}: q1=${round(load.q1, 2)} to q2=${round(load.q2, 2)} ${load.loadCase}`, x1, beamY + 44 - index * 8, { size: 6.5, color: '#991b1b' });
    });
    sketch.points.forEach((load, index) => {
      const x = xMap(load.x);
      line(x, beamY + 54, x, beamY + 8, '#b91c1c', 1);
      text(load.text, x + 4, beamY + 58 - index * 8, { size: 6.5, color: '#991b1b' });
    });
    sketch.moments.forEach((load, index) => {
      const x = xMap(load.x);
      add(`${pdfColour('#7c2d12')} RG 1 w ${roundPdf(x - 12)} ${roundPdf(beamY + 18)} ${roundPdf(24)} ${roundPdf(24)} re S`);
      text(load.text, x + 15, beamY + 36 - index * 8, { size: 6.5, color: '#7c2d12' });
    });
    sketch.axial.forEach((load) => text(load.text, xMap(span / 2) - 38, beamY + 92, { size: 7, bold: true, color: '#1d4ed8' }));
    text('0', xMap(0) - 4, beamY - 31, { size: 7 });
    text(`${round(span, 3)} m`, xMap(span) - 16, beamY - 31, { size: 7 });
    text(`L = ${round(span, 3)} m`, xMap(span / 2) - 22, beamY - 31, { size: 7, bold: true });
    y -= h + 12;
  };
  const drawChart = (key, title, unit, colour) => {
    const series = result.diagrams?.series || [];
    ensure(135);
    const top = y;
    const h = 122;
    const left = margin;
    const plotLeft = left + 42;
    const plotRight = left + contentWidth - 18;
    const plotTop = top - 24;
    const plotBottom = top - h + 24;
    rect(left, top, contentWidth, h, { fill: '#ffffff', stroke: '#cbd5e1' });
    text(title, left + 8, top - 12, { size: 9, bold: true });
    if (!series.length) {
      text('Diagram data not returned by calculation service.', left + 8, top - 42, { size: 8, color: '#64748b' });
      y -= h + 10;
      return;
    }
    const maxX = Math.max(...series.map((row) => Number(row.x || 0)), 1);
    const values = series.map((row) => Number(row[key] || 0));
    const maxAbs = Math.max(...values.map((value) => Math.abs(value)), 1e-9);
    const xMap = (xValue) => plotLeft + (Number(xValue || 0) / maxX) * (plotRight - plotLeft);
    const yMap = (value) => (plotTop + plotBottom) / 2 - (Number(value || 0) / maxAbs) * ((plotTop - plotBottom) * 0.43);
    [0, 0.25, 0.5, 0.75, 1].forEach((p) => line(plotLeft, plotBottom + p * (plotTop - plotBottom), plotRight, plotBottom + p * (plotTop - plotBottom), '#e2e8f0', 0.35));
    line(plotLeft, plotBottom, plotRight, plotBottom, '#64748b', 0.55);
    line(plotLeft, plotTop, plotLeft, plotBottom, '#64748b', 0.55);
    line(plotLeft, yMap(0), plotRight, yMap(0), '#334155', 0.6);
    stroke(colour);
    add(`1.2 w ${series.map((row, index) => `${roundPdf(xMap(row.x))} ${roundPdf(yMap(row[key]))} ${index ? 'l' : 'm'}`).join(' ')} S`);
    const peak = series.reduce((best, row) => Math.abs(Number(row[key] || 0)) > Math.abs(Number(best?.[key] || 0)) ? row : best, series[0]);
    text(`Peak ${round(peak?.[key], 3)} ${unit} at x=${round(peak?.x, 3)} m`, plotLeft + 6, plotBottom - 12, { size: 7, bold: true });
    text(unit, left + 8, (plotTop + plotBottom) / 2, { size: 7 });
    y -= h + 10;
  };

  header();
  titleBlock();
  section('Design summary');
  table(['Check', 'Resistance / Limit', 'Applied / Actual', 'Utilisation', 'Status'], rows.summaryRows, [130, 118, 120, 82, 84], { size: 7.8 });
  section('Section details');
  table(['Property', 'Value', 'Unit'], model.sectionRows || [], [210, 160, 164], { size: 7.8 });
  section('Span, restraints and limits');
  table(['Item', 'Value'], rows.spanRows, [230, 304], { size: 8 });
  section('Loading details');
  table(['Load ID', 'Type', 'Value', 'Start x', 'End x', 'Notes'], buildPdfLoadRows(input, result), [58, 88, 128, 62, 62, 136], { size: 7.2 });
  drawLoadingDiagram();
  section('Reactions');
  table(['Support', 'Position', 'Vertical reaction', 'Moment reaction'], rows.reactionRows.length ? rows.reactionRows : [['-', '-', '-', '-']], [110, 110, 150, 164], { size: 8 });
  section('Shear, moment and deflection diagrams');
  drawChart('shear', 'Design shear force diagram', forceUnit, '#1d4ed8');
  drawChart('moment', 'Design bending moment diagram', momentUnit, '#1d4ed8');
  drawChart('deflection', 'Deflection diagram', 'mm', '#15803d');
  section('Eurocode checks');
  table(['Check', 'Expression', 'Clause', 'Utilisation', 'Status'], buildPdfCheckRows(result), [96, 238, 78, 62, 60], { size: 6.9 });
  drawCalculationDerivations();
  section('Notes and assumptions');
  const notes = [
    ...(model.packageData?.assumptions || []),
    ...(model.warnings || []).map((warning) => `Warning: ${warning}`),
    `Section data source: ${model.source?.title || 'Source to be confirmed'}`,
    `Load combination basis: ${result.actions?.ulsNote || result.loads?.combinations?.uls || '-'}`
  ];
  table(['Item', 'Note'], notes.map((note, index) => [`${index + 1}`, note]), [42, 492], { size: 7.5 });
  section('Final summary');
  table(['Item', 'Result'], [
    ['Overall status', result.status || '-'],
    ['Governing utilisation', `${formatPercent(result.summary?.governingIR)} (${round(result.summary?.governingIR, 3)})`],
    ['Governing check', model.governing?.title || '-'],
    ['Engineer comments', meta.notes || '-'],
    ['Prepared by', meta.engineerName || '-'],
    ['Checked by', meta.checkedBy || '-'],
    ['Approved by', meta.approvedBy || '-']
  ], [170, 364], { size: 8 });
  finishPage();

  const pageTotal = pages.length;
  const finalPages = pages.map((pageOps, index) => {
    const footer = [];
    footer.push(`${pdfColour('#64748b')} rg`);
    footer.push(`BT /F1 7 Tf 1 0 0 1 ${margin} 30 Tm (${pdfLiteral(pdfSafeText(model.packageData?.designCode || meta.designCode || 'EN 1993-1-1'))}) Tj ET`);
    footer.push(`BT /F1 7 Tf 1 0 0 1 ${pageWidth - margin - 70} 30 Tm (${pdfLiteral(`Page ${index + 1} of ${pageTotal}`)}) Tj ET`);
    return [...pageOps, ...footer].join('\n');
  });
  return buildPdfFromOperations(finalPages);
}

function resultToPdf(result = {}, metadata = {}, input = {}) {
  result = result || {};
  input = input || {};
  const model = buildReportModel(input, result, metadata);
  const lines = [
    'Professional Beam Calculation Report',
    `Project: ${model.meta.projectName}`,
    `Client: ${model.meta.clientName}`,
    `Company: ${model.meta.companyName}`,
    `Job/reference: ${model.meta.jobReference}`,
    `Revision: ${model.meta.revision}`,
    `Prepared by: ${model.meta.engineerName}`,
    `Checked by: ${model.meta.checkedBy}`,
    `Approved by: ${model.meta.approvedBy}`,
    `Date: ${model.meta.date}`,
    `Status: ${result.status || '-'}`,
    `Governing IR: ${round(result.summary?.governingIR, 5)}`,
    `Governing check: ${model.governing.title}`,
    `Section: ${(result.inputEcho?.section?.family || '')} ${(result.inputEcho?.section?.name || '')}`,
    `Material: ${result.inputEcho?.material || '-'}`,
    `Span: ${round(result.inputEcho?.span || input.model?.span, 3)} m`,
    `Max moment: ${round(result.summary?.maxMoment, 5)} ${result.summary?.momentUnit || ''}`,
    `Max shear: ${round(result.summary?.maxShear, 5)} ${result.summary?.forceUnit || ''}`,
    `Max deflection: ${round(result.summary?.deflection, 5)} mm`,
    `Source: ${model.source.title || 'Source to be confirmed'}`,
    '',
    'Detailed calculation objects:',
    ...(model.packageData.calculations || []).flatMap((calc) => [
      `${calc.title} - ${calc.status}`,
      `Reference: ${calc.codeReference}`,
      `Formula: ${calc.equation}`,
      `Substitution: ${calc.substitution}`,
      `Result: ${calc.result}`,
      `Utilisation: ${calc.utilisation}`,
      ''
    ]),
    'Professional print package: use /api/report/html for the full HTML report with vector diagrams and graphs.',
    'LaTeX package: use /api/report/latex for the generated engineering calculation source.'
  ];
  const pages = [];
  for (let i = 0; i < lines.length; i += 46) pages.push(lines.slice(i, i + 46));
  return buildPdfBuffer(pages.length ? pages : [['Beam calculation report']]);
}

function buildHandCalculationPdf(input = {}, result = {}, suppliedMetadata = {}) {
  input = input || {};
  result = result || {};
  const model = buildReportModel(input, result, suppliedMetadata);
  return buildStructuredHandPdf(input, result, model);
}

module.exports = {
  buildReportModel,
  buildReportHtml,
  buildLatexReport,
  buildHandCalculationPdf,
  resultToPdf
};
