cmake_minimum_required(VERSION 3.25)

project(beam_calculator_cad_fem_native VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

option(CAD_FEM_BUILD_TESTS "Build native pipeline verification tests" ON)
option(CAD_FEM_ENABLE_CONTACT "Build the Tribol contact spike" OFF)
option(CAD_FEM_ENABLE_SANITIZERS "Enable AddressSanitizer and UndefinedBehaviourSanitizer" OFF)

find_package(OpenCASCADE CONFIG REQUIRED)
find_package(Netgen CONFIG REQUIRED)
find_package(MFEM CONFIG REQUIRED)

if(TARGET netgen::nglib)
  set(CAD_FEM_NETGEN_TARGET netgen::nglib)
elseif(TARGET nglib)
  set(CAD_FEM_NETGEN_TARGET nglib)
else()
  message(FATAL_ERROR "Netgen was found, but no nglib target is available.")
endif()

if(TARGET MFEM::mfem)
  set(CAD_FEM_MFEM_TARGET MFEM::mfem)
elseif(TARGET mfem)
  set(CAD_FEM_MFEM_TARGET mfem)
else()
  message(FATAL_ERROR "MFEM was found, but no mfem target is available.")
endif()

add_library(cad_fem_pipeline
  src/cad_pipeline.cpp
  src/linear_elasticity.cpp
)
target_include_directories(cad_fem_pipeline
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${OpenCASCADE_INCLUDE_DIR}
)
target_link_libraries(cad_fem_pipeline
  PUBLIC
    ${OpenCASCADE_LIBRARIES}
    ${CAD_FEM_NETGEN_TARGET}
    ${CAD_FEM_MFEM_TARGET}
)
target_compile_definitions(cad_fem_pipeline
  PUBLIC
    CAD_FEM_NATIVE_VERSION="${PROJECT_VERSION}"
)

if(MSVC)
  target_compile_options(cad_fem_pipeline PRIVATE /W4 /permissive-)
else()
  target_compile_options(cad_fem_pipeline PRIVATE -Wall -Wextra -Wpedantic)
  if(CAD_FEM_ENABLE_SANITIZERS)
    target_compile_options(cad_fem_pipeline PUBLIC -fno-omit-frame-pointer -fsanitize=address,undefined)
    target_link_options(cad_fem_pipeline PUBLIC -fno-omit-frame-pointer -fsanitize=address,undefined)
  endif()
endif()

add_executable(cad-fem-pipeline src/main.cpp)
target_link_libraries(cad-fem-pipeline PRIVATE cad_fem_pipeline)

if(CAD_FEM_ENABLE_CONTACT)
  find_package(MPI REQUIRED)
  find_package(tribol CONFIG REQUIRED)
  add_executable(cad-fem-contact-patch src/contact_patch.cpp)
  target_compile_definitions(
    cad-fem-contact-patch
    PRIVATE
      CAD_FEM_CONTACT_MESH="${CMAKE_CURRENT_SOURCE_DIR}/tests/two_hex.mesh"
  )
  target_link_libraries(cad-fem-contact-patch PRIVATE cad_fem_pipeline MPI::MPI_CXX)
  if(TARGET tribol::tribol)
    target_link_libraries(cad-fem-contact-patch PRIVATE tribol::tribol)
  elseif(TARGET tribol)
    target_link_libraries(cad-fem-contact-patch PRIVATE tribol)
  else()
    message(FATAL_ERROR "Tribol was found, but no supported target is available.")
  endif()
  if(TARGET tribol::redecomp)
    target_link_libraries(cad-fem-contact-patch PRIVATE tribol::redecomp)
  elseif(TARGET redecomp)
    target_link_libraries(cad-fem-contact-patch PRIVATE redecomp)
  endif()
  if(TARGET axom::slic)
    target_link_libraries(cad-fem-contact-patch PRIVATE axom::slic)
  endif()
endif()

include(GNUInstallDirs)
install(TARGETS cad-fem-pipeline RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(
  PROGRAMS ${CMAKE_CURRENT_SOURCE_DIR}/scripts/cad-fem-batch-runner
  DESTINATION ${CMAKE_INSTALL_BINDIR}
)
install(FILES
  ${CMAKE_CURRENT_SOURCE_DIR}/NOTICE.md
  ${CMAKE_CURRENT_SOURCE_DIR}/THIRD_PARTY_LICENSES.md
  DESTINATION ${CMAKE_INSTALL_DATADIR}/beam-calculator-cad-fem
)

if(CAD_FEM_BUILD_TESTS)
  enable_testing()
  add_executable(cad-fem-generate-box tests/generate_box_step.cpp)
  target_include_directories(cad-fem-generate-box PRIVATE ${OpenCASCADE_INCLUDE_DIR})
  target_link_libraries(cad-fem-generate-box PRIVATE ${OpenCASCADE_LIBRARIES})

  set(CAD_FEM_TEST_ROOT ${CMAKE_CURRENT_BINARY_DIR}/verification)
  set(CAD_FEM_TEST_STEP ${CAD_FEM_TEST_ROOT}/fixture/axial-bar.step)
  add_test(
    NAME cad_fem_generate_axial_bar_step
    COMMAND cad-fem-generate-box
      --output ${CAD_FEM_TEST_STEP}
      --length 1000
      --width 50
      --height 100
  )
  set_tests_properties(cad_fem_generate_axial_bar_step PROPERTIES FIXTURES_SETUP axial_bar_step)

  add_test(
    NAME cad_fem_step_ocaf_geometry
    COMMAND cad-fem-pipeline
      --step ${CAD_FEM_TEST_STEP}
      --output ${CAD_FEM_TEST_ROOT}/geometry
      --stage geometry
      --mesh-min-size 4
  )

  add_test(
    NAME cad_fem_step_netgen_mesh
    COMMAND cad-fem-pipeline
      --step ${CAD_FEM_TEST_STEP}
      --output ${CAD_FEM_TEST_ROOT}/mesh
      --stage mesh
      --mesh-size 40
      --mesh-min-size 4
  )

  add_test(
    NAME cad_fem_step_netgen_mfem_axial_bar
    COMMAND cad-fem-pipeline
      --step ${CAD_FEM_TEST_STEP}
      --output ${CAD_FEM_TEST_ROOT}/solve
      --mesh-size 40
      --mesh-min-size 4
      --element-order 2
      --elastic-modulus 210000
      --poisson-ratio 0.3
      --traction-x 1
      --traction-y 0
      --traction-z 0
      --relative-tolerance 1e-10
      --maximum-iterations 2000
      --benchmark-component x
      --benchmark-value 0.004761904761904762
      --benchmark-relative-tolerance 0.01
  )
  set_tests_properties(
    cad_fem_step_ocaf_geometry
    cad_fem_step_netgen_mesh
    cad_fem_step_netgen_mfem_axial_bar
    PROPERTIES
      FIXTURES_REQUIRED axial_bar_step
      TIMEOUT 600
      RUN_SERIAL TRUE
  )

  if(CAD_FEM_ENABLE_CONTACT)
    add_test(
      NAME cad_fem_tribol_frictionless_contact_patch
      COMMAND
        ${MPIEXEC_EXECUTABLE}
        ${MPIEXEC_NUMPROC_FLAG} 2
        ${MPIEXEC_PREFLAGS}
        $<TARGET_FILE:cad-fem-contact-patch>
        --output ${CMAKE_CURRENT_BINARY_DIR}/verification/contact-patch
        ${MPIEXEC_POSTFLAGS}
    )
    set_tests_properties(
      cad_fem_tribol_frictionless_contact_patch
      PROPERTIES TIMEOUT 600
    )
  endif()
endif()
