#include "linear_elasticity.hpp"

#include <mfem.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <stdexcept>
#include <string>

namespace cad_fem {
namespace {

using mfem::Array;
using mfem::BilinearForm;
using mfem::CGSolver;
using mfem::ConstantCoefficient;
using mfem::ElasticityIntegrator;
using mfem::ElementTransformation;
using mfem::FiniteElementSpace;
using mfem::GSSmoother;
using mfem::GridFunction;
using mfem::H1_FECollection;
using mfem::IntegrationPoint;
using mfem::L2_FECollection;
using mfem::LinearForm;
using mfem::Mesh;
using mfem::Ordering;
using mfem::ParaViewDataCollection;
using mfem::SparseMatrix;
using mfem::Vector;
using mfem::VectorBoundaryLFIntegrator;
using mfem::VectorConstantCoefficient;

constexpr double kCoordinateToleranceFactor = 1.0e-8;

class VonMisesCoefficient final : public mfem::Coefficient {
 public:
  explicit VonMisesCoefficient(GridFunction& stress)
      : stress_(stress) {}

  mfem::real_t Eval(ElementTransformation& transformation, const IntegrationPoint& point) override {
    Vector stress;
    stress_.GetVectorValue(transformation, point, stress);
    if (stress.Size() != 6) {
      throw std::runtime_error("The stress field does not contain six symmetric tensor components.");
    }
    const double sx = stress(0);
    const double sy = stress(1);
    const double sz = stress(2);
    const double txy = stress(3);
    const double txz = stress(4);
    const double tyz = stress(5);
    return std::sqrt(
        0.5 * ((sx - sy) * (sx - sy) + (sy - sz) * (sy - sz) + (sz - sx) * (sz - sx)) +
        3.0 * (txy * txy + txz * txz + tyz * tyz));
  }

 private:
  GridFunction& stress_;
};

double vector_norm(const std::array<double, 3>& value) {
  return std::sqrt(value[0] * value[0] + value[1] * value[1] + value[2] * value[2]);
}

int vector_component(const FiniteElementSpace& space, int vdof) {
  if (space.GetOrdering() == Ordering::byVDIM) {
    return vdof % space.GetVDim();
  }
  return vdof / space.GetNDofs();
}

void classify_boundary_faces(Mesh& mesh) {
  Vector minimum;
  Vector maximum;
  mesh.GetBoundingBox(minimum, maximum);
  const double span = std::max(maximum(0) - minimum(0), 1.0);
  const double tolerance = span * kCoordinateToleranceFactor;

  Array<int> vertices;
  for (int boundary_element = 0; boundary_element < mesh.GetNBE(); ++boundary_element) {
    mesh.GetBdrElementVertices(boundary_element, vertices);
    double centroid_x = 0.0;
    for (int local_vertex = 0; local_vertex < vertices.Size(); ++local_vertex) {
      centroid_x += mesh.GetVertex(vertices[local_vertex])[0];
    }
    centroid_x /= static_cast<double>(vertices.Size());
    int attribute = 3;
    if (std::abs(centroid_x - minimum(0)) <= tolerance) {
      attribute = 1;
    } else if (std::abs(centroid_x - maximum(0)) <= tolerance) {
      attribute = 2;
    }
    mesh.SetBdrAttribute(boundary_element, attribute);
  }
  mesh.SetAttributes();
  if (mesh.bdr_attributes.Find(1) < 0 || mesh.bdr_attributes.Find(2) < 0) {
    throw std::runtime_error("Could not identify opposite x-normal boundary faces for support and traction.");
  }
}

void integrate_loaded_face(
    Mesh& mesh,
    GridFunction& displacement,
    int integration_order,
    const std::array<double, 3>& traction,
    double& area,
    std::array<double, 3>& average_displacement,
    std::array<double, 3>& applied_force) {
  area = 0.0;
  average_displacement = {0.0, 0.0, 0.0};
  for (int boundary_element = 0; boundary_element < mesh.GetNBE(); ++boundary_element) {
    if (mesh.GetBdrElement(boundary_element)->GetAttribute() != 2) {
      continue;
    }
    ElementTransformation* transformation = mesh.GetBdrElementTransformation(boundary_element);
    const auto geometry = mesh.GetBdrElementBaseGeometry(boundary_element);
    const mfem::IntegrationRule& rule = mfem::IntRules.Get(geometry, integration_order);
    for (int point_index = 0; point_index < rule.GetNPoints(); ++point_index) {
      const IntegrationPoint& point = rule.IntPoint(point_index);
      transformation->SetIntPoint(&point);
      const double weight = point.weight * transformation->Weight();
      Vector value;
      displacement.GetVectorValue(*transformation, point, value);
      area += weight;
      for (int component = 0; component < 3; ++component) {
        average_displacement[component] += weight * value(component);
      }
    }
  }
  if (!(area > 0.0)) {
    throw std::runtime_error("The loaded face has zero integrated area.");
  }
  for (int component = 0; component < 3; ++component) {
    average_displacement[component] /= area;
    applied_force[component] = traction[component] * area;
  }
}

double sample_maximum_displacement(Mesh& mesh, GridFunction& displacement, int order) {
  double maximum = 0.0;
  for (int element = 0; element < mesh.GetNE(); ++element) {
    const auto geometry = mesh.GetElementBaseGeometry(element);
    const mfem::IntegrationRule& rule = mfem::IntRules.Get(geometry, std::max(2, 2 * order));
    for (int point_index = 0; point_index < rule.GetNPoints(); ++point_index) {
      Vector value;
      displacement.GetVectorValue(element, rule.IntPoint(point_index), value);
      maximum = std::max(maximum, value.Norml2());
    }
  }
  return maximum;
}

void write_result_manifest(
    const std::filesystem::path& path,
    const LinearElasticityOptions& options,
    const LinearElasticityResult& result,
    int nodes,
    int elements,
    int true_dofs) {
  std::ofstream stream(path);
  if (!stream) {
    throw std::runtime_error("Could not create result manifest: " + path.string());
  }
  stream << std::setprecision(17);
  stream << "{\n"
         << "  \"schemaVersion\": \"1.0.0\",\n"
         << "  \"nativePipelineVersion\": \"" << CAD_FEM_NATIVE_VERSION << "\",\n"
         << "  \"analysisType\": \"linearStatic\",\n"
         << "  \"units\": {\"length\":\"mm\",\"force\":\"N\",\"stress\":\"N/mm2\",\"energy\":\"N*mm\"},\n"
         << "  \"converged\": " << (result.converged ? "true" : "false") << ",\n"
         << "  \"mesh\": {\"nodes\":" << nodes << ",\"elements\":" << elements
         << ",\"displacementElementOrder\":" << options.element_order << "},\n"
         << "  \"linearSystem\": {\"trueDofs\":" << true_dofs
         << ",\"iterations\":" << result.iterations
         << ",\"finalSolverNorm\":" << result.final_solver_norm << "},\n"
         << "  \"equilibriumResidual\": " << result.normalised_equilibrium_residual << ",\n"
         << "  \"strainEnergy\": " << result.strain_energy_n_mm << ",\n"
         << "  \"maximumDisplacement\": " << result.maximum_displacement_mm << ",\n"
         << "  \"maximumVonMises\": " << result.maximum_von_mises_n_per_mm2 << ",\n"
         << "  \"loadedArea\": " << result.loaded_area_mm2 << ",\n"
         << "  \"loadedFaceAverageDisplacement\": ["
         << result.loaded_face_average_displacement_mm[0] << ','
         << result.loaded_face_average_displacement_mm[1] << ','
         << result.loaded_face_average_displacement_mm[2] << "],\n"
         << "  \"appliedForce\": ["
         << result.applied_force_n[0] << ','
         << result.applied_force_n[1] << ','
         << result.applied_force_n[2] << "],\n"
         << "  \"reactionForce\": ["
         << result.reaction_force_n[0] << ','
         << result.reaction_force_n[1] << ','
         << result.reaction_force_n[2] << "]\n"
         << "}\n";
}

}  // namespace

LinearElasticityResult solve_linear_elasticity(const LinearElasticityOptions& options) {
  if (!std::filesystem::is_regular_file(options.mesh_path)) {
    throw std::runtime_error("MFEM mesh input does not exist: " + options.mesh_path.string());
  }
  if (!(options.elastic_modulus_n_per_mm2 > 0.0) || !std::isfinite(options.elastic_modulus_n_per_mm2)) {
    throw std::runtime_error("Elastic modulus must be a positive finite value.");
  }
  if (!(options.poisson_ratio > -1.0 && options.poisson_ratio < 0.49)) {
    throw std::runtime_error("Poisson ratio must satisfy -1 < nu < 0.49.");
  }
  if (options.element_order < 1) {
    throw std::runtime_error("Displacement element order must be at least one.");
  }
  std::filesystem::create_directories(options.output_directory);

  Mesh mesh(options.mesh_path.string().c_str(), 1, 1);
  if (mesh.Dimension() != 3 || mesh.SpaceDimension() != 3) {
    throw std::runtime_error("The linear-elasticity pipeline requires a three-dimensional mesh.");
  }
  classify_boundary_faces(mesh);

  H1_FECollection displacement_collection(options.element_order, 3);
  FiniteElementSpace displacement_space(
      &mesh,
      &displacement_collection,
      3,
      Ordering::byVDIM);

  Array<int> fixed_marker(mesh.bdr_attributes.Max());
  fixed_marker = 0;
  fixed_marker[0] = 1;
  Array<int> fixed_true_dofs;
  displacement_space.GetEssentialTrueDofs(fixed_marker, fixed_true_dofs);
  if (fixed_true_dofs.IsEmpty()) {
    throw std::runtime_error("The fixed boundary produced no essential degrees of freedom.");
  }

  Array<int> load_marker(mesh.bdr_attributes.Max());
  load_marker = 0;
  load_marker[1] = 1;
  Vector traction_vector(3);
  for (int component = 0; component < 3; ++component) {
    traction_vector(component) = options.traction_n_per_mm2[component];
  }
  VectorConstantCoefficient traction_coefficient(traction_vector);
  LinearForm load(&displacement_space);
  load.AddBoundaryIntegrator(new VectorBoundaryLFIntegrator(traction_coefficient), load_marker);
  load.Assemble();
  const Vector assembled_load(load);

  const double shear_modulus =
      options.elastic_modulus_n_per_mm2 / (2.0 * (1.0 + options.poisson_ratio));
  const double lame_lambda =
      options.elastic_modulus_n_per_mm2 * options.poisson_ratio /
      ((1.0 + options.poisson_ratio) * (1.0 - 2.0 * options.poisson_ratio));
  ConstantCoefficient lambda_coefficient(lame_lambda);
  ConstantCoefficient mu_coefficient(shear_modulus);
  auto* elasticity = new ElasticityIntegrator(lambda_coefficient, mu_coefficient);
  BilinearForm stiffness(&displacement_space);
  stiffness.AddDomainIntegrator(elasticity);
  stiffness.Assemble();

  GridFunction displacement(&displacement_space);
  displacement = 0.0;
  SparseMatrix system_matrix;
  Vector system_rhs;
  Vector system_solution;
  stiffness.FormLinearSystem(
      fixed_true_dofs,
      displacement,
      load,
      system_matrix,
      system_solution,
      system_rhs);

  GSSmoother preconditioner(system_matrix);
  CGSolver solver;
  solver.SetOperator(system_matrix);
  solver.SetPreconditioner(preconditioner);
  solver.SetRelTol(options.relative_tolerance);
  solver.SetAbsTol(options.absolute_tolerance);
  solver.SetMaxIter(options.maximum_iterations);
  solver.SetPrintLevel(0);
  solver.Mult(system_rhs, system_solution);

  LinearElasticityResult result;
  result.converged = solver.GetConverged();
  result.iterations = solver.GetNumIterations();
  result.final_solver_norm = solver.GetFinalNorm();
  if (!result.converged) {
    throw std::runtime_error("MFEM conjugate-gradient solve did not converge.");
  }
  stiffness.RecoverFEMSolution(system_solution, load, displacement);

  integrate_loaded_face(
      mesh,
      displacement,
      2 * options.element_order + 2,
      options.traction_n_per_mm2,
      result.loaded_area_mm2,
      result.loaded_face_average_displacement_mm,
      result.applied_force_n);
  result.maximum_displacement_mm =
      sample_maximum_displacement(mesh, displacement, options.element_order);

  Vector internal_force(displacement_space.GetVSize());
  stiffness.FullMult(displacement, internal_force);
  internal_force -= assembled_load;
  Array<int> fixed_vdof_marker;
  displacement_space.GetEssentialVDofs(fixed_marker, fixed_vdof_marker);
  for (int vdof = 0; vdof < fixed_vdof_marker.Size(); ++vdof) {
    if (fixed_vdof_marker[vdof] < 0) {
      const int component = vector_component(displacement_space, vdof);
      result.reaction_force_n[component] += internal_force(vdof);
    }
  }
  std::array<double, 3> imbalance{};
  for (int component = 0; component < 3; ++component) {
    imbalance[component] = result.reaction_force_n[component] + result.applied_force_n[component];
  }
  result.normalised_equilibrium_residual =
      vector_norm(imbalance) / std::max(vector_norm(result.applied_force_n), std::numeric_limits<double>::epsilon());

  Vector stiffness_times_displacement(displacement_space.GetVSize());
  stiffness.FullMult(displacement, stiffness_times_displacement);
  result.strain_energy_n_mm = 0.5 * (displacement * stiffness_times_displacement);

  L2_FECollection stress_collection(0, 3);
  FiniteElementSpace stress_space(&mesh, &stress_collection, 6, Ordering::byVDIM);
  GridFunction stress(&stress_space);
  displacement.ComputeFlux(*elasticity, stress, true);
  L2_FECollection scalar_collection(0, 3);
  FiniteElementSpace scalar_space(&mesh, &scalar_collection);
  GridFunction von_mises(&scalar_space);
  VonMisesCoefficient von_mises_coefficient(stress);
  von_mises.ProjectCoefficient(von_mises_coefficient);
  result.maximum_von_mises_n_per_mm2 = von_mises.Max();

  const std::filesystem::path paraview_directory = options.output_directory / "paraview";
  std::filesystem::create_directories(paraview_directory);
  ParaViewDataCollection collection("linear-static", &mesh);
  collection.SetPrefixPath(paraview_directory.string());
  collection.SetLevelsOfDetail(options.element_order);
  collection.SetDataFormat(mfem::VTKFormat::BINARY32);
  collection.SetHighOrderOutput(true);
  collection.RegisterField("displacement_mm", &displacement);
  collection.RegisterField("stress_n_per_mm2", &stress);
  collection.RegisterField("von_mises_n_per_mm2", &von_mises);
  collection.Save();
  result.paraview_collection_path = paraview_directory / "linear-static.pvd";

  result.result_manifest_path = options.output_directory / "result.json";
  write_result_manifest(
      result.result_manifest_path,
      options,
      result,
      mesh.GetNV(),
      mesh.GetNE(),
      displacement_space.GetTrueVSize());
  return result;
}

}  // namespace cad_fem
