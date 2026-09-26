// Incremental current-season learning state.
// Completed 2026/27 GWs are learned once; the five historical seasons are not replayed.
export const CURRENT_SEASON_MODEL={
  "season": "2026-27",
  "lastLearnedGW": 4,
  "weights": {
    "form3": 0.2434402409061094,
    "form5": 0.18565428238536727,
    "p90": 0.1416768535342005,
    "xgi90": 0.19260127903327848,
    "xg90": 0.057714062958481485,
    "xa90": 0.0693889593119259,
    "dc90": 0.0778209125338675,
    "bonus90": 0,
    "bps90": 0,
    "ict90": 0,
    "threat90": 0,
    "creativity90": 0,
    "influence90": 0,
    "goals90": 0,
    "assists90": 0,
    "saves90": 0,
    "cleanSheetRate": 0,
    "startRate": 0.17655032916107732,
    "minutesRate": 0.23724615827359194,
    "recentMinutesRate": 0,
    "bias": -0.0814561559506406
  },
  "updatedAt": "2026-09-26T09:46:32.483Z"
} as const;
