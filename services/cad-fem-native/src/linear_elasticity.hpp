#pragma once

#include <array>
#include <filesystem>
#include <optional>
#include <string>

namespace cad_fem {

struct LinearElasticityOptions {
  std::filesystem::path mesh_path;
  std::filesystem::path output_directory;
  double elastic_modulus_n_per_mm2 = 210000.0;
  double poisson_ratio = 0.3;
  std::array<double, 3> traction_n_per_mm2{0.0, -1.0, 0.0};
  int element_order = 2;
  int maximum_iterations = 1000;
  double relative_tolerance = 1e-10;
  double absolute_tolerance = 1e-14;
};

struct LinearElasticityResult {
  bool converged = false;
  int iterations = 0;
  double final_solver_norm = 0.0;
  double normalised_equilibrium_residual = 0.0;
  double strain_energy_n_mm = 0.0;
  double maximum_displacement_mm = 0.0;
  double maximum_von_mises_n_per_mm2 = 0.0;
  double loaded_area_mm2 = 0.0;
  std::array<double, 3> loaded_face_average_displacement_mm{};
  std::array<double, 3> applied_force_n{};
  std::array<double, 3> reaction_force_n{};
  std::filesystem::path result_manifest_path;
  std::filesystem::path paraview_collection_path;
};

LinearElasticityResult solve_linear_elasticity(const LinearElasticityOptions& options);

}  // namespace cad_fem
