import { mkdir, writeFile } from "node:fs/promises";
import { getBootstrap, getFixtures, getHistory, getPicks, getTeam } from "../lib/fpl.ts";
import { optimiseSquad } from "../lib/engine.ts";

const id = process.env.FPL_TEAM_ID || "1187241";
const started = Date.now();

const [b, t, h, f0] = await Promise.all([
  getBootstrap(),
  getTeam(id),
  getHistory(id),
  getFixtures(),
]);

const teamRanks = new Map((b.teams || []).map((x) => [Number(x.id), Number(x.position || 0)]));
const teamForms = new Map((b.teams || []).map((x) => [Number(x.id), Number(x.form || 0)]));
const fixtures = (f0 || []).map((x) => ({
  ...x,
  team_h_rank: teamRanks.get(Number(x.team_h)) || 0,
  team_a_rank: teamRanks.get(Number(x.team_a)) || 0,
  team_h_form: teamForms.get(Number(x.team_h)) || 0,
  team_a_form: teamForms.get(Number(x.team_a)) || 0,
}));
const gw = Number(t.current_event || h.current?.at(-1)?.event || 1);
const picks = await getPicks(id, gw);
const entryHistory = picks?.entry_history ?? null;

const result = await optimiseSquad(
  picks?.picks || [],
  b.elements || [],
  fixtures,
  gw,
  Number(entryHistory?.bank || 0) / 10,
  h,
  entryHistory,
  true,
  false,
  true,
);

const output = {
  generatedAt: new Date().toISOString(),
  elapsedMs: Date.now() - started,
  gameweek: gw,
  horizon: 5,
  source: "github-actions-worker",
  result,
};

await mkdir("worker-output", { recursive: true });
await writeFile("worker-output/latest-plan.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({
  gameweek: gw,
  elapsedMs: output.elapsedMs,
  horizon: 5,
  diagnostics: result.decisionPlanDiagnostics,
  plan: result.decisionPlan,
}, null, 2));
