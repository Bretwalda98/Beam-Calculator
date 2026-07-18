// Frictionless mortar contact platform spike.
//
// This is adapted from MFEM's BSD-3-Clause contact-patch-test miniapp and uses
// the native MFEM/Tribol interface. The benchmark intentionally remains
// separate from the release solver until the nonlinear incremental driver and
// full contact benchmark matrix pass.

#include <mfem.hpp>

#include <axom/slic.hpp>
#include <tribol/interface/mfem_tribol.hpp>
#include <tribol/interface/tribol.hpp>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

#if defined(MFEM_USE_DOUBLE)
#define CAD_FEM_MPI_REAL MPI_DOUBLE
#else
#error "Tribol contact verification requires a Float64 MFEM build."
#endif

namespace {

struct Arguments {
  std::filesystem::path output_directory;
  int refinement_levels = 2;
  double lambda = 50.0;
  double mu = 50.0;
};

Arguments parse_arguments(int argc, char** argv) {
  Arguments arguments;
  for (int index = 1; index < argc; ++index) {
    const std::string option = argv[index];
    const auto next = [&]() -> std::string {
      if (index + 1 >= argc) throw std::runtime_error(option + " requires a value.");
      return argv[++index];
    };
    if (option == "--output") arguments.output_directory = next();
    else if (option == "--refine") arguments.refinement_levels = std::stoi(next());
    else if (option == "--lambda") arguments.lambda = std::stod(next());
    else if (option == "--mu") arguments.mu = std::stod(next());
    else throw std::runtime_error("Unknown option: " + option);
  }
  if (arguments.output_directory.empty()) {
    throw std::runtime_error("--output is required.");
  }
  return arguments;
}

double global_max(double local, MPI_Comm communicator) {
  double result = 0.0;
  MPI_Allreduce(&local, &result, 1, CAD_FEM_MPI_REAL, MPI_MAX, communicator);
  return result;
}

}  // namespace

int main(int argc, char** argv) {
  mfem::Mpi::Init(argc, argv);
  axom::slic::SimpleLogger logger;
  axom::slic::setIsRoot(mfem::Mpi::Root());
  bool tribol_initialised = false;
  try {
    const Arguments arguments = parse_arguments(argc, argv);
    if (mfem::Mpi::Root()) {
      std::filesystem::create_directories(arguments.output_directory);
    }
    MPI_Barrier(MPI_COMM_WORLD);

    constexpr int dimension = 3;
    constexpr int order = 1;
    const std::set<int> mortar_attributes{4};
    const std::set<int> nonmortar_attributes{5};
    std::vector<std::set<int>> fixed_attributes(dimension);
    fixed_attributes[0] = {1};
    fixed_attributes[1] = {2};
    fixed_attributes[2] = {3, 6};

    mfem::Mesh serial_mesh(CAD_FEM_CONTACT_MESH);
    for (int level = 0; level < arguments.refinement_levels; ++level) {
      serial_mesh.UniformRefinement();
    }
    mfem::ParMesh mesh(MPI_COMM_WORLD, serial_mesh);
    serial_mesh.Clear();
    if (mesh.Dimension() != dimension) {
      throw std::runtime_error("Contact patch fixture is not three-dimensional.");
    }

    mfem::H1_FECollection collection(order, dimension);
    mfem::ParFiniteElementSpace displacement_space(&mesh, &collection, dimension);
    mfem::ParGridFunction coordinates(&displacement_space);
    mesh.SetNodalGridFunction(&coordinates);
    mfem::ParGridFunction displacement(&displacement_space);
    displacement = 0.0;

    mfem::Array<int> essential_true_dofs;
    {
      mfem::Array<int> essential_vector_marker(displacement_space.GetVSize());
      essential_vector_marker = 0;
      for (int component = 0; component < dimension; ++component) {
        mfem::Array<int> boundary_marker(mesh.bdr_attributes.Max());
        boundary_marker = 0;
        for (const int attribute : fixed_attributes[component]) {
          boundary_marker[attribute - 1] = 1;
        }
        mfem::Array<int> component_marker;
        displacement_space.GetEssentialVDofs(boundary_marker, component_marker, component);
        for (int index = 0; index < component_marker.Size(); ++index) {
          essential_vector_marker[index] =
              essential_vector_marker[index] || component_marker[index];
        }
      }
      mfem::Array<int> essential_true_marker;
      displacement_space.GetRestrictionMatrix()->BooleanMult(
          essential_vector_marker,
          essential_true_marker);
      mfem::FiniteElementSpace::MarkerToList(essential_true_marker, essential_true_dofs);
    }

    mfem::ParBilinearForm elasticity(&displacement_space);
    mfem::ConstantCoefficient lambda_coefficient(arguments.lambda);
    mfem::ConstantCoefficient mu_coefficient(arguments.mu);
    elasticity.AddDomainIntegrator(
        new mfem::ElasticityIntegrator(lambda_coefficient, mu_coefficient));
    elasticity.Assemble();
    auto elastic_matrix = std::make_unique<mfem::HypreParMatrix>();
    elasticity.FormSystemMatrix(essential_true_dofs, *elastic_matrix);

    tribol::initialize(dimension, MPI_COMM_WORLD);
    tribol_initialised = true;
    constexpr int coupling_scheme_id = 0;
    tribol::registerMfemCouplingScheme(
        coupling_scheme_id,
        0,
        1,
        mesh,
        coordinates,
        mortar_attributes,
        nonmortar_attributes,
        tribol::SURFACE_TO_SURFACE,
        tribol::NO_CASE,
        tribol::SINGLE_MORTAR,
        tribol::FRICTIONLESS,
        tribol::LAGRANGE_MULTIPLIER,
        tribol::BINNING_GRID);
    auto& pressure = tribol::getMfemPressure(coupling_scheme_id);
    tribol::setLagrangeMultiplierOptions(
        coupling_scheme_id,
        tribol::ImplicitEvalMode::MORTAR_RESIDUAL_JACOBIAN);
    tribol::updateMfemParallelDecomposition();
    tribol::update(1, 1.0, 1.0);

    auto contact_operator = tribol::getMfemBlockJacobian(coupling_scheme_id);
    contact_operator->SetBlock(0, 0, elastic_matrix.release());
    mfem::Array2D<const mfem::HypreParMatrix*> blocks(2, 2);
    for (int row = 0; row < 2; ++row) {
      for (int column = 0; column < 2; ++column) {
        const mfem::Operator& block = contact_operator->GetBlock(row, column);
        blocks(row, column) =
            block.Height() > 0 && block.Width() > 0
                ? dynamic_cast<const mfem::HypreParMatrix*>(&block)
                : nullptr;
      }
    }
    auto system_matrix =
        std::unique_ptr<mfem::HypreParMatrix>(mfem::HypreParMatrixFromBlocks(blocks));

    mfem::BlockVector right_hand_side(contact_operator->RowOffsets());
    right_hand_side = 0.0;
    mfem::Vector gap;
    tribol::getMfemGap(coupling_scheme_id, gap);
    auto& pressure_prolongation = *pressure.ParFESpace()->GetProlongationMatrix();
    auto& true_gap = right_hand_side.GetBlock(1);
    pressure_prolongation.MultTranspose(gap, true_gap);

    mfem::BlockVector solution(contact_operator->ColOffsets());
    solution = 0.0;
    mfem::MINRESSolver solver(MPI_COMM_WORLD);
    solver.SetRelTol(1.0e-12);
    solver.SetAbsTol(1.0e-14);
    solver.SetMaxIter(4000);
    solver.SetPrintLevel(0);
    solver.SetOperator(*system_matrix);
    mfem::HypreDiagScale preconditioner(*system_matrix);
    preconditioner.SetErrorMode(mfem::HypreSolver::IGNORE_HYPRE_ERRORS);
    solver.SetPreconditioner(preconditioner);
    solver.Mult(right_hand_side, solution);
    if (!solver.GetConverged()) {
      throw std::runtime_error("Tribol contact patch linear system did not converge.");
    }

    auto& true_displacement = solution.GetBlock(0);
    displacement_space.GetProlongationMatrix()->Mult(true_displacement, displacement);
    displacement.Neg();
    coordinates += displacement;
    auto& true_pressure = solution.GetBlock(1);
    pressure_prolongation.Mult(true_pressure, pressure);

    mfem::Vector internal_force(displacement_space.GetTrueVSize());
    internal_force = 0.0;
    mfem::Vector contact_force(internal_force);
    contact_operator->GetBlock(0, 0).Mult(true_displacement, internal_force);
    contact_operator->GetBlock(0, 1).Mult(true_pressure, contact_force);
    mfem::Vector force_residual(internal_force);
    force_residual += contact_force;
    for (int index = 0; index < essential_true_dofs.Size(); ++index) {
      force_residual[essential_true_dofs[index]] = 0.0;
    }
    const double force_residual_norm = global_max(force_residual.Normlinf(), MPI_COMM_WORLD);
    const double force_scale = std::max({
        global_max(internal_force.Normlinf(), MPI_COMM_WORLD),
        global_max(contact_force.Normlinf(), MPI_COMM_WORLD),
        1e-30});
    const double normalised_force_residual = force_residual_norm / force_scale;

    mfem::Vector gap_residual(true_gap.Size());
    gap_residual = 0.0;
    contact_operator->GetBlock(1, 0).Mult(true_displacement, gap_residual);
    gap_residual -= true_gap;
    const double maximum_gap_residual =
        global_max(gap_residual.Normlinf(), MPI_COMM_WORLD);
    constexpr double initial_overlap = 0.01;
    const double normalised_gap_residual = maximum_gap_residual / initial_overlap;

    tribol::updateMfemParallelDecomposition();
    mfem::ParaViewDataCollection volume_collection(
        "contact-patch-volume",
        &mesh);
    volume_collection.SetPrefixPath(arguments.output_directory.string());
    volume_collection.RegisterField("coordinates", &coordinates);
    volume_collection.RegisterField("displacement", &displacement);
    volume_collection.Save();
    mfem::ParaViewDataCollection surface_collection(
        "contact-patch-surface",
        pressure.ParFESpace()->GetMesh());
    surface_collection.SetPrefixPath(arguments.output_directory.string());
    surface_collection.RegisterField("contact_pressure", &pressure);
    surface_collection.Save();

    if (mfem::Mpi::Root()) {
      const auto result_path = arguments.output_directory / "contact-result.json";
      std::ofstream result(result_path);
      result << std::setprecision(17)
             << "{\n"
             << "  \"schemaVersion\": \"1.0.0\",\n"
             << "  \"analysisType\": \"frictionlessMortarContactPatch\",\n"
             << "  \"converged\": true,\n"
             << "  \"iterations\": " << solver.GetNumIterations() << ",\n"
             << "  \"normalisedEquilibriumResidual\": " << normalised_force_residual << ",\n"
             << "  \"maximumGapResidual\": " << maximum_gap_residual << ",\n"
             << "  \"normalisedGapResidual\": " << normalised_gap_residual << "\n"
             << "}\n";
    }

    tribol::finalize();
    tribol_initialised = false;
    if (normalised_force_residual > 1e-6 || normalised_gap_residual > 1e-6) {
      if (mfem::Mpi::Root()) {
        std::cerr << "Contact patch failed force or gap residual gates.\n";
      }
      return 2;
    }
    if (mfem::Mpi::Root()) {
      std::cout << "Tribol contact patch passed: equilibrium="
                << normalised_force_residual
                << ", gap=" << normalised_gap_residual << '\n';
    }
    return 0;
  } catch (const std::exception& error) {
    if (tribol_initialised) {
      tribol::finalize();
    }
    if (mfem::Mpi::Root()) {
      std::cerr << "cad-fem-contact-patch failed: " << error.what() << '\n';
    }
    return 1;
  }
}
