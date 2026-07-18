use std::collections::HashMap;

use nalgebra::{DMatrix, DVector};

use crate::{
    element::{ElementProperties, Matrix12, local_stiffness},
    model::{AnalysisSelection, FrameModel, Material, Section},
    transformation::transformation,
};

pub struct ElementAssembly {
    pub member_index: usize,
    pub dofs: [usize; 12],
    pub local_stiffness: Matrix12,
    pub transform: Matrix12,
    pub axes: [[f64; 3]; 3],
}

pub struct Assembly {
    pub stiffness: DMatrix<f64>,
    pub loads: DVector<f64>,
    pub elements: Vec<ElementAssembly>,
}

fn lookup<'a, T>(map: &'a HashMap<&str, &'a T>, id: &str, kind: &str) -> Result<&'a T, String> {
    map.get(id)
        .copied()
        .ok_or_else(|| format!("Unknown {kind} identifier: {id}."))
}

fn member_dofs(start: usize, end: usize) -> [usize; 12] {
    let mut dofs = [0usize; 12];
    for offset in 0..6 {
        dofs[offset] = start * 6 + offset;
        dofs[offset + 6] = end * 6 + offset;
    }
    dofs
}

fn load_factors(
    model: &FrameModel,
    selection: &AnalysisSelection,
) -> Result<HashMap<String, f64>, String> {
    if selection.selection_type == "loadCase" {
        return Ok(HashMap::from([(selection.id.clone(), 1.0)]));
    }
    if selection.selection_type == "combination" {
        return model
            .combinations
            .iter()
            .find(|combination| combination.id == selection.id)
            .map(|combination| combination.factors.clone())
            .ok_or_else(|| format!("Selected load combination {} was not found.", selection.id));
    }
    Err(format!(
        "Unsupported analysis selection type {}.",
        selection.selection_type
    ))
}

pub fn assemble(model: &FrameModel, selection: &AnalysisSelection) -> Result<Assembly, String> {
    let node_indices: HashMap<&str, usize> = model
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.as_str(), index))
        .collect();
    let materials: HashMap<&str, &Material> = model
        .materials
        .iter()
        .map(|value| (value.id.as_str(), value))
        .collect();
    let sections: HashMap<&str, &Section> = model
        .sections
        .iter()
        .map(|value| (value.id.as_str(), value))
        .collect();
    let factors = load_factors(model, selection)?;
    let dof_count = model.nodes.len() * 6;
    let mut stiffness = DMatrix::<f64>::zeros(dof_count, dof_count);
    let mut loads = DVector::<f64>::zeros(dof_count);
    let mut elements = Vec::with_capacity(model.members.len());

    for load in &model.nodal_loads {
        let factor = factors.get(&load.load_case_id).copied().unwrap_or(0.0);
        if factor == 0.0 {
            continue;
        }
        let node_index = *node_indices
            .get(load.node_id.as_str())
            .ok_or_else(|| format!("Unknown load node: {}.", load.node_id))?;
        for (dof, value) in load.values().iter().enumerate() {
            loads[node_index * 6 + dof] += factor * value;
        }
    }

    for (member_index, member) in model.members.iter().enumerate() {
        let start_index = *node_indices
            .get(member.start_node_id.as_str())
            .ok_or_else(|| format!("Member {} has an unknown start node.", member.id))?;
        let end_index = *node_indices
            .get(member.end_node_id.as_str())
            .ok_or_else(|| format!("Member {} has an unknown end node.", member.id))?;
        let material = lookup(&materials, &member.material_id, "material")?;
        let section = lookup(&sections, &member.section_id, "section")?;
        let element_transform = transformation(
            model.nodes[start_index].position(),
            model.nodes[end_index].position(),
            member
                .local_axis_reference
                .as_ref()
                .map(|reference| reference.as_array()),
            member.roll_angle_rad,
        )
        .map_err(|error| format!("Member {}: {error}", member.id))?;
        let local = local_stiffness(ElementProperties {
            length: element_transform.length,
            e: material.elastic_modulus,
            g: material.effective_shear_modulus(),
            area: section.area,
            iy: section.iy,
            iz: section.iz,
            j: section.torsion_constant,
        });
        let global = element_transform.matrix.transpose() * local * element_transform.matrix;
        let dofs = member_dofs(start_index, end_index);
        for local_row in 0..12 {
            for local_column in 0..12 {
                stiffness[(dofs[local_row], dofs[local_column])] +=
                    global[(local_row, local_column)];
            }
        }
        elements.push(ElementAssembly {
            member_index,
            dofs,
            local_stiffness: local,
            transform: element_transform.matrix,
            axes: element_transform.axes,
        });
    }
    Ok(Assembly {
        stiffness,
        loads,
        elements,
    })
}
