export type ExactState = {
  gw: number;
  squadIds: number[];
  bank: number;
  freeTransfers: number;
  chips: string[];
};

export type ExactTransition<S extends ExactState, A = unknown> = {
  state: S;
  action: A;
  points: number;
};

export type ExactSearchResult<S extends ExactState, A = unknown> = {
  score: number;
  states: S[];
  actions: A[];
  nodes: number;
  memoHits: number;
  pruned: number;
  complete: boolean;
  elapsedMs: number;
};

export type ExactSearchConfig<S extends ExactState, A = unknown> = {
  start: S;
  endGw: number;
  expand: (state: S) => ExactTransition<S, A>[];
  terminalScore: (state: S) => number;
  upperBound: (state: S) => number;
  key?: (state: S) => string;
  nodeLimit?: number;
};

const defaultKey = (s: ExactState) =>
  [
    s.gw,
    [...s.squadIds].sort((a, b) => a - b).join(","),
    s.bank.toFixed(1),
    s.freeTransfers,
    [...s.chips].sort().join(","),
  ].join("|");

/**
 * Exact depth-first state-space search.
 *
 * This is deliberately independent of the FPL scoring model. The FPL engine
 * supplies legal transitions, points and a mathematically optimistic upper
 * bound. With no nodeLimit and a valid upperBound, pruning cannot remove the
 * optimum. Equivalent states are memoised by their canonical state key.
 */
export function exactSearch<S extends ExactState, A = unknown>(
  config: ExactSearchConfig<S, A>
): ExactSearchResult<S, A> {
  const started = Date.now();
  const keyOf = config.key ?? defaultKey;
  const bestSeen = new Map<string, number>();

  let bestScore = -Infinity;
  let bestStates: S[] = [];
  let bestActions: A[] = [];
  let nodes = 0;
  let memoHits = 0;
  let pruned = 0;
  let complete = true;

  const dfs = (state: S, accumulated: number, states: S[], actions: A[]) => {
    nodes++;
    if (config.nodeLimit && nodes > config.nodeLimit) {
      complete = false;
      return;
    }

    const key = keyOf(state);
    const previous = bestSeen.get(key);
    if (previous !== undefined && previous >= accumulated) {
      memoHits++;
      return;
    }
    bestSeen.set(key, accumulated);

    const optimistic = accumulated + config.upperBound(state);
    if (optimistic <= bestScore + 1e-9) {
      pruned++;
      return;
    }

    if (state.gw > config.endGw) {
      const finalScore = accumulated + config.terminalScore(state);
      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestStates = states;
        bestActions = actions;
      }
      return;
    }

    const transitions = config.expand(state);

    // No legal transition means the state is terminal for this search.
    if (!transitions.length) {
      const finalScore = accumulated + config.terminalScore(state);
      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestStates = states;
        bestActions = actions;
      }
      return;
    }

    // Explore promising branches first. This only changes search order, never
    // correctness, and helps establish a strong incumbent early for pruning.
    transitions.sort((a, b) => b.points - a.points);

    for (const transition of transitions) {
      dfs(
        transition.state,
        accumulated + transition.points,
        [...states, transition.state],
        [...actions, transition.action],
      );
      if (!complete) return;
    }
  };

  dfs(config.start, 0, [config.start], []);

  return {
    score: bestScore,
    states: bestStates,
    actions: bestActions,
    nodes,
    memoHits,
    pruned,
    complete,
    elapsedMs: Date.now() - started,
  };
}
