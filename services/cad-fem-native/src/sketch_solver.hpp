#pragma once

#include <filesystem>
#include <string>

namespace cad_fem {

struct SketchSolveOptions {
  std::filesystem::path input_json;
  std::filesystem::path output_json;
  double residual_tolerance = 1.0e-8;
  int maximum_iterations = 100;
  std::string expected_state;
};

struct SketchSolveSummary {
  std::string state;
  int degrees_of_freedom = 0;
  int variable_count = 0;
  int equation_count = 0;
  int jacobian_rank = 0;
  double residual_norm = 0.0;
  double maximum_residual = 0.0;
};

SketchSolveSummary solve_sketch_json(const SketchSolveOptions& options);

}  // namespace cad_fem
