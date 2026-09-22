// Incremental current-season learning state.
// This is deliberately separate from the five-season historical trainer: each
// completed 2026/27 Gameweek is learned once and persisted, so we never replay
// the five historical seasons or relearn completed current-season GWs.
export const CURRENT_SEASON_MODEL={
  season:"2026-27",
  lastLearnedGW:0,
  weights:{
    form3:0.2172182101856406,
    form5:0.15943225166489847,
    p90:0.1431516728032819,
    xgi90:0.1893258978193213,
    xg90:0.057875303292560604,
    xa90:0.05859252068022994,
    dc90:0.0732481541801605,
    bonus90:0,
    bps90:0,
    ict90:0,
    threat90:0,
    creativity90:0,
    influence90:0,
    goals90:0,
    assists90:0,
    saves90:0,
    cleanSheetRate:0,
    startRate:0.14336301403852017,
    minutesRate:0.20144942954201622,
    recentMinutesRate:0,
    bias:-0.0756866117530283
  }
} as const;
