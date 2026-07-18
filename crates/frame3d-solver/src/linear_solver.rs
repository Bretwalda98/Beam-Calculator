use nalgebra::{DMatrix, DVector};

pub struct LinearSolution {
    pub displacements: DVector<f64>,
    pub condition_estimate: Option<f64>,
    pub warnings: Vec<String>,
}

pub fn solve(
    stiffness: &DMatrix<f64>,
    loads: &DVector<f64>,
    free: &[usize],
) -> Result<LinearSolution, String> {
    if free.is_empty() {
        return Ok(LinearSolution {
            displacements: DVector::zeros(stiffness.nrows()),
            condition_estimate: None,
            warnings: Vec::new(),
        });
    }
    let mut reduced = DMatrix::<f64>::zeros(free.len(), free.len());
    let mut reduced_loads = DVector::<f64>::zeros(free.len());
    for (row, global_row) in free.iter().enumerate() {
        reduced_loads[row] = loads[*global_row];
        for (column, global_column) in free.iter().enumerate() {
            reduced[(row, column)] = stiffness[(*global_row, *global_column)];
        }
    }
    let eigenvalues = reduced.clone().symmetric_eigen().eigenvalues;
    let max_eigenvalue = eigenvalues
        .iter()
        .copied()
        .map(f64::abs)
        .fold(0.0, f64::max);
    let min_eigenvalue = eigenvalues
        .iter()
        .copied()
        .map(f64::abs)
        .fold(f64::INFINITY, f64::min);
    if !max_eigenvalue.is_finite()
        || max_eigenvalue <= 0.0
        || min_eigenvalue <= max_eigenvalue * 1e-12
    {
        return Err(
            "The reduced stiffness matrix is singular or contains a near-zero mode. This indicates rigid-body motion or a structural mechanism."
                .into(),
        );
    }
    let condition_estimate = Some(max_eigenvalue / min_eigenvalue);
    let mut warnings = Vec::new();
    if condition_estimate.is_some_and(|condition| condition > 1e10) {
        warnings.push(
            "The stiffness matrix is ill-conditioned; review model scale, supports and relative member stiffness."
                .into(),
        );
    }
    let reduced_displacements = reduced
        .cholesky()
        .ok_or_else(|| {
            "The reduced stiffness matrix is not positive definite. Check supports, connectivity and member geometry."
                .to_string()
        })?
        .solve(&reduced_loads);
    if reduced_displacements.iter().any(|value| !value.is_finite()) {
        return Err(
            "The solver produced a non-finite displacement. Check model scale and stiffness values."
                .into(),
        );
    }
    let mut displacements = DVector::<f64>::zeros(stiffness.nrows());
    for (index, global_dof) in free.iter().enumerate() {
        displacements[*global_dof] = reduced_displacements[index];
    }
    Ok(LinearSolution {
        displacements,
        condition_estimate,
        warnings,
    })
}
