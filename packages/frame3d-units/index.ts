import type { Frame3DDisplayUnits } from '../frame3d-schema';

export const INTERNAL_UNITS = {
  force: 'N',
  length: 'mm',
  stress: 'N/mm²',
  moment: 'N·mm',
  rotation: 'rad'
} as const;

export const displayLength = (value: number, units: Frame3DDisplayUnits): number => units.length === 'm' ? value / 1000 : value;
export const displayForce = (value: number, units: Frame3DDisplayUnits): number => units.force === 'kN' ? value / 1000 : value;
export const displayMoment = (value: number, units: Frame3DDisplayUnits): number => units.moment === 'kN·m' ? value / 1e6 : value;
export const lengthUnit = (units: Frame3DDisplayUnits): string => units.length;
export const forceUnit = (units: Frame3DDisplayUnits): string => units.force;
export const momentUnit = (units: Frame3DDisplayUnits): string => units.moment;

export function formatNumber(value: number, significant = 6): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) > 0 && (Math.abs(value) < 1e-4 || Math.abs(value) >= 1e7)) return value.toExponential(4);
  return Number(value.toPrecision(significant)).toLocaleString('en-GB', { maximumFractionDigits: 6 });
}
