use nalgebra::{SMatrix, Vector3};

use crate::element::Matrix12;

pub struct ElementTransformation {
    pub matrix: Matrix12,
    pub length: f64,
    pub axes: [[f64; 3]; 3],
}

fn automatic_reference(local_x: &Vector3<f64>) -> Vector3<f64> {
    let global_z = Vector3::new(0.0, 0.0, 1.0);
    if local_x.dot(&global_z).abs() < 0.9 {
        global_z
    } else {
        Vector3::new(0.0, 1.0, 0.0)
    }
}

pub fn transformation(
    start: [f64; 3],
    end: [f64; 3],
    reference: Option<[f64; 3]>,
    roll_angle_rad: f64,
) -> Result<ElementTransformation, String> {
    let start = Vector3::from(start);
    let end = Vector3::from(end);
    let delta = end - start;
    let length = delta.norm();
    if !length.is_finite() || length <= 1e-9 {
        return Err("Member length must be greater than zero.".into());
    }
    if !roll_angle_rad.is_finite() {
        return Err("Member roll angle must be finite.".into());
    }
    let local_x = delta / length;
    let reference = reference
        .map(Vector3::from)
        .unwrap_or_else(|| automatic_reference(&local_x));
    if reference.iter().any(|value| !value.is_finite()) || reference.norm() <= 1e-12 {
        return Err("Local-axis reference vector must be finite and non-zero.".into());
    }
    let projected = reference - local_x * reference.dot(&local_x);
    let projected_norm = projected.norm();
    if !projected_norm.is_finite() || projected_norm <= 1e-9 {
        return Err(
            "Local-axis reference vector is parallel or nearly parallel to the member axis.".into(),
        );
    }
    let base_y = projected / projected_norm;
    let base_z = local_x.cross(&base_y).normalize();
    let (sin_roll, cos_roll) = roll_angle_rad.sin_cos();
    let local_y = base_y * cos_roll + base_z * sin_roll;
    let local_z = -base_y * sin_roll + base_z * cos_roll;
    let rotation = SMatrix::<f64, 3, 3>::from_rows(&[
        local_x.transpose(),
        local_y.transpose(),
        local_z.transpose(),
    ]);
    let mut matrix = Matrix12::zeros();
    for block in 0..4 {
        matrix
            .fixed_view_mut::<3, 3>(block * 3, block * 3)
            .copy_from(&rotation);
    }
    Ok(ElementTransformation {
        matrix,
        length,
        axes: [
            [local_x.x, local_x.y, local_x.z],
            [local_y.x, local_y.y, local_y.z],
            [local_z.x, local_z.y, local_z.z],
        ],
    })
}
