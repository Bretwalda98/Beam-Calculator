use nalgebra::{DVector, SVector, Vector3};

use crate::{
    assembly::Assembly,
    model::{EquilibriumSummary, FrameModel, MemberResult, NodeResult, ReactionResult},
};

pub struct RecoveredResults {
    pub nodes: Vec<NodeResult>,
    pub reactions: Vec<ReactionResult>,
    pub members: Vec<MemberResult>,
    pub maximum_displacement_magnitude: f64,
    pub equilibrium: EquilibriumSummary,
}

fn vector3(values: &[f64]) -> Vector3<f64> {
    Vector3::new(values[0], values[1], values[2])
}

pub fn recover(
    model: &FrameModel,
    assembly: &Assembly,
    displacements: &DVector<f64>,
) -> RecoveredResults {
    let residual = &assembly.stiffness * displacements - &assembly.loads;
    let mut maximum_displacement_magnitude = 0.0;
    let nodes = model
        .nodes
        .iter()
        .enumerate()
        .map(|(node_index, node)| {
            let offset = node_index * 6;
            let translations = [
                displacements[offset],
                displacements[offset + 1],
                displacements[offset + 2],
            ];
            let rotations = [
                displacements[offset + 3],
                displacements[offset + 4],
                displacements[offset + 5],
            ];
            maximum_displacement_magnitude = f64::max(
                maximum_displacement_magnitude,
                vector3(&translations).norm(),
            );
            NodeResult {
                node_id: node.id.clone(),
                translations,
                rotations,
            }
        })
        .collect();
    let reactions = model
        .nodes
        .iter()
        .enumerate()
        .filter_map(|(node_index, node)| {
            let restraints = node.restraints.as_array();
            if !restraints.iter().any(|value| *value) {
                return None;
            }
            let offset = node_index * 6;
            let mut values = [0.0; 6];
            for dof in 0..6 {
                if restraints[dof] {
                    values[dof] = residual[offset + dof];
                }
            }
            Some(ReactionResult {
                node_id: node.id.clone(),
                forces: [values[0], values[1], values[2]],
                moments: [values[3], values[4], values[5]],
            })
        })
        .collect::<Vec<_>>();
    let members = assembly
        .elements
        .iter()
        .map(|element| {
            let mut global_displacements = SVector::<f64, 12>::zeros();
            for index in 0..12 {
                global_displacements[index] = displacements[element.dofs[index]];
            }
            let local_displacements = element.transform * global_displacements;
            let local_forces = element.local_stiffness * local_displacements;
            let mut start_forces = [0.0; 6];
            let mut end_forces = [0.0; 6];
            start_forces.copy_from_slice(&local_forces.as_slice()[0..6]);
            end_forces.copy_from_slice(&local_forces.as_slice()[6..12]);
            MemberResult {
                member_id: model.members[element.member_index].id.clone(),
                start_forces,
                end_forces,
                local_axes: element.axes,
            }
        })
        .collect();

    let mut force_residual = Vector3::zeros();
    let mut moment_residual = Vector3::zeros();
    let mut force_scale = 0.0;
    let mut moment_scale = 0.0;
    for (node_index, node) in model.nodes.iter().enumerate() {
        let offset = node_index * 6;
        let applied_force = vector3(&assembly.loads.as_slice()[offset..offset + 3]);
        let applied_moment = vector3(&assembly.loads.as_slice()[offset + 3..offset + 6]);
        let reaction_force = Vector3::new(
            if node.restraints.ux {
                residual[offset]
            } else {
                0.0
            },
            if node.restraints.uy {
                residual[offset + 1]
            } else {
                0.0
            },
            if node.restraints.uz {
                residual[offset + 2]
            } else {
                0.0
            },
        );
        let reaction_moment = Vector3::new(
            if node.restraints.rx {
                residual[offset + 3]
            } else {
                0.0
            },
            if node.restraints.ry {
                residual[offset + 4]
            } else {
                0.0
            },
            if node.restraints.rz {
                residual[offset + 5]
            } else {
                0.0
            },
        );
        let position = Vector3::new(node.x, node.y, node.z);
        force_residual += applied_force + reaction_force;
        moment_residual += applied_moment
            + position.cross(&applied_force)
            + reaction_moment
            + position.cross(&reaction_force);
        force_scale += applied_force.norm();
        moment_scale += (applied_moment + position.cross(&applied_force)).norm();
    }
    let normalised_force_residual = force_residual.norm() / force_scale.max(1.0);
    let normalised_moment_residual = moment_residual.norm() / moment_scale.max(1.0);
    let normalised_residual = f64::max(normalised_force_residual, normalised_moment_residual);
    RecoveredResults {
        nodes,
        reactions,
        members,
        maximum_displacement_magnitude,
        equilibrium: EquilibriumSummary {
            force_residual: [force_residual.x, force_residual.y, force_residual.z],
            moment_residual: [moment_residual.x, moment_residual.y, moment_residual.z],
            normalised_force_residual,
            normalised_moment_residual,
            normalised_residual,
        },
    }
}
