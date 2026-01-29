import { RunState } from './types';
import { CostSummary } from '../cost/tracker';

export type SerializedRunState = Omit<RunState, 'costTracker'> & {
  costTracker: CostSummary;
};

export function serializeRunState(state: RunState): SerializedRunState {
  return {
    ...state,
    costTracker: state.costTracker.getSummary(),
  };
}
