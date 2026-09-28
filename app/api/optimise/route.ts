import {NextResponse} from "next/server";
import fs from "node:fs";
import path from "node:path";
import{getBootstrap,getFixtures,getHistory,getPicks,getTeam}from "../../../lib/fpl";
import{optimiseSquad}from "../../../lib/engine";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export const preferredRegion="lhr1";

function readDecisionCache(gw:number){
  try{
    const file=path.join(process.cwd(),"data","decision-plan.json");
    if(!fs.existsSync(file))return null;
    const cached=JSON.parse(fs.readFileSync(file,"utf8"));
    return Number(cached.gameweek)===Number(gw)?cached:null;
  }catch{return null}
}

export async function GET(request:Request){
  const id=process.env.FPL_TEAM_ID||"1187241";
  const started=Date.now();
  try{
    const [b,t,h,f0]=await Promise.all([getBootstrap(),getTeam(id),getHistory(id),getFixtures()]);
    const teamRanks=new Map((b.teams||[]).map((x:any)=>[Number(x.id),Number(x.position||0)]));
    const teamForms=new Map((b.teams||[]).map((x:any)=>[Number(x.id),Number(x.form||0)]));
    const f=(f0||[]).map((x:any)=>({...x,team_h_rank:teamRanks.get(Number(x.team_h))||0,team_a_rank:teamRanks.get(Number(x.team_a))||0,team_h_form:teamForms.get(Number(x.team_h))||0,team_a_form:teamForms.get(Number(x.team_a))||0}));
    const gw=Number(t.current_event||h.current?.at(-1)?.event||1);
    const picks:any=await getPicks(id,gw);
    const entryHistory:any=(picks as any)?.entry_history??null;
    const url=new URL(request.url);
    const planOnly=url.searchParams.has("plan");
    const fast=url.searchParams.has("fast")&&!planOnly;
    const cachedPlan=readDecisionCache(gw);

    // The expensive multi-GW search is now a GitHub Actions worker. The web
    // request only calculates the live squad/transfer/substitution layer. This
    // prevents a second full search from being launched by the UI and keeps the
    // Vercel function responsive while retaining the same engine code/model.
    const result=await optimiseSquad(
      (picks as any)?.picks||[],b.elements||[],f,gw,Number((entryHistory as any)?.bank||0)/10,h,entryHistory,
      planOnly?true:!fast,
      fast,
      planOnly
    );

    if(cachedPlan&&!planOnly){
      result.decisionPlan=cachedPlan.decisionPlan||[];
      result.decisionPlanDiagnostics=cachedPlan.decisionPlanDiagnostics||null;
      result.decisionPlanSource={source:"github-actions-worker",generatedAt:cachedPlan.generatedAt,gameweek:cachedPlan.gameweek};
    }

    return NextResponse.json({connected:true,team:t,gw,picks,history:h,result,generatedAt:new Date().toISOString(),elapsedMs:Date.now()-started});
  }catch(e){
    console.error("optimise failed",e);
    return NextResponse.json({connected:false,error:String(e),elapsedMs:Date.now()-started},{status:502});
  }
}