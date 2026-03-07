import type { DAWAction, DAWState } from '../types/daw';
import { dawReducer } from './dawReducer';

export interface DAWHistoryState {
  past: DAWState[];
  present: DAWState;
  future: DAWState[];
}

const MAX_HISTORY_STATES = 100;

const NON_UNDOABLE_ACTIONS = new Set<DAWAction['type']>([
  'UNDO',
  'REDO',
  'SET_PLAYING',
  'SET_RECORDING',
  'SET_CURRENT_TIME',
  'SET_SCROLL_LEFT',
  'SET_ACTIVE_PANEL',
  'SET_PLUGIN_RACK_TRACK',
  'SELECT_TRACK',
]);

export function createInitialHistoryState(initialState: DAWState): DAWHistoryState {
  return {
    past: [],
    present: initialState,
    future: [],
  };
}

export function dawHistoryReducer(state: DAWHistoryState, action: DAWAction): DAWHistoryState {
  if (action.type === 'UNDO') {
    if (state.past.length === 0) return state;
    const previous = state.past[state.past.length - 1];
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
    };
  }

  if (action.type === 'REDO') {
    if (state.future.length === 0) return state;
    const next = state.future[0];
    return {
      past: [...state.past, state.present].slice(-MAX_HISTORY_STATES),
      present: next,
      future: state.future.slice(1),
    };
  }

  const nextPresent = dawReducer(state.present, action);
  if (nextPresent === state.present) return state;

  if (action.type === 'LOAD_PROJECT') {
    return {
      past: [],
      present: nextPresent,
      future: [],
    };
  }

  if (NON_UNDOABLE_ACTIONS.has(action.type)) {
    return {
      ...state,
      present: nextPresent,
    };
  }

  return {
    past: [...state.past, state.present].slice(-MAX_HISTORY_STATES),
    present: nextPresent,
    future: [],
  };
}
