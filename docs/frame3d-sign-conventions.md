# Frame3D sign conventions

## Global degrees of freedom

The global order at every node is:

1. `UX` — translation in global X, mm
2. `UY` — translation in global Y, mm
3. `UZ` — translation in global Z, mm
4. `RX` — rotation about global X, rad
5. `RY` — rotation about global Y, rad
6. `RZ` — rotation about global Z, rad

Positive forces act along positive global axes. Positive moments and rotations follow the right-hand rule.

## Member local axes

- Local `x` points from the start node to the end node.
- A supplied local-axis reference is projected into the plane normal to local `x` and normalised to form the unrolled local `y`.
- Without a supplied reference, global Z is used unless `|x · Z| ≥ 0.9`; near-vertical members use global Y. This avoids a near-zero projection.
- Local `z = x × y`, giving a deterministic right-handed basis.
- Positive roll is a right-hand rotation about positive local `x`. The rolled axes are:

  - `y′ = y cos θ + z sin θ`
  - `z′ = −y sin θ + z cos θ`

A supplied reference that is parallel or nearly parallel to the member axis is rejected rather than silently replaced.

## Local element order and end actions

Local element degrees of freedom are:

`[u1, v1, w1, rx1, ry1, rz1, u2, v2, w2, rx2, ry2, rz2]`

The returned local member end-force order at each end is:

`[N, Vy, Vz, T, My, Mz]`

The values are the actions exerted by the element at its local start and end degrees of freedom, using the positive local axes and right-hand moment convention. Equal and opposite end actions emerge for isolated axial and torsional benchmark cases.

## Bending properties

- Local `v` displacement and `rz` rotation use `EIz`.
- Local `w` displacement and `ry` rotation use `EIy`.
- Local axial deformation uses `EA`.
- Local torsional rotation uses `GJ`.

No shear-deformation terms are included in the version-1 Euler–Bernoulli formulation.
