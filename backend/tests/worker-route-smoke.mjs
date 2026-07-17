import assert from 'node:assert/strict';

import worker, { buildCadFemUpstreamRequest } from '../../src/worker.mjs';

const health = await worker.fetch(new Request('https://beam-calculator.pages.dev/api/health'));
assert.equal(health.status, 200);
assert.equal((await health.json()).ok, true);

const sections = await worker.fetch(new Request('https://beam-calculator.pages.dev/api/frame3d/sections'));
assert.equal(sections.status, 200);
const sectionBody = await sections.json();
assert.equal(sectionBody.ok, true);
assert.ok(Array.isArray(sectionBody.sections));
assert.ok(sectionBody.sections.length > 0);
const available = sectionBody.sections.find((section) => section.available);
assert.ok(available?.snapshot?.area > 0);
assert.ok(available?.snapshot?.iy > 0);
assert.ok(available?.snapshot?.iz > 0);
assert.ok(available?.snapshot?.torsionConstant > 0);
assert.match(available?.snapshot?.catalogueRevision, /^[a-f0-9]{64}$/);
assert.equal(available?.snapshot?.profile?.catalogue, 'beam-ec3');
assert.equal(available?.snapshot?.profile?.units, 'mm');

const catalogue = await worker.fetch(new Request('https://beam-calculator.pages.dev/api/sections'));
assert.equal(catalogue.status, 200);
const catalogueBody = await catalogue.json();
assert.equal(catalogueBody.sections.length, 368);
const solidSection = catalogueBody.sections.find((section) => section.solidProfileAvailable);
assert.ok(solidSection?.backendId);
assert.match(solidSection?.catalogueRevision, /^[a-f0-9]{64}$/);
const preview = await worker.fetch(new Request(
  `https://beam-calculator.pages.dev/api/sections/${encodeURIComponent(solidSection.backendId)}/preview`
));
assert.equal(preview.status, 200);
const previewBody = await preview.json();
assert.equal(previewBody.section.solidProfile.sectionId, solidSection.backendId);
assert.equal(previewBody.section.solidProfile.geometryVerified, true);

const unauthenticatedCad = await worker.fetch(
  new Request('https://beam-calculator.pages.dev/api/cad/projects')
);
assert.equal(unauthenticatedCad.status, 401);
assert.equal((await unauthenticatedCad.json()).error.code, 'auth_required');

const forwarded = buildCadFemUpstreamRequest(
  new Request('https://beam-calculator.pages.dev/api/cad/projects?revision=2', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer browser-token',
      Cookie: 'session=browser-cookie',
      'Cf-Access-Jwt-Assertion': 'browser-access-token',
      'X-Cad-Fem-Gateway-Token': 'spoofed',
      'X-Beam-User-Email': 'spoofed@example.com',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ok: true })
  }),
  {
    hasServiceBinding: false,
    originUrl: 'https://cad-fem.internal.example',
    gatewayToken: 'trusted-gateway-token',
    identity: {
      subject: 'access-subject',
      email: 'engineer@example.com',
      name: 'Engineer'
    }
  }
);
assert.equal(forwarded.url, 'https://cad-fem.internal.example/api/cad/projects?revision=2');
assert.equal(forwarded.headers.get('Authorization'), null);
assert.equal(forwarded.headers.get('Cookie'), null);
assert.equal(forwarded.headers.get('Cf-Access-Jwt-Assertion'), null);
assert.equal(forwarded.headers.get('X-Cad-Fem-Gateway-Token'), 'trusted-gateway-token');
assert.equal(forwarded.headers.get('X-Beam-User-Subject'), 'access-subject');
assert.equal(forwarded.headers.get('X-Beam-User-Email'), 'engineer@example.com');
assert.deepEqual(await forwarded.json(), { ok: true });

console.log('worker route smoke ok', {
  preservedHealthRoute: true,
  cadFemFailsClosed: true,
  browserCredentialsStripped: true,
  frame3dSections: sectionBody.sections.length,
  availableSection: available.designation
});
