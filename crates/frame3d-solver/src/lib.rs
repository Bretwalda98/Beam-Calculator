mod assembly;
mod constraints;
mod diagnostics;
mod element;
mod linear_solver;
mod model;
mod recovery;
mod transformation;

use std::panic::{AssertUnwindSafe, catch_unwind};

use wasm_bindgen::prelude::*;

use crate::{
    assembly::assemble,
    constraints::partition,
    diagnostics::{mechanism_hints, validate},
    linear_solver::solve,
    model::{
        AnalysisSelection, FrameModel, FrameResult, SOLVER_VERSION, SolveRequest, SolverError,
        SolverFailure, SolverMetadata,
    },
    recovery::recover,
};

pub fn solve_model(
    model: &FrameModel,
    selection: &AnalysisSelection,
) -> Result<FrameResult, SolverFailure> {
    let validation = validate(model, selection);
    if !validation.errors.is_empty() {
        return Err(SolverFailure {
            stage: "validation",
            message: "The model did not pass validation.".into(),
            warnings: validation.warnings,
            errors: validation.errors,
        });
    }
    let assembly = assemble(model, selection).map_err(|message| SolverFailure {
        stage: "assembly",
        message,
        warnings: validation.warnings.clone(),
        errors: Vec::new(),
    })?;
    let partition = partition(model);
    let solution =
        solve(&assembly.stiffness, &assembly.loads, &partition.free).map_err(|message| {
            SolverFailure {
                stage: "solving",
                message,
                warnings: validation.warnings.clone(),
                errors: mechanism_hints(model),
            }
        })?;
    let recovered = recover(model, &assembly, &solution.displacements);
    let mut warnings = validation.warnings;
    warnings.extend(solution.warnings);
    if recovered.equilibrium.normalised_residual > 1e-8 {
        warnings.push(format!(
            "Normalised global equilibrium residual {:.3e} exceeds 1e-8.",
            recovered.equilibrium.normalised_residual
        ));
    }
    Ok(FrameResult {
        status: "ok",
        nodes: recovered.nodes,
        reactions: recovered.reactions,
        members: recovered.members,
        maximum_displacement_magnitude: recovered.maximum_displacement_magnitude,
        equilibrium: recovered.equilibrium,
        warnings,
        errors: Vec::new(),
        metadata: SolverMetadata {
            solver: "Beam Calculator Studio Frame3D linear static solver",
            solver_version: SOLVER_VERSION,
            schema_version: model.schema_version.clone(),
            numerical_library: "nalgebra 0.34 (MIT/Apache-2.0)",
            analysis_selection: selection.clone(),
            dof_count: model.nodes.len() * 6,
            free_dof_count: partition.free.len(),
            restrained_dof_count: partition.restrained.len(),
            condition_estimate: solution.condition_estimate,
        },
    })
}

fn error_json(failure: SolverFailure) -> String {
    serde_json::to_string(&SolverError {
        status: "error",
        stage: failure.stage.into(),
        message: failure.message,
        warnings: failure.warnings,
        errors: failure.errors,
    })
    .unwrap_or_else(|_| {
        r#"{"status":"error","stage":"serialisation","message":"Result serialisation failed.","warnings":[],"errors":[]}"#.into()
    })
}

#[wasm_bindgen]
pub fn solve_linear_static_json(input: &str) -> String {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let request =
            serde_json::from_str::<SolveRequest>(input).map_err(|error| SolverFailure {
                stage: "validation",
                message: format!("Invalid solver request JSON: {error}"),
                warnings: Vec::new(),
                errors: Vec::new(),
            })?;
        let selection = request
            .selection
            .unwrap_or_else(|| request.model.analysis_settings.selection.clone());
        solve_model(&request.model, &selection)
    }));
    match result {
        Ok(Ok(value)) => serde_json::to_string(&value).unwrap_or_else(|_| {
            error_json(SolverFailure {
                stage: "serialisation",
                message: "Result serialisation failed.".into(),
                warnings: Vec::new(),
                errors: Vec::new(),
            })
        }),
        Ok(Err(failure)) => error_json(failure),
        Err(_) => error_json(SolverFailure {
            stage: "panic",
            message: "The solver encountered an unexpected internal failure.".into(),
            warnings: Vec::new(),
            errors: vec!["No raw panic details were exposed to the browser.".into()],
        }),
    }
}

#[wasm_bindgen]
pub fn solve_frame_json(input: &str) -> String {
    match serde_json::from_str::<FrameModel>(input) {
        Ok(model) => solve_linear_static_json(
            &serde_json::to_string(&serde_json::json!({ "model": model })).unwrap_or_default(),
        ),
        Err(error) => error_json(SolverFailure {
            stage: "validation",
            message: format!("Invalid model JSON: {error}"),
            warnings: Vec::new(),
            errors: Vec::new(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        diagnostics::validate,
        model::{
            AnalysisSettings, DisplayUnits, LoadCase, LoadCombination, Material, Member, Metadata,
            NodalLoad, Node, Restraints, Section,
        },
        transformation::transformation,
    };
    use std::collections::HashMap;

    const E: f64 = 200_000.0;
    const G: f64 = 80_000.0;
    const L: f64 = 2_000.0;
    const A: f64 = 10_000.0;
    const IY: f64 = 80_000_000.0;
    const IZ: f64 = 50_000_000.0;
    const J: f64 = 20_000_000.0;

    fn fixed() -> Restraints {
        Restraints {
            ux: true,
            uy: true,
            uz: true,
            rx: true,
            ry: true,
            rz: true,
        }
    }

    fn free() -> Restraints {
        Restraints {
            ux: false,
            uy: false,
            uz: false,
            rx: false,
            ry: false,
            rz: false,
        }
    }

    fn section() -> Section {
        Section {
            id: "SEC".into(),
            designation: "Benchmark".into(),
            source_section_id: None,
            area: A,
            iy: IY,
            iz: IZ,
            torsion_constant: J,
            source_revision: Some("Analytical".into()),
        }
    }

    fn material() -> Material {
        Material {
            id: "MAT".into(),
            name: "Steel".into(),
            elastic_modulus: E,
            poisson_ratio: 0.25,
            shear_modulus: Some(G),
        }
    }

    fn selection() -> AnalysisSelection {
        AnalysisSelection {
            selection_type: "loadCase".into(),
            id: "LC1".into(),
        }
    }

    fn model_with(nodes: Vec<Node>, members: Vec<Member>, loads: Vec<NodalLoad>) -> FrameModel {
        FrameModel {
            schema_version: "1.0.0".into(),
            metadata: Metadata {
                project_name: "Tests".into(),
                model_name: "Benchmark".into(),
                engineer: String::new(),
                description: None,
                expected_behaviour: None,
                benchmark_source: None,
            },
            display_units: DisplayUnits {
                force: "N".into(),
                length: "mm".into(),
                stress: "N/mm²".into(),
                moment: "N·mm".into(),
            },
            nodes,
            members,
            materials: vec![material()],
            sections: vec![section()],
            load_cases: vec![LoadCase {
                id: "LC1".into(),
                name: "Test".into(),
                category: "Other".into(),
            }],
            combinations: vec![LoadCombination {
                id: "COMB1".into(),
                name: "Combination".into(),
                factors: HashMap::from([("LC1".into(), 1.5)]),
            }],
            nodal_loads: loads,
            analysis_settings: AnalysisSettings {
                solver: "linearStatic".into(),
                selection: selection(),
            },
        }
    }

    fn member(id: &str, start: &str, end: &str) -> Member {
        Member {
            id: id.into(),
            start_node_id: start.into(),
            end_node_id: end.into(),
            section_id: "SEC".into(),
            material_id: "MAT".into(),
            roll_angle_rad: 0.0,
            local_axis_reference: None,
        }
    }

    fn cantilever(load: [f64; 6]) -> FrameModel {
        model_with(
            vec![
                Node {
                    id: "N1".into(),
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    restraints: fixed(),
                },
                Node {
                    id: "N2".into(),
                    x: L,
                    y: 0.0,
                    z: 0.0,
                    restraints: free(),
                },
            ],
            vec![member("M1", "N1", "N2")],
            vec![NodalLoad {
                id: "P1".into(),
                node_id: "N2".into(),
                load_case_id: "LC1".into(),
                fx: load[0],
                fy: load[1],
                fz: load[2],
                mx: load[3],
                my: load[4],
                mz: load[5],
            }],
        )
    }

    fn relative_error(actual: f64, expected: f64) -> f64 {
        (actual - expected).abs() / expected.abs().max(1e-12)
    }

    fn solved(model: &FrameModel) -> FrameResult {
        solve_model(model, &selection()).expect("benchmark should solve")
    }

    #[test]
    fn axial_bar_matches_pl_over_ea() {
        let result = solved(&cantilever([100_000.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
        let expected = 100_000.0 * L / (E * A);
        assert!(relative_error(result.nodes[1].translations[0], expected) <= 1e-9);
    }

    #[test]
    fn cantilever_tip_force_deflection_matches_closed_form() {
        let result = solved(&cantilever([0.0, 0.0, -10_000.0, 0.0, 0.0, 0.0]));
        let expected = 10_000.0 * L.powi(3) / (3.0 * E * IZ);
        assert!(relative_error(result.nodes[1].translations[2].abs(), expected) <= 1e-9);
    }

    #[test]
    fn cantilever_tip_force_rotation_matches_closed_form() {
        let result = solved(&cantilever([0.0, 0.0, -10_000.0, 0.0, 0.0, 0.0]));
        let expected = 10_000.0 * L.powi(2) / (2.0 * E * IZ);
        assert!(relative_error(result.nodes[1].rotations[1].abs(), expected) <= 1e-9);
    }

    #[test]
    fn cantilever_tip_moment_rotation_matches_closed_form() {
        let result = solved(&cantilever([0.0, 0.0, 0.0, 0.0, 5e6, 0.0]));
        let expected = 5e6 * L / (E * IZ);
        assert!(relative_error(result.nodes[1].rotations[1].abs(), expected) <= 1e-9);
    }

    #[test]
    fn cantilever_torsion_matches_tl_over_gj() {
        let result = solved(&cantilever([0.0, 0.0, 0.0, 5e6, 0.0, 0.0]));
        let expected = 5e6 * L / (G * J);
        assert!(relative_error(result.nodes[1].rotations[0], expected) <= 1e-9);
    }

    #[test]
    fn cantilever_bends_about_both_local_axes() {
        let result = solved(&cantilever([0.0, 8_000.0, -10_000.0, 0.0, 0.0, 0.0]));
        let expected_y = 8_000.0 * L.powi(3) / (3.0 * E * IY);
        let expected_z = 10_000.0 * L.powi(3) / (3.0 * E * IZ);
        assert!(relative_error(result.nodes[1].translations[1].abs(), expected_y) <= 1e-9);
        assert!(relative_error(result.nodes[1].translations[2].abs(), expected_z) <= 1e-9);
    }

    #[test]
    fn reaction_force_equilibrium_is_satisfied() {
        let result = solved(&cantilever([12_000.0, -8_000.0, -10_000.0, 0.0, 0.0, 0.0]));
        assert!(result.equilibrium.normalised_force_residual <= 1e-12);
    }

    #[test]
    fn reaction_moment_equilibrium_is_satisfied() {
        let result = solved(&cantilever([0.0, 0.0, -10_000.0, 0.0, 0.0, 0.0]));
        assert!(result.equilibrium.normalised_moment_residual <= 1e-12);
        assert!(relative_error(result.reactions[0].moments[1].abs(), 10_000.0 * L) <= 1e-9);
    }

    #[test]
    fn portal_frame_solves_with_small_equilibrium_residual() {
        let model = model_with(
            vec![
                Node {
                    id: "N1".into(),
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    restraints: fixed(),
                },
                Node {
                    id: "N2".into(),
                    x: 0.0,
                    y: 0.0,
                    z: 3000.0,
                    restraints: free(),
                },
                Node {
                    id: "N3".into(),
                    x: 5000.0,
                    y: 0.0,
                    z: 3000.0,
                    restraints: free(),
                },
                Node {
                    id: "N4".into(),
                    x: 5000.0,
                    y: 0.0,
                    z: 0.0,
                    restraints: fixed(),
                },
            ],
            vec![
                member("M1", "N1", "N2"),
                member("M2", "N2", "N3"),
                member("M3", "N3", "N4"),
            ],
            vec![NodalLoad {
                id: "P1".into(),
                node_id: "N3".into(),
                load_case_id: "LC1".into(),
                fx: 25_000.0,
                fy: 0.0,
                fz: -50_000.0,
                mx: 0.0,
                my: 0.0,
                mz: 0.0,
            }],
        );
        assert!(solved(&model).equilibrium.normalised_residual <= 1e-10);
    }

    #[test]
    fn inclined_member_matches_axial_closed_form() {
        let length = (3_000.0_f64.powi(2) + 4_000.0_f64.powi(2)).sqrt();
        let direction = [3_000.0 / length, 4_000.0 / length, 0.0];
        let load = 100_000.0;
        let model = model_with(
            vec![
                Node {
                    id: "N1".into(),
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    restraints: fixed(),
                },
                Node {
                    id: "N2".into(),
                    x: 3000.0,
                    y: 4000.0,
                    z: 0.0,
                    restraints: free(),
                },
            ],
            vec![member("M1", "N1", "N2")],
            vec![NodalLoad {
                id: "P1".into(),
                node_id: "N2".into(),
                load_case_id: "LC1".into(),
                fx: load * direction[0],
                fy: load * direction[1],
                fz: 0.0,
                mx: 0.0,
                my: 0.0,
                mz: 0.0,
            }],
        );
        let result = solved(&model);
        let displacement = (result.nodes[1].translations[0].powi(2)
            + result.nodes[1].translations[1].powi(2))
        .sqrt();
        assert!(relative_error(displacement, load * length / (E * A)) <= 1e-9);
    }

    #[test]
    fn skew_three_dimensional_frame_solves() {
        let model = model_with(
            vec![
                Node {
                    id: "N1".into(),
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    restraints: fixed(),
                },
                Node {
                    id: "N2".into(),
                    x: 3000.0,
                    y: 1000.0,
                    z: 2500.0,
                    restraints: free(),
                },
                Node {
                    id: "N3".into(),
                    x: 6000.0,
                    y: -1200.0,
                    z: 3200.0,
                    restraints: free(),
                },
                Node {
                    id: "N4".into(),
                    x: 7000.0,
                    y: 2500.0,
                    z: 0.0,
                    restraints: fixed(),
                },
            ],
            vec![
                member("M1", "N1", "N2"),
                member("M2", "N2", "N3"),
                member("M3", "N3", "N4"),
            ],
            vec![NodalLoad {
                id: "P1".into(),
                node_id: "N2".into(),
                load_case_id: "LC1".into(),
                fx: 12_000.0,
                fy: -18_000.0,
                fz: -30_000.0,
                mx: 2e6,
                my: 0.0,
                mz: -1e6,
            }],
        );
        assert!(solved(&model).equilibrium.normalised_residual <= 1e-9);
    }

    #[test]
    fn non_zero_roll_angle_rotates_section_axes() {
        let mut unrolled = cantilever([0.0, 8_000.0, 0.0, 0.0, 0.0, 0.0]);
        let unrolled_displacement = solved(&unrolled).nodes[1].translations[1].abs();
        unrolled.members[0].roll_angle_rad = std::f64::consts::FRAC_PI_2;
        let rolled_displacement = solved(&unrolled).nodes[1].translations[1].abs();
        assert!(relative_error(rolled_displacement / unrolled_displacement, IY / IZ) <= 1e-9);
    }

    #[test]
    fn coordinate_rotation_invariance_holds_for_axial_case() {
        let x_result = solved(&cantilever([100_000.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
        let y_model = model_with(
            vec![
                Node {
                    id: "N1".into(),
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    restraints: fixed(),
                },
                Node {
                    id: "N2".into(),
                    x: 0.0,
                    y: L,
                    z: 0.0,
                    restraints: free(),
                },
            ],
            vec![member("M1", "N1", "N2")],
            vec![NodalLoad {
                id: "P1".into(),
                node_id: "N2".into(),
                load_case_id: "LC1".into(),
                fx: 0.0,
                fy: 100_000.0,
                fz: 0.0,
                mx: 0.0,
                my: 0.0,
                mz: 0.0,
            }],
        );
        let y_result = solved(&y_model);
        assert!(
            relative_error(
                x_result.maximum_displacement_magnitude,
                y_result.maximum_displacement_magnitude
            ) <= 1e-9
        );
    }

    #[test]
    fn near_vertical_member_generates_stable_local_axes() {
        let transform = transformation([0.0, 0.0, 0.0], [0.001, 0.0, 3000.0], None, 0.0)
            .expect("near-vertical member should have automatic axes");
        assert!((transform.axes[0][2].abs() - 1.0).abs() < 1e-6);
        let x = nalgebra::Vector3::from(transform.axes[0]);
        let y = nalgebra::Vector3::from(transform.axes[1]);
        let z = nalgebra::Vector3::from(transform.axes[2]);
        assert!((x.cross(&y) - z).norm() < 1e-12);
    }

    #[test]
    fn zero_length_member_is_rejected() {
        let mut model = cantilever([0.0; 6]);
        model.nodes[1].x = 0.0;
        let outcome = validate(&model, &selection());
        assert!(
            outcome
                .errors
                .iter()
                .any(|error| error.contains("zero length"))
        );
    }

    #[test]
    fn disconnected_node_produces_warning() {
        let mut model = cantilever([0.0; 6]);
        model.nodes.push(Node {
            id: "N3".into(),
            x: 5000.0,
            y: 0.0,
            z: 0.0,
            restraints: free(),
        });
        let outcome = validate(&model, &selection());
        assert!(
            outcome
                .warnings
                .iter()
                .any(|warning| warning.contains("no connected members"))
        );
    }

    #[test]
    fn rigid_body_instability_is_identified_specifically() {
        let mut model = cantilever([0.0; 6]);
        model.nodes[0].restraints = free();
        let outcome = validate(&model, &selection());
        assert!(
            outcome
                .errors
                .iter()
                .any(|error| error.contains("Rigid-body instability"))
        );
    }

    #[test]
    fn invalid_section_property_is_rejected() {
        let mut model = cantilever([0.0; 6]);
        model.sections[0].iy = 0.0;
        assert!(
            validate(&model, &selection())
                .errors
                .iter()
                .any(|error| error.contains("Iy"))
        );
    }

    #[test]
    fn invalid_material_property_is_rejected() {
        let mut model = cantilever([0.0; 6]);
        model.materials[0].poisson_ratio = 0.5;
        assert!(
            validate(&model, &selection())
                .errors
                .iter()
                .any(|error| error.contains("Poisson"))
        );
    }

    #[test]
    fn json_export_import_round_trip_preserves_model() {
        let model = cantilever([100_000.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        let text = serde_json::to_string_pretty(&model).expect("serialise");
        let restored: FrameModel = serde_json::from_str(&text).expect("deserialise");
        assert_eq!(restored.schema_version, model.schema_version);
        assert_eq!(restored.members[0].id, model.members[0].id);
        assert_eq!(restored.sections[0].iy, model.sections[0].iy);
    }

    #[test]
    fn linear_load_combination_applies_factors() {
        let model = cantilever([100_000.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        let combination = AnalysisSelection {
            selection_type: "combination".into(),
            id: "COMB1".into(),
        };
        let result = solve_model(&model, &combination).expect("combination should solve");
        let expected = 1.5 * 100_000.0 * L / (E * A);
        assert!(relative_error(result.nodes[1].translations[0], expected) <= 1e-9);
    }

    #[test]
    fn unsupported_schema_version_is_rejected() {
        let mut model = cantilever([0.0; 6]);
        model.schema_version = "2.0.0".into();
        assert!(
            validate(&model, &selection())
                .errors
                .iter()
                .any(|error| error.contains("Unsupported schema version"))
        );
    }

    #[test]
    fn duplicate_identifiers_are_rejected() {
        let mut model = cantilever([0.0; 6]);
        model.nodes[1].id = "N1".into();
        assert!(
            validate(&model, &selection())
                .errors
                .iter()
                .any(|error| error.contains("Duplicate node"))
        );
    }

    #[test]
    fn missing_member_references_are_rejected() {
        let mut model = cantilever([0.0; 6]);
        model.members[0].material_id = "MISSING".into();
        assert!(
            validate(&model, &selection())
                .errors
                .iter()
                .any(|error| error.contains("missing material"))
        );
    }

    #[test]
    fn missing_load_case_in_combination_is_rejected() {
        let mut model = cantilever([0.0; 6]);
        model.combinations[0].factors.insert("MISSING".into(), 1.0);
        assert!(
            validate(&model, &selection())
                .errors
                .iter()
                .any(|error| error.contains("missing load case"))
        );
    }

    #[test]
    fn shear_modulus_is_derived_when_omitted() {
        let mut model = cantilever([0.0, 0.0, 0.0, 5e6, 0.0, 0.0]);
        model.materials[0].poisson_ratio = 0.25;
        model.materials[0].shear_modulus = None;
        let result = solved(&model);
        let derived_g = E / (2.0 * (1.0 + 0.25));
        let expected = 5e6 * L / (derived_g * J);
        assert!(relative_error(result.nodes[1].rotations[0], expected) <= 1e-9);
    }
}
