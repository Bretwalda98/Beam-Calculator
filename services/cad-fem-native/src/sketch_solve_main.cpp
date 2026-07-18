#include "sketch_solver.hpp"

#include <cstdlib>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

std::string require_value(int argc, char** argv, int& index) {
  if (index + 1 >= argc) throw std::runtime_error(std::string("Missing value for ") + argv[index]);
  return argv[++index];
}

void usage() {
  std::cerr << "Usage: cad-fem-sketch-solve --input sketch.json --output result.json "
               "[--residual-tolerance 1e-8] [--maximum-iterations 100] "
               "[--expect-state underConstrained|fullyConstrained|overConstrained|failed]\n";
}

}  // namespace

int main(int argc, char** argv) {
  try {
    cad_fem::SketchSolveOptions options;
    for (int i = 1; i < argc; ++i) {
      const std::string argument = argv[i];
      if (argument == "--input") options.input_json = require_value(argc, argv, i);
      else if (argument == "--output") options.output_json = require_value(argc, argv, i);
      else if (argument == "--residual-tolerance") options.residual_tolerance = std::stod(require_value(argc, argv, i));
      else if (argument == "--maximum-iterations") options.maximum_iterations = std::stoi(require_value(argc, argv, i));
      else if (argument == "--expect-state") options.expected_state = require_value(argc, argv, i);
      else if (argument == "--help" || argument == "-h") {
        usage();
        return EXIT_SUCCESS;
      } else {
        throw std::runtime_error("Unknown argument: " + argument);
      }
    }
    if (options.input_json.empty() || options.output_json.empty()) {
      usage();
      return EXIT_FAILURE;
    }
    const auto summary = cad_fem::solve_sketch_json(options);
    std::cout << "Ceres sketch solve: state=" << summary.state
              << " dof=" << summary.degrees_of_freedom
              << " variables=" << summary.variable_count
              << " equations=" << summary.equation_count
              << " rank=" << summary.jacobian_rank
              << " maximumResidual=" << summary.maximum_residual << '\n';
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "cad-fem-sketch-solve: " << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
