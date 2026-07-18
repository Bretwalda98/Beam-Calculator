#include "sketch_solver.hpp"

#include <ceres/ceres.h>
#include <ceres/crs_matrix.h>
#include <ceres/dynamic_autodiff_cost_function.h>
#include <ceres/version.h>
#include <Eigen/Dense>
#include <rapidjson/document.h>
#include <rapidjson/istreamwrapper.h>
#include <rapidjson/ostreamwrapper.h>
#include <rapidjson/prettywriter.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace cad_fem {
namespace {

using Json = rapidjson::Value;

enum class EquationKind {
  DifferenceX,
  DifferenceY,
  Distance,
  Horizontal,
  Vertical,
  Parallel,
  Perpendicular,
  EqualLineLength,
  EqualRadius,
  Radius,
  Angle,
  FixedX,
  FixedY,
  ArcRadiusEquality,
  LineRadialTangent,
  RadialTangent
};

struct RadialReference {
  int centre_x = -1;
  int centre_y = -1;
  int radius_variable = -1;
  int radial_x = -1;
  int radial_y = -1;
};

struct Equation {
  EquationKind kind = EquationKind::DifferenceX;
  std::array<int, 8> index{-1, -1, -1, -1, -1, -1, -1, -1};
  RadialReference radial_a;
  RadialReference radial_b;
  double target = 0.0;
  std::string constraint_id;
  std::vector<std::string> entity_ids;
};

struct EntityReference {
  std::string id;
  std::string type;
  int start_x = -1;
  int start_y = -1;
  int end_x = -1;
  int end_y = -1;
  RadialReference radial;
};

struct Diagnostic {
  std::string severity;
  std::string code;
  std::string message;
  std::vector<std::string> entity_ids;
  std::vector<std::string> constraint_ids;
};

const Json& required_member(const Json& object, const char* name) {
  if (!object.IsObject() || !object.HasMember(name)) throw std::runtime_error(std::string("Missing JSON member: ") + name);
  return object[name];
}

std::string required_string(const Json& object, const char* name) {
  const auto& value = required_member(object, name);
  if (!value.IsString() || std::string(value.GetString()).empty()) throw std::runtime_error(std::string("Invalid string member: ") + name);
  return value.GetString();
}

double required_number(const Json& object, const char* name) {
  const auto& value = required_member(object, name);
  if (!value.IsNumber() || !std::isfinite(value.GetDouble())) throw std::runtime_error(std::string("Invalid number member: ") + name);
  return value.GetDouble();
}

template <typename T>
T radial_radius(const T* values, const RadialReference& radial) {
  if (radial.radius_variable >= 0) return values[radial.radius_variable];
  const T dx = values[radial.radial_x] - values[radial.centre_x];
  const T dy = values[radial.radial_y] - values[radial.centre_y];
  using std::sqrt;
  return sqrt(dx * dx + dy * dy + T(1.0e-24));
}

template <typename T>
T line_length(const T* values, int ax, int ay, int bx, int by) {
  const T dx = values[bx] - values[ax];
  const T dy = values[by] - values[ay];
  using std::sqrt;
  return sqrt(dx * dx + dy * dy + T(1.0e-24));
}

class SketchResiduals {
 public:
  explicit SketchResiduals(std::vector<Equation> equations) : equations_(std::move(equations)) {}

  template <typename T>
  bool operator()(T const* const* parameter_blocks, T* residuals) const {
    const T* values = parameter_blocks[0];
    for (std::size_t row = 0; row < equations_.size(); ++row) {
      const auto& equation = equations_[row];
      const auto& i = equation.index;
      switch (equation.kind) {
        case EquationKind::DifferenceX:
          residuals[row] = values[i[0]] - values[i[2]] - T(equation.target);
          break;
        case EquationKind::DifferenceY:
          residuals[row] = values[i[1]] - values[i[3]] - T(equation.target);
          break;
        case EquationKind::Distance: {
          const T dx = values[i[2]] - values[i[0]];
          const T dy = values[i[3]] - values[i[1]];
          using std::sqrt;
          residuals[row] = sqrt(dx * dx + dy * dy + T(1.0e-24)) - T(equation.target);
          break;
        }
        case EquationKind::Horizontal:
          residuals[row] = values[i[3]] - values[i[1]];
          break;
        case EquationKind::Vertical:
          residuals[row] = values[i[2]] - values[i[0]];
          break;
        case EquationKind::Parallel:
        case EquationKind::Perpendicular:
        case EquationKind::Angle: {
          const T ax = values[i[2]] - values[i[0]];
          const T ay = values[i[3]] - values[i[1]];
          const T bx = values[i[6]] - values[i[4]];
          const T by = values[i[7]] - values[i[5]];
          const T scale = line_length(values, i[0], i[1], i[2], i[3]) *
                          line_length(values, i[4], i[5], i[6], i[7]);
          const T cross = (ax * by - ay * bx) / scale;
          const T dot = (ax * bx + ay * by) / scale;
          if (equation.kind == EquationKind::Parallel) residuals[row] = cross;
          else if (equation.kind == EquationKind::Perpendicular) residuals[row] = dot;
          else {
            using std::atan2;
            residuals[row] = atan2(cross, dot) - T(equation.target);
          }
          break;
        }
        case EquationKind::EqualLineLength:
          residuals[row] = line_length(values, i[0], i[1], i[2], i[3]) -
                           line_length(values, i[4], i[5], i[6], i[7]);
          break;
        case EquationKind::EqualRadius:
          residuals[row] = radial_radius(values, equation.radial_a) - radial_radius(values, equation.radial_b);
          break;
        case EquationKind::Radius:
          residuals[row] = radial_radius(values, equation.radial_a) - T(equation.target);
          break;
        case EquationKind::FixedX:
          residuals[row] = values[i[0]] - T(equation.target);
          break;
        case EquationKind::FixedY:
          residuals[row] = values[i[1]] - T(equation.target);
          break;
        case EquationKind::ArcRadiusEquality:
          residuals[row] = radial_radius(values, equation.radial_a) - radial_radius(values, equation.radial_b);
          break;
        case EquationKind::LineRadialTangent: {
          const T ax = values[i[0]];
          const T ay = values[i[1]];
          const T bx = values[i[2]];
          const T by = values[i[3]];
          const T cx = values[equation.radial_a.centre_x];
          const T cy = values[equation.radial_a.centre_y];
          const T numerator = (bx - ax) * (ay - cy) - (ax - cx) * (by - ay);
          using std::sqrt;
          const T distance = sqrt(numerator * numerator + T(1.0e-24)) /
                             line_length(values, i[0], i[1], i[2], i[3]);
          residuals[row] = distance - radial_radius(values, equation.radial_a);
          break;
        }
        case EquationKind::RadialTangent: {
          const T dx = values[equation.radial_b.centre_x] - values[equation.radial_a.centre_x];
          const T dy = values[equation.radial_b.centre_y] - values[equation.radial_a.centre_y];
          using std::sqrt;
          residuals[row] = sqrt(dx * dx + dy * dy + T(1.0e-24)) -
                           radial_radius(values, equation.radial_a) - radial_radius(values, equation.radial_b);
          break;
        }
      }
    }
    return true;
  }

 private:
  std::vector<Equation> equations_;
};

std::string utc_now() {
  const auto now = std::chrono::system_clock::now();
  const std::time_t value = std::chrono::system_clock::to_time_t(now);
  std::tm tm{};
#ifdef _WIN32
  gmtime_s(&tm, &value);
#else
  gmtime_r(&value, &tm);
#endif
  std::ostringstream stream;
  stream << std::put_time(&tm, "%Y-%m-%dT%H:%M:%SZ");
  return stream.str();
}

void add_string(rapidjson::Document::AllocatorType& allocator, Json& object, const char* name, const std::string& value) {
  rapidjson::Value key(name, allocator);
  rapidjson::Value json_value(value.c_str(), static_cast<rapidjson::SizeType>(value.size()), allocator);
  object.AddMember(key, json_value, allocator);
}

void add_string_array(rapidjson::Document::AllocatorType& allocator, Json& object, const char* name, const std::vector<std::string>& values) {
  rapidjson::Value array(rapidjson::kArrayType);
  for (const auto& value : values) array.PushBack(rapidjson::Value(value.c_str(), allocator), allocator);
  object.AddMember(rapidjson::Value(name, allocator), array, allocator);
}

int point_index(const std::map<std::string, int>& points, const std::string& id) {
  const auto found = points.find(id);
  if (found == points.end()) throw std::runtime_error("Constraint references missing point " + id + '.');
  return found->second;
}

const EntityReference& entity_reference(const std::map<std::string, EntityReference>& entities, const std::string& id) {
  const auto found = entities.find(id);
  if (found == entities.end()) throw std::runtime_error("Constraint references missing entity " + id + '.');
  return found->second;
}

std::pair<int, int> entity_point(const EntityReference& entity, const std::string& role) {
  if (role == "start" && entity.start_x >= 0) return {entity.start_x, entity.start_y};
  if (role == "end" && entity.end_x >= 0) return {entity.end_x, entity.end_y};
  if (role == "centre" && entity.radial.centre_x >= 0) return {entity.radial.centre_x, entity.radial.centre_y};
  throw std::runtime_error("Entity " + entity.id + " does not provide point role " + role + '.');
}

Equation line_equation(EquationKind kind, const EntityReference& line, const std::string& constraint_id) {
  if (line.type != "line") throw std::runtime_error("Constraint requires a line entity.");
  Equation equation;
  equation.kind = kind;
  equation.index = {line.start_x, line.start_y, line.end_x, line.end_y, -1, -1, -1, -1};
  equation.constraint_id = constraint_id;
  equation.entity_ids = {line.id};
  return equation;
}

void assign_second_line(Equation& equation, const EntityReference& line) {
  if (line.type != "line") throw std::runtime_error("Constraint requires two line entities.");
  equation.index[4] = line.start_x;
  equation.index[5] = line.start_y;
  equation.index[6] = line.end_x;
  equation.index[7] = line.end_y;
  equation.entity_ids.push_back(line.id);
}

rapidjson::Document read_document(const std::filesystem::path& path) {
  std::ifstream input(path);
  if (!input) throw std::runtime_error("Cannot open sketch input " + path.string());
  rapidjson::IStreamWrapper wrapper(input);
  rapidjson::Document document;
  document.ParseStream(wrapper);
  if (document.HasParseError() || !document.IsObject()) throw std::runtime_error("Sketch input is not valid JSON.");
  return document;
}

void write_document(const std::filesystem::path& path, const rapidjson::Document& document) {
  if (!path.parent_path().empty()) std::filesystem::create_directories(path.parent_path());
  std::ofstream output(path);
  if (!output) throw std::runtime_error("Cannot write sketch result " + path.string());
  rapidjson::OStreamWrapper wrapper(output);
  rapidjson::PrettyWriter<rapidjson::OStreamWrapper> writer(wrapper);
  writer.SetMaxDecimalPlaces(17);
  document.Accept(writer);
  output << '\n';
}

}  // namespace

SketchSolveSummary solve_sketch_json(const SketchSolveOptions& options) {
  if (!(options.residual_tolerance > 0.0) || options.maximum_iterations < 1) {
    throw std::runtime_error("Sketch solve tolerances are invalid.");
  }
  auto document = read_document(options.input_json);
  Json* sketch = &document;
  if (document.HasMember("sketch")) sketch = &document["sketch"];
  if (!sketch->IsObject()) throw std::runtime_error("Sketch must be a JSON object.");
  required_string(*sketch, "id");

  auto& points_json = const_cast<Json&>(required_member(*sketch, "points"));
  auto& entities_json = const_cast<Json&>(required_member(*sketch, "entities"));
  const auto& constraints_json = required_member(*sketch, "constraints");
  if (!points_json.IsArray() || !entities_json.IsArray() || !constraints_json.IsArray()) {
    throw std::runtime_error("Sketch points, entities and constraints must be arrays.");
  }

  std::vector<double> variables;
  std::map<std::string, int> point_indices;
  for (const auto& point : points_json.GetArray()) {
    const std::string id = required_string(point, "id");
    if (point_indices.contains(id)) throw std::runtime_error("Duplicate sketch point ID " + id + '.');
    point_indices[id] = static_cast<int>(variables.size());
    variables.push_back(required_number(point, "x"));
    variables.push_back(required_number(point, "y"));
  }
  if (variables.empty()) throw std::runtime_error("A sketch must contain at least one point before solving.");

  std::map<std::string, EntityReference> entities;
  std::vector<Equation> equations;
  std::vector<int> radius_variables;
  for (const auto& entity : entities_json.GetArray()) {
    EntityReference reference;
    reference.id = required_string(entity, "id");
    reference.type = required_string(entity, "type");
    if (entities.contains(reference.id)) throw std::runtime_error("Duplicate sketch entity ID " + reference.id + '.');
    if (reference.type == "line") {
      const int start = point_index(point_indices, required_string(entity, "startPointId"));
      const int end = point_index(point_indices, required_string(entity, "endPointId"));
      reference.start_x = start;
      reference.start_y = start + 1;
      reference.end_x = end;
      reference.end_y = end + 1;
    } else if (reference.type == "circle") {
      const int centre = point_index(point_indices, required_string(entity, "centrePointId"));
      reference.radial.centre_x = centre;
      reference.radial.centre_y = centre + 1;
      reference.radial.radius_variable = static_cast<int>(variables.size());
      radius_variables.push_back(reference.radial.radius_variable);
      const double radius = required_number(entity, "radius");
      if (!(radius > 0.0)) throw std::runtime_error("Circle radius must be positive.");
      variables.push_back(radius);
    } else if (reference.type == "arc") {
      const int centre = point_index(point_indices, required_string(entity, "centrePointId"));
      const int start = point_index(point_indices, required_string(entity, "startPointId"));
      const int end = point_index(point_indices, required_string(entity, "endPointId"));
      reference.start_x = start;
      reference.start_y = start + 1;
      reference.end_x = end;
      reference.end_y = end + 1;
      reference.radial = {centre, centre + 1, -1, start, start + 1};
      Equation intrinsic;
      intrinsic.kind = EquationKind::ArcRadiusEquality;
      intrinsic.radial_a = reference.radial;
      intrinsic.radial_b = {centre, centre + 1, -1, end, end + 1};
      intrinsic.entity_ids = {reference.id};
      equations.push_back(std::move(intrinsic));
    } else {
      throw std::runtime_error("Unsupported sketch entity type " + reference.type + '.');
    }
    entities.emplace(reference.id, std::move(reference));
  }

  for (const auto& constraint : constraints_json.GetArray()) {
    const std::string id = required_string(constraint, "id");
    const std::string type = required_string(constraint, "type");
    if (type == "fixed") {
      const int point = point_index(point_indices, required_string(constraint, "pointId"));
      Equation x;
      x.kind = EquationKind::FixedX;
      x.index[0] = point;
      x.target = variables[point];
      x.constraint_id = id;
      Equation y = x;
      y.kind = EquationKind::FixedY;
      y.index[1] = point + 1;
      y.target = variables[point + 1];
      equations.push_back(std::move(x));
      equations.push_back(std::move(y));
    } else if (type == "coincident") {
      const auto& a = entity_reference(entities, required_string(constraint, "entityA"));
      const auto& b = entity_reference(entities, required_string(constraint, "entityB"));
      const std::string role_a = constraint.HasMember("pointA") && constraint["pointA"].IsString() ? constraint["pointA"].GetString() : "start";
      const std::string role_b = constraint.HasMember("pointB") && constraint["pointB"].IsString() ? constraint["pointB"].GetString() : "start";
      const auto pa = entity_point(a, role_a);
      const auto pb = entity_point(b, role_b);
      Equation x;
      x.kind = EquationKind::DifferenceX;
      x.index = {pa.first, pa.second, pb.first, pb.second, -1, -1, -1, -1};
      x.constraint_id = id;
      x.entity_ids = {a.id, b.id};
      Equation y = x;
      y.kind = EquationKind::DifferenceY;
      equations.push_back(std::move(x));
      equations.push_back(std::move(y));
    } else if (type == "horizontal" || type == "vertical") {
      equations.push_back(line_equation(
        type == "horizontal" ? EquationKind::Horizontal : EquationKind::Vertical,
        entity_reference(entities, required_string(constraint, "entityId")), id));
    } else if (type == "parallel" || type == "perpendicular" || type == "angle") {
      const auto kind = type == "parallel" ? EquationKind::Parallel :
                        type == "perpendicular" ? EquationKind::Perpendicular : EquationKind::Angle;
      const auto& first = entity_reference(entities, required_string(constraint, "entityA"));
      const auto& second = entity_reference(entities, required_string(constraint, "entityB"));
      Equation equation = line_equation(kind, first, id);
      assign_second_line(equation, second);
      if (type == "angle") equation.target = required_number(constraint, "valueRad");
      equations.push_back(std::move(equation));
    } else if (type == "equal") {
      const auto& first = entity_reference(entities, required_string(constraint, "entityA"));
      const auto& second = entity_reference(entities, required_string(constraint, "entityB"));
      if (first.type == "line" && second.type == "line") {
        Equation equation = line_equation(EquationKind::EqualLineLength, first, id);
        assign_second_line(equation, second);
        equations.push_back(std::move(equation));
      } else if (first.radial.centre_x >= 0 && second.radial.centre_x >= 0) {
        Equation equation;
        equation.kind = EquationKind::EqualRadius;
        equation.radial_a = first.radial;
        equation.radial_b = second.radial;
        equation.constraint_id = id;
        equation.entity_ids = {first.id, second.id};
        equations.push_back(std::move(equation));
      } else {
        throw std::runtime_error("Equal constraint requires two lines or two radial entities.");
      }
    } else if (type == "distance" || type == "horizontalDistance" || type == "verticalDistance") {
      const int first = point_index(point_indices, required_string(constraint, "pointA"));
      const int second = point_index(point_indices, required_string(constraint, "pointB"));
      Equation equation;
      equation.kind = type == "distance" ? EquationKind::Distance :
                      type == "horizontalDistance" ? EquationKind::DifferenceX : EquationKind::DifferenceY;
      equation.index = {second, second + 1, first, first + 1, -1, -1, -1, -1};
      equation.target = required_number(constraint, "value");
      equation.constraint_id = id;
      equations.push_back(std::move(equation));
    } else if (type == "radius" || type == "diameter") {
      const auto& radial = entity_reference(entities, required_string(constraint, "entityId"));
      if (radial.radial.centre_x < 0) throw std::runtime_error("Radius constraint requires an arc or circle.");
      Equation equation;
      equation.kind = EquationKind::Radius;
      equation.radial_a = radial.radial;
      equation.target = required_number(constraint, "value") / (type == "diameter" ? 2.0 : 1.0);
      equation.constraint_id = id;
      equation.entity_ids = {radial.id};
      equations.push_back(std::move(equation));
    } else if (type == "tangent") {
      const auto& first = entity_reference(entities, required_string(constraint, "entityA"));
      const auto& second = entity_reference(entities, required_string(constraint, "entityB"));
      Equation equation;
      equation.constraint_id = id;
      equation.entity_ids = {first.id, second.id};
      if (first.type == "line" && second.radial.centre_x >= 0) {
        equation = line_equation(EquationKind::LineRadialTangent, first, id);
        equation.radial_a = second.radial;
        equation.entity_ids.push_back(second.id);
      } else if (second.type == "line" && first.radial.centre_x >= 0) {
        equation = line_equation(EquationKind::LineRadialTangent, second, id);
        equation.radial_a = first.radial;
        equation.entity_ids.push_back(first.id);
      } else if (first.radial.centre_x >= 0 && second.radial.centre_x >= 0) {
        equation.kind = EquationKind::RadialTangent;
        equation.radial_a = first.radial;
        equation.radial_b = second.radial;
      } else {
        throw std::runtime_error("Tangent constraint requires a line and radial entity, or two radial entities.");
      }
      equations.push_back(std::move(equation));
    } else {
      throw std::runtime_error("Unsupported sketch constraint type " + type + '.');
    }
  }

  ceres::Problem problem;
  problem.AddParameterBlock(variables.data(), static_cast<int>(variables.size()));
  for (const int variable : radius_variables) problem.SetParameterLowerBound(variables.data(), variable, 1.0e-9);
  if (!equations.empty()) {
    auto* cost = new ceres::DynamicAutoDiffCostFunction<SketchResiduals, 4>(new SketchResiduals(equations));
    cost->AddParameterBlock(static_cast<int>(variables.size()));
    cost->SetNumResiduals(static_cast<int>(equations.size()));
    problem.AddResidualBlock(cost, nullptr, variables.data());
  }

  ceres::Solver::Options solver_options;
  solver_options.linear_solver_type = ceres::DENSE_QR;
  solver_options.max_num_iterations = options.maximum_iterations;
  solver_options.function_tolerance = 1.0e-14;
  solver_options.gradient_tolerance = 1.0e-14;
  solver_options.parameter_tolerance = 1.0e-14;
  solver_options.minimizer_progress_to_stdout = false;
  ceres::Solver::Summary ceres_summary;
  if (!equations.empty()) ceres::Solve(solver_options, &problem, &ceres_summary);

  std::vector<double> residuals;
  ceres::CRSMatrix jacobian;
  if (!equations.empty()) {
    ceres::Problem::EvaluateOptions evaluate_options;
    double cost = 0.0;
    if (!problem.Evaluate(evaluate_options, &cost, &residuals, nullptr, &jacobian)) {
      throw std::runtime_error("Ceres could not evaluate the solved sketch Jacobian.");
    }
  }
  const int jacobian_rows = equations.empty() ? 0 : jacobian.num_rows;
  const int jacobian_columns = equations.empty() ? static_cast<int>(variables.size()) : jacobian.num_cols;
  Eigen::MatrixXd dense = Eigen::MatrixXd::Zero(jacobian_rows, jacobian_columns);
  for (int row = 0; row < jacobian_rows; ++row) {
    for (int position = jacobian.rows[row]; position < jacobian.rows[row + 1]; ++position) {
      dense(row, jacobian.cols[position]) = jacobian.values[position];
    }
  }
  int rank = 0;
  if (dense.rows() > 0 && dense.cols() > 0) {
    Eigen::JacobiSVD<Eigen::MatrixXd> svd(dense, Eigen::ComputeThinU | Eigen::ComputeThinV);
    const double largest = svd.singularValues().size() ? svd.singularValues()(0) : 0.0;
    const double threshold = std::max(1.0e-10, largest * std::max(dense.rows(), dense.cols()) * 1.0e-10);
    rank = static_cast<int>((svd.singularValues().array() > threshold).count());
  }
  const int dof = std::max(0, static_cast<int>(variables.size()) - rank);
  double residual_norm = 0.0;
  double maximum_residual = 0.0;
  for (const double residual : residuals) {
    residual_norm += residual * residual;
    maximum_residual = std::max(maximum_residual, std::abs(residual));
  }
  residual_norm = std::sqrt(residual_norm);

  std::vector<Diagnostic> diagnostics;
  const bool solver_failed = !equations.empty() && !ceres_summary.IsSolutionUsable();
  std::string state;
  if (solver_failed) {
    state = "failed";
    diagnostics.push_back({"error", "ceres_solution_unusable", ceres_summary.BriefReport(), {}, {}});
  } else if (maximum_residual > options.residual_tolerance || static_cast<int>(equations.size()) > rank) {
    state = "overConstrained";
    diagnostics.push_back({
      "error",
      maximum_residual > options.residual_tolerance ? "constraint_residual_exceeded" : "redundant_constraints",
      maximum_residual > options.residual_tolerance
        ? "The sketch constraints are inconsistent at the configured residual tolerance."
        : "The sketch contains redundant constraint equations.",
      {}, {}
    });
  } else if (dof == 0) {
    state = "fullyConstrained";
    diagnostics.push_back({"info", "sketch_fully_constrained", "The sketch has no remaining unconstrained degrees of freedom.", {}, {}});
  } else {
    state = "underConstrained";
    diagnostics.push_back({"warning", "sketch_under_constrained", "The sketch has " + std::to_string(dof) + " remaining degrees of freedom.", {}, {}});
  }
  for (std::size_t row = 0; row < residuals.size(); ++row) {
    if (std::abs(residuals[row]) <= options.residual_tolerance) continue;
    diagnostics.push_back({
      "error", "constraint_residual_exceeded",
      "Constraint residual " + std::to_string(std::abs(residuals[row])) + " exceeds tolerance.",
      equations[row].entity_ids,
      equations[row].constraint_id.empty() ? std::vector<std::string>{} : std::vector<std::string>{equations[row].constraint_id}
    });
  }

  for (auto& point : points_json.GetArray()) {
    const int index = point_index(point_indices, required_string(point, "id"));
    point["x"].SetDouble(variables[index]);
    point["y"].SetDouble(variables[index + 1]);
  }
  for (auto& entity : entities_json.GetArray()) {
    if (required_string(entity, "type") != "circle") continue;
    const auto& reference = entity_reference(entities, required_string(entity, "id"));
    entity["radius"].SetDouble(variables[reference.radial.radius_variable]);
  }

  auto& allocator = document.GetAllocator();
  (*sketch)["solverState"].SetString(state.c_str(), static_cast<rapidjson::SizeType>(state.size()), allocator);
  (*sketch)["degreesOfFreedom"].SetInt(dof);
  if (sketch->HasMember("solveEvidence")) sketch->RemoveMember("solveEvidence");
  rapidjson::Value evidence(rapidjson::kObjectType);
  add_string(allocator, evidence, "kernel", "ceres");
  add_string(allocator, evidence, "kernelVersion", CERES_VERSION_STRING);
  add_string(allocator, evidence, "solvedAt", utc_now());
  evidence.AddMember("iterations", static_cast<int>(ceres_summary.iterations.size()), allocator);
  evidence.AddMember("residualNorm", residual_norm, allocator);
  evidence.AddMember("maximumResidual", maximum_residual, allocator);
  evidence.AddMember("jacobianRank", rank, allocator);
  evidence.AddMember("variableCount", static_cast<int>(variables.size()), allocator);
  evidence.AddMember("constraintEquationCount", static_cast<int>(equations.size()), allocator);
  rapidjson::Value diagnostics_json(rapidjson::kArrayType);
  for (const auto& diagnostic : diagnostics) {
    rapidjson::Value item(rapidjson::kObjectType);
    add_string(allocator, item, "severity", diagnostic.severity);
    add_string(allocator, item, "code", diagnostic.code);
    add_string(allocator, item, "message", diagnostic.message);
    add_string_array(allocator, item, "entityIds", diagnostic.entity_ids);
    add_string_array(allocator, item, "constraintIds", diagnostic.constraint_ids);
    diagnostics_json.PushBack(item, allocator);
  }
  evidence.AddMember("diagnostics", diagnostics_json, allocator);
  sketch->AddMember("solveEvidence", evidence, allocator);

  rapidjson::Document output;
  output.SetObject();
  auto& output_allocator = output.GetAllocator();
  add_string(output_allocator, output, "apiVersion", "1.0.0");
  rapidjson::Value sketch_copy;
  sketch_copy.CopyFrom(*sketch, output_allocator);
  output.AddMember("sketch", sketch_copy, output_allocator);
  write_document(options.output_json, output);

  if (!options.expected_state.empty() && state != options.expected_state) {
    throw std::runtime_error("Expected sketch state " + options.expected_state + " but received " + state + '.');
  }
  return {state, dof, static_cast<int>(variables.size()), static_cast<int>(equations.size()), rank, residual_norm, maximum_residual};
}

}  // namespace cad_fem
