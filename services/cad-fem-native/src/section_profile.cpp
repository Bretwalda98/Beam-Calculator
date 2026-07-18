#include "section_profile.hpp"

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <GProp_GProps.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_StepModelType.hxx>
#include <STEPControl_Writer.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <rapidjson/document.h>
#include <rapidjson/prettywriter.h>
#include <rapidjson/stringbuffer.h>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace cad_fem {
namespace {

struct ProfileInput {
  std::string section_id;
  std::string designation;
  std::string family;
  std::string kind;
  std::string catalogue_revision;
  double length = 0.0;
  double height = 0.0;
  double width = 0.0;
  std::optional<double> web_thickness;
  std::optional<double> flange_thickness;
  std::optional<double> wall_thickness;
  double root_radius = 0.0;
  std::optional<double> toe_radius;
  double flange_slope_percent = 0.0;
  double catalogue_area = 0.0;
};

std::string read_text(const std::filesystem::path& path) {
  std::ifstream stream(path, std::ios::binary);
  if (!stream) throw std::runtime_error("Cannot read catalogue profile input: " + path.string());
  std::ostringstream buffer;
  buffer << stream.rdbuf();
  return buffer.str();
}

const rapidjson::Value& require_member(
    const rapidjson::Value& object,
    const char* name,
    rapidjson::Type type) {
  if (!object.IsObject() || !object.HasMember(name) || object[name].GetType() != type) {
    throw std::runtime_error(std::string("Catalogue profile requires ") + name + ".");
  }
  return object[name];
}

double positive_number(const rapidjson::Value& object, const char* name) {
  const auto& value = require_member(object, name, rapidjson::kNumberType);
  const double result = value.GetDouble();
  if (!(result > 0.0) || !std::isfinite(result)) {
    throw std::runtime_error(std::string(name) + " must be a positive finite number.");
  }
  return result;
}

double finite_number(const rapidjson::Value& object, const char* name) {
  const auto& value = require_member(object, name, rapidjson::kNumberType);
  const double result = value.GetDouble();
  if (!std::isfinite(result)) {
    throw std::runtime_error(std::string(name) + " must be a finite number.");
  }
  return result;
}

std::optional<double> optional_positive_number(const rapidjson::Value& object, const char* name) {
  if (!object.HasMember(name) || object[name].IsNull()) return std::nullopt;
  if (!object[name].IsNumber()) throw std::runtime_error(std::string(name) + " must be a number or null.");
  const double result = object[name].GetDouble();
  if (!(result > 0.0) || !std::isfinite(result)) {
    throw std::runtime_error(std::string(name) + " must be positive when supplied.");
  }
  return result;
}

std::string required_string(const rapidjson::Value& object, const char* name) {
  return require_member(object, name, rapidjson::kStringType).GetString();
}

ProfileInput parse_profile(const std::filesystem::path& input_json) {
  rapidjson::Document document;
  const std::string source = read_text(input_json);
  document.Parse(source.c_str(), source.size());
  if (document.HasParseError() || !document.IsObject()) {
    throw std::runtime_error("Catalogue profile input is not valid JSON.");
  }
  const auto& section = require_member(document, "section", rapidjson::kObjectType);
  if (required_string(section, "catalogue") != "beam-ec3" ||
      required_string(section, "units") != "mm" ||
      required_string(section, "schemaVersion") != "1.0.0") {
    throw std::runtime_error("Only Beam EC3 catalogue profile schema 1.0.0 in millimetres is supported.");
  }
  const auto& dimensions = require_member(section, "dimensions", rapidjson::kObjectType);
  const auto& properties = require_member(section, "properties", rapidjson::kObjectType);
  ProfileInput input{
      .section_id = required_string(section, "sectionId"),
      .designation = required_string(section, "designation"),
      .family = required_string(section, "family"),
      .kind = required_string(section, "kind"),
      .catalogue_revision = required_string(section, "catalogueRevision"),
      .length = positive_number(document, "length"),
      .height = positive_number(dimensions, "height"),
      .width = positive_number(dimensions, "width"),
      .web_thickness = optional_positive_number(dimensions, "webThickness"),
      .flange_thickness = optional_positive_number(dimensions, "flangeThickness"),
      .wall_thickness = optional_positive_number(dimensions, "wallThickness"),
      .root_radius = positive_number(dimensions, "rootRadius"),
      .toe_radius = optional_positive_number(dimensions, "toeRadius"),
      .flange_slope_percent = finite_number(dimensions, "flangeSlopePercent"),
      .catalogue_area = positive_number(properties, "area"),
  };
  if (input.catalogue_revision.size() != 64) {
    throw std::runtime_error("catalogueRevision must be a 64-character SHA-256 fingerprint.");
  }
  if (input.kind != "i" && input.kind != "channel" && input.kind != "rhs") {
    throw std::runtime_error("Only I-section, channel and RHS catalogue profiles are supported.");
  }
  return input;
}

TopoDS_Wire polygon_wire(const std::vector<std::pair<double, double>>& yz_points) {
  BRepBuilderAPI_MakePolygon builder;
  for (const auto& [y, z] : yz_points) builder.Add(gp_Pnt(0.0, y, z));
  builder.Close();
  if (!builder.IsDone()) throw std::runtime_error("OCCT could not construct the section profile wire.");
  return builder.Wire();
}

TopoDS_Shape prismatic_shape(const ProfileInput& input) {
  const double h = input.height;
  const double b = input.width;
  TopoDS_Wire outer;
  std::optional<TopoDS_Wire> inner;
  if (input.kind == "rhs") {
    if (!input.wall_thickness) throw std::runtime_error("RHS profile requires wallThickness.");
    const double t = *input.wall_thickness;
    if (2.0 * t >= std::min(h, b)) throw std::runtime_error("RHS wall thickness closes the hollow profile.");
    outer = polygon_wire({
        {-b / 2.0, -h / 2.0}, {b / 2.0, -h / 2.0},
        {b / 2.0, h / 2.0}, {-b / 2.0, h / 2.0},
    });
    inner = polygon_wire({
        {-b / 2.0 + t, -h / 2.0 + t}, {-b / 2.0 + t, h / 2.0 - t},
        {b / 2.0 - t, h / 2.0 - t}, {b / 2.0 - t, -h / 2.0 + t},
    });
  } else {
    if (!input.web_thickness || !input.flange_thickness) {
      throw std::runtime_error("Open profile requires webThickness and flangeThickness.");
    }
    const double tw = *input.web_thickness;
    const double tf = *input.flange_thickness;
    if (tw >= b || 2.0 * tf >= h) throw std::runtime_error("Open-profile dimensions do not define a valid section.");
    if (input.kind == "channel") {
      outer = polygon_wire({
          {-b / 2.0, -h / 2.0}, {b / 2.0, -h / 2.0},
          {b / 2.0, -h / 2.0 + tf}, {-b / 2.0 + tw, -h / 2.0 + tf},
          {-b / 2.0 + tw, h / 2.0 - tf}, {b / 2.0, h / 2.0 - tf},
          {b / 2.0, h / 2.0}, {-b / 2.0, h / 2.0},
      });
    } else {
      outer = polygon_wire({
          {-b / 2.0, -h / 2.0}, {b / 2.0, -h / 2.0},
          {b / 2.0, -h / 2.0 + tf}, {tw / 2.0, -h / 2.0 + tf},
          {tw / 2.0, h / 2.0 - tf}, {b / 2.0, h / 2.0 - tf},
          {b / 2.0, h / 2.0}, {-b / 2.0, h / 2.0},
          {-b / 2.0, h / 2.0 - tf}, {-tw / 2.0, h / 2.0 - tf},
          {-tw / 2.0, -h / 2.0 + tf}, {-b / 2.0, -h / 2.0 + tf},
      });
    }
  }
  BRepBuilderAPI_MakeFace face_builder(outer);
  if (inner) face_builder.Add(*inner);
  if (!face_builder.IsDone()) throw std::runtime_error("OCCT could not construct the section profile face.");
  const TopoDS_Face face = face_builder.Face();
  BRepPrimAPI_MakePrism prism(face, gp_Vec(input.length, 0.0, 0.0), false, true);
  if (!prism.IsDone()) throw std::runtime_error("OCCT could not extrude the section profile.");
  const TopoDS_Shape shape = prism.Shape();
  if (shape.IsNull() || !BRepCheck_Analyzer(shape, true).IsValid()) {
    throw std::runtime_error("OCCT produced an invalid catalogue section solid.");
  }
  return shape;
}

void write_metadata(
    const std::filesystem::path& path,
    const ProfileInput& input,
    double generated_area,
    double relative_difference) {
  rapidjson::StringBuffer buffer;
  rapidjson::PrettyWriter<rapidjson::StringBuffer> writer(buffer);
  writer.StartObject();
  writer.Key("schemaVersion"); writer.String("1.0.0");
  writer.Key("generator"); writer.String("cad-fem-section-step");
  writer.Key("sectionId"); writer.String(input.section_id.c_str());
  writer.Key("designation"); writer.String(input.designation.c_str());
  writer.Key("family"); writer.String(input.family.c_str());
  writer.Key("kind"); writer.String(input.kind.c_str());
  writer.Key("catalogueRevision"); writer.String(input.catalogue_revision.c_str());
  writer.Key("units"); writer.String("mm");
  writer.Key("length"); writer.Double(input.length);
  writer.Key("catalogueArea"); writer.Double(input.catalogue_area);
  writer.Key("generatedArea"); writer.Double(generated_area);
  writer.Key("relativeAreaDifference"); writer.Double(relative_difference);
  writer.Key("geometryFidelity"); writer.String("nominal-sharp-corner-profile");
  writer.Key("warnings"); writer.StartArray();
  writer.String("Root/toe radii are retained in the immutable snapshot but are not yet applied by this generator.");
  if (relative_difference > 0.02) {
    writer.String("The nominal sharp-corner area differs from the catalogue area by more than 2%; do not use this geometry for released analysis.");
  }
  if (std::abs(input.flange_slope_percent) > 1e-12) {
    writer.String("The catalogue flange slope is retained in the snapshot but is not yet applied by this generator.");
  }
  writer.EndArray();
  writer.EndObject();
  std::ofstream output(path, std::ios::binary);
  if (!output) throw std::runtime_error("Cannot write section generation metadata: " + path.string());
  output << buffer.GetString() << '\n';
}

}  // namespace

SectionGenerationArtifacts generate_catalogue_section_step(
    const std::filesystem::path& input_json,
    const std::filesystem::path& output_step,
    const std::filesystem::path& output_metadata) {
  const ProfileInput input = parse_profile(input_json);
  if (!output_step.parent_path().empty()) std::filesystem::create_directories(output_step.parent_path());
  if (!output_metadata.parent_path().empty()) std::filesystem::create_directories(output_metadata.parent_path());
  const TopoDS_Shape shape = prismatic_shape(input);
  GProp_GProps properties;
  BRepGProp::VolumeProperties(shape, properties);
  const double generated_area = properties.Mass() / input.length;
  const double relative_difference = std::abs(generated_area - input.catalogue_area) / input.catalogue_area;
  if (relative_difference > 0.10) {
    throw std::runtime_error("Nominal generated area differs from the catalogue area by more than 10%.");
  }

  STEPControl_Writer writer;
  if (writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone ||
      writer.Write(output_step.string().c_str()) != IFSelect_RetDone) {
    throw std::runtime_error("OCCT could not write the catalogue section STEP file.");
  }
  write_metadata(output_metadata, input, generated_area, relative_difference);
  return {
      .step_path = output_step,
      .metadata_path = output_metadata,
      .generated_area_mm2 = generated_area,
      .catalogue_area_mm2 = input.catalogue_area,
      .relative_area_difference = relative_difference,
  };
}

}  // namespace cad_fem
