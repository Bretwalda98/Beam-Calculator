'use strict';

const assert = require('assert');
const {
  PREVIEW_API_BY_BRANCH,
  resolveFrontendApiBases
} = require('../../scripts/frontend-api-config');

const previewApi = PREVIEW_API_BY_BRANCH['codex/fea-platform-spike'];

assert.deepStrictEqual(
  resolveFrontendApiBases({ CF_PAGES_BRANCH: 'codex/fea-platform-spike' }),
  { beamApiBase: previewApi, frameApiBase: previewApi },
  'The FEA platform branch must use its isolated preview Worker for both applications.'
);

const cadWorkbenchApi = PREVIEW_API_BY_BRANCH['codex/cad-workbench-v1'];
assert.deepStrictEqual(
  resolveFrontendApiBases({ CF_PAGES_BRANCH: 'codex/cad-workbench-v1' }),
  { beamApiBase: cadWorkbenchApi, frameApiBase: cadWorkbenchApi },
  'The CAD workbench branch must use its isolated preview Worker for all applications.'
);

assert.deepStrictEqual(
  resolveFrontendApiBases({ CF_PAGES_BRANCH: 'main' }),
  { beamApiBase: '', frameApiBase: '' },
  'Production and unrelated branches must retain the default same-origin API behaviour.'
);

assert.deepStrictEqual(
  resolveFrontendApiBases({
    CF_PAGES_BRANCH: 'codex/fea-platform-spike',
    BEAM_API_BASE_URL: 'https://beam.example.test',
    VITE_API_BASE_URL: 'https://frame.example.test'
  }),
  {
    beamApiBase: 'https://beam.example.test',
    frameApiBase: 'https://frame.example.test'
  },
  'Explicit build settings must override the branch defaults.'
);

console.log('Cloudflare Pages preview API configuration tests passed.');
