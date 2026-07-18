# Frame3D foundation release

The foundation release provides a separate `/frame3d/` linear-elastic three-dimensional space-frame application using two-node Euler–Bernoulli beam elements with six global degrees of freedom per node.

Detailed documentation:

- [Architecture](frame3d-architecture.md)
- [Model schema](frame3d-model-schema.md)
- [Sign conventions](frame3d-sign-conventions.md)
- [Verification](frame3d-verification.md)
- [Development](frame3d-development.md)

Version 1 supports nodal restraints, nodal forces and moments, multiple load cases, linear combinations, constant member properties, section snapshots, reactions, local member end forces and global equilibrium recovery.

It intentionally excludes member loads, releases, springs, offsets, support settlement, P-Delta analysis, eigenvalue buckling, plasticity, dynamics, plates, shells, solids and graphical modelling.
