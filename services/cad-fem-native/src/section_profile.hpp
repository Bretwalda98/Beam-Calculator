#pragma once

#include <filesystem>

namespace cad_fem {

struct SectionGenerationArtifacts {
  std::filesystem::path step_path;
  std::filesystem::path metadata_path;
  double generated_area_mm2 = 0.0;
  double catalogue_area_mm2 = 0.0;
  double relative_area_difference = 0.0;
};

SectionGenerationArtifacts generate_catalogue_section_step(
    const std::filesystem::path& input_json,
    const std::filesystem::path& output_step,
    const std::filesystem::path& output_metadata);

}  // namespace cad_fem
