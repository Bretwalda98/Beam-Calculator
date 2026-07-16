import type { AnalysisState, Frame3DModel, FrameResult } from '../../../../packages/frame3d-schema';
import { DEFAULT_FRAME3D_EXAMPLE, FRAME3D_EXAMPLES } from '../../../../packages/frame3d-schema/examples';

export interface Frame3dState {
  model: Frame3DModel;
  result: FrameResult | null;
  modelRevision: number;
  requestId: number;
  analysisState: AnalysisState;
  analysisErrors: string[];
  analysisWarnings: string[];
  worker: Worker | null;
}

export const state: Frame3dState = {
  model: FRAME3D_EXAMPLES[DEFAULT_FRAME3D_EXAMPLE](),
  result: null,
  modelRevision: 1,
  requestId: 0,
  analysisState: 'Ready',
  analysisErrors: [],
  analysisWarnings: [],
  worker: null
};
