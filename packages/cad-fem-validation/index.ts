import {
  CAD_FEM_SCHEMA_VERSION,
  type CadFEMProject,
  type JobDiagnostic,
  type TopologyRef
} from '../cad-fem-schema';

export interface CadFEMValidationReport {
  valid: boolean;
  errors: JobDiagnostic[];
  warnings: JobDiagnostic[];
}

const finite = (value: number): boolean => Number.isFinite(value);

function diagnostic(
  severity: JobDiagnostic['severity'],
  code: string,
  message: string,
  entityIds: string[] = []
): JobDiagnostic {
  return { severity, code, message, entityIds };
}

function duplicateIds(values: Array<{ id: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { id } of values) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

function validateTopologyRef(
  ref: TopologyRef,
  documentIds: Set<string>,
  bodyIds: Set<string>,
  featureIds: Set<string>,
  errors: JobDiagnostic[]
): void {
  if (!documentIds.has(ref.documentId)) {
    errors.push(diagnostic('error', 'topology_document_missing', `Topology reference ${ref.semanticName} uses a missing part document.`, [ref.documentId]));
  }
  if (!bodyIds.has(ref.bodyId)) {
    errors.push(diagnostic('error', 'topology_body_missing', `Topology reference ${ref.semanticName} uses a missing body.`, [ref.bodyId]));
  }
  if (!featureIds.has(ref.featureId)) {
    errors.push(diagnostic('error', 'topology_feature_missing', `Topology reference ${ref.semanticName} uses a missing feature.`, [ref.featureId]));
  }
  if (!Number.isInteger(ref.topologyRevision) || ref.topologyRevision < 0) {
    errors.push(diagnostic('error', 'topology_revision_invalid', `Topology reference ${ref.semanticName} has an invalid revision.`, [ref.featureId]));
  }
  if (!ref.semanticName.trim()) {
    errors.push(diagnostic('error', 'topology_name_missing', 'A topology reference is missing its semantic name.', [ref.featureId]));
  }
}

export function validateCadFEMProject(project: CadFEMProject): CadFEMValidationReport {
  const errors: JobDiagnostic[] = [];
  const warnings: JobDiagnostic[] = [];

  if (project.schemaVersion !== CAD_FEM_SCHEMA_VERSION) {
    errors.push(diagnostic('error', 'schema_version_unsupported', `Unsupported CAD/FEM schema version ${String(project.schemaVersion)}.`));
    return { valid: false, errors, warnings };
  }
  if (!project.id || !project.metadata?.name?.trim()) {
    errors.push(diagnostic('error', 'project_identity_invalid', 'Project ID and name are required.', project.id ? [project.id] : []));
  }
  if (!Number.isInteger(project.revision) || project.revision < 0) {
    errors.push(diagnostic('error', 'project_revision_invalid', 'Project revision must be a non-negative integer.', [project.id]));
  }
  if (!project.partDocuments.length) {
    errors.push(diagnostic('error', 'part_document_missing', 'At least one part document is required.', [project.id]));
  }
  if (!project.materials.length) {
    errors.push(diagnostic('error', 'material_missing', 'At least one material is required.', [project.id]));
  }
  if (!project.studies.length) {
    errors.push(diagnostic('error', 'study_missing', 'At least one solid study is required.', [project.id]));
  }

  const documentIds = new Set(project.partDocuments.map(({ id }) => id));
  const bodyIds = new Set(project.partDocuments.flatMap(({ bodies }) => bodies.map(({ id }) => id)));
  const featureIds = new Set(project.partDocuments.flatMap(({ features }) => features.map(({ id }) => id)));
  const sketchIds = new Set(project.partDocuments.flatMap(({ sketches }) => sketches.map(({ id }) => id)));
  const componentIds = new Set(project.assembly.components.map(({ id }) => id));
  const materialIds = new Set(project.materials.map(({ id }) => id));

  const allEntities = [
    ...project.partDocuments,
    ...project.partDocuments.flatMap(({ sketches, features, bodies }) => [...sketches, ...features, ...bodies]),
    ...project.assembly.components,
    ...project.assembly.mates,
    ...project.materials,
    ...project.studies
  ];
  for (const id of duplicateIds(allEntities)) {
    errors.push(diagnostic('error', 'duplicate_id', `Duplicate entity ID ${id}.`, [id]));
  }

  for (const document of project.partDocuments) {
    if (!Number.isInteger(document.geometryRevision) || document.geometryRevision < 0) {
      errors.push(diagnostic('error', 'geometry_revision_invalid', `${document.name} has an invalid geometry revision.`, [document.id]));
    }
    for (const sketch of document.sketches) {
      for (const point of sketch.points) {
        if (!finite(point.x) || !finite(point.y)) {
          errors.push(diagnostic('error', 'sketch_coordinate_invalid', `${sketch.name} contains a non-finite point.`, [sketch.id, point.id]));
        }
      }
      if (sketch.solverState === 'overConstrained' || sketch.solverState === 'failed') {
        errors.push(diagnostic('error', 'sketch_constraints_invalid', `${sketch.name} must solve before regeneration.`, [sketch.id]));
      } else if (sketch.solverState === 'underConstrained') {
        warnings.push(diagnostic('warning', 'sketch_under_constrained', `${sketch.name} remains under-constrained.`, [sketch.id]));
      }
    }
    for (const feature of document.features) {
      if (feature.type === 'sketch' && !sketchIds.has(feature.sketchId)) {
        errors.push(diagnostic('error', 'feature_sketch_missing', `${feature.name} uses a missing sketch.`, [feature.id, feature.sketchId]));
      }
      if ('size' in feature && (!finite(feature.size) || feature.size <= 0)) {
        errors.push(diagnostic('error', 'feature_size_invalid', `${feature.name} requires a positive size.`, [feature.id]));
      }
      if (feature.type === 'extrude' && (!finite(feature.distance) || feature.distance <= 0)) {
        errors.push(diagnostic('error', 'extrude_distance_invalid', `${feature.name} requires a positive extrusion distance.`, [feature.id]));
      }
      if (feature.type === 'catalogueExtrusion') {
        const { section } = feature;
        if (!finite(feature.length) || feature.length <= 0) {
          errors.push(diagnostic('error', 'catalogue_extrusion_length_invalid', `${feature.name} requires a positive member length.`, [feature.id]));
        }
        if (section.catalogue !== 'beam-ec3' || !/^[a-f0-9]{64}$/.test(section.catalogueRevision)) {
          errors.push(diagnostic('error', 'catalogue_snapshot_invalid', `${feature.name} does not contain a valid Beam EC3 catalogue snapshot.`, [feature.id]));
        }
        const dimensions = section.dimensions;
        if (!finite(dimensions.height) || !finite(dimensions.width) || dimensions.height <= 0 || dimensions.width <= 0 ||
            !finite(dimensions.rootRadius) || dimensions.rootRadius <= 0) {
          errors.push(diagnostic('error', 'catalogue_profile_dimensions_invalid', `${feature.name} has invalid profile dimensions.`, [feature.id]));
        }
        if (section.kind === 'rhs') {
          const thickness = dimensions.wallThickness;
          if (thickness === null || !finite(thickness) || thickness <= 0 || 2 * thickness >= Math.min(dimensions.height, dimensions.width)) {
            errors.push(diagnostic('error', 'catalogue_rhs_thickness_invalid', `${feature.name} has an invalid hollow-section wall thickness.`, [feature.id]));
          }
        } else {
          const web = dimensions.webThickness;
          const flange = dimensions.flangeThickness;
          if (web === null || flange === null || !finite(web) || !finite(flange) || web <= 0 || flange <= 0 ||
              web >= dimensions.width || 2 * flange >= dimensions.height) {
            errors.push(diagnostic('error', 'catalogue_open_profile_invalid', `${feature.name} has invalid web or flange dimensions.`, [feature.id]));
          }
        }
        if (!section.geometryVerified) {
          warnings.push(diagnostic('warning', 'catalogue_geometry_unverified', `${feature.name} uses catalogue geometry that is not marked as verified source data.`, [feature.id]));
        }
      }
      if (feature.type === 'hole' && (!finite(feature.diameter) || feature.diameter <= 0)) {
        errors.push(diagnostic('error', 'hole_diameter_invalid', `${feature.name} requires a positive diameter.`, [feature.id]));
      }
    }
  }

  for (const component of project.assembly.components) {
    if (!documentIds.has(component.partDocumentId)) {
      errors.push(diagnostic('error', 'component_document_missing', `${component.name} references a missing part document.`, [component.id, component.partDocumentId]));
    }
    if (component.transform.some((value) => !finite(value))) {
      errors.push(diagnostic('error', 'component_transform_invalid', `${component.name} has a non-finite transform.`, [component.id]));
    }
  }

  for (const material of project.materials) {
    if (!finite(material.elasticModulus) || material.elasticModulus <= 0) {
      errors.push(diagnostic('error', 'elastic_modulus_invalid', `${material.name} requires a positive elastic modulus.`, [material.id]));
    }
    if (!finite(material.poissonRatio) || material.poissonRatio <= -1 || material.poissonRatio >= 0.49) {
      errors.push(diagnostic('error', 'poisson_ratio_unsupported', `${material.name} must have -1 < ν < 0.49.`, [material.id]));
    } else if (material.poissonRatio > 0.45) {
      warnings.push(diagnostic('warning', 'near_incompressible_material', `${material.name} has ν > 0.45; the displacement formulation may lock.`, [material.id]));
    }
    if (material.density !== undefined && (!finite(material.density) || material.density <= 0)) {
      errors.push(diagnostic('error', 'density_invalid', `${material.name} requires a positive density.`, [material.id]));
    }
  }

  const refs: TopologyRef[] = [];
  for (const study of project.studies) {
    if (study.geometryRevision !== Math.max(0, ...project.partDocuments.map(({ geometryRevision }) => geometryRevision))) {
      warnings.push(diagnostic('warning', 'study_geometry_stale', `${study.name} was defined against a different geometry revision.`, [study.id]));
    }
    if (study.mesh.elementOrder !== 2) {
      warnings.push(diagnostic('warning', 'linear_tetra_preview_only', `${study.name} uses first-order tetrahedra, which are preview/diagnostic elements only.`, [study.id]));
    }
    if (!finite(study.mesh.globalSize) || study.mesh.globalSize <= 0 || !finite(study.mesh.minimumSize) || study.mesh.minimumSize <= 0) {
      errors.push(diagnostic('error', 'mesh_size_invalid', `${study.name} requires positive mesh sizes.`, [study.id]));
    }
    if (study.mesh.minimumSize > study.mesh.globalSize) {
      errors.push(diagnostic('error', 'mesh_size_order_invalid', `${study.name} has a minimum mesh size larger than its global size.`, [study.id]));
    }
    if (study.solver.analysisType === 'nonlinearContact' && !study.contacts.some(({ type, enabled }) => type === 'frictionless' && enabled)) {
      errors.push(diagnostic('error', 'contact_pair_missing', `${study.name} is nonlinear contact but has no enabled frictionless contact pair.`, [study.id]));
    }
    if (study.solver.analysisType === 'linearStatic' && study.contacts.some(({ type, enabled }) => type === 'frictionless' && enabled)) {
      errors.push(diagnostic('error', 'contact_requires_nonlinear_study', `${study.name} contains frictionless contact and must use nonlinear contact analysis.`, [study.id]));
    }
    if (!project.assembly.components.length) {
      errors.push(diagnostic('error', 'study_component_missing', `${study.name} has no assembly component to analyse.`, [study.id]));
    }
    if (!study.materialAssignments.length) {
      errors.push(diagnostic('error', 'study_material_assignment_missing', `${study.name} requires a material assignment for each analysed body.`, [study.id]));
    }
    if (!study.supports.length) {
      errors.push(diagnostic('error', 'study_support_missing', `${study.name} requires at least one displacement restraint.`, [study.id]));
    }
    if (!study.loads.length) {
      errors.push(diagnostic('error', 'study_load_missing', `${study.name} requires at least one applied load.`, [study.id]));
    }
    for (const assignment of study.materialAssignments) {
      if (!componentIds.has(assignment.componentId)) {
        errors.push(diagnostic('error', 'assignment_component_missing', 'A material assignment references a missing component.', [study.id, assignment.componentId]));
      }
      if (!bodyIds.has(assignment.bodyId)) {
        errors.push(diagnostic('error', 'assignment_body_missing', 'A material assignment references a missing body.', [study.id, assignment.bodyId]));
      }
      if (!materialIds.has(assignment.materialId)) {
        errors.push(diagnostic('error', 'assignment_material_missing', 'A material assignment references a missing material.', [study.id, assignment.materialId]));
      }
    }
    for (const support of study.supports) refs.push(...support.targets);
    for (const load of study.loads) if ('targets' in load) refs.push(...load.targets);
    for (const contact of study.contacts) refs.push(...contact.primary, ...contact.secondary);
    for (const control of study.mesh.controls) refs.push(...control.targets);
  }
  for (const mate of project.assembly.mates) {
    if ('componentId' in mate && !componentIds.has(mate.componentId)) {
      errors.push(diagnostic('error', 'mate_component_missing', `${mate.name} references a missing component.`, [mate.id, mate.componentId]));
    }
    if ('componentA' in mate) {
      if (!componentIds.has(mate.componentA) || !componentIds.has(mate.componentB)) {
        errors.push(diagnostic('error', 'mate_component_missing', `${mate.name} references a missing component.`, [mate.id, mate.componentA, mate.componentB]));
      }
      refs.push(mate.faceA, mate.faceB);
    }
  }
  for (const ref of refs) validateTopologyRef(ref, documentIds, bodyIds, featureIds, errors);

  return { valid: errors.length === 0, errors, warnings };
}
