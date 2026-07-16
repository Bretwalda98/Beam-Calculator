use crate::model::FrameModel;

pub struct DofPartition {
    pub free: Vec<usize>,
    pub restrained: Vec<usize>,
}

pub fn partition(model: &FrameModel) -> DofPartition {
    let mut free = Vec::new();
    let mut restrained = Vec::new();
    for (node_index, node) in model.nodes.iter().enumerate() {
        for (local_dof, is_restrained) in node.restraints.as_array().iter().enumerate() {
            let global_dof = node_index * 6 + local_dof;
            if *is_restrained {
                restrained.push(global_dof);
            } else {
                free.push(global_dof);
            }
        }
    }
    DofPartition { free, restrained }
}
