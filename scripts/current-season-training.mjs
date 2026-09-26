#!/usr/bin/env node
import fs from "node:fs";
const API="https://fantasy.premierleague.com/api";
const MODEL_PATH="lib/current-season-model.ts";
const LIVE_PATH="data/current-season-live.json";
const KEYS=["form3","form5","p90","xgi90","xg90","xa90","dc90","startRate","minutesRate"];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:0};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
async function get(path){
  let last;
  for(let i=0;i<3;i++){
    try{
      const r=await fetch(API+path,{headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36","Accept":"application/json","Referer":"https://fantasy.premierleague.com/"}});
      if(r.ok)return r.json();
      last=new Error("FPL "+r.status+" "+path);
    }catch(e){last=e}
    if(i<2)await new Promise(r=>setTimeout(r,750*(i+1)));
  }
  throw last;
}
function parseModel(){
  const text=fs.readFileSync(MODEL_PATH,"utf8");
  const m=text.match(/export const CURRENT_SEASON_MODEL=(.*) as const;/s);
  if(!m)throw Error("Unable to parse current-season model");
  return JSON.parse(m[1]);
}
function features(rows){
  const mins=Math.max(1,rows.reduce((s,r)=>s+num(r.minutes),0)),n=Math.max(1,rows.length);
  const per90=k=>rows.reduce((s,r)=>s+num(r[k]),0)/(mins/90);
  return {form3:mean(rows.slice(-3).map(r=>num(r.total_points))),form5:mean(rows.slice(-5).map(r=>num(r.total_points))),p90:per90("total_points"),xgi90:per90("expected_goal_involvements"),xg90:per90("expected_goals"),xa90:per90("expected_assists"),dc90:per90("defensive_contribution"),startRate:rows.reduce((s,r)=>s+num(r.starts),0)/n,minutesRate:mins/(90*n)};
}
function normalise(rows){
  const stats={};
  for(const k of KEYS){const vals=rows.map(x=>num(x[k])),mu=mean(vals),sd=Math.sqrt(mean(vals.map(v=>(v-mu)**2)))||1;stats[k]=[mu,sd]}
  return rows.map(x=>({...x,z:Object.fromEntries(KEYS.map(k=>[k,(num(x[k])-stats[k][0])/stats[k][1]]))}));
}
const model=parseModel();
const live=fs.existsSync(LIVE_PATH)?JSON.parse(fs.readFileSync(LIVE_PATH,"utf8")):{season:"2026-27",gameweeks:{}};
const bootstrap=await get("/bootstrap-static/");
const current=Number(bootstrap.events?.find(e=>e.is_current)?.id||bootstrap.events?.find(e=>e.is_next)?.id||1);
const completed=Math.max(0,current-1);
for(let gw=1;gw<=completed;gw++){if(!live.gameweeks[gw]){live.gameweeks[gw]=await get("/event/"+gw+"/live/");console.log("Cached current-season GW",gw);}}
const historyByPlayer=new Map();
const rows=Object.entries(live.gameweeks).map(([gw,data])=>({gw:Number(gw),data})).sort((a,b)=>a.gw-b.gw);
let learned=model.lastLearnedGW||0;
for(const {gw,data} of rows){
  if(gw<=learned)continue;
  const examples=[];
  for(const e of (data.elements||[])){
    const prior=historyByPlayer.get(Number(e.id))||[];
    if(prior.length)examples.push({f:features(prior),actual:num(e.stats?.total_points)});
    const s=e.stats||{};
    historyByPlayer.set(Number(e.id),prior.concat([{total_points:num(s.total_points),minutes:num(s.minutes),starts:num(s.starts),expected_goals:num(s.expected_goals),expected_assists:num(s.expected_assists),expected_goal_involvements:num(s.expected_goal_involvements),defensive_contribution:num(s.defensive_contribution)}]));
  }
  if(examples.length){
    const norm=normalise(examples.map(x=>x.f)),lr=.00002,scale=.55;
    for(let i=0;i<examples.length;i++){
      const z=norm[i].z,pred=2+KEYS.reduce((s,k)=>s+num(model.weights[k])*num(z[k]),0)*scale,err=clamp(examples[i].actual-pred,-8,8);
      for(const k of KEYS)model.weights[k]=clamp(num(model.weights[k])+lr*err*num(z[k]),-.75,.75);
      model.weights.bias=clamp(num(model.weights.bias)+lr*err*.25,-1,1);
    }
  }
  learned=gw;
}
model.lastLearnedGW=learned;
model.updatedAt=new Date().toISOString();
fs.mkdirSync("data",{recursive:true});
fs.writeFileSync(LIVE_PATH,JSON.stringify(live,null,2));
fs.writeFileSync(MODEL_PATH,"// Incremental current-season learning state.\n// Completed 2026/27 GWs are learned once; the five historical seasons are not replayed.\nexport const CURRENT_SEASON_MODEL="+JSON.stringify(model,null,2)+" as const;\n");
console.log("Current-season model learned through GW",learned);
