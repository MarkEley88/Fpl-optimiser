// GitHub Actions worker: run the expensive decision search away from Vercel.
// Model parser is kept compatible with the persisted current-season TS state.
import fs from "node:fs";
import {optimiseSquad} from "../lib/engine";

const CACHE_PATH="data/fpl-cache.json";
const OUT_PATH="data/decision-plan.json";

function num(v:any){const n=Number(v);return Number.isFinite(n)?n:0;}

async function main(){
  const cache=JSON.parse(fs.readFileSync(CACHE_PATH,"utf8"));
  const bootstrap=cache.bootstrap||{};
  const team=cache.team||{};
  const history=cache.history||{};
  const picks=cache.picks||{};
  const fixtures=(cache.fixtures||[]).map((x:any)=>{
    const h=(bootstrap.teams||[]).find((t:any)=>Number(t.id)===Number(x.team_h));
    const a=(bootstrap.teams||[]).find((t:any)=>Number(t.id)===Number(x.team_a));
    return {...x,team_h_rank:num(h?.position),team_a_rank:num(a?.position),team_h_form:num(h?.form),team_a_form:num(a?.form)};
  });
  const gw=num(team.current_event||(history.current||[]).at(-1)?.event||1);
  const entryHistory=picks.entry_history||null;
  const bank=num(entryHistory?.bank)/10;
  console.log(`[decision-worker] calculating GW ${gw} multi-GW plan on GitHub Actions`);
  const result=await optimiseSquad(picks.picks||[],bootstrap.elements||[],fixtures,gw,bank,history,entryHistory,true,false,true);
  const output={generatedAt:new Date().toISOString(),gameweek:gw,decisionPlan:result.decisionPlan||[],decisionPlanDiagnostics:result.decisionPlanDiagnostics||null};
  fs.mkdirSync("data",{recursive:true});
  fs.writeFileSync(OUT_PATH,JSON.stringify(output,null,2));
  console.log(`[decision-worker] wrote ${OUT_PATH}; ${output.decisionPlan.length} GW steps`);
}
main().catch(error=>{console.error("[decision-worker] failed",error);process.exit(1)});

// Search-engine validation trigger: run the worker after decision-search algorithm changes.
