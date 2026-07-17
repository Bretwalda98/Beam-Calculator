# Native CAD/FEM platform spike

This service proves the authoritative native path:

1. Import STEP into an OCCT/OCAF document.
2. Persist the OCAF document, regenerated B-rep, topology metadata and an OCCT
   tessellation.
3. Generate a first-order geometric tetrahedral mesh with Netgen.
4. Solve Float64 linear elasticity with a quadratic MFEM displacement space.
5. Export displacement, stress and von Mises fields in ParaView/VTU form plus
   a machine-readable result manifest.

No JavaScript solver fallback exists. If the native service, mesher or solver is
unavailable, the public API returns a failure and does not create a result.

## Local native build

The build needs installed CMake packages for OCCT, Netgen and MFEM:

```text
cmake -S services/cad-fem-native -B build/cad-fem-native -G Ninja
cmake --build build/cad-fem-native
ctest --test-dir build/cad-fem-native --output-on-failure
```

The CTest pipeline generates a STEP axial bar, imports it through OCAF, meshes
it with Netgen and checks the MFEM end displacement against `tL/E` with a 1%
gate. It also enforces the `1e-8` normalised equilibrium gate.

The release is not described as verified until this test and the broader
benchmark matrix pass in the pinned Linux OCI image. First-order Netgen
tetrahedra describe the geometry; MFEM uses a second-order displacement basis
by default. Curved high-order geometry and mesh-to-CAD projection remain a
separate release gate.

The pinned Netgen source is built with the small patch in
`patches/netgen-ng-delete-mesh-double-free.patch`. It clears deleted boundary
name pointers before the `Mesh` destructor runs, preventing `Ng_DeleteMesh`
from freeing those pointers twice after an OCCT volume mesh has been written.
The native mesh and solve tests exercise this cleanup under AddressSanitizer.

## Contact

`CAD_FEM_ENABLE_CONTACT` is off by default. Contact may only be enabled in an
image where MFEM was built with the pinned MPI, Hypre, Axom and Tribol stack and
the frictionless mortar patch test passes. A failed or unconverged contact
increment must never produce a completed ResultManifest.
