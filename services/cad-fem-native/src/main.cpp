#include "cad_pipeline.hpp"
#include "linear_elasticity.hpp"

#include <array>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

struct Arguments {
  std::filesystem::path step_path;
  std::filesystem::path output_directory;
  std::string stage = "solve";
  double mesh_size = 10.0;
  double mesh_min_size = 1.0;
  int element_order = 2;
  double elastic_modulus = 210000.0;
  double poisson_ratio = 0.3;
  std::array<double, 3> traction{0.0, -1.0, 0.0};
  double relative_tolerance = 1e-10;
  double absolute_tolerance = 1e-14;
  int maximum_iterations = 1000;
  std::optional<int> benchmark_component;
  std::optional<double> benchmark_value;
  double benchmark_relative_tolerance = 0.01;
};

double parse_double(std::string_view value, std::string_view option) {
  std::size_t consumed = 0;
  const double parsed = std::stod(std::string(value), &consumed);
  if (consumed != value.size() || !std::isfinite(parsed)) {
    throw std::runtime_error(std::string(option) + " requires a finite number.");
  }
  return parsed;
}

int parse_int(std::string_view value, std::string_view option) {
  std::size_t consumed = 0;
  const int parsed = std::stoi(std::string(value), &consumed);
  if (consumed != value.size()) {
    throw std::runtime_error(std::string(option) + " requires an integer.");
  }
  return parsed;
}

Arguments parse_arguments(int argc, char** argv) {
  Arguments arguments;
  for (int index = 1; index < argc; ++index) {
    const std::string option = argv[index];
    const auto next = [&]() -> std::string_view {
      if (index + 1 >= argc) {
        throw std::runtime_error(option + " requires a value.");
      }
      return argv[++index];
    };
    if (option == "--step") {
      arguments.step_path = next();
    } else if (option == "--output") {
      arguments.output_directory = next();
    } else if (option == "--stage") {
      arguments.stage = next();
      if (arguments.stage != "geometry" && arguments.stage != "mesh" && arguments.stage != "solve") {
        throw std::runtime_error("--stage must be geometry, mesh or solve.");
      }
    } else if (option == "--mesh-size") {
      arguments.mesh_size = parse_double(next(), option);
    } else if (option == "--mesh-min-size") {
      arguments.mesh_min_size = parse_double(next(), option);
    } else if (option == "--element-order") {
      arguments.element_order = parse_int(next(), option);
    } else if (option == "--elastic-modulus") {
      arguments.elastic_modulus = parse_double(next(), option);
    } else if (option == "--poisson-ratio") {
      arguments.poisson_ratio = parse_double(next(), option);
    } else if (option == "--traction-x") {
      arguments.traction[0] = parse_double(next(), option);
    } else if (option == "--traction-y") {
      arguments.traction[1] = parse_double(next(), option);
    } else if (option == "--traction-z") {
      arguments.traction[2] = parse_double(next(), option);
    } else if (option == "--relative-tolerance") {
      arguments.relative_tolerance = parse_double(next(), option);
    } else if (option == "--absolute-tolerance") {
      arguments.absolute_tolerance = parse_double(next(), option);
    } else if (option == "--maximum-iterations") {
      arguments.maximum_iterations = parse_int(next(), option);
    } else if (option == "--benchmark-component") {
      const std::string component(next());
      if (component == "x") arguments.benchmark_component = 0;
      else if (component == "y") arguments.benchmark_component = 1;
      else if (component == "z") arguments.benchmark_component = 2;
      else throw std::runtime_error("--benchmark-component must be x, y or z.");
    } else if (option == "--benchmark-value") {
      arguments.benchmark_value = parse_double(next(), option);
    } else if (option == "--benchmark-relative-tolerance") {
      arguments.benchmark_relative_tolerance = parse_double(next(), option);
    } else if (option == "--help" || option == "-h") {
      std::cout
          << "cad-fem-pipeline --step model.step --output output-directory [options]\n"
          << "Runs STEP -> OCAF/B-rep -> Netgen tetrahedral mesh -> MFEM linear elasticity.\n"
          << "All geometry and solution values use N, mm, N/mm^2 and N*mm.\n";
      std::exit(0);
    } else {
      throw std::runtime_error("Unknown option: " + option);
    }
  }
  if (arguments.step_path.empty() || arguments.output_directory.empty()) {
    throw std::runtime_error("--step and --output are required.");
  }
  if (arguments.benchmark_component.has_value() != arguments.benchmark_value.has_value()) {
    throw std::runtime_error("Benchmark component and value must be supplied together.");
  }
  return arguments;
}

}  // namespace

int main(int argc, char** argv) {
  try {
    const Arguments arguments = parse_arguments(argc, argv);
    const auto geometry = cad_fem::regenerate_step_with_ocaf({
        .step_path = arguments.step_path,
        .output_directory = arguments.output_directory,
        .tessellation_deflection = std::max(0.05, arguments.mesh_min_size * 0.25),
        .tessellation_angle_rad = 0.3,
    });
    if (arguments.stage == "geometry") {
      std::cout << "Native CAD regeneration complete.\n"
                << "  Free shapes: " << geometry.free_shape_count << '\n'
                << "  Faces: " << geometry.face_count << '\n'
                << "  B-rep: " << geometry.brep_path << '\n'
                << "  Tessellation: " << geometry.tessellation_path << '\n';
      return 0;
    }
    const auto mesh = cad_fem::mesh_brep_with_netgen({
        .brep_path = geometry.brep_path,
        .output_directory = arguments.output_directory,
        .maximum_size_mm = arguments.mesh_size,
        .minimum_size_mm = arguments.mesh_min_size,
        .grading = 0.3,
        .curvature_refinement = true,
    });
    if (arguments.stage == "mesh") {
      std::cout << "Native CAD meshing complete.\n"
                << "  Mesh nodes: " << mesh.node_count << '\n'
                << "  Tetrahedra: " << mesh.volume_element_count << '\n'
                << "  Mesh: " << mesh.netgen_mesh_path << '\n';
      return 0;
    }
    const auto solution = cad_fem::solve_linear_elasticity({
        .mesh_path = mesh.netgen_mesh_path,
        .output_directory = arguments.output_directory,
        .elastic_modulus_n_per_mm2 = arguments.elastic_modulus,
        .poisson_ratio = arguments.poisson_ratio,
        .traction_n_per_mm2 = arguments.traction,
        .element_order = arguments.element_order,
        .maximum_iterations = arguments.maximum_iterations,
        .relative_tolerance = arguments.relative_tolerance,
        .absolute_tolerance = arguments.absolute_tolerance,
    });

    std::cout << "Native CAD/FEM pipeline complete.\n"
              << "  Free shapes: " << geometry.free_shape_count << '\n'
              << "  Faces: " << geometry.face_count << '\n'
              << "  Mesh nodes: " << mesh.node_count << '\n'
              << "  Tetrahedra: " << mesh.volume_element_count << '\n'
              << "  Equilibrium residual: " << solution.normalised_equilibrium_residual << '\n'
              << "  Result manifest: " << solution.result_manifest_path << '\n';

    if (arguments.benchmark_component && arguments.benchmark_value) {
      const double actual =
          solution.loaded_face_average_displacement_mm[*arguments.benchmark_component];
      const double denominator = std::max(std::abs(*arguments.benchmark_value), 1e-30);
      const double relative_error = std::abs(actual - *arguments.benchmark_value) / denominator;
      std::cout << "  Benchmark actual: " << actual << '\n'
                << "  Benchmark expected: " << *arguments.benchmark_value << '\n'
                << "  Benchmark relative error: " << relative_error << '\n';
      if (relative_error > arguments.benchmark_relative_tolerance) {
        std::cerr << "Benchmark failed the configured relative-error gate.\n";
        return 2;
      }
    }
    if (solution.normalised_equilibrium_residual > 1e-8) {
      std::cerr << "Solution failed the linear equilibrium gate.\n";
      return 3;
    }
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "cad-fem-pipeline failed: " << error.what() << '\n';
    return 1;
  }
}
