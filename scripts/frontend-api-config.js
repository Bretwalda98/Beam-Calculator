'use strict';

const PREVIEW_API_BY_BRANCH = Object.freeze({
  'codex/fea-platform-spike': 'https://codex-fea-platform-spike-beam-calculator-api.harrynixon98.workers.dev',
  'codex/cad-workbench-v1': 'https://codex-cad-workbench-v1-beam-calculator-api.harrynixon98.workers.dev'
});

function resolveFrontendApiBases(env = process.env) {
  const branchApiBase = PREVIEW_API_BY_BRANCH[env.CF_PAGES_BRANCH || ''] || '';

  return {
    beamApiBase: env.BEAM_API_BASE_URL || branchApiBase,
    frameApiBase: env.VITE_API_BASE_URL || branchApiBase
  };
}

module.exports = {
  PREVIEW_API_BY_BRANCH,
  resolveFrontendApiBases
};
