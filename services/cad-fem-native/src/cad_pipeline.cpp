#include "cad_pipeline.hpp"

#include <BRepBndLib.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepCheck_Analyzer.hxx>
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
#include <Standard_Failure.hxx>
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
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string_view>
#include <utility>
#include <vector>

// Netgen exposes the C++ nglib implementation from its nglib namespace.  The
// public headers intentionally contain the declarations without a namespace,
// so include them inside the namespace to keep the declarations ABI-compatible
// with the shared library exported by the pinned Netgen build.
namespace nglib {
#include <nglib.h>
#include <nglib_occ.h>
}  // namespace nglib

namespace cad_fem {
namespace {

using namespace nglib;

void progress(std::string_view stage) {
  std::cerr << "[cad-fem] " << stage << '\n' << std::flush;
}

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

std::optional<std::array<double, 3>> face_normal(const TopoDS_Face& face) {
  try {
    Standard_Real u_min = 0.0;
    Standard_Real u_max = 0.0;
    Standard_Real v_min = 0.0;
    Standard_Real v_max = 0.0;
    BRepTools::UVBounds(face, u_min, u_max, v_min, v_max);
    if (!std::isfinite(u_min) || !std::isfinite(u_max) ||
        !std::isfinite(v_min) || !std::isfinite(v_max)) {
      return std::nullopt;
    }
    BRepAdaptor_Surface surface(face, Standard_False);
    gp_Pnt point;
    gp_Vec derivative_u;
    gp_Vec derivative_v;
    surface.D1((u_min + u_max) * 0.5, (v_min + v_max) * 0.5, point, derivative_u, derivative_v);
    gp_Vec normal = derivative_u.Crossed(derivative_v);
    if (normal.SquareMagnitude() <= 1.0e-24) return std::nullopt;
    normal.Normalize();
    if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
    return std::array<double, 3>{normal.X(), normal.Y(), normal.Z()};
  } catch (const Standard_Failure&) {
    return std::nullopt;
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
         << "  \"topologyRevision\": 1,\n"
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
    const auto normal = face_normal(face);
    stream << "    {\"semanticName\":\"Import:1/Face:" << index
           << "\",\"kind\":\"face\",\"measure\":" << properties.Mass()
           << ",\"area\":" << properties.Mass()
           << ",\"centroid\":[" << centroid.X() << ',' << centroid.Y() << ',' << centroid.Z()
           << ']';
    if (normal) {
      stream << ",\"normal\":[" << (*normal)[0] << ',' << (*normal)[1] << ',' << (*normal)[2] << ']';
    }
    stream << ",\"adjacentKinds\":[\"edge\"]}";
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

void write_mfem_netgen_neutral_mesh(
    const std::filesystem::path& path,
    Ng_Mesh* mesh) {
  std::ofstream stream(path);
  if (!stream) {
    throw std::runtime_error("Could not create the MFEM mesh exchange artifact: " + path.string());
  }
  stream << std::setprecision(17);
  stream << "NETGEN\n";

  const int point_count = Ng_GetNP(mesh);
  stream << point_count << '\n';
  for (int point = 1; point <= point_count; ++point) {
    std::array<double, 3> coordinates{};
    Ng_GetPoint(mesh, point, coordinates.data());
    stream << coordinates[0] << ' ' << coordinates[1] << ' ' << coordinates[2] << '\n';
  }

  const int volume_element_count = Ng_GetNE(mesh);
  stream << volume_element_count << '\n';
  for (int element = 1; element <= volume_element_count; ++element) {
    std::array<int, NG_VOLUME_ELEMENT_MAXPOINTS> vertices{};
    if (Ng_GetVolumeElement(mesh, element, vertices.data()) != NG_TET) {
      throw std::runtime_error("The MFEM exchange currently permits first-order tetrahedra only.");
    }
    stream << "1 " << vertices[0] << ' ' << vertices[1] << ' '
           << vertices[2] << ' ' << vertices[3] << '\n';
  }

  const int surface_element_count = Ng_GetNSE(mesh);
  stream << surface_element_count << '\n';
  for (int element = 1; element <= surface_element_count; ++element) {
    std::array<int, NG_SURFACE_ELEMENT_MAXPOINTS> vertices{};
    if (Ng_GetSurfaceElement(mesh, element, vertices.data()) != NG_TRIG) {
      throw std::runtime_error("The MFEM exchange currently permits first-order boundary triangles only.");
    }
    stream << "1 " << vertices[0] << ' ' << vertices[1] << ' ' << vertices[2] << '\n';
  }
  stream.flush();
  if (!stream) {
    throw std::runtime_error("Could not finish the MFEM mesh exchange artifact: " + path.string());
  }
}

}  // namespace

GeometryArtifacts regenerate_step_with_ocaf(const GeometryOptions& options) {
  progress("geometry: validating input");
  require_file(options.step_path, "STEP input");
  require_positive(options.tessellation_deflection, "Tessellation deflection");
  require_positive(options.tessellation_angle_rad, "Tessellation angle");
  std::filesystem::create_directories(options.output_directory);

  progress("geometry: opening OCAF document");
  const Handle(XCAFApp_Application) application = XCAFApp_Application::GetApplication();
  Handle(TDocStd_Document) document;
  application->NewDocument("BinXCAF", document);

  progress("geometry: reading STEP file");
  STEPCAFControl_Reader reader;
  reader.SetColorMode(Standard_True);
  reader.SetNameMode(Standard_True);
  reader.SetLayerMode(Standard_True);
  reader.SetPropsMode(Standard_True);
  if (reader.ReadFile(options.step_path.string().c_str()) != IFSelect_RetDone) {
    application->Close(document);
    throw std::runtime_error("OCCT could not read the STEP input.");
  }
  progress("geometry: transferring STEP model into OCAF");
  if (!reader.Transfer(document)) {
    application->Close(document);
    throw std::runtime_error("OCCT could not transfer the STEP model into OCAF.");
  }

  progress("geometry: collecting free shapes");
  const Handle(XCAFDoc_ShapeTool) shape_tool = XCAFDoc_DocumentTool::ShapeTool(document->Main());
  TDF_LabelSequence free_shape_labels;
  shape_tool->GetFreeShapes(free_shape_labels);
  if (free_shape_labels.Length() == 0) {
    application->Close(document);
    throw std::runtime_error("The STEP document contains no transferable free shapes.");
  }

  TopoDS_Compound compound;
  BRep_Builder builder;
  builder.MakeCompound(compound);
  for (int index = 1; index <= free_shape_labels.Length(); ++index) {
    builder.Add(compound, shape_tool->GetShape(free_shape_labels.Value(index)));
  }
  if (compound.IsNull() || !BRepCheck_Analyzer(compound, Standard_True).IsValid()) {
    application->Close(document);
    throw std::runtime_error("The transferred STEP model is not a valid OCCT B-rep.");
  }

  GeometryArtifacts artifacts;
  artifacts.ocaf_path = options.output_directory / "geometry.xbf";
  artifacts.brep_path = options.output_directory / "geometry.brep";
  artifacts.topology_path = options.output_directory / "topology.json";
  artifacts.tessellation_path = options.output_directory / "tessellation.json";
  artifacts.free_shape_count = static_cast<std::size_t>(free_shape_labels.Length());

  progress("geometry: writing OCAF document");
  if (application->SaveAs(document, artifacts.ocaf_path.string().c_str()) != PCDM_SS_OK) {
    application->Close(document);
    throw std::runtime_error("OCCT could not persist the OCAF document.");
  }
  progress("geometry: writing B-rep");
  if (!BRepTools::Write(compound, artifacts.brep_path.string().c_str())) {
    application->Close(document);
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

  progress("geometry: writing topology metadata");
  write_topology_json(
      artifacts.topology_path,
      compound,
      artifacts.free_shape_count,
      artifacts.bounds_mm,
      artifacts.volume_mm3);
  progress("geometry: writing tessellation");
  write_tessellation_json(
      artifacts.tessellation_path,
      compound,
      options.tessellation_deflection,
      options.tessellation_angle_rad);

  // Netgen's OCCT integration uses the process-wide XCAF application and
  // explicitly requires existing documents to be closed before it starts.
  // Keeping this document open can therefore invalidate handles inside the
  // subsequent OCC meshing stage.
  progress("geometry: closing OCAF document");
  application->Close(document);
  progress("geometry: complete");
  return artifacts;
}

MeshArtifacts mesh_brep_with_netgen(const MeshOptions& options) {
  progress("mesh: validating B-rep input");
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

  progress("mesh: initialising Netgen");
  NetgenSession netgen_session;
  progress("mesh: loading OCCT B-rep");
  Ng_OCC_Geometry* geometry = Ng_OCC_Load_BREP(options.brep_path.string().c_str());
  if (geometry == nullptr) {
    throw std::runtime_error("Netgen could not load the regenerated OCCT B-rep.");
  }
  progress("mesh: allocating mesh");
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

  progress("mesh: setting local mesh sizes");
  if (Ng_OCC_SetLocalMeshSize(geometry, mesh, &parameters) != NG_OK) {
    cleanup();
    throw std::runtime_error("Netgen failed while setting local mesh sizes.");
  }
  progress("mesh: generating edge mesh");
  if (Ng_OCC_GenerateEdgeMesh(geometry, mesh, &parameters) != NG_OK) {
    cleanup();
    throw std::runtime_error("Netgen failed while generating the edge mesh.");
  }
  progress("mesh: generating surface mesh");
  if (Ng_OCC_GenerateSurfaceMesh(geometry, mesh, &parameters) != NG_OK) {
    cleanup();
    throw std::runtime_error("Netgen failed while generating the surface mesh.");
  }
  progress("mesh: generating volume mesh");
  if (Ng_GenerateVolumeMesh(mesh, &parameters) != NG_OK) {
    cleanup();
    throw std::runtime_error("Netgen failed while generating the volume mesh.");
  }

  MeshArtifacts artifacts;
  artifacts.netgen_mesh_path = options.output_directory / "mesh.vol";
  artifacts.mfem_mesh_path = options.output_directory / "mesh.mfem";
  artifacts.node_count = static_cast<std::size_t>(Ng_GetNP(mesh));
  artifacts.surface_element_count = static_cast<std::size_t>(Ng_GetNSE(mesh));
  artifacts.volume_element_count = static_cast<std::size_t>(Ng_GetNE(mesh));
  if (artifacts.node_count == 0 || artifacts.volume_element_count == 0) {
    cleanup();
    throw std::runtime_error("Netgen returned an empty volume mesh.");
  }
  try {
    progress("mesh: writing Netgen mesh");
    Ng_SaveMesh(mesh, artifacts.netgen_mesh_path.string().c_str());
    progress("mesh: writing MFEM exchange mesh");
    write_mfem_netgen_neutral_mesh(artifacts.mfem_mesh_path, mesh);
  } catch (...) {
    cleanup();
    throw;
  }
  cleanup();
  require_file(artifacts.netgen_mesh_path, "Netgen mesh artifact");
  require_file(artifacts.mfem_mesh_path, "MFEM mesh exchange artifact");
  progress("mesh: complete");
  return artifacts;
}

}  // namespace cad_fem
