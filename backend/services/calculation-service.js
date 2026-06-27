const { getMaterialForSection } = require('../data/materials');
const { getSection, getSectionSourceInfo } = require('./sections-service');
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

function getUnit(key) {
  return UNIT_DEFS[key] || UNIT_DEFS.tonne;
}

function getLC(input = {}) {
  const key = input.combination || 'en1990_610';
  const psi1 = clamp(finiteNumber(input.psiQ1, 0.7), 0, 1);
  const psi2 = clamp(finiteNumber(input.psiQ2, 0.7), 0, 1);
  const psiText = (n) => (n === 1 ? psi1 : psi2).toFixed(1);
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
  return { W: moduli.Wel, label: 'Wel,y (fallback - no Weff in DB)', source: moduli.source.Wel, fallback: true, missing: 'Weff_y_mm3' };
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
  const out = { trigger, available: false, ratio, rho: 0, MvRd: baseMyRd, label: 'My,Rd', note: 'Shear reduction not active' };
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
  if (!(webWpl > 0) || !(Wsel.W > webWpl)) {
    out.available = true;
    out.MvRd = baseMyRd;
    out.label = 'Mv,y,Rd';
    out.note = 'High-shear trigger active; detailed web dimensions are incomplete, so Mv,y,Rd is retained equal to My,Rd to match legacy behavior.';
    return out;
  }
  const reducedW = Math.max(0, Wsel.W - webWpl) + (1 - rho) * webWpl;
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
    passM: IR_M < 1,
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
      momentCase: ['G', 'Q1', 'Q2'].includes(load.momentCase) ? load.momentCase : 'G'
    });
  });
  if (model.includeSelfWeight !== false && section.mass_kg_m > 0) {
    const sw = unit.key === 'tonne' ? (section.mass_kg_m / 1000) : (section.mass_kg_m * g / 1000);
    raw.udls.push({ label: 'Self-weight', x1: 0, x2: L, G: sw, Q1: 0, Q2: 0, isSelf: true });
  }
  return raw;
}

function applyCombo(raw, coeff, unit) {
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
      w: unit.toBaseUdl(coeff.cG * u.G + coeff.cQ1 * u.Q1 + coeff.cQ2 * u.Q2)
    })).filter((u) => Math.abs(u.w) > 1e-12 && u.x2 > u.x1),
    supportXs: raw.supportXs.slice(),
    mode: raw.mode
  };
}

function sampleSeries(series, max = 161) {
  const { xs, V, M, defl } = series;
  const step = Math.max(1, Math.ceil(xs.length / max));
  return xs.filter((_, i) => i % step === 0 || i === xs.length - 1).map((x, i) => {
    const sourceIndex = Math.min(i * step, xs.length - 1);
    return {
      x: round(x, 5),
      shear: round(V[sourceIndex], 5),
      moment: round(M[sourceIndex], 5),
      deflection: round(interpolate(defl.xs, defl.Y, x), 5)
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
    kzy: finiteNumber(input.settings?.kzy, 0.6)
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
  const evalCombo = (coeff) => solveBeam({
    L,
    supportType,
    E_MPa: material.E,
    I_mm4: I,
    loads: applyCombo(rawLoads, coeff, unit),
    springs
  });
  let uls;
  let ulsNote;
  if (lc.key === 'en1990_610ab') {
    const a = evalCombo(lc.uls);
    const b = evalCombo(lc.uls.alt);
    if ((b.peakM?.val || 0) > (a.peakM?.val || 0)) {
      uls = b;
      ulsNote = lc.uls.alt.note;
    } else {
      uls = a;
      ulsNote = lc.uls.note;
    }
  } else {
    uls = evalCombo(lc.uls);
    ulsNote = lc.uls.note;
  }
  const sls = evalCombo(lc.sls);
  const axialRaw = input.axial || {};
  const axialEd = unit.toBaseForce(lc.uls.cG * finiteNumber(axialRaw.G, 0) + lc.uls.cQ1 * finiteNumber(axialRaw.Q1, 0) + lc.uls.cQ2 * finiteNumber(axialRaw.Q2, 0));
  const check = buildSectionCheck(section, material, { peakM: uls.peakM, peakV: uls.peakV }, axialEd, settings);
  const ltb = evaluateLTB(section, material, L, uls.peakM.val, check.Wsel, settings);
  const endSupport = evaluateEndSupportCheck(check, uls, settings);
  const memberBuckling = evaluateMemberBuckling(section, material, check, L, ltb, settings);
  const deflAllow_mm = (L * 1000) / settings.deflectionLimit;
  const deflPeak = sls.defl.peakY.val;
  const passDefl = deflPeak <= deflAllow_mm;
  const passLTB = !ltb.enabled || (ltb.available && ltb.pass);
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
      combination: lc.name
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
      ltb: ltb.enabled ? { ir: ltb.available ? round(ltb.IR_LT, 5) : null, pass: Boolean(ltb.pass), available: Boolean(ltb.available), message: ltb.message || null } : { enabled: false },
      support: { ir: round(supportIR, 5), pass: passSupport },
      combined: { ir: round(IR_NM, 5), pass: passNM },
      memberBuckling: memberBuckling.active ? { ir: memberBuckling.available ? round(memberBuckling.governing, 5) : null, pass: Boolean(memberBuckling.pass), available: Boolean(memberBuckling.available), message: memberBuckling.message || null } : { active: false }
    },
    actions: {
      ulsNote,
      slsNote: lc.sls.note,
      reactions: (uls.reactions.supportActions || []).map((r, index) => ({ support: index + 1, x: round(r.x, 5), vertical: round(unit.fromBaseForce(r.V || 0), 5), moment: round(unit.fromBaseMoment(r.M || 0), 5) })),
      peakMoment: { value: round(unit.fromBaseMoment(uls.peakM.val), 5), x: round(uls.peakM.x, 5), signed: round(unit.fromBaseMoment(uls.peakM.signed), 5) },
      peakShear: { value: round(unit.fromBaseForce(uls.peakV.val), 5), x: round(uls.peakV.x, 5), signed: round(unit.fromBaseForce(uls.peakV.signed), 5) }
    },
    sectionProperties: {
      area: round(check.areas.A || 0, 3),
      inertiaY: round(I, 3),
      modulus: round(check.Wsel.W || 0, 3),
      modulusLabel: check.Wsel.label,
      source: check.Wsel.source,
      sourceReference: getSectionSourceInfo(section)
    },
    diagrams: {
      series: sampleSeries(uls)
    }
  };
}

module.exports = { calculateBeam, UNIT_DEFS };
