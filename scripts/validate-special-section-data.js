'use strict';

const fs = require('fs');
const path = require('path');
const { createSpecialSectionAdapter } = require('../backend/services/external-special-section-adapter');

const target = path.resolve(process.argv[2] || path.join(__dirname, '..', 'backend', 'data', 'verified-special-sections.json'));
const dataset = JSON.parse(fs.readFileSync(target, 'utf8'));
const adapter = createSpecialSectionAdapter(dataset);
console.log(JSON.stringify({ ok: true, file: target, records: adapter.list().length }, null, 2));
