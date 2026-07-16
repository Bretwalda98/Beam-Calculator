use std::collections::HashMap;

use serde::{Deserialize, Serialize};

pub const SUPPORTED_SCHEMA_VERSION: &str = "1.0.0";
pub const SOLVER_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameModel {
    pub schema_version: String,
    pub metadata: Metadata,
    pub display_units: DisplayUnits,
    pub nodes: Vec<Node>,
    pub members: Vec<Member>,
    pub materials: Vec<Material>,
    pub sections: Vec<Section>,
    pub load_cases: Vec<LoadCase>,
    pub combinations: Vec<LoadCombination>,
    pub nodal_loads: Vec<NodalLoad>,
    pub analysis_settings: AnalysisSettings,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub project_name: String,
    pub model_name: String,
    pub engineer: String,
    pub description: Option<String>,
    pub expected_behaviour: Option<String>,
    pub benchmark_source: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DisplayUnits {
    pub force: String,
    pub length: String,
    pub stress: String,
    pub moment: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Node {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub restraints: Restraints,
}

impl Node {
    pub fn position(&self) -> [f64; 3] {
        [self.x, self.y, self.z]
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Restraints {
    pub ux: bool,
    pub uy: bool,
    pub uz: bool,
    pub rx: bool,
    pub ry: bool,
    pub rz: bool,
}

impl Restraints {
    pub fn as_array(&self) -> [bool; 6] {
        [self.ux, self.uy, self.uz, self.rx, self.ry, self.rz]
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Material {
    pub id: String,
    pub name: String,
    pub elastic_modulus: f64,
    pub poisson_ratio: f64,
    pub shear_modulus: Option<f64>,
}

impl Material {
    pub fn effective_shear_modulus(&self) -> f64 {
        self.shear_modulus
            .unwrap_or(self.elastic_modulus / (2.0 * (1.0 + self.poisson_ratio)))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub designation: String,
    pub source_section_id: Option<String>,
    pub area: f64,
    pub iy: f64,
    pub iz: f64,
    pub torsion_constant: f64,
    pub source_revision: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LocalAxisReference {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl LocalAxisReference {
    pub fn as_array(&self) -> [f64; 3] {
        [self.x, self.y, self.z]
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub start_node_id: String,
    pub end_node_id: String,
    pub section_id: String,
    pub material_id: String,
    pub roll_angle_rad: f64,
    pub local_axis_reference: Option<LocalAxisReference>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodalLoad {
    pub id: String,
    pub node_id: String,
    pub load_case_id: String,
    pub fx: f64,
    pub fy: f64,
    pub fz: f64,
    pub mx: f64,
    pub my: f64,
    pub mz: f64,
}

impl NodalLoad {
    pub fn values(&self) -> [f64; 6] {
        [self.fx, self.fy, self.fz, self.mx, self.my, self.mz]
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoadCase {
    pub id: String,
    pub name: String,
    pub category: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoadCombination {
    pub id: String,
    pub name: String,
    pub factors: HashMap<String, f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AnalysisSettings {
    pub solver: String,
    pub selection: AnalysisSelection,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AnalysisSelection {
    #[serde(rename = "type")]
    pub selection_type: String,
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct SolveRequest {
    pub model: FrameModel,
    pub selection: Option<AnalysisSelection>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameResult {
    pub status: &'static str,
    pub nodes: Vec<NodeResult>,
    pub reactions: Vec<ReactionResult>,
    pub members: Vec<MemberResult>,
    pub maximum_displacement_magnitude: f64,
    pub equilibrium: EquilibriumSummary,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub metadata: SolverMetadata,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeResult {
    pub node_id: String,
    pub translations: [f64; 3],
    pub rotations: [f64; 3],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReactionResult {
    pub node_id: String,
    pub forces: [f64; 3],
    pub moments: [f64; 3],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberResult {
    pub member_id: String,
    pub start_forces: [f64; 6],
    pub end_forces: [f64; 6],
    pub local_axes: [[f64; 3]; 3],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EquilibriumSummary {
    pub force_residual: [f64; 3],
    pub moment_residual: [f64; 3],
    pub normalised_force_residual: f64,
    pub normalised_moment_residual: f64,
    pub normalised_residual: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverMetadata {
    pub solver: &'static str,
    pub solver_version: &'static str,
    pub schema_version: String,
    pub numerical_library: &'static str,
    pub analysis_selection: AnalysisSelection,
    pub dof_count: usize,
    pub free_dof_count: usize,
    pub restrained_dof_count: usize,
    pub condition_estimate: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct SolverError {
    pub status: &'static str,
    pub stage: String,
    pub message: String,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug)]
pub struct SolverFailure {
    pub stage: &'static str,
    pub message: String,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}
