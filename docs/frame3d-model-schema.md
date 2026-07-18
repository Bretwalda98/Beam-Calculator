# Frame3D model schema

## Version and internal units

The supported schema version is `1.0.0`. Imports with a missing or different `schemaVersion` are rejected clearly.

Canonical solver units are:

- force: N;
- length and translation: mm;
- modulus/stress: N/mm²;
- moment: N·mm;
- second moment and torsion constant: mm⁴;
- rotation and member roll: radians.

`displayUnits` controls formatting only. Matrices are never assembled using display units.

## Top-level object

`Frame3DModel` contains:

- `schemaVersion`;
- `metadata`: project name, model name, engineer and optional example/benchmark notes;
- `displayUnits`;
- `nodes`;
- `members`;
- `materials`;
- `sections`;
- `loadCases`;
- `combinations`;
- `nodalLoads`;
- `analysisSettings`.

## Records

### Node

Each node stores `id`, `x`, `y`, `z` and Boolean restraints `ux`, `uy`, `uz`, `rx`, `ry`, `rz`.

### Member

Each member stores start/end node IDs, material ID, section ID, `rollAngleRad` and an optional global reference vector. Member properties are constant and member ends are rigid in version 1.

### Material

Materials store `E`, Poisson ratio and optional `G`. When `G` is absent:

`G = E / [2(1 + ν)]`

The schema requires `−1 < ν < 0.5`.

### Section snapshot

Sections store actual analysis values `A`, `Iy`, `Iz` and `torsionConstant`. Optional `sourceSectionId` and `sourceRevision` preserve provenance. A live catalogue ID alone is insufficient.

### Loading

Nodal loads store six global components and a load-case ID. Linear combinations store a numeric factor map keyed by load-case ID. The analysis selection identifies one load case or one combination.

## Import and export

Export serialises the complete snapshot model as JSON. Import:

1. parses JSON without evaluation;
2. checks `schemaVersion`;
3. runs full TypeScript validation;
4. rejects malformed references and unsupported versions;
5. clones accepted data before placing it in application state.

Imported strings are assigned through DOM text/value properties. Model values are not inserted into `innerHTML`.
