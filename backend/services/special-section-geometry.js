'use strict';

const STEEL_DENSITY_KG_M3 = 7850;
const EPS = 1e-9;

function geometryError(message, code = 'invalid_special_section_geometry') {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

function finitePositive(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw geometryError(`${label} must be greater than zero.`);
  return n;
}

function rectangle(id, y0, z0, width, height, role = 'plate') {
  const values = { y0: Number(y0), z0: Number(z0), width: Number(width), height: Number(height) };
  if (!Number.isFinite(values.y0) || !Number.isFinite(values.z0)) throw geometryError(`${id} coordinates must be finite.`);
  finitePositive(values.width, `${id} width`);
  finitePositive(values.height, `${id} height`);
  return Object.freeze({ id, role, ...values, y1: values.y0 + values.width, z1: values.z0 + values.height });
}

function overlapArea(a, b) {
  const width = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const height = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return width > EPS && height > EPS ? width * height : 0;
}

function areaBelow(rect, axis, coordinate) {
  const lo = axis === 'z' ? rect.z0 : rect.y0;
  const hi = axis === 'z' ? rect.z1 : rect.y1;
  const transverse = axis === 'z' ? rect.width : rect.height;
  return Math.max(0, Math.min(hi, coordinate) - lo) * transverse;
}

function absoluteFirstMoment(rect, axis, neutral) {
  const lo = axis === 'z' ? rect.z0 : rect.y0;
  const hi = axis === 'z' ? rect.z1 : rect.y1;
  const transverse = axis === 'z' ? rect.width : rect.height;
  if (neutral <= lo) return transverse * ((hi - neutral) ** 2 - (lo - neutral) ** 2) / 2;
  if (neutral >= hi) return transverse * ((neutral - lo) ** 2 - (neutral - hi) ** 2) / 2;
  return transverse * ((neutral - lo) ** 2 + (hi - neutral) ** 2) / 2;
}

function plasticNeutralAxis(rectangles, axis, totalArea) {
  let low = Math.min(...rectangles.map((rect) => axis === 'z' ? rect.z0 : rect.y0));
  let high = Math.max(...rectangles.map((rect) => axis === 'z' ? rect.z1 : rect.y1));
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    const below = rectangles.reduce((sum, rect) => sum + areaBelow(rect, axis, mid), 0);
    if (below < totalArea / 2) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function deriveCompositeProperties(rawRectangles, options = {}) {
  if (!Array.isArray(rawRectangles) || !rawRectangles.length) throw geometryError('At least one plate component is required.');
  const rectangles = rawRectangles.map((item, index) => rectangle(
    item.id || `plate-${index + 1}`, item.y0, item.z0, item.width, item.height, item.role
  ));
  for (let i = 0; i < rectangles.length; i += 1) {
    for (let j = i + 1; j < rectangles.length; j += 1) {
      const overlap = overlapArea(rectangles[i], rectangles[j]);
      if (overlap > EPS) throw geometryError(`Plate components ${rectangles[i].id} and ${rectangles[j].id} overlap by ${overlap.toFixed(3)} mm2.`);
    }
  }
  const components = rectangles.map((rect) => {
    const area = rect.width * rect.height;
    return {
      ...rect,
      area_mm2: area,
      centroid_y_mm: rect.y0 + rect.width / 2,
      centroid_z_mm: rect.z0 + rect.height / 2,
      Iy_local_mm4: rect.width * rect.height ** 3 / 12,
      Iz_local_mm4: rect.height * rect.width ** 3 / 12
    };
  });
  const A = components.reduce((sum, item) => sum + item.area_mm2, 0);
  const cy = components.reduce((sum, item) => sum + item.area_mm2 * item.centroid_y_mm, 0) / A;
  const cz = components.reduce((sum, item) => sum + item.area_mm2 * item.centroid_z_mm, 0) / A;
  const Iy = components.reduce((sum, item) => sum + item.Iy_local_mm4 + item.area_mm2 * (item.centroid_z_mm - cz) ** 2, 0);
  const Iz = components.reduce((sum, item) => sum + item.Iz_local_mm4 + item.area_mm2 * (item.centroid_y_mm - cy) ** 2, 0);
  const minY = Math.min(...rectangles.map((item) => item.y0));
  const maxY = Math.max(...rectangles.map((item) => item.y1));
  const minZ = Math.min(...rectangles.map((item) => item.z0));
  const maxZ = Math.max(...rectangles.map((item) => item.z1));
  const pnaZ = plasticNeutralAxis(rectangles, 'z', A);
  const pnaY = plasticNeutralAxis(rectangles, 'y', A);
  const WplY = rectangles.reduce((sum, item) => sum + absoluteFirstMoment(item, 'z', pnaZ), 0);
  const WplZ = rectangles.reduce((sum, item) => sum + absoluteFirstMoment(item, 'y', pnaY), 0);
  return Object.freeze({
    status: 'GEOMETRY_DERIVED',
    A_mm2: A,
    mass_kg_m: A * STEEL_DENSITY_KG_M3 / 1e6,
    centroid_y_mm: cy,
    centroid_z_mm: cz,
    Iy_mm4: Iy,
    Iz_mm4: Iz,
    Wel_y_top_mm3: Iy / (maxZ - cz),
    Wel_y_bottom_mm3: Iy / (cz - minZ),
    Wel_z_left_mm3: Iz / (cy - minY),
    Wel_z_right_mm3: Iz / (maxY - cy),
    plasticNeutralAxis_z_mm: pnaZ,
    plasticNeutralAxis_y_mm: pnaY,
    Wpl_y_mm3: WplY,
    Wpl_z_mm3: WplZ,
    bounds: { minY_mm: minY, maxY_mm: maxY, minZ_mm: minZ, maxZ_mm: maxZ, width_mm: maxY - minY, height_mm: maxZ - minZ },
    components,
    density_kg_m3: STEEL_DENSITY_KG_M3,
    source: options.source || 'Explicit user-entered plate geometry',
    unavailable: {
      Avy_mm2: 'No validated subtype shear-area formula.',
      Avz_mm2: 'No validated subtype shear-area formula.',
      It_mm4: 'No validated open/closed welded-section torsion formula for this subtype.',
      Iw_mm6: 'No validated warping formula for this subtype.',
      shearCentre: 'No validated shear-centre formula for this subtype.',
      effectiveProperties: 'Class 4 effective properties have not been calculated.'
    }
  });
}

function centredX(width) {
  return -width / 2;
}

function plateTGeometry(dimensions = {}, options = {}) {
  const webHeight = finitePositive(dimensions.webHeight_mm, 'Web height');
  const webThickness = finitePositive(dimensions.webThickness_mm, 'Web thickness');
  const flangeWidth = finitePositive(dimensions.flangeWidth_mm, 'Flange width');
  const flangeThickness = finitePositive(dimensions.flangeThickness_mm, 'Flange thickness');
  if (webThickness >= flangeWidth) throw geometryError('Web thickness must be less than flange width.');
  return deriveCompositeProperties([
    rectangle('web', centredX(webThickness), 0, webThickness, webHeight, 'web'),
    rectangle('top-flange', centredX(flangeWidth), webHeight, flangeWidth, flangeThickness, 'flange')
  ], options);
}

function weldedISections(dimensions = {}, doubleSymmetric = false, options = {}) {
  const webHeight = finitePositive(dimensions.clearWebHeight_mm, 'Clear web height');
  const webThickness = finitePositive(dimensions.webThickness_mm, 'Web thickness');
  const topWidth = finitePositive(dimensions.topFlangeWidth_mm, 'Top flange width');
  const topThickness = finitePositive(dimensions.topFlangeThickness_mm, 'Top flange thickness');
  const bottomWidth = doubleSymmetric ? topWidth : finitePositive(dimensions.bottomFlangeWidth_mm, 'Bottom flange width');
  const bottomThickness = doubleSymmetric ? topThickness : finitePositive(dimensions.bottomFlangeThickness_mm, 'Bottom flange thickness');
  if (webThickness >= Math.min(topWidth, bottomWidth)) throw geometryError('Web thickness must be less than both flange widths.');
  return deriveCompositeProperties([
    rectangle('bottom-flange', centredX(bottomWidth), 0, bottomWidth, bottomThickness, 'flange'),
    rectangle('web', centredX(webThickness), bottomThickness, webThickness, webHeight, 'web'),
    rectangle('top-flange', centredX(topWidth), bottomThickness + webHeight, topWidth, topThickness, 'flange')
  ], options);
}

function weldedBoxSections(dimensions = {}, doubleSymmetric = false, options = {}) {
  const clearHeight = finitePositive(dimensions.clearWebHeight_mm, 'Clear web height');
  const webThickness = finitePositive(dimensions.webThickness_mm, 'Web thickness');
  const webSpacing = finitePositive(dimensions.webCentres_mm, 'Web centre spacing');
  const topWidth = finitePositive(dimensions.topFlangeWidth_mm, 'Top flange width');
  const topThickness = finitePositive(dimensions.topFlangeThickness_mm, 'Top flange thickness');
  const bottomWidth = doubleSymmetric ? topWidth : finitePositive(dimensions.bottomFlangeWidth_mm, 'Bottom flange width');
  const bottomThickness = doubleSymmetric ? topThickness : finitePositive(dimensions.bottomFlangeThickness_mm, 'Bottom flange thickness');
  if (webSpacing <= webThickness) throw geometryError('Web centre spacing must exceed web thickness.');
  if (webSpacing + webThickness > Math.min(topWidth, bottomWidth)) throw geometryError('Both webs must bear within both flange widths.');
  const leftWebY = -webSpacing / 2 - webThickness / 2;
  const rightWebY = webSpacing / 2 - webThickness / 2;
  return deriveCompositeProperties([
    rectangle('bottom-flange', centredX(bottomWidth), 0, bottomWidth, bottomThickness, 'flange'),
    rectangle('left-web', leftWebY, bottomThickness, webThickness, clearHeight, 'web'),
    rectangle('right-web', rightWebY, bottomThickness, webThickness, clearHeight, 'web'),
    rectangle('top-flange', centredX(topWidth), bottomThickness + clearHeight, topWidth, topThickness, 'flange')
  ], options);
}

function weldedAngle(dimensions = {}, options = {}) {
  const verticalLeg = finitePositive(dimensions.verticalLeg_mm, 'Vertical leg');
  const horizontalLeg = finitePositive(dimensions.horizontalLeg_mm, 'Horizontal leg');
  const thickness = finitePositive(dimensions.thickness_mm, 'Plate thickness');
  if (thickness >= Math.min(verticalLeg, horizontalLeg)) throw geometryError('Plate thickness must be less than both leg dimensions.');
  return deriveCompositeProperties([
    rectangle('vertical-leg', 0, 0, thickness, verticalLeg, 'leg'),
    rectangle('horizontal-leg', thickness, 0, horizontalLeg - thickness, thickness, 'leg')
  ], options);
}

function derivePlateSubtype(subtype, dimensions = {}, options = {}) {
  switch (subtype) {
    case 'plate_flatbar':
    case 'plate_t_girder':
    case 'welded_t_axial':
      return plateTGeometry(dimensions, options);
    case 'plate_l_welded':
      return weldedAngle(dimensions, options);
    case 'welded_i_single_symmetric':
      return weldedISections(dimensions, false, options);
    case 'welded_i_double_symmetric':
      return weldedISections(dimensions, true, options);
    case 'welded_box_non_symmetric':
      return weldedBoxSections(dimensions, false, options);
    case 'welded_box_double_symmetric':
      return weldedBoxSections(dimensions, true, options);
    default:
      throw geometryError(`Subtype ${subtype || '(missing)'} does not have a verified component layout.`, 'special_section_data_required');
  }
}

module.exports = {
  STEEL_DENSITY_KG_M3,
  rectangle,
  overlapArea,
  deriveCompositeProperties,
  derivePlateSubtype,
  geometryError
};
