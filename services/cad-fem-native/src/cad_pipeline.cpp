#include "cad_pipeline.hpp"

#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <PCDM_StoreStatus.hxx>
#include <Poly_Triangulation.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDocStd_Document.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <memory>
#include <stdexcept>
#include <string_view>
#include <utility>
#include <vector>

#include <nglib.h>
#include <nglib_occ.h>

namespace cad_fem {
namespace {

void require_file(const std::filesystem::path& path, std::string_view label) {
  if (!std::filesystem::is_regular_file(path)) {
    throw std::runtime_error(std::string(label) + " does not exist: " + path.string());
  }
}

void require_positive(double value, std::string_view label) {
  if (!(value > 0.0) || !std::isfinite(value)) {
    throw std::runtime_error(std::string(label) + " must be a positive finite value.");
  }
}

void write_topology_json(
    const std::filesystem::path& path,
    const TopoDS_Shape& shape,
    std::size_t free_shape_count,
    const std::array<double, 6>& bounds,
    double volume) {
  TopTools_IndexedMapOfShape faces;
  TopTools_IndexedMapOfShape edges;
  TopTools_IndexedMapOfShape vertices;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  TopExp::MapShapes(shape, TopAbs_EDGE, edges);
  TopExp::MapShapes(shape, TopAbs_VERTEX, vertices);

  std::ofstream stream(path);
  if (!stream) {
    throw std::runtime_error("Could not create topology metadata: " + path.string());
  }
  stream << std::setprecision(17);
  stream << "{\n"
         << "  \"schemaVersion\": \"1.0.0\",\n"
         << "  \"units\": \"mm\",\n"
         << "  \"freeShapeCount\": " << free_shape_count << ",\n"
         << "  \"faceCount\": " << faces.Extent() << ",\n"
         << "  \"edgeCount\": " << edges.Extent() << ",\n"
         << "  \"vertexCount\": " << vertices.Extent() << ",\n"
         << "  \"bounds\": [" << bounds[0] << ", " << bounds[1] << ", " << bounds[2] << ", "
         << bounds[3] << ", " << bounds[4] << ", " << bounds[5] << "],\n"
         << "  \"volume\": " << volume << ",\n"
         << "  \"faces\": [\n";
  for (int index = 1; index <= faces.Extent(); ++index) {
    const TopoDS_Face face = TopoDS::Face(faces.FindKey(index));
    GProp_GProps properties;
    BRepGProp::SurfaceProperties(face, properties);
    const gp_Pnt centroid = properties.CentreOfMass();
    stream << "    {\"semanticName\":\"import/face/" << index
           << "\",\"area\":" << properties.Mass()
           << ",\"centroid\":[" << centroid.X() << ',' << centroid.Y() << ',' << centroid.Z()
           << "],\"adjacentKinds\":[\"edge\"]}";
    stream << (index == faces.Extent() ? "\n" : ",\n");
  }
  stream << "  ]\n}\n";
}

void write_tessellation_json(
    const std::filesystem::path& path,
    const TopoDS_Shape& shape,
    double deflection,
    double angle_rad) {
  BRepMesh_IncrementalMesh mesher(shape, deflection, Standard_False, angle_rad, Standard_True);
  mesher.Perform();
  if (!mesher.IsDone()) {
    throw std::runtime_error("OCCT tessellation did not complete.");
  }

  std::vector<std::array<double, 3>> positions;
  std::vector<std::array<int, 3>> triangles;
  for (TopExp_Explorer explorer(shape, TopAbs_FACE); explorer.More(); explorer.Next()) {
    const TopoDS_Face face = TopoDS::Face(explorer.Current());
    TopLoc_Location location;
    const Handle(Poly_Triangulation) triangulation = BRep_Tool::Triangulation(face, location);
    if (triangulation.IsNull()) {
      continue;
    }
    const int offset = static_cast<int>(positions.size());
    const gp_Trsf transform = location.Transformation();
    for (int node = 1; node <= triangulation->NbNodes(); ++node) {
      const gp_Pnt point = triangulation->Node(node).Transformed(transform);
      positions.push_back({point.X(), point.Y(), point.Z()});
    }
    for (int triangle = 1; triangle <= triangulation->NbTriangles(); ++triangle) {
      int first = 0;
      int second = 0;
      int third = 0;
      triangulation->Triangle(triangle).Get(first, second, third);
      if (face.Orientation() == TopAbs_REVERSED) {
        std::swap(second, third);
      }
      triangles.push_back({offset + first - 1, offset + second - 1, offset + third - 1});
    }
  }
  if (triangles.empty()) {
    throw std::runtime_error("OCCT produced no tessellation triangles.");
  }

  std::ofstream stream(path);
  if (!stream) {
    throw std::runtime_error("Could not create tessellation artifact: " + path.string());
  }
  stream << std::setprecision(17);
  stream << "{\"schemaVersion\":\"1.0.0\",\"units\":\"mm\",\"positions\":[";
  for (std::size_t index = 0; index < positions.size(); ++index) {
    const auto& point = positions[index];
    stream << '[' << point[0] << ',' << point[1] << ',' << point[2] << ']';
    if (index + 1 != positions.size()) {
      stream << ',';
    }
  }
  stream << "],\"triangles\":[";
  for (std::size_t index = 0; index < triangles.size(); ++index) {
    const auto& triangle = triangles[index];
    stream << '[' << triangle[0] << ',' << triangle[1] << ',' << triangle[2] << ']';
    if (index + 1 != triangles.size()) {
      stream << ',';
    }
  }
  stream << "]}\n";
}

class NetgenSession {
 public:
  NetgenSession() { Ng_Init(); }
  ~NetgenSession() { Ng_Exit(); }
  NetgenSession(const NetgenSession&) = delete;
  NetgenSession& operator=(const NetgenSession&) = delete;
};

}  // namespace

GeometryArtifacts regenerate_step_with_ocaf(const GeometryOptions& options) {
  require_file(options.step_path, "STEP input");
  require_positive(options.tessellation_deflection, "Tessellation deflection");
  require_positive(options.tessellation_angle_rad, "Tessellation angle");
  std::filesystem::create_directories(options.output_directory);

  const Handle(XCAFApp_Application) application = XCAFApp_Application::GetApplication();
  Handle(TDocStd_Document) document;
  application->NewDocument("BinXCAF", document);

  STEPCAFControl_Reader reader;
  reader.SetColorMode(Standard_True);
  reader.SetNameMode(Standard_True);
  reader.SetLayerMode(Standard_True);
  reader.SetPropsMode(Standard_True);
  if (reader.ReadFile(options.step_path.string().c_str()) != IFSelect_RetDone) {
    throw std::runtime_error("OCCT could not read the STEP input.");
  }
  if (!reader.Transfer(document)) {
    throw std::runtime_error("OCCT could not transfer the STEP model into OCAF.");
  }

  const Handle(XCAFDoc_ShapeTool) shape_tool = XCAFDoc_DocumentTool::ShapeTool(document->Main());
  TDF_LabelSequence free_shape_labels;
  shape_tool->GetFreeShapes(free_shape_labels);
  if (free_shape_labels.Length() == 0) {
    throw std::runtime_error("The STEP document contains no transferable free shapes.");
  }

  TopoDS_Compound compound;
  BRep_Builder builder;
  builder.MakeCompound(compound);
  for (int index = 1; index <= free_shape_labels.Length(); ++index) {
    builder.Add(compound, shape_tool->GetShape(free_shape_labels.Value(index)));
  }

  GeometryArtifacts artifacts;
  artifacts.ocaf_path = options.output_directory / "geometry.xbf";
  artifacts.brep_path = options.output_directory / "geometry.brep";
  artifacts.topology_path = options.output_directory / "topology.json";
  artifacts.tessellation_path = options.output_directory / "tessellation.json";
  artifacts.free_shape_count = static_cast<std::size_t>(free_shape_labels.Length());

  if (application->SaveAs(document, artifacts.ocaf_path.string().c_str()) != PCDM_SS_OK) {
    throw std::runtime_error("OCCT could not persist the OCAF document.");
  }
  if (!BRepTools::Write(compound, artifacts.brep_path.string().c_str())) {
    throw std::runtime_error("OCCT could not persist the regenerated B-rep.");
  }

  TopTools_IndexedMapOfShape faces;
  TopTools_IndexedMapOfShape edges;
  TopTools_IndexedMapOfShape vertices;
  TopExp::MapShapes(compound, TopAbs_FACE, faces);
  TopExp::MapShapes(compound, TopAbs_EDGE, edges);
  TopExp::MapShapes(compound, TopAbs_VERTEX, vertices);
  artifacts.face_count = static_cast<std::size_t>(faces.Extent());
  artifacts.edge_count = static_cast<std::size_t>(edges.Extent());
  artifacts.vertex_count = static_cast<std::size_t>(vertices.Extent());

  Bnd_Box box;
  BRepBndLib::Add(compound, box);
  box.Get(
      artifacts.bounds_mm[0],
      artifacts.bounds_mm[1],
      artifacts.bounds_mm[2],
      artifacts.bounds_mm[3],
      artifacts.bounds_mm[4],
      artifacts.bounds_mm[5]);
  GProp_GProps volume_properties;
  BRepGProp::VolumeProperties(compound, volume_properties);
  artifacts.volume_mm3 = volume_properties.Mass();

  write_topology_json(
      artifacts.topology_path,
      compound,
      artifacts.free_shape_count,
      artifacts.bounds_mm,
      artifacts.volume_mm3);
  write_tessellation_json(
      artifacts.tessellation_path,
      compound,
      options.tessellation_deflection,
      options.tessellation_angle_rad);
  return artifacts;
}

MeshArtifacts mesh_brep_with_netgen(const MeshOptions& options) {
  require_file(options.brep_path, "B-rep input");
  require_positive(options.maximum_size_mm, "Maximum mesh size");
  require_positive(options.minimum_size_mm, "Minimum mesh size");
  if (options.minimum_size_mm > options.maximum_size_mm) {
    throw std::runtime_error("Minimum mesh size cannot exceed maximum mesh size.");
  }
  if (!(options.grading > 0.0 && options.grading <= 1.0)) {
    throw std::runtime_error("Netgen grading must be in the interval (0, 1].");
  }
  std::filesystem::create_directories(options.output_directory);

  NetgenSession netgen_session;
  Ng_OCC_Geometry* geometry = Ng_OCC_Load_BREP(options.brep_path.string().c_str());
  if (geometry == nullptr) {
    throw std::runtime_error("Netgen could not load the regenerated OCCT B-rep.");
  }
  Ng_Mesh* mesh = Ng_NewMesh();
  if (mesh == nullptr) {
    Ng_OCC_DeleteGeometry(geometry);
    throw std::runtime_error("Netgen could not allocate a mesh.");
  }

  const auto cleanup = [&]() {
    Ng_DeleteMesh(mesh);
    Ng_OCC_DeleteGeometry(geometry);
  };

  Ng_Meshing_Parameters parameters;
  parameters.maxh = options.maximum_size_mm;
  parameters.minh = options.minimum_size_mm;
  parameters.grading = options.grading;
  parameters.uselocalh = options.curvature_refinement ? 1 : 0;
  parameters.elementsperedge = options.curvature_refinement ? 2.5 : 1.0;
  parameters.elementspercurve = options.curvature_refinement ? 3.0 : 1.0;
  parameters.second_order = 0;
  parameters.optsurfmeshenable = 1;
  parameters.optvolmeshenable = 1;
  parameters.check_overlap = 1;
  parameters.check_overlapping_boundary = 1;

  if (Ng_OCC_SetLocalMeshSize(geometry, mesh, &parameters) != NG_OK ||
      Ng_OCC_GenerateEdgeMesh(geometry, mesh, &parameters) != NG_OK ||
      Ng_OCC_GenerateSurfaceMesh(geometry, mesh, &parameters) != NG_OK ||
      Ng_GenerateVolumeMesh(mesh, &parameters) != NG_OK) {
    cleanup();
    throw std::runtime_error("Netgen failed while generating the tetrahedral mesh.");
  }

  MeshArtifacts artifacts;
  artifacts.netgen_mesh_path = options.output_directory / "mesh.vol";
  artifacts.node_count = static_cast<std::size_t>(Ng_GetNP(mesh));
  artifacts.surface_element_count = static_cast<std::size_t>(Ng_GetNSE(mesh));
  artifacts.volume_element_count = static_cast<std::size_t>(Ng_GetNE(mesh));
  if (artifacts.node_count == 0 || artifacts.volume_element_count == 0) {
    cleanup();
    throw std::runtime_error("Netgen returned an empty volume mesh.");
  }
  Ng_SaveMesh(mesh, artifacts.netgen_mesh_path.string().c_str());
  cleanup();
  require_file(artifacts.netgen_mesh_path, "Netgen mesh artifact");
  return artifacts;
}

}  // namespace cad_fem
