'use strict';

const END_FORCE_SCHEMA_VERSION = 1;
const END_FORCE_KEYS = Object.freeze([
  'N_kN',
  'My1_kNm', 'My2_kNm',
  'Mz1_kNm', 'Mz2_kNm',
  'Vz1_kN', 'Vz2_kN',
  'Vy1_kN', 'Vy2_kN'
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normaliseAnalysisInputMode(value) {
  return value === 'endForces' ? 'endForces' : 'appliedLoads';
}

function normaliseEndForces(value = {}) {
  const normalised = { schemaVersion: END_FORCE_SCHEMA_VERSION };
  END_FORCE_KEYS.forEach((key) => {
    normalised[key] = finite(value[key], 0);
  });
  return normalised;
}

function linearValue(start, end, t) {
  return start + (end - start) * t;
}

function zeroCrossing(start, end, L) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return null;
  const t = -start / (end - start);
  return t > 0 && t < 1 ? t * L : null;
}

function peakOfLinear(start, end, L) {
  const atEnd2 = Math.abs(end) > Math.abs(start);
  return {
    val: Math.max(Math.abs(start), Math.abs(end)),
    signed: atEnd2 ? end : start,
    x: atEnd2 ? L : 0,
    xL: atEnd2 ? 1 : 0,
    end: atEnd2 ? 'End 2' : 'End 1'
  };
}

function buildDirectActionProfiles(endForces, L, sampleCount = 161) {
  const values = normaliseEndForces(endForces);
  const count = Math.max(2, Math.floor(finite(sampleCount, 161)));
  const series = Array.from({ length: count }, (_, index) => {
    const t = index / (count - 1);
    return {
      x: L * t,
      N: values.N_kN,
      My: linearValue(values.My1_kNm, values.My2_kNm, t),
      Mz: linearValue(values.Mz1_kNm, values.Mz2_kNm, t),
      Vz: linearValue(values.Vz1_kN, values.Vz2_kN, t),
      Vy: linearValue(values.Vy1_kN, values.Vy2_kN, t)
    };
  });
  return {
    schemaVersion: END_FORCE_SCHEMA_VERSION,
    mode: 'endForces',
    span_m: L,
    entered: values,
    series,
    peaks: {
      N: { val: Math.abs(values.N_kN), signed: values.N_kN, x: 0, xL: 0, end: 'Constant' },
      My: peakOfLinear(values.My1_kNm, values.My2_kNm, L),
      Mz: peakOfLinear(values.Mz1_kNm, values.Mz2_kNm, L),
      Vz: peakOfLinear(values.Vz1_kN, values.Vz2_kN, L),
      Vy: peakOfLinear(values.Vy1_kN, values.Vy2_kN, L)
    },
    zeroCrossings: {
      My: zeroCrossing(values.My1_kNm, values.My2_kNm, L),
      Mz: zeroCrossing(values.Mz1_kNm, values.Mz2_kNm, L),
      Vz: zeroCrossing(values.Vz1_kN, values.Vz2_kN, L),
      Vy: zeroCrossing(values.Vy1_kN, values.Vy2_kN, L)
    }
  };
}

module.exports = {
  END_FORCE_SCHEMA_VERSION,
  END_FORCE_KEYS,
  normaliseAnalysisInputMode,
  normaliseEndForces,
  linearValue,
  zeroCrossing,
  peakOfLinear,
  buildDirectActionProfiles
};
