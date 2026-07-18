import { FRAME3D_SCHEMA_VERSION, type Frame3DModel } from '../../../../packages/frame3d-schema';
import { validateFrameModel } from '../../../../packages/frame3d-validation';

export class Frame3DImportError extends Error {}

export function parseModel(text: string): Frame3DModel {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Frame3DImportError(`The selected file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!data || typeof data !== 'object') throw new Frame3DImportError('The selected JSON does not contain a Frame3D model object.');
  const version = (data as { schemaVersion?: unknown }).schemaVersion;
  if (version !== FRAME3D_SCHEMA_VERSION) {
    throw new Frame3DImportError(`Unsupported Frame3D schema version "${String(version)}". This release supports ${FRAME3D_SCHEMA_VERSION}.`);
  }
  const model = data as Frame3DModel;
  const report = validateFrameModel(model);
  if (!report.valid) throw new Frame3DImportError(`The imported model is malformed:\n${report.errors.join('\n')}`);
  return structuredClone(model);
}

export function serialiseModel(model: Frame3DModel): string {
  return JSON.stringify(model, null, 2);
}

export function roundTripModel(model: Frame3DModel): Frame3DModel {
  return parseModel(serialiseModel(model));
}
