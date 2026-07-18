# Frame3D verification

## Automated scope

Rust unit tests cover:

1. axial `PL/EA`;
2. cantilever tip-force deflection `PL³/3EI`;
3. cantilever tip-force rotation `PL²/2EI`;
4. cantilever tip-moment rotation `ML/EI`;
5. cantilever torsion `TL/GJ`;
6. bending about both local axes;
7. reaction-force equilibrium;
8. reaction-moment equilibrium;
9. a 2D portal represented in the 3D solver;
10. an inclined member;
11. a skew 3D frame;
12. non-zero member roll;
13. coordinate-rotation invariance;
14. near-vertical automatic local axes;
15. zero-length rejection;
16. disconnected-node warning;
17. rigid-body instability identification;
18. invalid section rejection;
19. invalid material rejection;
20. JSON round trip;
21. linear load-combination factors.
22. unsupported schema versions;
23. duplicate identifiers;
24. missing member references;
25. missing load-case references in combinations;
26. derived shear modulus when `G` is omitted.

The compiled WebAssembly boundary repeats seven analytical comparisons and checks structured instability diagnostics.

## Acceptance

- analytical displacement and reaction relative error: at most 0.1%;
- member end-force relative error: at most 0.2%;
- combined absolute/relative checks are used near zero;
- normalised force and moment equilibrium residuals: at most `1 × 10⁻⁸` for well-conditioned benchmarks.

The implementation tests use tighter numerical assertions where the closed-form and matrix solutions should agree to floating-point precision. Tolerances were not relaxed to obtain passing tests.

## Meaning of “verified”

Passing tests verify the implemented element, transformation, assembly, constraint, solution and recovery paths for the stated benchmark set. They do not certify arbitrary structures, replace independent software comparison, or make the foundation release suitable for unreviewed design use.

Run:

```bash
npm run test:frame3d
npm run check:rust
node backend/tests/routing-smoke.js
node backend/tests/worker-route-smoke.mjs
```

The WASM test prints expected values, actual values and relative errors for the analytical comparison table.
