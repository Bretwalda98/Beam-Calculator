use std::collections::{HashMap, HashSet, VecDeque};

use crate::model::{AnalysisSelection, FrameModel, SUPPORTED_SCHEMA_VERSION};

pub struct ValidationOutcome {
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

fn duplicate_ids<'a>(ids: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut duplicates = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            duplicates.insert(id.to_string());
        }
    }
    let mut values: Vec<_> = duplicates.into_iter().collect();
    values.sort();
    values
}

fn non_finite(values: &[f64]) -> bool {
    values.iter().any(|value| !value.is_finite())
}

fn connected_groups(model: &FrameModel) -> (Vec<Vec<usize>>, Vec<usize>) {
    let indices: HashMap<&str, usize> = model
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.as_str(), index))
        .collect();
    let mut adjacency = vec![Vec::<usize>::new(); model.nodes.len()];
    for member in &model.members {
        if let (Some(start), Some(end)) = (
            indices.get(member.start_node_id.as_str()),
            indices.get(member.end_node_id.as_str()),
        ) {
            adjacency[*start].push(*end);
            adjacency[*end].push(*start);
        }
    }
    let isolated = adjacency
        .iter()
        .enumerate()
        .filter_map(|(index, connected)| connected.is_empty().then_some(index))
        .collect();
    let mut visited = vec![false; model.nodes.len()];
    let mut groups = Vec::new();
    for start in 0..model.nodes.len() {
        if visited[start] || adjacency[start].is_empty() {
            continue;
        }
        let mut queue = VecDeque::from([start]);
        visited[start] = true;
        let mut group = Vec::new();
        while let Some(node) = queue.pop_front() {
            group.push(node);
            for adjacent in &adjacency[node] {
                if !visited[*adjacent] {
                    visited[*adjacent] = true;
                    queue.push_back(*adjacent);
                }
            }
        }
        groups.push(group);
    }
    (groups, isolated)
}

pub fn validate(model: &FrameModel, selection: &AnalysisSelection) -> ValidationOutcome {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    if model.schema_version != SUPPORTED_SCHEMA_VERSION {
        errors.push(format!(
            "Unsupported schema version {}. Supported version: {}.",
            model.schema_version, SUPPORTED_SCHEMA_VERSION
        ));
    }
    if model.metadata.model_name.trim().is_empty() {
        errors.push("The model needs a name.".into());
    }
    if model.nodes.is_empty() {
        errors.push("The model requires at least one node.".into());
    }
    if model.members.is_empty() {
        errors.push("The model requires at least one member.".into());
    }
    for id in duplicate_ids(model.nodes.iter().map(|node| node.id.as_str())) {
        errors.push(format!("Duplicate node identifier: {id}."));
    }
    for id in duplicate_ids(model.members.iter().map(|member| member.id.as_str())) {
        errors.push(format!("Duplicate member identifier: {id}."));
    }
    for id in duplicate_ids(model.materials.iter().map(|value| value.id.as_str())) {
        errors.push(format!("Duplicate material identifier: {id}."));
    }
    for id in duplicate_ids(model.sections.iter().map(|value| value.id.as_str())) {
        errors.push(format!("Duplicate section identifier: {id}."));
    }
    for id in duplicate_ids(model.load_cases.iter().map(|value| value.id.as_str())) {
        errors.push(format!("Duplicate load-case identifier: {id}."));
    }
    for id in duplicate_ids(model.combinations.iter().map(|value| value.id.as_str())) {
        errors.push(format!("Duplicate load-combination identifier: {id}."));
    }
    for id in duplicate_ids(model.nodal_loads.iter().map(|value| value.id.as_str())) {
        errors.push(format!("Duplicate nodal-load identifier: {id}."));
    }

    let node_ids: HashSet<&str> = model.nodes.iter().map(|value| value.id.as_str()).collect();
    let material_ids: HashSet<&str> = model
        .materials
        .iter()
        .map(|value| value.id.as_str())
        .collect();
    let section_ids: HashSet<&str> = model
        .sections
        .iter()
        .map(|value| value.id.as_str())
        .collect();
    let load_case_ids: HashSet<&str> = model
        .load_cases
        .iter()
        .map(|value| value.id.as_str())
        .collect();
    for node in &model.nodes {
        if node.id.trim().is_empty() {
            errors.push("Every node requires an identifier.".into());
        }
        if non_finite(&node.position()) {
            errors.push(format!("Node {} has a non-finite coordinate.", node.id));
        }
    }
    for material in &model.materials {
        if !material.elastic_modulus.is_finite() || material.elastic_modulus <= 0.0 {
            errors.push(format!(
                "Material {} requires a positive finite elastic modulus E.",
                material.id
            ));
        }
        if !material.poisson_ratio.is_finite()
            || material.poisson_ratio <= -1.0
            || material.poisson_ratio >= 0.5
        {
            errors.push(format!(
                "Material {} requires -1 < Poisson ratio < 0.5.",
                material.id
            ));
        }
        let shear = material.effective_shear_modulus();
        if !shear.is_finite() || shear <= 0.0 {
            errors.push(format!(
                "Material {} requires a positive finite shear modulus G.",
                material.id
            ));
        }
    }
    for section in &model.sections {
        for (name, value) in [
            ("A", section.area),
            ("Iy", section.iy),
            ("Iz", section.iz),
            ("J", section.torsion_constant),
        ] {
            if !value.is_finite() || value <= 0.0 {
                errors.push(format!(
                    "Section {} requires a positive finite {name} property.",
                    section.id
                ));
            }
        }
    }
    for member in &model.members {
        if !node_ids.contains(member.start_node_id.as_str()) {
            errors.push(format!(
                "Member {} references missing start node {}.",
                member.id, member.start_node_id
            ));
        }
        if !node_ids.contains(member.end_node_id.as_str()) {
            errors.push(format!(
                "Member {} references missing end node {}.",
                member.id, member.end_node_id
            ));
        }
        if member.start_node_id == member.end_node_id {
            errors.push(format!("Member {} has identical end nodes.", member.id));
        }
        if !material_ids.contains(member.material_id.as_str()) {
            errors.push(format!(
                "Member {} references missing material {}.",
                member.id, member.material_id
            ));
        }
        if !section_ids.contains(member.section_id.as_str()) {
            errors.push(format!(
                "Member {} references missing section {}.",
                member.id, member.section_id
            ));
        }
        if !member.roll_angle_rad.is_finite() {
            errors.push(format!("Member {} has a non-finite roll angle.", member.id));
        }
        if let Some(reference) = &member.local_axis_reference
            && non_finite(&reference.as_array())
        {
            errors.push(format!(
                "Member {} has a non-finite local-axis reference.",
                member.id
            ));
        }
        if let (Some(start), Some(end)) = (
            model
                .nodes
                .iter()
                .find(|node| node.id == member.start_node_id),
            model
                .nodes
                .iter()
                .find(|node| node.id == member.end_node_id),
        ) {
            let length =
                ((end.x - start.x).powi(2) + (end.y - start.y).powi(2) + (end.z - start.z).powi(2))
                    .sqrt();
            if !length.is_finite() || length <= 1e-9 {
                errors.push(format!("Member {} has zero length.", member.id));
            }
        }
    }
    for load in &model.nodal_loads {
        if !node_ids.contains(load.node_id.as_str()) {
            errors.push(format!(
                "Load {} references missing node {}.",
                load.id, load.node_id
            ));
        }
        if !load_case_ids.contains(load.load_case_id.as_str()) {
            errors.push(format!(
                "Load {} references missing load case {}.",
                load.id, load.load_case_id
            ));
        }
        if non_finite(&load.values()) {
            errors.push(format!("Load {} has a non-finite component.", load.id));
        }
    }
    for combination in &model.combinations {
        for (load_case_id, factor) in &combination.factors {
            if !load_case_ids.contains(load_case_id.as_str()) {
                errors.push(format!(
                    "Combination {} references missing load case {}.",
                    combination.id, load_case_id
                ));
            }
            if !factor.is_finite() {
                errors.push(format!(
                    "Combination {} has a non-finite factor for {}.",
                    combination.id, load_case_id
                ));
            }
        }
    }
    if selection.selection_type == "loadCase" && !load_case_ids.contains(selection.id.as_str()) {
        errors.push(format!(
            "Selected load case {} was not found.",
            selection.id
        ));
    }
    if selection.selection_type == "combination"
        && !model
            .combinations
            .iter()
            .any(|combination| combination.id == selection.id)
    {
        errors.push(format!(
            "Selected load combination {} was not found.",
            selection.id
        ));
    }
    if !["loadCase", "combination"].contains(&selection.selection_type.as_str()) {
        errors.push(format!(
            "Unsupported analysis selection type {}.",
            selection.selection_type
        ));
    }

    let restraint_names = ["UX", "UY", "UZ", "RX", "RY", "RZ"];
    let restraints: Vec<[bool; 6]> = model
        .nodes
        .iter()
        .map(|node| node.restraints.as_array())
        .collect();
    if !restraints
        .iter()
        .any(|values| values.iter().any(|value| *value))
    {
        errors
            .push("Rigid-body instability: the model has no restrained degrees of freedom.".into());
    } else {
        for dof in 0..6 {
            if !restraints.iter().any(|values| values[dof]) {
                warnings.push(format!(
                    "No node directly restrains {}; check for rigid-body motion in this degree of freedom.",
                    restraint_names[dof]
                ));
            }
        }
    }
    let (groups, isolated) = connected_groups(model);
    for node_index in isolated {
        warnings.push(format!(
            "Node {} has no connected members.",
            model.nodes[node_index].id
        ));
    }
    if groups.len() > 1 {
        warnings.push(format!(
            "The structural model contains {} disconnected member groups.",
            groups.len()
        ));
    }
    for group in groups {
        if !group.iter().any(|index| {
            model.nodes[*index]
                .restraints
                .as_array()
                .iter()
                .any(|value| *value)
        }) {
            let node_names = group
                .iter()
                .map(|index| model.nodes[*index].id.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            warnings.push(format!(
                "Disconnected structural group [{node_names}] has no supports and is likely unstable."
            ));
        }
    }
    if model.nodal_loads.is_empty() {
        warnings.push("The selected model contains no nodal loads.".into());
    }
    ValidationOutcome { warnings, errors }
}

pub fn mechanism_hints(model: &FrameModel) -> Vec<String> {
    let labels = ["UX", "UY", "UZ", "RX", "RY", "RZ"];
    let arrays: Vec<[bool; 6]> = model
        .nodes
        .iter()
        .map(|node| node.restraints.as_array())
        .collect();
    let mut hints = Vec::new();
    for dof in 0..6 {
        if !arrays.iter().any(|values| values[dof]) {
            hints.push(format!(
                "Likely unstable {} rigid-body degree of freedom: no node directly restrains it.",
                labels[dof]
            ));
        }
    }
    let member_names = model
        .members
        .iter()
        .map(|member| member.id.as_str())
        .take(12)
        .collect::<Vec<_>>()
        .join(", ");
    if !member_names.is_empty() {
        hints.push(format!(
            "Review support connectivity and member geometry for: {member_names}."
        ));
    }
    hints
}
