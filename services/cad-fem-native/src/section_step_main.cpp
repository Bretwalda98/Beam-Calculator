#include "section_profile.hpp"

#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

int main(int argc, char** argv) {
  try {
    std::filesystem::path input;
    std::filesystem::path output;
    std::filesystem::path metadata;
    for (int index = 1; index < argc; ++index) {
      const std::string option = argv[index];
      const auto next = [&]() -> std::string_view {
        if (index + 1 >= argc) throw std::runtime_error(option + " requires a value.");
        return argv[++index];
      };
      if (option == "--input") input = next();
      else if (option == "--output") output = next();
      else if (option == "--metadata") metadata = next();
      else if (option == "--help" || option == "-h") {
        std::cout << "cad-fem-section-step --input profile.json --output model.step [--metadata section-generation.json]\n";
        return 0;
      } else {
        throw std::runtime_error("Unknown option: " + option);
      }
    }
    if (input.empty() || output.empty()) throw std::runtime_error("--input and --output are required.");
    if (metadata.empty()) metadata = output.parent_path() / "section-generation.json";
    const auto artifacts = cad_fem::generate_catalogue_section_step(input, output, metadata);
    std::cout << "Catalogue section STEP generation complete.\n"
              << "  STEP: " << artifacts.step_path << '\n'
              << "  Generated area [mm^2]: " << artifacts.generated_area_mm2 << '\n'
              << "  Catalogue area [mm^2]: " << artifacts.catalogue_area_mm2 << '\n'
              << "  Relative area difference: " << artifacts.relative_area_difference << '\n';
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "cad-fem-section-step failed: " << error.what() << '\n';
    return 1;
  }
}
