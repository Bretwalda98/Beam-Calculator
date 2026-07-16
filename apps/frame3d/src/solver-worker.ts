/// <reference lib="webworker" />
import init, { solve_linear_static_json } from './wasm/frame3d_solver';
import type {
  AnalysisSelection,
  AnalysisState,
  Frame3DModel,
  SolverResponse,
  SolverWorkerMessage
} from '../../../packages/frame3d-schema';

interface SolveMessage {
  requestId: number;
  modelRevision: number;
  model: Frame3DModel;
  selection: AnalysisSelection;
}

let initialised: Promise<unknown> | null = null;

const progress = (message: SolveMessage, state: AnalysisState): void => {
  self.postMessage({
    type: 'progress',
    requestId: message.requestId,
    modelRevision: message.modelRevision,
    state
  } satisfies SolverWorkerMessage);
};

self.onmessage = async (event: MessageEvent<SolveMessage>) => {
  const message = event.data;
  try {
    progress(message, 'Validating');
    initialised ||= init();
    await initialised;
    progress(message, 'Assembling');
    await Promise.resolve();
    progress(message, 'Solving');
    const response = JSON.parse(solve_linear_static_json(JSON.stringify({
      model: message.model,
      selection: message.selection
    }))) as SolverResponse;
    progress(message, 'Recovering results');
    self.postMessage({
      type: 'result',
      requestId: message.requestId,
      modelRevision: message.modelRevision,
      response
    } satisfies SolverWorkerMessage);
  } catch (error) {
    self.postMessage({
      type: 'result',
      requestId: message.requestId,
      modelRevision: message.modelRevision,
      response: {
        status: 'error',
        stage: 'worker',
        message: error instanceof Error ? error.message : String(error),
        warnings: [],
        errors: []
      }
    } satisfies SolverWorkerMessage);
  }
};
