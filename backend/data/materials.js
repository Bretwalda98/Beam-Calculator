const MATERIALS = Object.freeze({
  S235: { grade: 'S235', fy: 235, E: 210000 },
  S275: { grade: 'S275', fy: 275, E: 210000 },
  S355: { grade: 'S355', fy: 355, E: 210000 },
  S420: { grade: 'S420', fy: 420, E: 210000 },
  S460: { grade: 'S460', fy: 460, E: 210000 }
});

function getEffectiveFy(materialKey, section) {
  const key = MATERIALS[materialKey] ? materialKey : 'S355';
  const t = Math.max(Number(section?.tf_mm || section?.tw_mm || section?.t_mm || 0), 0);
  if (key === 'S355') {
    if (t <= 16) return 355;
    if (t <= 40) return 345;
    if (t <= 63) return 335;
    if (t <= 80) return 325;
    if (t <= 100) return 315;
    return 295;
  }
  if (key === 'S275') {
    if (t <= 16) return 275;
    if (t <= 40) return 265;
    if (t <= 63) return 255;
    if (t <= 80) return 245;
    if (t <= 100) return 235;
    return 225;
  }
  return MATERIALS[key].fy;
}

function getMaterialForSection(materialKey, section) {
  const key = MATERIALS[materialKey] ? materialKey : 'S355';
  return { ...MATERIALS[key], fy: getEffectiveFy(key, section), grade: key };
}

module.exports = { MATERIALS, getMaterialForSection };
