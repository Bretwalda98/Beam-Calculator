const LOAD_DIRECTIONS = new Set(['Y', 'Z']);
const SLS_DEFLECTION_BASIS = new Set(['total', 'imposed-only', 'variable-only']);
const LTB_LOAD_HEIGHTS = new Set(['shear_centre', 'top_flange', 'bottom_flange', 'centroid']);
const LTB_RESTRAINT_MODELS = new Set(['current', 'colbeam', 'manual', 'full_span', 'restraint_points']);
const LTB_MOMENT_GRADIENT_METHODS = new Set(['manual', 'auto_from_diagram', 'colbeam_default']);
const MEMBER_INTERACTION_METHODS = new Set(['current', 'ec3_annex_a', 'ec3_annex_b', 'colbeam']);
const EFFECTIVE_PROPERTIES_MODES = new Set(['not_available', 'manual', 'database', 'auto']);

const DEFAULT_CUSTOM_FACTORS = {
  uls: { G: 1.35, Q1: 1.5, Q2: 1.5 },
  sls: { G: 1, Q1: 1, Q2: 0.7 }
};

const DEFAULT_AUDIT_SETTINGS = {
  auditProfile: 'current',
  materialVariantLabel: '',
  nationalAnnexLabel: 'UK National Annex',
  coefficientSource: 'Backend EN 1990/EN 1993 defaults',
  autoSectionClassificationStatus: 'manual',
  class4EffectivePropertiesMode: 'not_available',
  shearFactorEta: 1.0,
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
  colbeamInteractionMethodLabel: 'Source to be confirmed',
  supportBearingModel: 'current_screening',
  webBearingModel: 'current_screening',
  stiffenerModel: 'current_screening',
  modalAnalysisStatus: 'not implemented'
};

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
  }
  return Boolean(value);
}

function enumValue(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function cleanText(value, fallback = '', max = 160) {
  if (value === undefined || value === null) return fallback;
  return String(value).trim().slice(0, max);
}

function normaliseLoadDirection(value, fallback = 'Z') {
  return enumValue(String(value || '').toUpperCase(), LOAD_DIRECTIONS, fallback);
}

function normaliseCustomFactors(input = {}) {
  return {
    G: finite(input.G, 0),
    Q1: finite(input.Q1, 0),
    Q2: finite(input.Q2, 0)
  };
}

function normaliseCombinationAudit(combination = {}) {
  const custom = combination.customFactors || {};
  return {
    customULSFactors: normaliseCustomFactors(combination.customULSFactors || custom.uls || DEFAULT_CUSTOM_FACTORS.uls),
    customSLSFactors: normaliseCustomFactors(combination.customSLSFactors || custom.sls || DEFAULT_CUSTOM_FACTORS.sls),
    perCheckEnvelope: bool(combination.perCheckEnvelope, false),
    slsDeflectionBasis: enumValue(combination.slsDeflectionBasis, SLS_DEFLECTION_BASIS, 'total'),
    slsIncludeSelfWeight: bool(combination.slsIncludeSelfWeight, true)
  };
}

function normaliseSetupAudit(settings = {}, metadata = {}) {
  const source = settings.colbeamAudit || settings.audit || {};
  return {
    ...DEFAULT_AUDIT_SETTINGS,
    auditProfile: cleanText(source.auditProfile, DEFAULT_AUDIT_SETTINGS.auditProfile, 80),
    materialVariantLabel: cleanText(source.materialVariantLabel || metadata.materialVariantLabel, DEFAULT_AUDIT_SETTINGS.materialVariantLabel, 80),
    nationalAnnexLabel: cleanText(source.nationalAnnexLabel || metadata.nationalAnnex, DEFAULT_AUDIT_SETTINGS.nationalAnnexLabel, 120),
    coefficientSource: cleanText(source.coefficientSource, DEFAULT_AUDIT_SETTINGS.coefficientSource, 160),
    autoSectionClassificationStatus: cleanText(source.autoSectionClassificationStatus, DEFAULT_AUDIT_SETTINGS.autoSectionClassificationStatus, 80),
    class4EffectivePropertiesMode: enumValue(source.class4EffectivePropertiesMode, EFFECTIVE_PROPERTIES_MODES, DEFAULT_AUDIT_SETTINGS.class4EffectivePropertiesMode),
    shearFactorEta: finite(source.shearFactorEta, DEFAULT_AUDIT_SETTINGS.shearFactorEta),
    class12ElasticDesign: bool(source.class12ElasticDesign, DEFAULT_AUDIT_SETTINGS.class12ElasticDesign),
    conservativeNMyMz: bool(source.conservativeNMyMz, DEFAULT_AUDIT_SETTINGS.conservativeNMyMz),
    flangeBucklingIgnored: bool(source.flangeBucklingIgnored, DEFAULT_AUDIT_SETTINGS.flangeBucklingIgnored),
    webBucklingIgnored: bool(source.webBucklingIgnored, DEFAULT_AUDIT_SETTINGS.webBucklingIgnored),
    ltbC3: finite(source.ltbC3, DEFAULT_AUDIT_SETTINGS.ltbC3),
    ltbKw: finite(source.ltbKw, DEFAULT_AUDIT_SETTINGS.ltbKw),
    ltbLoadHeight: enumValue(source.ltbLoadHeight, LTB_LOAD_HEIGHTS, DEFAULT_AUDIT_SETTINGS.ltbLoadHeight),
    ltbShearCentreConvention: cleanText(source.ltbShearCentreConvention, DEFAULT_AUDIT_SETTINGS.ltbShearCentreConvention, 120),
    ltbRestraintModel: enumValue(source.ltbRestraintModel, LTB_RESTRAINT_MODELS, DEFAULT_AUDIT_SETTINGS.ltbRestraintModel),
    ltbMomentGradientMethod: enumValue(source.ltbMomentGradientMethod, LTB_MOMENT_GRADIENT_METHODS, DEFAULT_AUDIT_SETTINGS.ltbMomentGradientMethod),
    lambdaLT0: finite(source.lambdaLT0, DEFAULT_AUDIT_SETTINGS.lambdaLT0),
    beta: finite(source.beta, DEFAULT_AUDIT_SETTINGS.beta),
    memberBucklingInteractionMethod: enumValue(source.memberBucklingInteractionMethod, MEMBER_INTERACTION_METHODS, DEFAULT_AUDIT_SETTINGS.memberBucklingInteractionMethod),
    colbeamInteractionMethodLabel: cleanText(source.colbeamInteractionMethodLabel, DEFAULT_AUDIT_SETTINGS.colbeamInteractionMethodLabel, 120),
    supportBearingModel: cleanText(source.supportBearingModel, DEFAULT_AUDIT_SETTINGS.supportBearingModel, 80),
    webBearingModel: cleanText(source.webBearingModel, DEFAULT_AUDIT_SETTINGS.webBearingModel, 80),
    stiffenerModel: cleanText(source.stiffenerModel, DEFAULT_AUDIT_SETTINGS.stiffenerModel, 80),
    modalAnalysisStatus: cleanText(source.modalAnalysisStatus, DEFAULT_AUDIT_SETTINGS.modalAnalysisStatus, 80)
  };
}

function normaliseModelAudit(model = {}) {
  return {
    colbeamSupportMappingLabel: cleanText(model.colbeamSupportMappingLabel, 'Current support mapping', 120),
    supportEquivalenceNote: cleanText(model.supportEquivalenceNote, 'Support equivalence to COLBEAM EC3 has not been independently verified.', 220)
  };
}

function normaliseAxialAudit(axial = {}) {
  return {
    signConvention: cleanText(axial.signConvention, 'positive_compression', 80)
  };
}

function normaliseColbeamAuditInput(input = {}) {
  const combinationAudit = normaliseCombinationAudit(input.combination || {});
  const setupAudit = normaliseSetupAudit(input.settings || {}, input.metadata || {});
  return {
    model: normaliseModelAudit(input.model || {}),
    combination: combinationAudit,
    axial: normaliseAxialAudit(input.axial || {}),
    settings: setupAudit,
    metadataOnlyWarnings: [
      'COLBEAM audit fields are recorded and echoed for comparison, but this stage does not claim COLBEAM EC3 parity.',
      'Per-check EN 1990 6.10a/6.10b envelope remains metadata-only; the current engine still selects a single governing 6.10a/b ULS response by peak moment.',
      'Custom ULS/SLS factors are engine-wired only when the Custom / COLBEAM audit combination mode is selected.',
      'LTB C3, kw, load-height, shear-centre convention, restraint model, moment-gradient method, lambdaLT,0 and beta are metadata-only until the COLBEAM LTB method is implemented.',
      'Member-buckling interaction method, Class 4 effective-property mode, auto classification status, support bearing, web bearing and stiffener model are metadata-only in this stage.',
      'Modal analysis status is recorded as not implemented.'
    ]
  };
}

module.exports = {
  DEFAULT_CUSTOM_FACTORS,
  DEFAULT_AUDIT_SETTINGS,
  LOAD_DIRECTIONS,
  normaliseLoadDirection,
  normaliseColbeamAuditInput
};
