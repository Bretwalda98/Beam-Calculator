# Native CAD/FEM dependency pins for the platform spike.
#
# Release images must use these exact commits (or an intentionally reviewed
# update) and record them in every JobManifest/ResultManifest.

set(CAD_FEM_OCCT_REPOSITORY "https://github.com/Open-Cascade-SAS/OCCT.git")
set(CAD_FEM_OCCT_REVISION "a016080bf6738d6aeae020badee4e888ad1540a5") # V7_9_3

set(CAD_FEM_NETGEN_REPOSITORY "https://github.com/NGSolve/netgen.git")
set(CAD_FEM_NETGEN_REVISION "a3e08f0ec196b442f7de3b9b717ab86c6993f1ab") # v6.2.2606

set(CAD_FEM_MFEM_REPOSITORY "https://github.com/mfem/mfem.git")
set(CAD_FEM_MFEM_REVISION "d9d6526cc1749980a2ba1da16e2c1ca1e07d82ec") # v4.9

set(CAD_FEM_TRIBOL_REPOSITORY "https://github.com/LLNL/Tribol.git")
set(CAD_FEM_TRIBOL_REVISION "ab6ac57daf1a9dd8a8ffd3b4250b883ecbecec47") # reviewed develop pin

set(CAD_FEM_AXOM_REPOSITORY "https://github.com/LLNL/axom.git")
set(CAD_FEM_AXOM_REVISION "4839900850b7b43bcc2accf7041e3479cea59515") # reviewed develop pin

set(CAD_FEM_CERES_REPOSITORY "https://github.com/ceres-solver/ceres-solver.git")
set(CAD_FEM_CERES_REVISION "2.2.0") # stage-two sketch solver pin
