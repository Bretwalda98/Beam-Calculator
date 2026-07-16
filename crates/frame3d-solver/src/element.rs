use nalgebra::SMatrix;

pub type Matrix12 = SMatrix<f64, 12, 12>;

#[derive(Clone, Copy)]
pub struct ElementProperties {
    pub length: f64,
    pub e: f64,
    pub g: f64,
    pub area: f64,
    pub iy: f64,
    pub iz: f64,
    pub j: f64,
}

fn add_bending(
    matrix: &mut Matrix12,
    indices: [usize; 4],
    ei: f64,
    length: f64,
    rotation_sign: f64,
) {
    let l2 = length * length;
    let l3 = l2 * length;
    let values = [
        [
            12.0 * ei / l3,
            rotation_sign * 6.0 * ei / l2,
            -12.0 * ei / l3,
            rotation_sign * 6.0 * ei / l2,
        ],
        [
            rotation_sign * 6.0 * ei / l2,
            4.0 * ei / length,
            -rotation_sign * 6.0 * ei / l2,
            2.0 * ei / length,
        ],
        [
            -12.0 * ei / l3,
            -rotation_sign * 6.0 * ei / l2,
            12.0 * ei / l3,
            -rotation_sign * 6.0 * ei / l2,
        ],
        [
            rotation_sign * 6.0 * ei / l2,
            2.0 * ei / length,
            -rotation_sign * 6.0 * ei / l2,
            4.0 * ei / length,
        ],
    ];
    for row in 0..4 {
        for column in 0..4 {
            matrix[(indices[row], indices[column])] += values[row][column];
        }
    }
}

pub fn local_stiffness(properties: ElementProperties) -> Matrix12 {
    let mut stiffness = Matrix12::zeros();
    let axial = properties.e * properties.area / properties.length;
    stiffness[(0, 0)] = axial;
    stiffness[(0, 6)] = -axial;
    stiffness[(6, 0)] = -axial;
    stiffness[(6, 6)] = axial;

    let torsion = properties.g * properties.j / properties.length;
    stiffness[(3, 3)] = torsion;
    stiffness[(3, 9)] = -torsion;
    stiffness[(9, 3)] = -torsion;
    stiffness[(9, 9)] = torsion;

    add_bending(
        &mut stiffness,
        [1, 5, 7, 11],
        properties.e * properties.iz,
        properties.length,
        1.0,
    );
    add_bending(
        &mut stiffness,
        [2, 4, 8, 10],
        properties.e * properties.iy,
        properties.length,
        -1.0,
    );
    stiffness
}
