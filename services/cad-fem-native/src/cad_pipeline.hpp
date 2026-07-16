#pragma once

#include <array>
#include <cstddef>
#include <filesystem>
#include <string>

namespace cad_fem {

struct GeometryOptions {
  std::filesystem::path step_path;
  std::filesystem::path output_directory;
  double tessellation_deflection = 0.5;
  double tessellation_angle_rad = 0.35;
};

struct GeometryArtifacts {
  std::filesystem::path ocaf_path;
  std::filesystem::path brep_path;
  std::filesystem::path topology_path;
  std::filesystem::path tessellation_path;
  std::size_t free_shape_count = 0;
  std::size_t face_count = 0;
  std::size_t edge_count = 0;
  std::size_t vertex_count = 0;
  std::array<double, 6> bounds_mm{};
  double volume_mm3 = 0.0;
};

struct MeshOptions {
  std::filesystem::path brep_path;
  std::filesystem::path output_directory;
  double maximum_size_mm = 10.0;
  double minimum_size_mm = 1.0;
  double grading = 0.3;
  bool curvature_refinement = true;
};

struct MeshArtifacts {
  std::filesystem::path netgen_mesh_path;
  std::size_t node_count = 0;
  std::size_t surface_element_count = 0;
  std::size_t volume_element_count = 0;
};

GeometryArtifacts regenerate_step_with_ocaf(const GeometryOptions& options);
MeshArtifacts mesh_brep_with_netgen(const MeshOptions& options);

}  // namespace cad_fem
