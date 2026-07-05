const { getMaterialForSection } = require('../data/materials');
const { getSection, getSectionSourceInfo } = require('./sections-service');
const { normaliseLoadDirection, normaliseColbeamAuditInput } = require('./colbeam-audit-settings');
const { randomUUID } = require('crypto');

const g = 9.81;

const UNIT_DEFS = {
  tonne: {
    key: 'tonne',
    name: 'Metric tonnes',
    forceShort: 't',
    forceLong: 'metric tonnes',
    udlShort: 't/m',
    momentShort: 't m',
    toBaseForce: (v) => v * g,
    fromBaseForce: (v) => v / g,
    toBaseUdl: (v) => v * g,
    fromBaseUdl: (v) => v / g,
    toBaseMoment: (v) => v * g,
    fromBaseMoment: (v) => v / g
  },
  kn: {
    key: 'kn',
    name: 'kN',
    forceShort: 'kN',
    forceLong: 'kN',
    udlShort: 'kN/m',
    momentShort: 'kN m',
    toBaseForce: (v) => v,
    fromBaseForce: (v) => v,
    toBaseUdl: (v) => v,
    fromBaseUdl: (v) => v,
    toBaseMoment: (v) => v,
    fromBaseMoment: (v) => v
  }
};

const SUPPORT_LABELS = {
  ss: 'Simply supported',
  cantilever: 'Cantilever (fixed at x=0)',
  fixed_fixed: 'Fixed at both ends',
  fixed_roller: 'Fixed at x=0, roller at x=L',
  spring_spring: 'Spring supports at both ends',
  spring_roller: 'Spring at x=0, roller at x=L',
  multi_continuous: 'Continuous beam'
};

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumber(value, fallback = 0) {
  const n = finiteNumber(value, fallback);
  return n > 0 ? n : fallback;
}

function round(value, dp = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(dp)) : value;
}

function fmtControl(value, dp = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(dp);
}

function fmtControlRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(2);
}

function fmtXL(x, L) {
  const ratio = L > 0 ? x / L : 0;
  return `${fmtControl(ratio, 2)}L`;
}

function comparisonText(ir) {
  return Number(ir) < 1 ? '< 1.0' : '> 1.0';
}

function getUnit(key) {
  return UNIT_DEFS[key] || UNIT_DEFS.tonne;
}

function getLC(input = {}) {
  const key = input.combination || 'en1990_610';
  const psi1 = clamp(finiteNumber(input.psiQ1, 0.7), 0, 1);
  const psi2 = clamp(finiteNumber(input.psiQ2, 0.7), 0, 1);
  const psiText = (n) => (n === 1 ? psi1 : psi2).toFixed(1);
  const customULS = input.customULSFactors || {};
  const customSLS = input.customSLSFactors || {};
  const coeffText = (coeff) => `${fmtControl(coeff.cG, 2)}*G + ${fmtControl(coeff.cQ1, 2)}*Q1 + ${fmtControl(coeff.cQ2, 2)}*Q2`;
  if (key === 'custom_colbeam') {
    const uls = {
      cG: finiteNumber(customULS.G, 1.35),
      cQ1: finiteNumber(customULS.Q1, 1.5),
      cQ2: finiteNumber(customULS.Q2, 1.5)
    };
    const sls = {
      cG: finiteNumber(customSLS.G, 1),
      cQ1: finiteNumber(customSLS.Q1, 1),
      cQ2: finiteNumber(customSLS.Q2, psi2)
    };
    return {
      key,
      name: 'Custom / COLBEAM audit factors',
      uls: { ...uls, note: `ULS: Custom audit LC = ${coeffText(uls)}` },
      sls: { ...sls, note: `SLS: Custom audit LC = ${coeffText(sls)}` }
    };
  }
  if (key === 'basic') {
    return {
      key,
      name: 'Basic loads',
      uls: { cG: 1, cQ1: 1, cQ2: 1, note: 'Basic: LC = G + Q1 + Q2' },
      sls: { cG: 1, cQ1: 1, cQ2: 1, note: 'Basic: LC = G + Q1 + Q2' }
    };
  }
  if (key === 'uls_sls') {
    return {
      key,
      name: 'ULS/SLS',
      uls: { cG: 1, cQ1: 1.3, cQ2: 0.7, note: 'ULS: 1.00*G + 1.30*Q1 + 0.70*Q2' },
      sls: { cG: 1, cQ1: 1, cQ2: 1, note: 'SLS: 1.00*G + 1.00*Q1 + 1.00*Q2' }
    };
  }
  if (key === 'en1990_610a') {
    return {
      key,
      name: 'EN 1990 Eq 6.10a',
      uls: { cG: 1.35, cQ1: 1.5 * psi1, cQ2: 1.5 * psi2, note: `ULS: Eq 6.10a: LC = 1.35*G + 1.5*${psiText(1)}*Q1 + 1.5*${psiText(2)}*Q2` },
      sls: { cG: 1, cQ1: 1, cQ2: psi2, note: `SLS: Eq 6.14a: LC = G + Q1 + ${psiText(2)}*Q2` }
    };
  }
  if (key === 'en1990_610b') {
    return {
      key,
      name: 'EN 1990 Eq 6.10b',
      uls: { cG: 0.925 * 1.35, cQ1: 1.5, cQ2: 1.5 * psi2, note: `ULS: Eq 6.10b: LC = 0.925*1.35*G + 1.5*Q1 + 1.5*${psiText(2)}*Q2` },
      sls: { cG: 1, cQ1: 1, cQ2: psi2, note: `SLS: Eq 6.14a: LC = G + Q1 + ${psiText(2)}*Q2` }
    };
  }
  if (key === 'en1990_610ab') {
    const uA = { cG: 1.35, cQ1: 1.5 * psi1, cQ2: 1.5 * psi2, note: `ULS: Eq 6.10a: LC = 1.35*G + 1.5*${psiText(1)}*Q1 + 1.5*${psiText(2)}*Q2` };
    const uB = { cG: 0.925 * 1.35, cQ1: 1.5, cQ2: 1.5 * psi2, note: `ULS: Eq 6.10b: LC = 0.925*1.35*G + 1.5*Q1 + 1.5*${psiText(2)}*Q2` };
    return {
      key,
      name: 'EN 1990 Eq 6.10a/b',
      uls: { ...uA, alt: uB },
      sls: { cG: 1, cQ1: 1, cQ2: psi2, note: `SLS: Eq 6.14a: LC = G + Q1 + ${psiText(2)}*Q2` }
    };
  }
  return {
    key: 'en1990_610',
    name: 'EN 1990 Eq 6.10',
    uls: { cG: 1.35, cQ1: 1.5, cQ2: 1.5 * psi2, note: `ULS: Eq 6.10: LC = 1.35*G + 1.5*Q1 + 1.5*${psiText(2)}*Q2` },
    sls: { cG: 1, cQ1: 1, cQ2: psi2, note: `SLS: Eq 6.14a: LC = G + Q1 + ${psiText(2)}*Q2` }
  };
}

function getSectionPropCandidates(section, keys, allowZero = false) {
  for (const key of keys) {
    if (section && Object.prototype.hasOwnProperty.call(section, key)) {
      const n = Number(section[key]);
      if (Number.isFinite(n) && (n > 0 || (allowZero && n === 0))) return { value: n, key };
    }
  }
  return null;
}

function getSectionModuli(section) {
  const wel = getSectionPropCandidates(section, ['Wel_y_mm3', 'Wely_mm3', 'Wel_mm3_y', 'Wel_y']);
  const wpl = getSectionPropCandidates(section, ['Wpl_y_mm3', 'Wply_mm3', 'Wpl_mm3_y', 'Wpl_y']);
  const weff = getSectionPropCandidates(section, ['Weff_y_mm3', 'Weffy_mm3', 'Weff_mm3_y', 'Weff_y']);
  return {
    Wel: wel?.value ?? null,
    Wpl: wpl?.value ?? null,
    Weff: weff?.value ?? null,
    source: { Wel: wel?.key || null, Wpl: wpl?.key || null, Weff: weff?.key || null }
  };
}

function getSectionAreas(section) {
  const area = getSectionPropCandidates(section, ['A_mm2', 'Amm2', 'A']);
  const areaEff = getSectionPropCandidates(section, ['Aeff_mm2', 'Aeffmm2', 'Aeff']);
  const fromMass = (!area && section && Number.isFinite(Number(section.mass_kg_m))) ? (Number(section.mass_kg_m) * 1e6 / 7850) : null;
  return {
    A: area?.value ?? fromMass ?? null,
    Aeff: areaEff?.value ?? area?.value ?? fromMass ?? null,
    source: {
      A: area?.key || (fromMass ? 'mass_kg_m/7850' : null),
      Aeff: areaEff?.key || area?.key || (fromMass ? 'mass_kg_m/7850' : null)
    }
  };
}

function getFamilyKey(section) {
  return String(section?.family || '').toUpperCase();
}

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isChannelFamilyKey(family) {
  return ['UPE', 'UPN', 'PFC', 'CH'].includes(String(family || '').toUpperCase());
}

function isClosedHollowFamily(section) {
  return ['RHS', 'SHS', 'CHS', 'CFRHS', 'CFSHS'].includes(getFamilyKey(section));
}

function estimateOpenSectionGeometry(section) {
  const family = getFamilyKey(section);
  const h = numOrNull(section?.h_mm);
  const b = numOrNull(section?.b_mm);
  const areas = getSectionAreas(section);
  const area = areas.A;
  if (!(h && b && area)) return null;
  let Av = numOrNull(section?.Avz_mm2) || Math.max(area * 0.18, Math.min(area * 0.55, 0.08 * h * b));
  let tw = Math.max(2, Math.min(b * 0.6, Av / Math.max(1, h)));
  let tf = Math.max(3, (area - tw * h) / Math.max(2, 2 * (b - tw)));
  for (let i = 0; i < 10; i += 1) {
    const hw = Math.max(6, h - 2 * tf);
    tw = Math.max(2, Math.min(b * 0.65, Av / Math.max(1, hw)));
    tf = Math.max(3, Math.min(h * 0.28, (area - tw * hw) / Math.max(2, 2 * b)));
  }
  const hw = Math.max(6, h - 2 * tf);
  if (!(tw > 0 && tf > 0 && hw > 0)) return null;
  return { family, h, b, A: area, Av, tw, tf, hw };
}

function deriveMinorIzOpenSection(geometry) {
  const { family, b, tw, tf, hw } = geometry;
  if (isChannelFamilyKey(family)) {
    const areaWeb = tw * hw;
    const areaFlange = b * tf;
    const xWeb = tw / 2;
    const xFlange = b / 2;
    const total = areaWeb + 2 * areaFlange;
    const xbar = (areaWeb * xWeb + 2 * areaFlange * xFlange) / total;
    const IzWeb = hw * tw ** 3 / 12 + areaWeb * (xWeb - xbar) ** 2;
    const IzFlange = tf * b ** 3 / 12 + areaFlange * (xFlange - xbar) ** 2;
    return IzWeb + 2 * IzFlange;
  }
  return 2 * (tf * b ** 3 / 12) + hw * tw ** 3 / 12;
}

function deriveLtbPropsFromGeometry(section) {
  const geometry = estimateOpenSectionGeometry(section);
  if (!geometry) return null;
  const { family, h, b, tw, tf, hw } = geometry;
  const It = (2 * b * tf ** 3 + hw * tw ** 3) / 3;
  const Iz = deriveMinorIzOpenSection(geometry);
  const Iw = isChannelFamilyKey(family)
    ? 0.16 * tf * b ** 3 * Math.max(1, h - tf) ** 2
    : tf * b ** 3 * Math.max(1, h - tf) ** 2 / 24;
  return { It, Iz, Iw, estimated: true, source: { It: 'derived_geometry', Iz: 'derived_geometry', Iw: 'derived_geometry' } };
}

function getSectionLTBProps(section) {
  const It = getSectionPropCandidates(section, ['It_mm4', 'Ix_mm4', 'I_t_mm4', 'Ix']);
  const Iz = getSectionPropCandidates(section, ['Iz_mm4', 'I_z_mm4', 'Iminor_mm4', 'Iz']);
  const Iw = getSectionPropCandidates(section, ['Iw_mm6', 'I_w_mm6', 'Iw'], true);
  const verified = section?.ltb_data_verified === true;
  if (It?.value && Iz?.value && Iw && Iw.value >= 0) {
    return {
      It: It.value,
      Iz: Iz.value,
      Iw: Iw.value,
      estimated: !verified,
      verified,
      status: section?.ltb_data_status || (verified ? 'verified_direct_table' : 'stored_value'),
      sourceText: section?.ltb_data_source || null,
      sourceRef: section?.ltb_data_source_ref || null
    };
  }
  const derived = deriveLtbPropsFromGeometry(section);
  if (derived) return { ...derived, status: 'derived_geometry', verified: false };
  return { It: 0, Iz: 0, Iw: 0, estimated: true, status: 'missing', verified: false };
}

function calcI_mm4(section) {
  const I = getSectionPropCandidates(section, ['Iy_mm4', 'Iyy_mm4', 'I_y_mm4']);
  if (I) return I.value;
  const moduli = getSectionModuli(section);
  return (moduli.Wel || 0) * ((section.h_mm || 0) / 2);
}

function getWForMRd(section, sectionClass) {
  const moduli = getSectionModuli(section);
  if (sectionClass <= 2) {
    if (moduli.Wpl) return { W: moduli.Wpl, label: 'Wpl,y', source: moduli.source.Wpl, fallback: false };
    return { W: moduli.Wel, label: 'Wel,y (fallback - no Wpl in DB)', source: moduli.source.Wel, fallback: true, missing: 'Wpl_y_mm3' };
  }
  if (sectionClass === 3) return { W: moduli.Wel, label: 'Wel,y', source: moduli.source.Wel, fallback: false };
  if (moduli.Weff) return { W: moduli.Weff, label: 'Weff,y', source: moduli.source.Weff, fallback: false };
  return {
    W: moduli.Wel || 0,
    label: 'Weff,y unavailable (Wel,y shown for reference)',
    source: moduli.source.Wel,
    fallback: true,
    unavailable: true,
    missing: 'Weff_y_mm3'
  };
}

function zeroMatrix(n) {
  return Array.from({ length: n }, () => Array(n).fill(0));
}

function zeroVector(n) {
  return Array(n).fill(0);
}

function solveLinearSystem(Ain, bin) {
  const n = Ain.length;
  const A = Ain.map((row) => row.slice());
  const b = bin.slice();
  for (let k = 0; k < n; k += 1) {
    let pivot = k;
    let maxVal = Math.abs(A[k][k]);
    for (let i = k + 1; i < n; i += 1) {
      const value = Math.abs(A[i][k]);
      if (value > maxVal) {
        maxVal = value;
        pivot = i;
      }
    }
    if (maxVal < 1e-12) throw new Error('Beam solver became singular for the selected support condition.');
    if (pivot !== k) {
      [A[k], A[pivot]] = [A[pivot], A[k]];
      [b[k], b[pivot]] = [b[pivot], b[k]];
    }
    const akk = A[k][k];
    for (let i = k + 1; i < n; i += 1) {
      const factor = A[i][k] / akk;
      if (!factor) continue;
      for (let j = k; j < n; j += 1) A[i][j] -= factor * A[k][j];
      b[i] -= factor * b[k];
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = b[i];
    for (let j = i + 1; j < n; j += 1) sum -= A[i][j] * x[j];
    x[i] = sum / A[i][i];
  }
  return x;
}

function uniqueSortedNodes(values) {
  const arr = [...new Set(values.map((v) => Number(v.toFixed(8))))].sort((a, b) => a - b);
  return arr.filter((v, i) => i === 0 || Math.abs(v - arr[i - 1]) > 1e-8);
}

function buildBeamNodes(L, loads) {
  const points = [0, L, ...(loads.supportXs || []), ...loads.points_kN.map((p) => p.x), ...loads.moments_kN_m.map((m) => m.x)];
  loads.udls_kN_m.forEach((u) => points.push(u.x1, u.x2));
  const base = uniqueSortedNodes(points);
  const maxEl = Math.max(0.05, L / 90);
  const nodes = [base[0]];
  for (let i = 0; i < base.length - 1; i += 1) {
    const a = base[i];
    const b = base[i + 1];
    const seg = b - a;
    const nSub = Math.max(1, Math.ceil(seg / maxEl));
    for (let j = 1; j <= nSub; j += 1) nodes.push(a + seg * j / nSub);
  }
  return uniqueSortedNodes(nodes);
}

function supportBoundaryConfig(type, springs = {}) {
  return {
    fixVLeft: ['ss', 'cantilever', 'fixed_fixed', 'fixed_roller'].includes(type),
    fixThetaLeft: ['cantilever', 'fixed_fixed', 'fixed_roller'].includes(type),
    fixVRight: ['ss', 'fixed_fixed', 'fixed_roller', 'spring_roller'].includes(type),
    fixThetaRight: type === 'fixed_fixed',
    springLeftPct: type === 'spring_spring' || type === 'spring_roller' ? finiteNumber(springs.left, 100) : null,
    springRightPct: type === 'spring_spring' ? finiteNumber(springs.right, 100) : null
  };
}

function springPctToStiffness(pct, E_MPa, I_mm4, L_m) {
  if (pct === null || pct === undefined) return 0;
  const p = clamp(finiteNumber(pct, 0), 0, 100);
  const L_mm = L_m * 1000;
  const kRef = 12 * E_MPa * I_mm4 / Math.max(1, L_mm ** 3);
  if (p >= 100) return kRef * 1e9;
  if (p <= 0) return 0;
  return (p / (100 - p)) * kRef;
}

function addElementMatrix(K, dofs, ke) {
  for (let i = 0; i < dofs.length; i += 1) {
    for (let j = 0; j < dofs.length; j += 1) K[dofs[i]][dofs[j]] += ke[i][j];
  }
}

function addElementVector(F, dofs, fe) {
  for (let i = 0; i < dofs.length; i += 1) F[dofs[i]] += fe[i];
}

function solveBeamFE({ L, supportType, E_MPa, I_mm4, loads, springs }) {
  const nodes = buildBeamNodes(L, loads);
  const n = nodes.length;
  const ndof = 2 * n;
  const K = zeroMatrix(ndof);
  const F = zeroVector(ndof);
  const nodeIndex = new Map(nodes.map((x, i) => [x.toFixed(8), i]));
  const EI = E_MPa * I_mm4;
  for (let e = 0; e < n - 1; e += 1) {
    const x1 = nodes[e];
    const x2 = nodes[e + 1];
    const Le_m = x2 - x1;
    const Le = Le_m * 1000;
    const kFac = EI / (Le ** 3);
    const ke = [
      [12, 6 * Le, -12, 6 * Le],
      [6 * Le, 4 * Le * Le, -6 * Le, 2 * Le * Le],
      [-12, -6 * Le, 12, -6 * Le],
      [6 * Le, 2 * Le * Le, -6 * Le, 4 * Le * Le]
    ].map((row) => row.map((v) => v * kFac));
    const dofs = [2 * e, 2 * e + 1, 2 * (e + 1), 2 * (e + 1) + 1];
    addElementMatrix(K, dofs, ke);
    const xm = 0.5 * (x1 + x2);
    let w = 0;
    loads.udls_kN_m.forEach((u) => {
      if (xm >= u.x1 - 1e-9 && xm <= u.x2 + 1e-9) w += u.w;
    });
    if (Math.abs(w) > 1e-12) {
      const q = -w;
      addElementVector(F, dofs, [q * Le / 2, q * Le * Le / 12, q * Le / 2, -q * Le * Le / 12]);
    }
  }
  loads.points_kN.forEach((point) => {
    const idx = nodeIndex.get(point.x.toFixed(8));
    if (idx === undefined) throw new Error(`Point load ${point.label} could not be mapped to a solver node.`);
    F[2 * idx] += -point.P * 1000;
  });
  loads.moments_kN_m.forEach((moment) => {
    const idx = nodeIndex.get(moment.x.toFixed(8));
    if (idx === undefined) throw new Error(`Moment load ${moment.label} could not be mapped to a solver node.`);
    F[2 * idx + 1] += moment.M * 1e6;
  });
  const bc = supportBoundaryConfig(supportType, springs);
  const kSpringLeft = springPctToStiffness(bc.springLeftPct, E_MPa, I_mm4, L);
  const kSpringRight = springPctToStiffness(bc.springRightPct, E_MPa, I_mm4, L);
  if (kSpringLeft) K[0][0] += kSpringLeft;
  if (kSpringRight) K[2 * (n - 1)][2 * (n - 1)] += kSpringRight;
  const constrained = [];
  if (bc.fixVLeft) constrained.push(0);
  if (bc.fixThetaLeft) constrained.push(1);
  if (bc.fixVRight) constrained.push(2 * (n - 1));
  if (bc.fixThetaRight) constrained.push(2 * (n - 1) + 1);
  const cset = new Set(constrained);
  const free = Array.from({ length: ndof }, (_, i) => i).filter((i) => !cset.has(i));
  const d = zeroVector(ndof);
  if (free.length) {
    const dRed = solveLinearSystem(free.map((i) => free.map((j) => K[i][j])), free.map((i) => F[i]));
    free.forEach((dof, idx) => { d[dof] = dRed[idx]; });
  }
  const R = zeroVector(ndof);
  for (let i = 0; i < ndof; i += 1) {
    let sum = 0;
    for (let j = 0; j < ndof; j += 1) sum += K[i][j] * d[j];
    R[i] = sum - F[i];
  }
  const rightVdof = 2 * (n - 1);
  const leftReaction = bc.fixVLeft ? R[0] / 1000 : (kSpringLeft ? (-kSpringLeft * d[0] / 1000) : 0);
  const rightReaction = bc.fixVRight ? R[rightVdof] / 1000 : (kSpringRight ? (-kSpringRight * d[rightVdof] / 1000) : 0);
  const leftMoment = bc.fixThetaLeft ? R[1] / 1e6 : 0;
  const rightMoment = bc.fixThetaRight ? R[rightVdof + 1] / 1e6 : 0;
  return {
    nodes,
    d,
    reactions: {
      leftVertical: leftReaction,
      rightVertical: rightReaction,
      leftMoment,
      rightMoment,
      kSpringLeft,
      kSpringRight,
      supportActions: [{ x: 0, V: leftReaction, M: leftMoment }, { x: L, V: rightReaction, M: rightMoment }]
    }
  };
}

function shapeFunctions(xi, Le_mm) {
  return [
    1 - 3 * xi * xi + 2 * xi * xi * xi,
    Le_mm * (xi - 2 * xi * xi + xi * xi * xi),
    3 * xi * xi - 2 * xi * xi * xi,
    Le_mm * (-xi * xi + xi * xi * xi)
  ];
}

function buildDeflectionCurve(model, samplesPerElement = 5) {
  const xs = [];
  const Y = [];
  for (let e = 0; e < model.nodes.length - 1; e += 1) {
    const x1 = model.nodes[e];
    const x2 = model.nodes[e + 1];
    const Le_m = x2 - x1;
    const Le_mm = Le_m * 1000;
    const de = [model.d[2 * e], model.d[2 * e + 1], model.d[2 * (e + 1)], model.d[2 * (e + 1) + 1]];
    const max = e === model.nodes.length - 2 ? samplesPerElement : samplesPerElement - 1;
    for (let j = 0; j <= max; j += 1) {
      const xi = j / samplesPerElement;
      const N = shapeFunctions(xi, Le_mm);
      const vUp = N[0] * de[0] + N[1] * de[1] + N[2] * de[2] + N[3] * de[3];
      xs.push(x1 + xi * Le_m);
      Y.push(-vUp);
    }
  }
  let maxY = 0;
  let iY = 0;
  for (let i = 0; i < Y.length; i += 1) {
    const ay = Math.abs(Y[i]);
    if (ay > maxY) {
      maxY = ay;
      iY = i;
    }
  }
  return { xs, Y, peakY: { val: maxY, x: xs[iY], xL: xs[iY] / Math.max(xs[xs.length - 1], 1e-9), signed: Y[iY] } };
}

function partialUdlResultant(u, x) {
  const a = clamp(x - u.x1, 0, u.x2 - u.x1);
  if (a <= 0) return null;
  return { W: u.w * a, xc: u.x1 + a / 2 };
}

function buildInternalForceCurves({ L, loads, supportActions = [], N = 480 }) {
  const xs = Array.from({ length: N + 1 }, (_, i) => L * i / N);
  const V = [];
  const M = [];
  xs.forEach((x) => {
    let shear = 0;
    let moment = 0;
    supportActions.forEach((s) => {
      if ((s.x || 0) <= x + 1e-12) {
        shear += s.V || 0;
        moment += (s.V || 0) * (x - s.x) - (s.M || 0);
      }
    });
    loads.points_kN.forEach((p) => {
      if (p.x <= x + 1e-12) {
        shear -= p.P;
        moment -= p.P * (x - p.x);
      }
    });
    loads.moments_kN_m.forEach((m) => {
      if (m.x <= x + 1e-12) moment += m.M;
    });
    loads.udls_kN_m.forEach((u) => {
      const part = partialUdlResultant(u, x);
      if (!part) return;
      shear -= part.W;
      moment -= part.W * (x - part.xc);
    });
    V.push(shear);
    M.push(moment);
  });
  let iV = 0;
  let iM = 0;
  let maxV = 0;
  let maxM = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const aV = Math.abs(V[i]);
    const aM = Math.abs(M[i]);
    if (aV > maxV) { maxV = aV; iV = i; }
    if (aM > maxM) { maxM = aM; iM = i; }
  }
  return {
    xs,
    V,
    M,
    peakV: { val: maxV, x: xs[iV], xL: xs[iV] / L, signed: V[iV] },
    peakM: { val: maxM, x: xs[iM], xL: xs[iM] / L, signed: M[iM] }
  };
}

function solveBeam({ L, supportType, E_MPa, I_mm4, loads, springs }) {
  const model = solveBeamFE({ L, supportType, E_MPa, I_mm4, loads, springs });
  const defl = buildDeflectionCurve(model, 5);
  const forceCurves = buildInternalForceCurves({ L, loads, supportActions: model.reactions.supportActions || [] });
  return {
    xs: forceCurves.xs,
    V: forceCurves.V,
    M: forceCurves.M,
    defl,
    reactions: model.reactions,
    totals: {
      Ptot: loads.points_kN.reduce((sum, p) => sum + p.P, 0),
      Qtot: loads.udls_kN_m.reduce((sum, u) => sum + (u.x2 - u.x1) * u.w, 0)
    },
    peakV: forceCurves.peakV,
    peakM: forceCurves.peakM
  };
}

function getShearReducedMoment(section, material, gammaM0, VzEd, VzRd, Wsel, sectionClass) {
  const ratio = VzRd > 0 ? VzEd / VzRd : Infinity;
  const trigger = ratio > 0.5 + 1e-9;
  const baseMyRd = (Wsel.W * material.fy / gammaM0) / 1e6;
  const out = { trigger, available: false, ratio, rho: 0, webWpl: 0, reducedW: Wsel.W, MvRd: baseMyRd, label: 'My,Rd', note: 'Shear reduction not active' };
  if (!trigger || sectionClass > 2) return out;
  const family = getFamilyKey(section);
  if (!['IPE', 'HEA', 'HEB', 'HEM', 'HEAA', 'UB', 'UC', 'UBP', 'J'].includes(family)) {
    out.note = 'High-shear trigger active, but Mv,y,Rd is only implemented for I / UB / UC / UBP / J shapes.';
    return out;
  }
  const rho = clamp((2 * ratio - 1) ** 2, 0, 1);
  const h = Number(section?.h_mm || section?.d_mm || 0);
  const tw = Number(section?.tw_mm || 0);
  const tf = Number(section?.tf_mm || 0);
  const hw = Math.max(0, h - 2 * tf);
  const webWpl = h > 0 && tw > 0 && tf >= 0 && hw > 0 ? tw * hw * hw / 4 : 0;
  out.webWpl = webWpl;
  if (!(webWpl > 0) || !(Wsel.W > webWpl)) {
    out.available = true;
    out.MvRd = baseMyRd;
    out.label = 'Mv,y,Rd';
    out.note = 'High-shear trigger active; detailed web dimensions are incomplete, so Mv,y,Rd is retained equal to My,Rd to match legacy behavior.';
    return out;
  }
  const reducedW = Math.max(0, Wsel.W - webWpl) + (1 - rho) * webWpl;
  out.reducedW = reducedW;
  out.available = true;
  out.rho = rho;
  out.MvRd = (reducedW * material.fy / gammaM0) / 1e6;
  out.label = 'Mv,y,Rd';
  out.note = 'High-shear trigger active: VEd > 0.5*Vz,Rd, so a shear-reduced bending resistance is used.';
  return out;
}

function buildSectionCheck(section, material, actions, axialEd, settings) {
  const sectionClass = Number(settings.sectionClass || 2);
  const gammaM0 = positiveNumber(settings.gammaM0, 1);
  const Wsel = getWForMRd(section, sectionClass);
  const areas = getSectionAreas(section);
  const MyRd = (Wsel.W * material.fy / gammaM0) / 1e6;
  const VzRd = (Number(section.Avz_mm2 || 0) * material.fy / (Math.sqrt(3) * gammaM0)) / 1e3;
  const NtRd = ((areas.A || 0) * material.fy / gammaM0) / 1e3;
  const NcRd = (((sectionClass === 4 ? areas.Aeff : areas.A) || 0) * material.fy / gammaM0) / 1e3;
  const MyEd = actions.peakM.val;
  const VzEd = actions.peakV.val;
  const mv = getShearReducedMoment(section, material, gammaM0, VzEd, VzRd, Wsel, sectionClass);
  const momentRdForCheck = mv.available ? mv.MvRd : MyRd;
  const IR_M = MyEd / momentRdForCheck;
  const IR_V = VzEd / VzRd;
  const IR_N = axialEd >= 0 ? (NcRd > 0 ? axialEd / NcRd : Infinity) : (NtRd > 0 ? Math.abs(axialEd) / NtRd : Infinity);
  const momentAvailable = !(Wsel.unavailable || !(Wsel.W > 0));
  return {
    cls: sectionClass,
    gammaM0,
    Wsel,
    areas,
    axialEd,
    MyRd,
    MvRd: mv.MvRd,
    momentRdForCheck,
    momentLabelForCheck: mv.available ? 'Mv,y,Rd' : 'My,Rd',
    mv,
    VzRd,
    NtRd,
    NcRd,
    MyEd,
    VzEd,
    IR_M,
    IR_V,
    IR_N,
    IR_My: MyRd > 0 ? MyEd / MyRd : Infinity,
    momentAvailable,
    passM: momentAvailable && IR_M < 1,
    passV: IR_V < 1,
    passN: IR_N < 1
  };
}

function ltbUnavailable(message) {
  return { enabled: true, available: false, message, unavailableReason: message };
}

function isMonosymmetricLtbFamily(section) {
  return ['UPE', 'UPN', 'PFC', 'CH', 'CUSTOM_CHANNEL', 'CUSTOM_TEE', 'CUSTOM_ANGLE'].includes(getFamilyKey(section));
}

function isRolledISectionFamily(section) {
  return ['IPE', 'IPN', 'HEA', 'HEB', 'HEM', 'HEAA', 'UB', 'UC', 'UBP', 'J'].includes(getFamilyKey(section));
}

function getLtbImperfection(section, model) {
  const h = Math.max(1, numOrNull(section?.h_mm) || 1);
  const b = Math.max(1, numOrNull(section?.b_mm) || 1);
  const shallow = h / b <= 2;
  if (model === 'rolled') return { curve: shallow ? 'b' : 'c', alpha: shallow ? 0.34 : 0.49, lambda0: 0.4, beta: 0.75 };
  if (isRolledISectionFamily(section)) return { curve: shallow ? 'a' : 'b', alpha: shallow ? 0.21 : 0.34, lambda0: 0.2, beta: 1 };
  return { curve: 'd', alpha: 0.76, lambda0: 0.2, beta: 1 };
}

function evaluateLTB(section, material, L, MyEd, Wsel, settings) {
  if (!settings.enableLTB) return { enabled: false };
  if (isClosedHollowFamily(section)) {
    return {
      enabled: true,
      available: false,
      notRequired: true,
      pass: true,
      message: 'Lateral torsional buckling check not required for closed hollow sections in this EC3 beam model.'
    };
  }
  if (isMonosymmetricLtbFamily(section)) return ltbUnavailable('Automatic LTB is disabled for channels, tees and angles because C3, shear-centre and load-height data are not stored.');
  const props = getSectionLTBProps(section);
  const gammaM1 = positiveNumber(settings.gammaM1, 1);
  if (!(props.It > 0 && props.Iz > 0 && props.Iw >= 0)) return ltbUnavailable('Required LTB properties (It / Iz / Iw) are missing for this section.');
  const restraints = Math.max(0, Math.round(finiteNumber(settings.ltbRestraints, 0)));
  const k = positiveNumber(settings.ltbK, 1);
  const C1 = positiveNumber(settings.ltbC1, 1);
  const C2 = finiteNumber(settings.ltbC2, 0);
  const model = settings.ltbModel || 'rolled';
  const loadLevel = settings.ltbLoadLevel || 'shear_centre';
  const E = material.E;
  const Gs = 80770;
  const Lsegment_mm = (L * 1000) / Math.max(1, restraints + 1);
  const Le_mm = Math.max(1, Lsegment_mm * k);
  const h = numOrNull(section?.h_mm) || 0;
  const tf = numOrNull(section?.tf_mm) || numOrNull(section?.t_mm) || 0;
  const flangeLevel = Math.max(0, (h - tf) / 2);
  const zg = loadLevel === 'compression' ? flangeLevel : (loadLevel === 'tension' ? -flangeLevel : 0);
  const pi2 = Math.PI * Math.PI;
  const rootTerm = (props.Iw / props.Iz) + (Le_mm * Le_mm * Gs * props.It) / (pi2 * E * props.Iz) + (C2 * zg) ** 2;
  if (!(rootTerm > 0)) return ltbUnavailable('Calculated LTB root term is not positive.');
  let Mcr = (C1 * pi2 * E * props.Iz / (Le_mm * Le_mm)) * (Math.sqrt(rootTerm) - C2 * zg);
  Mcr /= 1e6;
  if (!(Mcr > 0)) return ltbUnavailable('Calculated Mcr is not positive.');
  const lambdaLT = Math.sqrt((Wsel.W * material.fy) / (Mcr * 1e6));
  const imperfection = getLtbImperfection(section, model);
  const phiLT = 0.5 * (1 + imperfection.alpha * (lambdaLT - imperfection.lambda0) + imperfection.beta * lambdaLT * lambdaLT);
  let chiLT = 1 / (phiLT + Math.sqrt(Math.max(0, phiLT * phiLT - lambdaLT * lambdaLT)));
  chiLT = clamp(chiLT, 0, 1);
  const MbRd = chiLT * Wsel.W * material.fy / gammaM1 / 1e6;
  const IR_LT = MyEd / MbRd;
  return {
    enabled: true,
    available: true,
    restraints,
    k,
    C1,
    C2,
    zg,
    Lsegment_mm,
    Lb_mm: Le_mm,
    Mcr,
    lambdaLT,
    phiLT,
    chiLT,
    alphaLT: imperfection.alpha,
    lambda0: imperfection.lambda0,
    beta: imperfection.beta,
    gammaM1,
    MbRd,
    IR_LT,
    pass: IR_LT < 1,
    model,
    loadLevel,
    curveLT: imperfection.curve,
    sourceText: props.sourceText || null,
    sourceRef: props.sourceRef || null,
    status: props.status,
    estimated: props.estimated
  };
}

function evaluateEndSupportCheck(check, uls, settings) {
  const rigid = settings.endPostType === 'rigid';
  const stiff = settings.webStiffener === 'support';
  let factor = rigid ? 1 : 0.9;
  if (stiff) factor = Math.min(1, factor + 0.1);
  const VbRd = check.VzRd * factor;
  const Ved = Math.max(...((uls.reactions.supportActions || []).map((r) => Math.abs(r.V || 0)).concat([
    Math.abs(uls.reactions.leftVertical || 0),
    Math.abs(uls.reactions.rightVertical || 0)
  ])));
  return { factor, VbRd, Ved, pass: Ved <= VbRd };
}

function getBucklingCurveAlpha(curve) {
  return ({ a0: 0.13, a: 0.21, b: 0.34, c: 0.49, d: 0.76 })[curve] ?? 0.49;
}

function calcBucklingReduction(lambdaBar, alpha) {
  if (!(lambdaBar > 0)) return 1;
  const phi = 0.5 * (1 + alpha * (lambdaBar - 0.2) + lambdaBar * lambdaBar);
  return clamp(1 / (phi + Math.sqrt(Math.max(0, phi * phi - lambdaBar * lambdaBar))), 0, 1);
}

function getAutoBucklingCurve(axis, section) {
  const family = getFamilyKey(section);
  if (['UB', 'UC', 'UBP', 'IPE', 'IPN', 'HEA', 'HEB', 'HEM', 'HEAA', 'J'].includes(family)) return axis === 'y' ? 'b' : 'c';
  if (['PFC', 'CH', 'UPE', 'UPN'].includes(family)) return 'c';
  if (['RHS', 'CFRHS'].includes(family)) return 'a';
  return 'c';
}

function evaluateMemberBuckling(section, material, check, L, ltb, settings) {
  if (!(check.axialEd > 1e-9)) return { active: false };
  const Iy = calcI_mm4(section);
  const ltbProps = getSectionLTBProps(section);
  const Iz = ltbProps.Iz || 0;
  const Acomp = ((check.cls === 4 ? check.areas.Aeff : check.areas.A) || 0);
  if (!(Iy > 0 && Iz > 0 && Acomp > 0)) return { active: true, available: false, message: 'Required section properties for member buckling (A / Iy / Iz) are missing.' };
  const ky = Math.max(0.1, finiteNumber(settings.bucklingKy, 1));
  const kz = Math.max(0.1, finiteNumber(settings.bucklingKz, 1));
  const curveY = settings.bucklingCurveY === 'auto' || !settings.bucklingCurveY ? getAutoBucklingCurve('y', section) : settings.bucklingCurveY;
  const curveZ = settings.bucklingCurveZ === 'auto' || !settings.bucklingCurveZ ? getAutoBucklingCurve('z', section) : settings.bucklingCurveZ;
  const gammaM1 = positiveNumber(settings.gammaM1, 1);
  const LeY = L * 1000 * ky;
  const LeZ = L * 1000 * kz;
  const NcrY = (Math.PI * Math.PI * material.E * Iy / Math.max(1, LeY * LeY)) / 1e3;
  const NcrZ = (Math.PI * Math.PI * material.E * Iz / Math.max(1, LeZ * LeZ)) / 1e3;
  const NplRd = (Acomp * material.fy / gammaM1) / 1e3;
  const lambdaY = Math.sqrt(Math.max(0, NplRd / Math.max(NcrY, 1e-9)));
  const lambdaZ = Math.sqrt(Math.max(0, NplRd / Math.max(NcrZ, 1e-9)));
  const chiY = calcBucklingReduction(lambdaY, getBucklingCurveAlpha(curveY));
  const chiZ = calcBucklingReduction(lambdaZ, getBucklingCurveAlpha(curveZ));
  const NbYRd = chiY * NplRd;
  const NbZRd = chiZ * NplRd;
  const chiLTForInteraction = ltb.enabled && ltb.available ? ltb.chiLT : 1;
  const momentDen = Math.max(1e-9, chiLTForInteraction * check.MyRd);
  const kyy = finiteNumber(settings.kyy, 1);
  const kzy = finiteNumber(settings.kzy, 0.6);
  const IRy = check.axialEd / Math.max(NbYRd, 1e-9) + kyy * (check.MyEd / momentDen);
  const IRz = check.axialEd / Math.max(NbZRd, 1e-9) + kzy * (check.MyEd / momentDen);
  return {
    active: true,
    available: true,
    ky,
    kz,
    curveY,
    curveZ,
    NcrY,
    NcrZ,
    NplRd,
    lambdaY,
    lambdaZ,
    chiY,
    chiZ,
    NbYRd,
    NbZRd,
    IRy,
    IRz,
    kyy,
    kzy,
    governing: Math.max(IRy, IRz),
    pass: Math.max(IRy, IRz) < 1
  };
}

function normaliseLoads(input, section, L, unit) {
  const raw = { points: [], udls: [], supportXs: [0, L], mode: 'single' };
  const model = input.model || {};
  (input.loads?.udls || []).slice(0, 40).forEach((load, index) => {
    const x1 = clamp(finiteNumber(load.x1, 0), 0, L);
    const x2 = clamp(finiteNumber(load.x2, L), 0, L);
    if (x2 <= x1) return;
    raw.udls.push({
      label: String(load.label || `UDL ${index + 1}`).slice(0, 80),
      x1,
      x2,
      direction: normaliseLoadDirection(load.direction, 'Z'),
      sourceType: load.sourceType || 'uniform',
      reportLabel: load.reportLabel,
      q1: finiteNumber(load.q1, 0),
      q2: finiteNumber(load.q2, 0),
      loadCase: load.loadCase,
      reportX1: finiteNumber(load.reportX1, x1),
      reportX2: finiteNumber(load.reportX2, x2),
      G: finiteNumber(load.G, 0),
      Q1: finiteNumber(load.Q1, 0),
      Q2: finiteNumber(load.Q2, 0)
    });
  });
  (input.loads?.points || []).slice(0, 40).forEach((load, index) => {
    const x = clamp(finiteNumber(load.x, 0), 0, L);
    const M = finiteNumber(load.M, 0);
    raw.points.push({
      label: String(load.label || (Math.abs(M) > 1e-12 ? `M ${index + 1}` : `P ${index + 1}`)).slice(0, 80),
      x,
      G: finiteNumber(load.G, 0),
      Q1: finiteNumber(load.Q1, 0),
      Q2: finiteNumber(load.Q2, 0),
      M,
      direction: normaliseLoadDirection(load.direction, 'Z'),
      momentCase: ['G', 'Q1', 'Q2'].includes(load.momentCase) ? load.momentCase : 'G'
    });
  });
  if (model.includeSelfWeight !== false && section.mass_kg_m > 0) {
    const sw = unit.key === 'tonne' ? (section.mass_kg_m / 1000) : (section.mass_kg_m * g / 1000);
    raw.udls.push({ label: 'Self-weight', x1: 0, x2: L, direction: 'Z', G: sw, Q1: 0, Q2: 0, isSelf: true });
  }
  return raw;
}

function applyCombo(raw, coeff, unit, options = {}) {
  return {
    points_kN: raw.points.filter((p) => Math.abs(p.M || 0) <= 1e-12).map((p) => ({
      label: p.label,
      x: p.x,
      P: unit.toBaseForce(coeff.cG * p.G + coeff.cQ1 * p.Q1 + coeff.cQ2 * p.Q2)
    })).filter((p) => Math.abs(p.P) > 1e-12),
    moments_kN_m: raw.points.filter((p) => Math.abs(p.M || 0) > 1e-12).map((p) => ({
      label: p.label,
      x: p.x,
      M: unit.toBaseMoment((p.momentCase === 'G' ? coeff.cG : p.momentCase === 'Q1' ? coeff.cQ1 : coeff.cQ2) * p.M)
    })).filter((m) => Math.abs(m.M) > 1e-12),
    udls_kN_m: raw.udls.map((u) => ({
      label: u.label,
      x1: u.x1,
      x2: u.x2,
      isSelf: Boolean(u.isSelf),
      w: unit.toBaseUdl((u.isSelf && options.excludeSelfWeight ? 0 : coeff.cG) * u.G + coeff.cQ1 * u.Q1 + coeff.cQ2 * u.Q2)
    })).filter((u) => Math.abs(u.w) > 1e-12 && u.x2 > u.x1),
    supportXs: raw.supportXs.slice(),
    mode: raw.mode
  };
}

function buildSlsCombination(lc, audit) {
  const basis = audit?.combination?.slsDeflectionBasis || 'total';
  const includeSelfWeight = audit?.combination?.slsIncludeSelfWeight !== false;
  if (basis === 'imposed-only') {
    return {
      coeff: { cG: 0, cQ1: lc.sls.cQ1, cQ2: 0, note: 'SLS deflection basis: imposed-only, LC = Q1 only' },
      excludeSelfWeight: true,
      basis,
      includeSelfWeight: false,
      note: 'SLS deflection basis: imposed-only, LC = Q1 only'
    };
  }
  if (basis === 'variable-only') {
    return {
      coeff: { cG: 0, cQ1: lc.sls.cQ1, cQ2: lc.sls.cQ2, note: `SLS deflection basis: variable-only, LC = ${fmtControl(lc.sls.cQ1, 2)}*Q1 + ${fmtControl(lc.sls.cQ2, 2)}*Q2` },
      excludeSelfWeight: true,
      basis,
      includeSelfWeight: false,
      note: `SLS deflection basis: variable-only, LC = ${fmtControl(lc.sls.cQ1, 2)}*Q1 + ${fmtControl(lc.sls.cQ2, 2)}*Q2`
    };
  }
  return {
    coeff: { ...lc.sls, note: `${lc.sls.note}${includeSelfWeight ? '' : ' (self-weight excluded from SLS deflection)'}` },
    excludeSelfWeight: !includeSelfWeight,
    basis: 'total',
    includeSelfWeight,
    note: `${lc.sls.note}${includeSelfWeight ? '' : ' (self-weight excluded from SLS deflection)'}`
  };
}

function sampleSeries(series, deflectionSeries = series, max = 161) {
  const { xs, V, M } = series;
  const step = Math.max(1, Math.ceil(xs.length / max));
  const indices = xs
    .map((_, index) => index)
    .filter((index) => index % step === 0 || index === xs.length - 1);
  return indices.map((sourceIndex) => {
    const x = xs[sourceIndex];
    return {
      x: round(x, 5),
      shear: round(V[sourceIndex], 5),
      moment: round(M[sourceIndex], 5),
      deflection: round(interpolate(deflectionSeries.defl.xs, deflectionSeries.defl.Y, x), 5)
    };
  });
}

function interpolate(xs, ys, x) {
  if (!xs.length) return 0;
  if (x <= xs[0]) return ys[0] || 0;
  for (let i = 1; i < xs.length; i += 1) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / Math.max(1e-9, xs[i] - xs[i - 1]);
      return (ys[i - 1] || 0) + t * ((ys[i] || 0) - (ys[i - 1] || 0));
    }
  }
  return ys[ys.length - 1] || 0;
}

function valueUnit(value, unit, dp = 3) {
  return `${round(value, dp)} ${unit}`;
}

function passFail(pass) {
  return pass ? 'PASS' : 'FAIL';
}

function getSectionReportGeometry(section) {
  const family = getFamilyKey(section);
  const h = numOrNull(section.h_mm || section.d_mm);
  const b = numOrNull(section.b_mm);
  const area = getSectionAreas(section).A;
  const warnings = [];
  let tw = numOrNull(section.tw_mm);
  let tf = numOrNull(section.tf_mm);
  if ((!tw || !tf) && h && b && area) {
    const geometry = estimateOpenSectionGeometry(section);
    if (geometry) {
      tw = tw || geometry.tw;
      tf = tf || geometry.tf;
      warnings.push('tw/tf are not explicit in this section row; drawing dimensions are derived from A, Av,z, h and b for reporting only.');
    }
  }
  return {
    family,
    type: ['RHS', 'SHS', 'CFRHS'].includes(family) ? 'rhs'
      : ['PFC', 'CH', 'UPE', 'UPN'].includes(family) ? 'channel'
        : family.includes('ANGLE') ? 'angle'
          : 'i',
    h_mm: h || null,
    b_mm: b || null,
    tw_mm: tw || null,
    tf_mm: tf || numOrNull(section.t_mm) || null,
    t_mm: numOrNull(section.t_mm) || null,
    r_mm: numOrNull(section.r_mm || section.r1_mm) || null,
    warnings
  };
}

function getFullSectionProperties(section, check) {
  const moduli = getSectionModuli(section);
  const areas = getSectionAreas(section);
  return {
    dimensions: getSectionReportGeometry(section),
    A_mm2: round(areas.A || 0, 3),
    Aeff_mm2: round(areas.Aeff || areas.A || 0, 3),
    Iy_mm4: round(calcI_mm4(section), 3),
    Iz_mm4: round(getSectionLTBProps(section).Iz || section.Iz_mm4 || 0, 3),
    It_mm4: round(getSectionLTBProps(section).It || section.It_mm4 || 0, 3),
    Iw_mm6: round(getSectionLTBProps(section).Iw || section.Iw_mm6 || 0, 3),
    Wel_y_mm3: round(moduli.Wel || 0, 3),
    Wel_z_mm3: round(section.Wel_z_mm3 || 0, 3),
    Wpl_y_mm3: round(moduli.Wpl || 0, 3),
    Wpl_z_mm3: round(section.Wpl_z_mm3 || 0, 3),
    Weff_y_mm3: round(moduli.Weff || 0, 3),
    Avz_mm2: round(section.Avz_mm2 || 0, 3),
    mass_kg_m: round(section.mass_kg_m || 0, 3),
    classification: `Class ${check.cls}`,
    databaseStatus: section.ltb_data_status || section.section_data_status || 'server_section_row'
  };
}

function buildCalculationObject({ id, title, codeReference, equation, variables, derivations = [], substitution, unitConversion, result, resistance, utilisation, status, warnings = [] }) {
  return {
    id,
    title,
    codeReference,
    equation,
    variables,
    derivations,
    substitution,
    unitConversion,
    result,
    resistance,
    utilisation,
    status,
    warnings
  };
}

function buildDerivation(symbol, description, formula, substitution, result, source = '') {
  return { symbol, description, formula, substitution, result, source };
}

function buildCalculationPackage(context) {
  const {
    input,
    section,
    material,
    settings,
    unit,
    L,
    supportType,
    lc,
    ulsNote,
    ulsCoeff,
    rawLoads,
    uls,
    sls,
    slsCombo,
    check,
    ltb,
    endSupport,
    memberBuckling,
    deflAllow_mm,
    deflPeak,
    deflIR,
    supportIR,
    IR_NM,
    passNM,
    passAll,
    governingIR,
    maxReaction
  } = context;
  const audit = settings.audit || normaliseColbeamAuditInput(input);
  const source = getSectionSourceInfo(section);
  const warnings = [
    ...getSectionReportGeometry(section).warnings,
    ...(audit.metadataOnlyWarnings || []),
    check.Wsel.unavailable ? `Required section property missing: ${check.Wsel.missing}. Class ${check.cls} resistance cannot be verified from the current database.` : null,
    check.Wsel.fallback ? `Section modulus fallback used: ${check.Wsel.label}.` : null,
    ltb.enabled && !ltb.available && !ltb.notRequired ? `LTB unavailable: ${ltb.message}` : null,
    memberBuckling.active && !memberBuckling.available ? `Member buckling unavailable: ${memberBuckling.message}` : null,
    !source.title || source.title === 'Source to be confirmed' ? 'Section source to be confirmed.' : null
  ].filter(Boolean);
  const calculations = [
    buildCalculationObject({
      id: 'design-basis',
      title: 'Design basis',
      codeReference: 'EN 1990 / EN 1993-1-1',
      equation: 'ULS and SLS combinations selected by project input.',
      variables: [
        { symbol: 'Combination', value: lc.name },
        { symbol: 'ULS selected', value: ulsNote || lc.uls.note },
        { symbol: 'COLBEAM audit profile', value: audit.settings.auditProfile },
        { symbol: 'Per-check 6.10a/b envelope', value: audit.combination.perCheckEnvelope ? 'Recorded only - not engine-wired in Stage 1' : 'Off' },
        { symbol: 'SLS deflection basis', value: `${audit.combination.slsDeflectionBasis}; self-weight ${audit.combination.slsIncludeSelfWeight ? 'included' : 'excluded'} metadata recorded only` },
        { symbol: 'Design code', value: input.metadata?.designCode || 'EN 1993-1-1' },
        { symbol: 'National Annex', value: input.metadata?.nationalAnnex || 'UK National Annex / project default' }
      ],
      substitution: `${ulsNote || lc.uls.note}; ${slsCombo?.note || lc.sls.note}`,
      unitConversion: 'Loads entered in project units are converted to kN and kN m internally before design checks.',
      result: `ULS: ${ulsNote || lc.uls.note}; SLS: ${slsCombo?.note || lc.sls.note}`,
      resistance: 'Not applicable',
      utilisation: 'Not applicable',
      status: 'INFO',
      warnings: audit.metadataOnlyWarnings || []
    }),
    buildCalculationObject({
      id: 'support-reactions',
      title: 'Support reactions',
      codeReference: 'Elastic beam analysis, equilibrium',
      equation: 'K d = F, reactions R = Kd - F',
      variables: [
        { symbol: 'L', value: valueUnit(L, 'm') },
        { symbol: 'Support condition', value: SUPPORT_LABELS[supportType] || supportType },
        { symbol: 'Max |R|', value: valueUnit(unit.fromBaseForce(maxReaction), unit.forceShort) }
      ],
      derivations: [
        buildDerivation('Load model', 'Entered permanent, variable and moment actions are converted to kN/kN m and assembled into the server beam model.', 'F_ULS = cG G + cQ1 Q1 + cQ2 Q2', ulsNote || lc.uls.note, 'ULS load vector assembled', 'Backend finite-element beam analysis'),
        buildDerivation('R', 'Support reactions are recovered after solving the beam stiffness equations.', 'R = Kd - F', 'Solve Kd = F using the selected support condition and active loads.', `Max |R| = ${valueUnit(unit.fromBaseForce(maxReaction), unit.forceShort)}`, 'Elastic beam analysis')
      ],
      substitution: 'Server finite-element beam model assembled from entered loads and supports.',
      unitConversion: `R[kN] converted to ${unit.forceShort} for display.`,
      result: `Maximum reaction = ${valueUnit(unit.fromBaseForce(maxReaction), unit.forceShort)}`,
      resistance: 'Support reaction is an action result; support shear resistance checked separately.',
      utilisation: 'See support/web check.',
      status: 'INFO',
      warnings: []
    }),
    buildCalculationObject({
      id: 'bending-resistance',
      title: 'Major-axis bending resistance',
      codeReference: 'EN 1993-1-1 Clause 6.2.5',
      equation: 'M_y,Rd = W_y f_y / gamma_M0',
      variables: [
        { symbol: 'W_y', value: valueUnit(check.Wsel.W, 'mm^3', 0) },
        { symbol: 'f_y', value: valueUnit(material.fy, 'MPa', 0) },
        { symbol: 'gamma_M0', value: round(settings.gammaM0, 3) },
        { symbol: 'M_y,Ed', value: valueUnit(unit.fromBaseMoment(check.MyEd), unit.momentShort) }
      ],
      derivations: [
        buildDerivation('M_y,Ed', 'Design bending action used in the code-check controls.', 'M_y,Ed = max |M_y(x)| from ULS beam analysis', `${ulsNote || lc.uls.note}; peak at x = ${round(uls.peakM.x, 5)} m`, valueUnit(unit.fromBaseMoment(check.MyEd), unit.momentShort), 'Server beam analysis'),
        buildDerivation('W_y', 'Section modulus selected from the section class.', 'Class 1-2: Wpl,y; Class 3: Wel,y; Class 4: Weff,y', `Class ${check.cls} -> ${check.Wsel.label}`, valueUnit(check.Wsel.W, 'mm^3', 0), check.Wsel.source || 'Section database'),
        buildDerivation('M_y,Rd', 'Major-axis cross-section bending resistance before high-shear reduction.', 'M_y,Rd = W_y f_y / gamma_M0', `${round(check.Wsel.W, 0)} x ${round(material.fy, 0)} / ${round(settings.gammaM0, 3)} / 10^6`, valueUnit(unit.fromBaseMoment(check.MyRd), unit.momentShort), 'EN 1993-1-1 6.2.5'),
        ...(check.mv?.trigger ? [
          buildDerivation('rho', 'High shear reduction factor because VEd exceeds 0.5 VRd.', 'rho = (2 VEd / VRd - 1)^2', `(2 x ${round(check.mv.ratio, 5)} - 1)^2`, round(check.mv.rho, 5), 'EN 1993-1-1 6.2.8'),
          buildDerivation('W_web', 'Plastic modulus contribution of the web used for shear-reduced bending resistance.', 'W_web = tw hw^2 / 4', `${round(check.mv.webWpl || 0, 0)} mm^3`, valueUnit(check.mv.webWpl || 0, 'mm^3', 0), 'Section geometry'),
          buildDerivation('M_v,y,Rd', 'Bending resistance reduced for high shear.', 'M_v,y,Rd = W_v,y f_y / gamma_M0', `${round(check.mv.reducedW || check.Wsel.W, 0)} x ${round(material.fy, 0)} / ${round(settings.gammaM0, 3)} / 10^6`, valueUnit(unit.fromBaseMoment(check.MvRd), unit.momentShort), 'EN 1993-1-1 6.2.8')
        ] : []),
        buildDerivation('IR_M', 'Utilisation ratio shown in Section Control.', `IR_M = M_y,Ed / ${check.momentLabelForCheck}`, `${round(unit.fromBaseMoment(check.MyEd), 5)} / ${round(unit.fromBaseMoment(check.momentRdForCheck), 5)}`, round(check.IR_M, 5), 'Code-check controls')
      ],
      substitution: `${round(check.Wsel.W, 0)} mm^3 x ${material.fy} N/mm^2 / ${round(settings.gammaM0, 3)}`,
      unitConversion: 'N mm converted to kN m by dividing by 1,000,000, then to display units.',
      result: `M_y,Rd = ${valueUnit(unit.fromBaseMoment(check.momentRdForCheck), unit.momentShort)}`,
      resistance: valueUnit(unit.fromBaseMoment(check.momentRdForCheck), unit.momentShort),
      utilisation: `IR = M_y,Ed / M_y,Rd = ${round(check.IR_M, 5)}`,
      status: passFail(check.passM),
      warnings: [
        check.Wsel.unavailable ? `Required ${check.Wsel.missing} is missing; Class ${check.cls} bending resistance is not verified.` : null,
        check.mv.trigger ? check.mv.note : null
      ].filter(Boolean)
    }),
    buildCalculationObject({
      id: 'shear-resistance',
      title: 'Shear resistance',
      codeReference: 'EN 1993-1-1 Clause 6.2.6',
      equation: 'V_pl,Rd = A_v f_y / (sqrt(3) gamma_M0)',
      variables: [
        { symbol: 'A_v,z', value: valueUnit(section.Avz_mm2 || 0, 'mm^2', 0) },
        { symbol: 'f_y', value: valueUnit(material.fy, 'MPa', 0) },
        { symbol: 'gamma_M0', value: round(settings.gammaM0, 3) },
        { symbol: 'V_z,Ed', value: valueUnit(unit.fromBaseForce(check.VzEd), unit.forceShort) }
      ],
      derivations: [
        buildDerivation('V_z,Ed', 'Design shear action used in the code-check controls.', 'V_z,Ed = max |V_z(x)| from ULS beam analysis', `${ulsNote || lc.uls.note}; peak at x = ${round(uls.peakV.x, 5)} m`, valueUnit(unit.fromBaseForce(check.VzEd), unit.forceShort), 'Server beam analysis'),
        buildDerivation('A_v,z', 'Published shear area used for vertical shear resistance.', 'A_v,z = tabulated section shear area', valueUnit(section.Avz_mm2 || 0, 'mm^2', 0), valueUnit(section.Avz_mm2 || 0, 'mm^2', 0), 'Section database'),
        buildDerivation('V_z,Rd', 'Plastic shear resistance.', 'V_z,Rd = A_v,z f_y / (sqrt(3) gamma_M0)', `${round(section.Avz_mm2 || 0, 0)} x ${round(material.fy, 0)} / (sqrt(3) x ${round(settings.gammaM0, 3)}) / 1000`, valueUnit(unit.fromBaseForce(check.VzRd), unit.forceShort), 'EN 1993-1-1 6.2.6'),
        buildDerivation('IR_V', 'Utilisation ratio shown in Section Control.', 'IR_V = V_z,Ed / V_z,Rd', `${round(unit.fromBaseForce(check.VzEd), 5)} / ${round(unit.fromBaseForce(check.VzRd), 5)}`, round(check.IR_V, 5), 'Code-check controls')
      ],
      substitution: `${round(section.Avz_mm2 || 0, 0)} mm^2 x ${material.fy} N/mm^2 / (sqrt(3) x ${round(settings.gammaM0, 3)})`,
      unitConversion: 'N converted to kN by dividing by 1,000, then to display units.',
      result: `V_z,Rd = ${valueUnit(unit.fromBaseForce(check.VzRd), unit.forceShort)}`,
      resistance: valueUnit(unit.fromBaseForce(check.VzRd), unit.forceShort),
      utilisation: `IR = V_z,Ed / V_z,Rd = ${round(check.IR_V, 5)}`,
      status: passFail(check.passV),
      warnings: []
    }),
    buildCalculationObject({
      id: 'axial-resistance',
      title: 'Axial resistance',
      codeReference: 'EN 1993-1-1 Clause 6.2.3 / 6.2.4',
      equation: 'N_c,Rd = A f_y / gamma_M0; N_t,Rd = A f_y / gamma_M0',
      variables: [
        { symbol: 'A', value: valueUnit(check.areas.A || 0, 'mm^2', 0) },
        { symbol: 'A_eff', value: valueUnit(check.areas.Aeff || check.areas.A || 0, 'mm^2', 0) },
        { symbol: 'N_Ed', value: valueUnit(unit.fromBaseForce(check.axialEd), unit.forceShort) }
      ],
      derivations: [
        buildDerivation('N_Ed', 'Design axial action used in the axial and interaction checks.', 'N_Ed = cG N_G + cQ1 N_Q1 + cQ2 N_Q2', `${round(ulsCoeff?.cG ?? 0, 5)} x ${round(input.axial?.G || 0, 5)} + ${round(ulsCoeff?.cQ1 ?? 0, 5)} x ${round(input.axial?.Q1 || 0, 5)} + ${round(ulsCoeff?.cQ2 ?? 0, 5)} x ${round(input.axial?.Q2 || 0, 5)}`, valueUnit(unit.fromBaseForce(check.axialEd), unit.forceShort), ulsNote || lc.uls.note),
        buildDerivation('A / A_eff', 'Compression uses effective area for Class 4 where available; otherwise gross area is used.', 'Class 4: A_eff; Classes 1-3: A', `Class ${check.cls}; A = ${round(check.areas.A || 0, 0)} mm^2; A_eff = ${round(check.areas.Aeff || check.areas.A || 0, 0)} mm^2`, valueUnit(check.axialEd >= 0 ? (check.cls === 4 ? check.areas.Aeff : check.areas.A) : check.areas.A, 'mm^2', 0), 'Section database'),
        buildDerivation('N_Rd', 'Axial compression/tension resistance.', 'N_Rd = A f_y / gamma_M0', `${round((check.axialEd >= 0 ? (check.cls === 4 ? check.areas.Aeff : check.areas.A) : check.areas.A) || 0, 0)} x ${round(material.fy, 0)} / ${round(settings.gammaM0, 3)} / 1000`, valueUnit(unit.fromBaseForce(check.axialEd >= 0 ? check.NcRd : check.NtRd), unit.forceShort), 'EN 1993-1-1 6.2.3/6.2.4'),
        buildDerivation('IR_N', 'Axial utilisation ratio.', 'IR_N = |N_Ed| / N_Rd', `${round(Math.abs(unit.fromBaseForce(check.axialEd)), 5)} / ${round(unit.fromBaseForce(check.axialEd >= 0 ? check.NcRd : check.NtRd), 5)}`, round(check.IR_N, 5), 'Code-check controls')
      ],
      substitution: `${round(check.areas.A || 0, 0)} mm^2 x ${material.fy} N/mm^2 / ${round(settings.gammaM0, 3)}`,
      unitConversion: 'N converted to kN by dividing by 1,000, then to display units.',
      result: `N_Rd = ${valueUnit(unit.fromBaseForce(check.axialEd >= 0 ? check.NcRd : check.NtRd), unit.forceShort)}`,
      resistance: valueUnit(unit.fromBaseForce(check.axialEd >= 0 ? check.NcRd : check.NtRd), unit.forceShort),
      utilisation: `IR = N_Ed / N_Rd = ${round(check.IR_N, 5)}`,
      status: passFail(check.passN),
      warnings: Math.abs(check.axialEd) < 1e-9 ? ['No axial design action entered.'] : []
    }),
    buildCalculationObject({
      id: 'deflection',
      title: 'Serviceability deflection',
      codeReference: 'EN 1993-1-1 Clause 7.2 and project deflection limit',
      equation: 'delta_IR = delta_max / delta_allow; delta_allow = L / limit',
      variables: [
        { symbol: 'L', value: valueUnit(L * 1000, 'mm', 0) },
        { symbol: 'Limit', value: `L/${settings.deflectionLimit}` },
        { symbol: 'delta_max', value: valueUnit(deflPeak, 'mm') }
      ],
      derivations: [
        buildDerivation('delta_max', 'Maximum serviceability deflection from the SLS beam analysis.', 'delta_max = max |delta(x)| from SLS analysis', slsCombo?.note || lc.sls.note, valueUnit(deflPeak, 'mm'), 'Server beam analysis'),
        buildDerivation('delta_allow / dzMax', 'Allowable deflection used in the code-check controls.', 'dzMax = L / limit', `${round(L * 1000, 0)} / ${round(settings.deflectionLimit, 0)}`, valueUnit(deflAllow_mm, 'mm'), 'Project deflection limit'),
        buildDerivation('IR_defl', 'Deflection utilisation ratio shown in Deflection Control.', 'IR = dz / dzMax', `${round(deflPeak, 5)} / ${round(deflAllow_mm, 5)}`, round(deflIR, 5), 'Code-check controls')
      ],
      substitution: `delta_allow = ${round(L * 1000, 0)} mm / ${round(settings.deflectionLimit, 0)}`,
      unitConversion: 'Finite element deflection is calculated in mm.',
      result: `delta_allow = ${valueUnit(deflAllow_mm, 'mm')}`,
      resistance: valueUnit(deflAllow_mm, 'mm'),
      utilisation: `IR = ${round(deflIR, 5)}`,
      status: passFail(deflPeak <= deflAllow_mm),
      warnings: []
    }),
    buildCalculationObject({
      id: 'section-classification',
      title: 'Section classification',
      codeReference: 'EN 1993-1-1 Clause 5.5',
      equation: 'Section class selected from project input and used to choose W_pl, W_el or W_eff.',
      variables: [
        { symbol: 'Selected class', value: `Class ${check.cls}` },
        { symbol: 'Resistance modulus', value: check.Wsel.label }
      ],
      derivations: [
        buildDerivation('Class', 'Section class currently comes from the project input.', 'Designer-selected EC3 section class', `sectionClass = ${check.cls}`, `Class ${check.cls}`, 'Project input'),
        buildDerivation('W selection', 'The selected class controls the resistance modulus used for My,Rd.', 'Class 1-2 -> Wpl,y; Class 3 -> Wel,y; Class 4 -> Weff,y', `Class ${check.cls} selects ${check.Wsel.label}`, check.Wsel.label, 'EN 1993-1-1 5.5')
      ],
      substitution: `Class ${check.cls} uses ${check.Wsel.label}.`,
      unitConversion: 'Not applicable.',
      result: `Section class = ${check.cls}`,
      resistance: check.Wsel.label,
      utilisation: 'Not applicable.',
      status: 'INFO',
      warnings: ['Automatic plate-element classification is not performed; selected class must be justified by the designer.']
    }),
    buildCalculationObject({
      id: 'ltb',
      title: 'Lateral torsional buckling',
      codeReference: 'EN 1993-1-1 Clause 6.3.2',
      equation: 'M_b,Rd = chi_LT W_y f_y / gamma_M1',
      variables: ltb.enabled && ltb.available ? [
        { symbol: 'M_cr', value: valueUnit(unit.fromBaseMoment(ltb.Mcr), unit.momentShort) },
        { symbol: 'lambda_LT', value: round(ltb.lambdaLT, 5) },
        { symbol: 'chi_LT', value: round(ltb.chiLT, 5) },
        { symbol: 'L_b', value: valueUnit(ltb.Lb_mm, 'mm', 0) }
      ] : [{ symbol: 'LTB', value: ltb.enabled ? (ltb.notRequired ? 'Not required' : 'Unavailable') : 'Disabled' }],
      derivations: ltb.enabled && ltb.available ? [
        buildDerivation('L_b', 'Unrestrained length for LTB.', 'L_b = k L_segment', `${round(ltb.k, 5)} x ${round(ltb.Lsegment_mm, 0)} mm`, valueUnit(ltb.Lb_mm, 'mm', 0), 'LTB restraints input'),
        buildDerivation('M_cr', 'Elastic critical moment used for LTB slenderness.', 'M_cr = C1 pi^2 E Iz / L_b^2 x (sqrt(Iw/Iz + L_b^2 G It/(pi^2 E Iz) + (C2 zg)^2) - C2 zg)', `C1=${round(ltb.C1, 3)}, C2=${round(ltb.C2, 3)}, zg=${round(ltb.zg, 3)} mm, L_b=${round(ltb.Lb_mm, 0)} mm`, valueUnit(unit.fromBaseMoment(ltb.Mcr), unit.momentShort), 'EN 1993-1-1 6.3.2 / NCCI Mcr expression'),
        buildDerivation('lambda_LT', 'Non-dimensional LTB slenderness.', 'lambda_LT = sqrt(W_y f_y / M_cr)', `sqrt(${round(check.Wsel.W, 0)} x ${round(material.fy, 0)} / (${round(ltb.Mcr, 5)} x 10^6))`, round(ltb.lambdaLT, 5), 'EN 1993-1-1 6.3.2'),
        buildDerivation('phi_LT', 'LTB reduction curve helper term.', 'phi_LT = 0.5[1 + alpha_LT(lambda_LT - lambda_0) + beta lambda_LT^2]', `alpha=${round(ltb.alphaLT, 3)}, lambda0=${round(ltb.lambda0, 3)}, beta=${round(ltb.beta, 3)}`, round(ltb.phiLT, 5), `LTB curve ${ltb.curveLT}`),
        buildDerivation('chi_LT', 'LTB reduction factor used in the code-check controls.', 'chi_LT = 1 / (phi_LT + sqrt(phi_LT^2 - lambda_LT^2))', `1 / (${round(ltb.phiLT, 5)} + sqrt(${round(ltb.phiLT, 5)}^2 - ${round(ltb.lambdaLT, 5)}^2))`, round(ltb.chiLT, 5), 'EN 1993-1-1 6.3.2'),
        buildDerivation('M_b,Rd', 'LTB bending resistance.', 'M_b,Rd = chi_LT W_y f_y / gamma_M1', `${round(ltb.chiLT, 5)} x ${round(check.Wsel.W, 0)} x ${round(material.fy, 0)} / ${round(settings.gammaM1, 3)} / 10^6`, valueUnit(unit.fromBaseMoment(ltb.MbRd), unit.momentShort), 'EN 1993-1-1 6.3.2'),
        buildDerivation('IR_LT', 'LTB utilisation ratio shown in Buckling Control.', 'IR_LT = M_y,Ed / M_b,Rd', `${round(unit.fromBaseMoment(check.MyEd), 5)} / ${round(unit.fromBaseMoment(ltb.MbRd), 5)}`, round(ltb.IR_LT, 5), 'Code-check controls')
      ] : [
        buildDerivation('LTB', 'LTB status used in the code-check controls.', 'Not applicable', ltb.message || 'LTB disabled by input.', ltb.enabled ? (ltb.notRequired ? 'Not required' : 'Unavailable') : 'Disabled', 'Backend check selection')
      ],
      substitution: ltb.enabled && ltb.available ? `${round(ltb.chiLT, 5)} x ${round(check.Wsel.W, 0)} mm^3 x ${material.fy} N/mm^2 / ${round(settings.gammaM1, 3)}` : (ltb.message || 'LTB disabled by input.'),
      unitConversion: 'N mm converted to kN m by dividing by 1,000,000, then to display units.',
      result: ltb.enabled && ltb.available ? `M_b,Rd = ${valueUnit(unit.fromBaseMoment(ltb.MbRd), unit.momentShort)}` : (ltb.message || 'LTB disabled'),
      resistance: ltb.enabled && ltb.available ? valueUnit(unit.fromBaseMoment(ltb.MbRd), unit.momentShort) : (ltb.notRequired ? 'Not required' : 'Not available'),
      utilisation: ltb.enabled && ltb.available ? `IR_LT = ${round(ltb.IR_LT, 5)}` : 'Not applicable',
      status: ltb.enabled ? (ltb.available ? passFail(ltb.pass) : (ltb.notRequired ? 'INFO' : 'WARNING')) : 'INFO',
      warnings: ltb.enabled && !ltb.available && !ltb.notRequired ? [ltb.message] : []
    }),
    buildCalculationObject({
      id: 'support-web',
      title: 'Support/web bearing screening',
      codeReference: 'EN 1993-1-5 style screening check',
      equation: 'IR = V_Ed / V_b,z,Rd',
      variables: [
        { symbol: 'V_Ed', value: valueUnit(unit.fromBaseForce(endSupport.Ved), unit.forceShort) },
        { symbol: 'V_b,z,Rd', value: valueUnit(unit.fromBaseForce(endSupport.VbRd), unit.forceShort) }
      ],
      derivations: [
        buildDerivation('V_Ed', 'Maximum support reaction used for support/web screening.', 'V_Ed = max |R_support|', `max support reaction from ULS analysis`, valueUnit(unit.fromBaseForce(endSupport.Ved), unit.forceShort), 'Server beam analysis'),
        buildDerivation('V_b,z,Rd', 'Screening resistance derived from shear resistance and end-post/stiffener settings.', 'V_b,z,Rd = factor x V_z,Rd', `${round(endSupport.factor, 5)} x ${round(unit.fromBaseForce(check.VzRd), 5)}`, valueUnit(unit.fromBaseForce(endSupport.VbRd), unit.forceShort), 'Backend support/web screening model'),
        buildDerivation('IR_support', 'Support/web screening utilisation.', 'IR = V_Ed / V_b,z,Rd', `${round(unit.fromBaseForce(endSupport.Ved), 5)} / ${round(unit.fromBaseForce(endSupport.VbRd), 5)}`, round(supportIR, 5), 'Code-check controls')
      ],
      substitution: `${round(unit.fromBaseForce(endSupport.Ved), 5)} / ${round(unit.fromBaseForce(endSupport.VbRd), 5)}`,
      unitConversion: `kN converted to ${unit.forceShort} for display.`,
      result: `Support IR = ${round(supportIR, 5)}`,
      resistance: valueUnit(unit.fromBaseForce(endSupport.VbRd), unit.forceShort),
      utilisation: `IR = ${round(supportIR, 5)}`,
      status: passFail(endSupport.pass),
      warnings: ['Support/web result is a screening check and may require detailed EN 1993-1-5 verification.']
    }),
    buildCalculationObject({
      id: 'member-buckling',
      title: 'Compression member buckling',
      codeReference: 'EN 1993-1-1 Clause 6.3.1 and 6.3.3',
      equation: 'N_b,Rd = chi A f_y / gamma_M1; interaction IR = N_Ed/N_b,Rd + k M_Ed/M_Rd',
      variables: memberBuckling.active && memberBuckling.available ? [
        { symbol: 'chi_y', value: round(memberBuckling.chiY, 5) },
        { symbol: 'chi_z', value: round(memberBuckling.chiZ, 5) },
        { symbol: 'N_b,y,Rd', value: valueUnit(unit.fromBaseForce(memberBuckling.NbYRd), unit.forceShort) },
        { symbol: 'N_b,z,Rd', value: valueUnit(unit.fromBaseForce(memberBuckling.NbZRd), unit.forceShort) }
      ] : [{ symbol: 'Member buckling', value: memberBuckling.active ? 'Unavailable' : 'Not active' }],
      derivations: memberBuckling.active && memberBuckling.available ? [
        buildDerivation('N_cr,y', 'Elastic critical buckling load about the y axis.', 'N_cr,y = pi^2 E Iy / L_ey^2', `Le,y = ${round(memberBuckling.ky, 5)} x ${round(L * 1000, 0)} mm`, valueUnit(unit.fromBaseForce(memberBuckling.NcrY), unit.forceShort), 'EN 1993-1-1 6.3.1'),
        buildDerivation('N_cr,z', 'Elastic critical buckling load about the z axis.', 'N_cr,z = pi^2 E Iz / L_ez^2', `Le,z = ${round(memberBuckling.kz, 5)} x ${round(L * 1000, 0)} mm`, valueUnit(unit.fromBaseForce(memberBuckling.NcrZ), unit.forceShort), 'EN 1993-1-1 6.3.1'),
        buildDerivation('lambda_y', 'Non-dimensional y-axis buckling slenderness.', 'lambda_y = sqrt(N_pl,Rd / N_cr,y)', `sqrt(${round(unit.fromBaseForce(memberBuckling.NplRd), 5)} / ${round(unit.fromBaseForce(memberBuckling.NcrY), 5)})`, round(memberBuckling.lambdaY, 5), `Buckling curve ${memberBuckling.curveY}`),
        buildDerivation('lambda_z', 'Non-dimensional z-axis buckling slenderness.', 'lambda_z = sqrt(N_pl,Rd / N_cr,z)', `sqrt(${round(unit.fromBaseForce(memberBuckling.NplRd), 5)} / ${round(unit.fromBaseForce(memberBuckling.NcrZ), 5)})`, round(memberBuckling.lambdaZ, 5), `Buckling curve ${memberBuckling.curveZ}`),
        buildDerivation('chi_y / chi_z', 'Buckling reduction factors from the selected curves.', 'chi = 1 / (phi + sqrt(phi^2 - lambda^2))', `chi_y=${round(memberBuckling.chiY, 5)}, chi_z=${round(memberBuckling.chiZ, 5)}`, `${round(memberBuckling.chiY, 5)} / ${round(memberBuckling.chiZ, 5)}`, 'EN 1993-1-1 6.3.1'),
        buildDerivation('N_b,y,Rd / N_b,z,Rd', 'Axis-specific compression member buckling resistances.', 'N_b,Rd = chi N_pl,Rd', `${round(memberBuckling.chiY, 5)} x ${round(unit.fromBaseForce(memberBuckling.NplRd), 5)}; ${round(memberBuckling.chiZ, 5)} x ${round(unit.fromBaseForce(memberBuckling.NplRd), 5)}`, `${valueUnit(unit.fromBaseForce(memberBuckling.NbYRd), unit.forceShort)} / ${valueUnit(unit.fromBaseForce(memberBuckling.NbZRd), unit.forceShort)}`, 'EN 1993-1-1 6.3.1'),
        buildDerivation('IR_y', 'y-axis member interaction shown in Buckling Control.', 'IR_y = N_Ed/N_b,y,Rd + kyy M_y,Ed/(chi_LT M_y,Rd)', `${round(unit.fromBaseForce(check.axialEd), 5)} / ${round(unit.fromBaseForce(memberBuckling.NbYRd), 5)} + ${round(memberBuckling.kyy, 3)} x ${round(unit.fromBaseMoment(check.MyEd), 5)} / (${round(ltb.enabled && ltb.available ? ltb.chiLT : 1, 5)} x ${round(unit.fromBaseMoment(check.MyRd), 5)})`, round(memberBuckling.IRy, 5), 'EN 1993-1-1 6.3.3'),
        buildDerivation('IR_z', 'z-axis member interaction shown in Buckling Control.', 'IR_z = N_Ed/N_b,z,Rd + kzy M_y,Ed/(chi_LT M_y,Rd)', `${round(unit.fromBaseForce(check.axialEd), 5)} / ${round(unit.fromBaseForce(memberBuckling.NbZRd), 5)} + ${round(memberBuckling.kzy, 3)} x ${round(unit.fromBaseMoment(check.MyEd), 5)} / (${round(ltb.enabled && ltb.available ? ltb.chiLT : 1, 5)} x ${round(unit.fromBaseMoment(check.MyRd), 5)})`, round(memberBuckling.IRz, 5), 'EN 1993-1-1 6.3.3')
      ] : [
        buildDerivation('Member buckling', 'Compression member buckling status used in the code-check controls.', 'Active only for compression axial force', memberBuckling.message || 'No compression force applied.', memberBuckling.active ? 'Unavailable' : 'Not active', 'Backend check selection')
      ],
      substitution: memberBuckling.active && memberBuckling.available ? `max(IR_y=${round(memberBuckling.IRy, 5)}, IR_z=${round(memberBuckling.IRz, 5)})` : (memberBuckling.message || 'No compression force applied.'),
      unitConversion: 'N converted to kN by dividing by 1,000, then to display units.',
      result: memberBuckling.active && memberBuckling.available ? `Governing member buckling IR = ${round(memberBuckling.governing, 5)}` : (memberBuckling.message || 'Not active'),
      resistance: memberBuckling.active && memberBuckling.available ? `${valueUnit(unit.fromBaseForce(memberBuckling.NbYRd), unit.forceShort)} / ${valueUnit(unit.fromBaseForce(memberBuckling.NbZRd), unit.forceShort)}` : 'Not applicable',
      utilisation: memberBuckling.active && memberBuckling.available ? `IR = ${round(memberBuckling.governing, 5)}` : 'Not applicable',
      status: memberBuckling.active ? (memberBuckling.available ? passFail(memberBuckling.pass) : 'WARNING') : 'INFO',
      warnings: memberBuckling.active && !memberBuckling.available ? [memberBuckling.message] : []
    }),
    buildCalculationObject({
      id: 'combined-interaction',
      title: 'Combined axial and bending interaction',
      codeReference: 'EN 1993-1-1 Clause 6.2.9 / 6.3.3 simplified interaction',
      equation: 'IR = N_Ed/N_Rd + M_y,Ed/M_y,Rd',
      variables: [
        { symbol: 'N_Ed/N_Rd', value: round(check.IR_N, 5) },
        { symbol: 'M_y,Ed/M_y,Rd', value: round(check.MyEd / Math.max(check.momentRdForCheck, 1e-9), 5) }
      ],
      derivations: [
        buildDerivation('N_Ed/N_Rd', 'Axial part of the combined cross-section interaction.', 'N_Ed/N_Rd', `${round(Math.abs(unit.fromBaseForce(check.axialEd)), 5)} / ${round(unit.fromBaseForce(check.axialEd >= 0 ? check.NcRd : check.NtRd), 5)}`, round(check.IR_N, 5), 'Axial resistance check'),
        buildDerivation('M_y,Ed/M_y,Rd', 'Bending part of the combined cross-section interaction.', `M_y,Ed/${check.momentLabelForCheck}`, `${round(unit.fromBaseMoment(check.MyEd), 5)} / ${round(unit.fromBaseMoment(check.momentRdForCheck), 5)}`, round(check.MyEd / Math.max(check.momentRdForCheck, 1e-9), 5), 'Bending resistance check'),
        buildDerivation('IR_NM', 'Combined interaction ratio shown in Section Control when axial force is present.', 'IR_NM = N_Ed/N_Rd + M_y,Ed/M_y,Rd', `${round(check.IR_N, 5)} + ${round(check.MyEd / Math.max(check.momentRdForCheck, 1e-9), 5)}`, round(IR_NM, 5), 'Code-check controls')
      ],
      substitution: `${round(check.IR_N, 5)} + ${round(check.MyEd / Math.max(check.momentRdForCheck, 1e-9), 5)}`,
      unitConversion: 'Dimensionless utilisation ratio.',
      result: `IR_NM = ${round(IR_NM, 5)}`,
      resistance: 'Combined interaction limit = 1.0',
      utilisation: `IR = ${round(IR_NM, 5)}`,
      status: Math.abs(check.axialEd) > 1e-9 ? passFail(passNM) : 'INFO',
      warnings: Math.abs(check.axialEd) > 1e-9 ? [] : ['No axial action entered; combined interaction is not governing.']
    }),
    buildCalculationObject({
      id: 'governing-summary',
      title: 'Governing utilisation',
      codeReference: 'Project acceptance criterion',
      equation: 'Governing IR = max(all active utilisation ratios)',
      variables: [
        { symbol: 'Moment IR', value: round(check.IR_M, 5) },
        { symbol: 'Shear IR', value: round(check.IR_V, 5) },
        { symbol: 'Deflection IR', value: round(deflIR, 5) },
        { symbol: 'Support IR', value: round(supportIR, 5) }
      ],
      substitution: `max(...) = ${round(governingIR, 5)}`,
      unitConversion: 'Dimensionless utilisation ratio.',
      result: `Governing IR = ${round(governingIR, 5)}`,
      resistance: 'Limit = 1.0',
      utilisation: `IR = ${round(governingIR, 5)}`,
      status: passFail(passAll),
      warnings
    })
  ];
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    designCode: input.metadata?.designCode || 'EN 1993-1-1',
    nationalAnnex: input.metadata?.nationalAnnex || 'UK National Annex / project default',
    assumptions: [
      `Support condition modelled as ${SUPPORT_LABELS[supportType] || supportType}.`,
      `COLBEAM support mapping: ${audit.model.colbeamSupportMappingLabel}. ${audit.model.supportEquivalenceNote}`,
      `Load combination: ${lc.name}.`,
      `SLS deflection basis used: ${slsCombo?.basis || 'total'}; self-weight ${slsCombo?.includeSelfWeight === false ? 'excluded' : 'included'} for SLS deflection.`,
      `Custom ULS factors recorded for audit: G=${audit.combination.customULSFactors.G}, Q1=${audit.combination.customULSFactors.Q1}, Q2=${audit.combination.customULSFactors.Q2}.`,
      `Custom SLS factors recorded for audit: G=${audit.combination.customSLSFactors.G}, Q1=${audit.combination.customSLSFactors.Q1}, Q2=${audit.combination.customSLSFactors.Q2}.`,
      rawLoads.udls.some((u) => u.isSelf) ? 'Self weight included from section mass.' : 'Self weight not included.',
      `gamma_M0 = ${settings.gammaM0}; gamma_M1 = ${settings.gammaM1}.`,
      settings.enableLTB ? `LTB enabled with ${settings.ltbRestraints} intermediate restraints.` : 'LTB disabled by user input.',
      `Section data source: ${source.title}.`
    ],
    revisionHistory: [{
      revision: input.metadata?.revision || '-',
      date: input.metadata?.date || new Date().toISOString().slice(0, 10),
      description: input.metadata?.revisionDescription || 'Current calculation issue',
      preparedBy: input.metadata?.engineerName || '-',
      checkedBy: input.metadata?.checkedBy || '-',
      approvedBy: input.metadata?.approvedBy || '-'
    }],
    colbeamAudit: audit,
    warnings,
    calculations
  };
}

function buildCodeCheckControls({
  unit,
  L,
  uls,
  check,
  ltb,
  memberBuckling,
  deflPeak,
  deflAllow_mm,
  deflIR,
  passDefl,
  IR_NM,
  passNM
}) {
  const force = (value) => fmtControl(unit.fromBaseForce(value), 1);
  const moment = (value) => fmtControl(unit.fromBaseMoment(value), 1);
  const ratioLine = (prefix, ratio, pass, suffix) => ({
    kind: 'ratio',
    prefix,
    ratio: fmtControlRatio(ratio),
    pass: Boolean(pass),
    suffix
  });
  const infoLine = (text) => ({ kind: 'info', text });

  const sectionLines = [
    ratioLine(
      `IR = My,Ed/My,Rd = ${moment(check.MyEd)}/${moment(check.MyRd)} = `,
      check.IR_My,
      check.momentAvailable && check.IR_My < 1,
      ` ${comparisonText(check.IR_My)} (${fmtXL(uls.peakM.x, L)}; Ch 6.2.5)`
    )
  ];

  if (check.Wsel.unavailable) {
    sectionLines.unshift(infoLine(`Class ${check.cls} effective section property ${check.Wsel.missing} is missing; bending resistance is not verified.`));
  }

  if (check.mv?.trigger) {
    const mvDen = check.mv.available ? check.MvRd : check.MyRd;
    const mvIr = check.MyEd / Math.max(mvDen, 1e-9);
    sectionLines.push(ratioLine(
      `IR = My,Ed/Mv,y,Rd = ${moment(check.MyEd)}/${moment(mvDen)} = `,
      mvIr,
      mvIr < 1,
      ` ${comparisonText(mvIr)} (${fmtXL(uls.peakM.x, L)}; Ch 6.2.8)`
    ));
  }

  if (Math.abs(check.axialEd) > 1e-9) {
    const axialDen = check.axialEd >= 0 ? check.NcRd : check.NtRd;
    sectionLines.push(ratioLine(
      `IR = NEd/NRd+My,Ed/My,Rd = ${force(Math.abs(check.axialEd))}/${force(axialDen)}+${moment(check.MyEd)}/${moment(check.momentRdForCheck)} = `,
      IR_NM,
      passNM,
      ` ${comparisonText(IR_NM)} (${fmtXL(uls.peakM.x, L)}; Ch 6.2.1/6.2.9)`
    ));
  }

  sectionLines.push(ratioLine(
    `IR = Vz,Ed/Vz,Rd = ${force(check.VzEd)}/${force(check.VzRd)} = `,
    check.IR_V,
    check.passV,
    ` ${comparisonText(check.IR_V)} (${fmtXL(uls.peakV.x, L)}; Ch 6.2.6)`
  ));

  const bucklingLines = [];
  const chiLT = ltb.enabled && ltb.available ? ltb.chiLT : 1;
  if (memberBuckling.active && memberBuckling.available) {
    bucklingLines.push(ratioLine(
      `IR = NEd/Nb,y,Rd + kyy*My,Ed/(χLT*My,Rd) = ${force(check.axialEd)}/${force(memberBuckling.NbYRd)}+${fmtControl(memberBuckling.kyy, 2)}*${moment(check.MyEd)}/(${fmtControl(chiLT, 2)}*${moment(check.MyRd)}) = `,
      memberBuckling.IRy,
      memberBuckling.IRy < 1,
      ` ${comparisonText(memberBuckling.IRy)} (Ch 6.3.3)`
    ));
    bucklingLines.push(ratioLine(
      `IR = NEd/Nb,z,Rd + kzy*My,Ed/(χLT*My,Rd) = ${force(check.axialEd)}/${force(memberBuckling.NbZRd)}+${fmtControl(memberBuckling.kzy, 2)}*${moment(check.MyEd)}/(${fmtControl(chiLT, 2)}*${moment(check.MyRd)}) = `,
      memberBuckling.IRz,
      memberBuckling.IRz < 1,
      ` ${comparisonText(memberBuckling.IRz)} (Ch 6.3.3)`
    ));
  } else if (memberBuckling.active) {
    bucklingLines.push(infoLine(memberBuckling.message || 'Member buckling interaction is unavailable for this section/loading.'));
  } else {
    bucklingLines.push(infoLine('No axial compression applied, so compression member buckling interaction is not required.'));
  }

  if (ltb.enabled && ltb.available) {
    bucklingLines.push(ratioLine(
      `IR = My,Ed/(χLT*My,Rd) = ${moment(check.MyEd)}/(${fmtControl(ltb.chiLT, 2)}*${moment(check.MyRd)}) = `,
      ltb.IR_LT,
      ltb.pass,
      ` ${comparisonText(ltb.IR_LT)} (Ch 6.3.2)`
    ));
  } else if (ltb.enabled && ltb.notRequired) {
    bucklingLines.push(infoLine(ltb.message || 'Lateral torsional buckling check is not required for this section.'));
  } else if (ltb.enabled) {
    bucklingLines.push(infoLine(ltb.message || 'Lateral torsional buckling check is unavailable for this section/loading.'));
  } else {
    bucklingLines.push(infoLine('Lateral torsional buckling check disabled.'));
  }

  return {
    title: 'Results',
    sections: [
      { heading: 'SECTION CONTROL:', lines: sectionLines },
      { heading: 'BUCKLING CONTROL: (incl Lateral Torsional Buckling)', lines: bucklingLines },
      {
        heading: `DEFLECTION CONTROL: (L/${Math.round(L * 1000 / Math.max(deflAllow_mm, 1e-9))})`,
        lines: [
          ratioLine(
            `IR = dz/dzMax = ${fmtControl(deflPeak, 1)}/${fmtControl(deflAllow_mm, 1)} = `,
            deflIR,
            passDefl,
            ` ${comparisonText(deflIR)}`
          )
        ]
      }
    ]
  };
}

function calculateBeam(input) {
  const sectionRef = input.section || {};
  const section = getSection(sectionRef.family, sectionRef.name);
  if (!section) {
    const err = new Error('Selected beam section was not found.');
    err.statusCode = 400;
    throw err;
  }
  const L = positiveNumber(input.model?.span, 0);
  if (!(L > 0 && L <= 200)) {
    const err = new Error('Enter a valid span between 0 and 200 m.');
    err.statusCode = 400;
    throw err;
  }
  const supportType = input.model?.supportType || 'ss';
  if (!Object.prototype.hasOwnProperty.call(SUPPORT_LABELS, supportType) || supportType === 'multi_continuous') {
    const err = new Error('Unsupported support condition.');
    err.statusCode = 400;
    throw err;
  }
  const unit = getUnit(input.units);
  const audit = normaliseColbeamAuditInput(input);
  const settings = {
    gammaM0: positiveNumber(input.settings?.gammaM0, 1),
    gammaM1: positiveNumber(input.settings?.gammaM1, 1),
    sectionClass: Number(input.settings?.sectionClass || 2),
    deflectionLimit: positiveNumber(input.settings?.deflectionLimit, 300),
    enableLTB: input.settings?.enableLTB !== false,
    ltbRestraints: finiteNumber(input.settings?.ltbRestraints, 0),
    ltbK: positiveNumber(input.settings?.ltbK, 1),
    ltbC1: positiveNumber(input.settings?.ltbC1, 1),
    ltbC2: finiteNumber(input.settings?.ltbC2, 0),
    ltbModel: input.settings?.ltbModel || 'rolled',
    ltbLoadLevel: input.settings?.ltbLoadLevel || 'shear_centre',
    endPostType: input.settings?.endPostType || 'flexible',
    webStiffener: input.settings?.webStiffener || 'none',
    bucklingKy: positiveNumber(input.settings?.bucklingKy, 1),
    bucklingKz: positiveNumber(input.settings?.bucklingKz, 1),
    bucklingCurveY: input.settings?.bucklingCurveY || 'auto',
    bucklingCurveZ: input.settings?.bucklingCurveZ || 'auto',
    kyy: finiteNumber(input.settings?.kyy, 1),
    kzy: finiteNumber(input.settings?.kzy, 0.6),
    audit
  };
  const material = getMaterialForSection(input.material?.grade || 'S355', section);
  const I = calcI_mm4(section);
  if (!(I > 0)) {
    const err = new Error('Selected section does not have a usable major-axis inertia.');
    err.statusCode = 400;
    throw err;
  }
  const lc = getLC(input.combination || {});
  const rawLoads = normaliseLoads(input, section, L, unit);
  const springs = {
    left: finiteNumber(input.model?.springLeftPct, 100),
    right: finiteNumber(input.model?.springRightPct, 100)
  };
  const evalCombo = (coeff, options = {}) => solveBeam({
    L,
    supportType,
    E_MPa: material.E,
    I_mm4: I,
    loads: applyCombo(rawLoads, coeff, unit, options),
    springs
  });
  let uls;
  let ulsNote;
  let ulsCoeff;
  if (lc.key === 'en1990_610ab') {
    const a = evalCombo(lc.uls);
    const b = evalCombo(lc.uls.alt);
    if ((b.peakM?.val || 0) > (a.peakM?.val || 0)) {
      uls = b;
      ulsNote = lc.uls.alt.note;
      ulsCoeff = lc.uls.alt;
    } else {
      uls = a;
      ulsNote = lc.uls.note;
      ulsCoeff = lc.uls;
    }
  } else {
    uls = evalCombo(lc.uls);
    ulsNote = lc.uls.note;
    ulsCoeff = lc.uls;
  }
  const slsCombo = buildSlsCombination(lc, audit);
  const sls = evalCombo(slsCombo.coeff, { excludeSelfWeight: slsCombo.excludeSelfWeight });
  const axialRaw = input.axial || {};
  const axialEd = unit.toBaseForce(ulsCoeff.cG * finiteNumber(axialRaw.G, 0) + ulsCoeff.cQ1 * finiteNumber(axialRaw.Q1, 0) + ulsCoeff.cQ2 * finiteNumber(axialRaw.Q2, 0));
  const check = buildSectionCheck(section, material, { peakM: uls.peakM, peakV: uls.peakV }, axialEd, settings);
  const ltb = evaluateLTB(section, material, L, uls.peakM.val, check.Wsel, settings);
  const endSupport = evaluateEndSupportCheck(check, uls, settings);
  const memberBuckling = evaluateMemberBuckling(section, material, check, L, ltb, settings);
  const deflAllow_mm = (L * 1000) / settings.deflectionLimit;
  const deflPeak = sls.defl.peakY.val;
  const passDefl = deflPeak <= deflAllow_mm;
  const passLTB = !ltb.enabled || ltb.notRequired || (ltb.available && ltb.pass);
  const passSupport = endSupport.pass;
  const baseMyRd = ltb.enabled && ltb.available ? Math.min(check.momentRdForCheck, ltb.MbRd) : check.momentRdForCheck;
  const IR_NM = check.IR_N + (check.MyEd / baseMyRd);
  const passNM = IR_NM < 1;
  const passMemberBuckling = !memberBuckling.active || (memberBuckling.available && memberBuckling.pass);
  const supportIR = endSupport.VbRd > 0 ? endSupport.Ved / endSupport.VbRd : 0;
  const deflIR = deflAllow_mm > 0 ? deflPeak / deflAllow_mm : 0;
  const governingIR = Math.max(
    check.IR_M,
    check.IR_V,
    Math.abs(check.IR_N || 0),
    deflIR,
    supportIR,
    ltb.enabled && ltb.available ? ltb.IR_LT : 0,
    Math.abs(check.axialEd) > 1e-9 ? IR_NM : 0,
    memberBuckling.active && memberBuckling.available ? memberBuckling.governing : 0
  );
  const passAll = check.passM && check.passV && check.passN && passDefl && passLTB && passSupport && passNM && passMemberBuckling;
  const maxReaction = Math.max(...((uls.reactions.supportActions || []).map((r) => Math.abs(r.V || 0)).concat([Math.abs(uls.reactions.leftVertical || 0), Math.abs(uls.reactions.rightVertical || 0)])));
  const fullSectionProperties = getFullSectionProperties(section, check);
  const calculationPackage = buildCalculationPackage({
    input,
    section,
    material,
    settings,
    unit,
    L,
    supportType,
    lc,
    ulsNote,
    ulsCoeff,
    rawLoads,
    uls,
    sls,
    slsCombo,
    check,
    ltb,
    endSupport,
    memberBuckling,
    deflAllow_mm,
    deflPeak,
    deflIR,
    supportIR,
    IR_NM,
    passNM,
    passAll,
    governingIR,
    maxReaction
  });
  return {
    calculationId: randomUUID(),
    generatedAt: new Date().toISOString(),
    status: passAll ? 'PASS' : 'FAIL',
    source: getSectionSourceInfo(section),
    inputEcho: {
      span: L,
      supportType,
      supportLabel: SUPPORT_LABELS[supportType],
      units: unit.key,
      material: material.grade,
      section: { family: section.family, name: section.name },
      combination: lc.name,
      colbeamAudit: audit
    },
    summary: {
      passAll,
      governingIR: round(governingIR, 5),
      maxMoment: round(unit.fromBaseMoment(uls.peakM.val), 5),
      maxShear: round(unit.fromBaseForce(uls.peakV.val), 5),
      maxReaction: round(unit.fromBaseForce(maxReaction), 5),
      deflection: round(deflPeak, 5),
      deflectionLimit: round(deflAllow_mm, 5),
      momentUnit: unit.momentShort,
      forceUnit: unit.forceShort
    },
    checks: {
      moment: { ir: round(check.IR_M, 5), pass: check.passM, resistance: round(unit.fromBaseMoment(check.momentRdForCheck), 5), label: check.momentLabelForCheck },
      shear: { ir: round(check.IR_V, 5), pass: check.passV, resistance: round(unit.fromBaseForce(check.VzRd), 5) },
      axial: { ir: round(check.IR_N, 5), pass: check.passN, axialEd: round(unit.fromBaseForce(check.axialEd), 5) },
      deflection: { ir: round(deflIR, 5), pass: passDefl },
      ltb: ltb.enabled ? { ir: ltb.available ? round(ltb.IR_LT, 5) : null, pass: Boolean(ltb.pass), available: Boolean(ltb.available), notRequired: Boolean(ltb.notRequired), message: ltb.message || null } : { enabled: false },
      support: { ir: round(supportIR, 5), pass: passSupport },
      combined: { ir: round(IR_NM, 5), pass: passNM },
      memberBuckling: memberBuckling.active ? { ir: memberBuckling.available ? round(memberBuckling.governing, 5) : null, pass: Boolean(memberBuckling.pass), available: Boolean(memberBuckling.available), message: memberBuckling.message || null } : { active: false }
    },
    codeCheckControls: buildCodeCheckControls({
      unit,
      L,
      uls,
      check,
      ltb,
      memberBuckling,
      deflPeak,
      deflAllow_mm,
      deflIR,
      passDefl,
      IR_NM,
      passNM
    }),
    loads: {
      raw: rawLoads,
      units: {
        force: unit.forceShort,
        moment: unit.momentShort,
        length: 'm'
      },
      combinations: {
        uls: ulsNote,
        sls: slsCombo.note,
        ulsCoefficients: { cG: round(ulsCoeff.cG, 6), cQ1: round(ulsCoeff.cQ1, 6), cQ2: round(ulsCoeff.cQ2, 6) },
        slsCoefficients: { cG: round(slsCombo.coeff.cG, 6), cQ1: round(slsCombo.coeff.cQ1, 6), cQ2: round(slsCombo.coeff.cQ2, 6) },
        slsDeflectionBasis: slsCombo.basis,
        slsIncludeSelfWeight: slsCombo.includeSelfWeight,
        perCheckEnvelopeEngineWired: false
      },
      colbeamAudit: {
        directions: {
          udls: rawLoads.udls.map((load) => ({ label: load.label, direction: load.direction || 'Z' })),
          points: rawLoads.points.map((load) => ({ label: load.label, direction: load.direction || 'Z' }))
        },
        axialSignConvention: audit.axial.signConvention
      }
    },
    actions: {
      ulsNote,
      slsNote: lc.sls.note,
      reactions: (uls.reactions.supportActions || []).map((r, index) => ({ support: index + 1, x: round(r.x, 5), vertical: round(unit.fromBaseForce(r.V || 0), 5), moment: round(unit.fromBaseMoment(r.M || 0), 5) })),
      peakMoment: { value: round(unit.fromBaseMoment(uls.peakM.val), 5), x: round(uls.peakM.x, 5), signed: round(unit.fromBaseMoment(uls.peakM.signed), 5) },
      peakShear: { value: round(unit.fromBaseForce(uls.peakV.val), 5), x: round(uls.peakV.x, 5), signed: round(unit.fromBaseForce(uls.peakV.signed), 5) }
    },
    sectionProperties: {
      ...fullSectionProperties,
      area: round(check.areas.A || 0, 3),
      inertiaY: round(I, 3),
      modulus: round(check.Wsel.W || 0, 3),
      modulusLabel: check.Wsel.label,
      source: check.Wsel.source,
      sourceReference: getSectionSourceInfo(section)
    },
    calculationPackage,
    diagrams: {
      series: sampleSeries(uls, sls),
      basis: {
        shear: 'ULS',
        moment: 'ULS',
        deflection: 'SLS'
      }
    }
  };
}

module.exports = { calculateBeam, UNIT_DEFS };
