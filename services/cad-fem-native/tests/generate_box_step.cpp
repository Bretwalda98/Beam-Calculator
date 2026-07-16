#include <BRepPrimAPI_MakeBox.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_StepModelType.hxx>
#include <STEPControl_Writer.hxx>
#include <TopoDS_Shape.hxx>

#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

double parse_double(std::string_view value, std::string_view option) {
  std::size_t consumed = 0;
  const double parsed = std::stod(std::string(value), &consumed);
  if (consumed != value.size() || !(parsed > 0.0)) {
    throw std::runtime_error(std::string(option) + " requires a positive number.");
  }
  return parsed;
}

}  // namespace

int main(int argc, char** argv) {
  try {
    std::filesystem::path output;
    double length = 1000.0;
    double width = 50.0;
    double height = 100.0;
    for (int index = 1; index < argc; ++index) {
      const std::string option = argv[index];
      const auto next = [&]() -> std::string_view {
        if (index + 1 >= argc) throw std::runtime_error(option + " requires a value.");
        return argv[++index];
      };
      if (option == "--output") output = next();
      else if (option == "--length") length = parse_double(next(), option);
      else if (option == "--width") width = parse_double(next(), option);
      else if (option == "--height") height = parse_double(next(), option);
      else throw std::runtime_error("Unknown option: " + option);
    }
    if (output.empty()) throw std::runtime_error("--output is required.");
    std::filesystem::create_directories(output.parent_path());

    const TopoDS_Shape box = BRepPrimAPI_MakeBox(length, width, height).Shape();
    STEPControl_Writer writer;
    if (writer.Transfer(box, STEPControl_AsIs) != IFSelect_RetDone ||
        writer.Write(output.string().c_str()) != IFSelect_RetDone) {
      throw std::runtime_error("OCCT could not write the axial-bar STEP fixture.");
    }
    std::cout << output << '\n';
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
