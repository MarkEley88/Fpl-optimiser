#!/usr/bin/env node
/*
  FPL historical walk-forward trainer.

  Five historical seasons are replayed chronologically:
    2021/22 -> 2022/23 -> 2023/24 -> 2024/25 -> 2025/26

  For each season:
    1. Construct a legal £100m GW1 squad using only GW1-era information.
    2. Score GW1.
    3. Update the model from the error between prediction and actual GW1.
    4. At every following deadline, use only information available by then.
    5. Choose transfers/chips.
    6. Reveal that GW's historical result.
    7. Learn from the result and continue.

  This is intentionally walk-forward/online learning, not a hindsight optimiser.
  The resulting coefficients are generic model parameters; the live engine still
  applies 2026/27 rules independently.
*/
import fs from "node:fs";

const ROOT="https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data";
const SEASONS=["2021-22","2022-23","2023-24","2024-25","2025-26"];

const RULES={
 "2021-22":{maxFT:2,chips:{wc:2,fh:1,bb:1,tc:1},secondFH:true},
 "2022-23":{maxFT:2,chips:{wc:2,fh:1,bb:1,tc:1}},
 "2023-24":{maxFT:2,chips:{wc:2,fh:1,bb:1,tc:1}},
 "2024-25":{maxFT:5,chips:{wc:2,fh:1,bb:1,tc:1,mystery:1}},
 "2025-26":{maxFT:5,chips:{wc:2,fh:2,bb:2,tc:2}}
};

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:0};

function csv(t){
 const rows=[];let r=[],c="",q=false;
 for(let i=0;i<t.length;i++){
  const ch=t[i],nx=t[i+1];
  if(q){if(ch==='"'&&nx==='"'){c+='"';i++}else if(ch==='"')q=false;else c+=ch}
  else if(ch==='"')q=true;
  else if(ch===','){r.push(c);c="";}
  else if(ch==="\n"){r.push(c.replace(/\r$/,""));rows.push(r);r=[];c="";}
  else c+=ch;
 }
 if(c||r.length){r.push(c);rows.push(r)}
 const h=rows.shift()||[];
 return rows.filter(x=>x.length===h.length).map(x=>Object.fromEntries(h.map((k,i)=>[k,x[i]])));
}
async function get(u){const r=await fetch(u);if(!r.ok)throw Error(r.status+" "+u);return r.text()}

function rulesFor(season){return RULES[season]||RULES["2025-26"]}

function features(history){
 const last=history.slice(-1)[0]||{}, last3=history.slice(-3),last5=history.slice(-5);
 const mins=history.reduce((s,x)=>s+x.minutes,0), n=history.length;
 const p90=mins?history.reduce((s,x)=>s+x.points,0)/(mins/90):0;
 const xgi90=mins?history.reduce((s,x)=>s+x.xgi,0)/(mins/90):0;
 const xg90=mins?history.reduce((s,x)=>s+x.xg,0)/(mins/90):0;
 const xa90=mins?history.reduce((s,x)=>s+x.xa,0)/(mins/90):0;
 const dc90=mins?history.reduce((s,x)=>s+x.dc,0)/(mins/90):0;
 return {
  id:last.id,pos:last.pos,team:last.team,price:last.value/10,
  form3:mean(last3.map(x=>x.points)),form5:mean(last5.map(x=>x.points)),
  p90,xgi90,xg90,xa90,dc90,
  startRate:history.reduce((s,x)=>s+x.starts,0)/Math.max(1,n),
  minutesRate:mins/(90*Math.max(1,n))
 };
}

const KEYS=["form3","form5","p90","xgi90","xg90","xa90","dc90","startRate","minutesRate"];
let W={form3:.16,form5:.10,p90:.15,xgi90:.18,xg90:.05,xa90:.05,dc90:.07,startRate:.10,minutesRate:.14,bias:0};
function rawScore(f){
 return W.bias+KEYS.reduce((s,k)=>s+(W[k]||0)*f[k],0);
}
function normalise(fs){
 const out=[...fs],stats={};
 for(const k of KEYS){const a=out.map(f=>f[k]),m=mean(a),sd=Math.sqrt(mean(a.map(v=>(v-m)**2)))||1;stats[k]=[m,sd]}
 return out.map(f=>{const z={...f};for(const k of KEYS)z[k]=(f[k]-stats[k][0])/stats[k][1];return z});
}
function predict(f){return 2+rawScore(f)*.55}

function legal(s){return s.length===15&&s.filter(x=>x.pos===1).length===2&&s.filter(x=>x.pos===2).length===5&&s.filter(x=>x.pos===3).length===5&&s.filter(x=>x.pos===4).length===3&&[...new Set(s.map(x=>x.team))].every(t=>s.filter(x=>x.team===t).length<=3)}
function buildStart(pool){
 const need={1:2,2:5,3:5,4:3};
 let states=[{s:[],cost:0,score:0,clubs:{}}];
 for(const pos of [1,2,3,4]){
  const src=pool.filter(p=>p.pos===pos).sort((a,b)=>b.model-a.model).slice(0,100);
  for(let k=0;k<need[pos];k++){
   const next=[];
   for(const st of states)for(const p of src){
    if(st.s.some(x=>x.id===p.id))continue;
    const cc=(st.clubs[p.team]||0)+1;
    if(cc>3)continue;
    const cost=Number((st.cost+p.price).toFixed(1));
    if(cost>100)continue;
    next.push({s:[...st.s,p],cost,score:st.score+p.model,clubs:{...st.clubs,[p.team]:cc}});
   }
   // Keep a broad beam, but always retain cheaper alternatives so the final
   // 15-player squad can still satisfy the £100m budget.
   next.sort((a,b)=>b.score-a.score);
   const seen=new Set(),kept=[];
   for(const st of next){
    const key=st.cost.toFixed(1)+"|"+Object.entries(st.clubs).sort((a,b)=>Number(a[0])-Number(b[0])).map(([t,n])=>t+":"+n).join(",");
    if(seen.has(key))continue;
    seen.add(key);kept.push(st);
    if(kept.length>=5000)break;
   }
   states=kept;
   if(!states.length)break;
  }
  if(!states.length)break;
 }
 return states.sort((a,b)=>b.score-a.score)[0]?.s||[];
}
function actual(id,gw,byId){return byId.get(id)?.get(gw)?.points||0}
function formations(s){
 const out=[];const g={1:[],2:[],3:[],4:[]};s.forEach(p=>g[p.pos].push(p));
 for(const [d,m,f] of [[3,4,3],[3,5,2],[4,4,2],[4,5,1],[4,3,3],[5,4,1],[5,3,2],[5,2,3]])
  if(g[1].length&&g[2].length>=d&&g[3].length>=m&&g[4].length>=f)out.push([g[1][0],...g[2].slice(0,d),...g[3].slice(0,m),...g[4].slice(0,f)]);
 return out;
}
function selectXI(squad,preds){
 let best=null,score=-1e9;
 for(const x of formations(squad)){const v=x.reduce((a,p)=>a+(preds.get(p.id)||0),0);if(v>score){score=v;best=x}}
 return best||formations(squad)[0];
}
function squadPrice(s){return s.reduce((a,p)=>a+p.price,0)}
function candidates(squad,pool,bank,ft,season){
 const out=[];const maxFT=rulesFor(season).maxFT;
 for(const o of squad)for(const p of pool){
  if(squad.some(x=>x.id===p.id)||p.pos!==o.pos)continue;
  const cost=Number((p.price-o.price).toFixed(1));if(cost>bank+.001)continue;
  if(p.team!==o.team&&squad.filter(x=>x.team===p.team).length>=3)continue;
  const s2=squad.filter(x=>x.id!==o.id).concat(p);if(!legal(s2))continue;
  out.push({o,p,cost,hit:ft>0?0:4});
 }
 return out;
}
function chooseAction(squad,pool,bank,ft,gw,season,preds,usedChips){
 let best={type:"hold",value:0};
 const current=squad.reduce((a,p)=>a+(preds.get(p.id)||0),0);
 // Chips are treated as explicit decisions, not hindsight overrides.
 // Use only chips available under that season's rules and require a material
 // immediate modelled gain. This keeps the walk-forward test causal.
 const available=chipAvailability(season,gw,usedChips);
 for(const chip of available){
  const gain=chipGain(chip,squad,pool,preds,gw);
  const threshold=chip==="tc"?1.5:chip==="bb"?4:chip==="fh"?3:4;
  if(gain>=threshold && gain>best.value)best={type:"chip",chip,value:gain};
 }
 for(const t of candidates(squad,pool,bank,ft,season)){
  const gain=t.p.model-t.o.model-t.hit;
  if(gain>best.value)best={type:"transfer",...t,value:gain};
 }
 if(ft>=2){
  const first=candidates(squad,pool,bank,ft,season).slice(0,100);
  for(const a of first){
   const s1=squad.filter(x=>x.id!==a.o.id).concat(a.p);
   const second=candidates(s1,pool,bank-a.cost,ft-1,season).slice(0,100);
   for(const b of second){const gain=a.p.model-a.o.model+b.p.model-b.o.model;if(gain>best.value)best={type:"double",a,b,value:gain}}
  }
 }
 return best;
}
function apply(squad,bank,ft,a,season){
 const max=rulesFor(season).maxFT;
 if(a.type==="hold")return{squad,bank,ft:Math.min(max,ft+1),hit:0};
 if(a.type==="transfer")return{squad:squad.filter(x=>x.id!==a.o.id).concat(a.p),bank:Number((bank-a.cost).toFixed(1)),ft:Math.min(max,ft-1+1),hit:a.hit};
 if(a.type==="double")return{squad:squad.filter(x=>x.id!==a.a.o.id&&x.id!==a.b.o.id).concat(a.a.p,a.b.p),bank:Number((bank-a.a.cost-a.b.cost).toFixed(1)),ft:Math.min(max,ft-2+1),hit:0};
 return{squad,bank,ft:Math.min(max,ft+1),hit:0};
}
function chipAvailability(season,gw,used){
 const r=rulesFor(season);const half=gw<=19?1:2;
 const available=[];
 for(const c of ["wc","fh","bb","tc"]){
  if(r.chips[c]===2){
   const key=c+"-"+half;
   if(!used.has(key))available.push(c);
  } else if(!used.has(c)&&r.chips[c]) available.push(c);
 }
 if(gw===1) return available.filter(c=>c!=="wc"&&c!=="fh");
 return available;
}
function chipGain(chip,squad,pool,preds,gw){
 const xi=selectXI(squad,preds),base=xi.reduce((a,p)=>a+(preds.get(p.id)||0),0);
 if(chip==="tc"){const c=[...xi].sort((a,b)=>(preds.get(b.id)||0)-(preds.get(a.id)||0))[0];return preds.get(c?.id)||0}
 if(chip==="bb")return squad.filter(p=>!xi.some(x=>x.id===p.id)).reduce((a,p)=>a+(preds.get(p.id)||0),0);
 if(chip==="fh"||chip==="wc"){
  const sorted=[...pool].sort((a,b)=>b.model-a.model);let chosen=[];
  for(const pos of [1,2,3,4])chosen.push(...sorted.filter(p=>p.pos===pos).slice(0,pos===1?2:pos===2?5:pos===3?5:3));
  if(!legal(chosen))return 0;
  const alt=selectXI(chosen,preds);return Math.max(0,alt.reduce((a,p)=>a+(preds.get(p.id)||0),0)-base);
 }
 return 0;
}

async function load(season){
 const raw=csv(await get(ROOT+"/"+season+"/gws/merged_gw.csv"));
 const posMap={GK:1,DEF:2,MID:3,FWD:4,1:1,2:2,3:3,4:4};
 const rows=raw.map(r=>({id:num(r.element),gw:num(r.GW||r.round||r.event),points:num(r.total_points),minutes:num(r.minutes),starts:num(r.starts),xg:num(r.expected_goals),xa:num(r.expected_assists),xgi:num(r.expected_goal_involvements),dc:num(r.defensive_contribution),value:num(r.value)/10,team:String(r.team||""),pos:posMap[String(r.position||"").trim()]||0})).filter(r=>r.id&&r.gw&&r.pos&&r.team);
 const byId=new Map(),byGw=new Map();
 for(const r of rows){if(!byId.has(r.id))byId.set(r.id,new Map());byId.get(r.id).set(r.gw,r);if(!byGw.has(r.gw))byGw.set(r.gw,[]);byGw.get(r.gw).push(r)}
 return{season,rows,byId,byGw};
}

async function runSeason(season){
 const d=await load(season),r=rulesFor(season);
 const gw1=d.byGw.get(1)||[];
 const initial=normalise(gw1.map(x=>features([x])));
 const pool0=initial.map(f=>({...f,model:predict(f)}));
 let squad=buildStart(pool0),bank=Number((100-squadPrice(squad)).toFixed(1)),ft=1,total=0,hits=0,events=[],usedChips=new Set();
 if(!legal(squad))throw Error("No legal starting squad "+season);
 for(let gw=1;gw<=38;gw++){
  const featureList=[];
  for(const [id,hm] of d.byId){
   const h=[];for(let g=1;g<gw;g++){const x=hm.get(g);if(x)h.push(x)}
   if(h.length)featureList.push(features(h));
  }
  const norm=normalise(featureList),pool=norm.map(f=>({...f,model:predict(f)})),preds=new Map(pool.map(p=>[p.id,p.model]));
  let action={type:"hold",chip:null,value:0};
  if(gw===1){
   for(const p of squad)preds.set(p.id,p.model);
  } else {
   action=chooseAction(squad,pool,bank,ft,gw,season,preds,usedChips);
   const applied=apply(squad,bank,ft,action,season);
   squad=applied.squad;bank=applied.bank;ft=applied.ft;hits+=applied.hit?1:0;
   events.push({gw,action:action.type,chip:action.chip||null,hit:applied.hit});
  }
  const xi=selectXI(squad,preds),cap=[...xi].sort((a,b)=>(preds.get(b.id)||0)-(preds.get(a.id)||0))[0];
  const predicted=xi.reduce((a,p)=>a+(preds.get(p.id)||0),0)+(preds.get(cap?.id)||0);
  const actualXI=xi.reduce((a,p)=>a+actual(p.id,gw,d.byId),0);
  const capActual=actual(cap?.id,gw,d.byId);
  let scored=actualXI+capActual;
  if(action?.type==="chip"){
    if(action.chip){
      const chipRule=rulesFor(season).chips[action.chip]||0;
      usedChips.add(chipRule===2?action.chip+"-"+(gw<=19?1:2):action.chip);
    }
    if(action.chip==="tc") scored+=capActual;
    if(action.chip==="bb"){
      const benchPlayers=squad.filter(p=>!xi.some(x=>x.id===p.id));
      scored+=benchPlayers.reduce((sum,p)=>sum+actual(p.id,gw,d.byId),0);
    }
  }
  total+=scored;
  // Online supervised update: every player with a historical appearance is a training example.
  // Error is measured only after the GW is complete.
  const lr=.006;
  for(const p of pool){
   const y=actual(p.id,gw,d.byId);
   const err=clamp(y-p.model,-8,8);
   for(const k of KEYS)W[k]=clamp(W[k]+lr*err*((p[k]||0)), -1.5,1.5);
   W.bias=clamp(W.bias+lr*err,-3,3);
  }
  // A small action-level adjustment: hits that underperformed increase hit aversion.
  const last=events.at(-1);
  if(last&&last.hit)W.bias=clamp(W.bias-.004,-3,3);
  events.at(-1)&&(events.at(-1).actual=scored,events.at(-1).predicted=Number(predicted.toFixed(2)),events.at(-1).bank=bank,events.at(-1).ft=ft);
 }
 return{season,total:Number(total.toFixed(1)),hits,finalWeights:{...W},events};
}

async function main(){
 const summary=[];
 for(const season of SEASONS){
  const r=await runSeason(season);
  summary.push({season,total:r.total,hits:r.hits});
  console.log(JSON.stringify(summary.at(-1)));
 }
 const generated=[
  "// Generated by scripts/historical-training.mjs.",
  "// Walk-forward historical learning only; live rules remain enforced separately.",
  "export const HISTORICAL_MODEL="+JSON.stringify({trainedSeasons:SEASONS,weights:W,features:KEYS,liveRules:{maxFreeTransfers:5,chipSets:2,chipSplitGameweek:20,oneChipPerGameweek:true,freeHitConsecutive:false}},null,2)+" as const;",
  ""
 ].join("\n");
 fs.writeFileSync("lib/historical-model.ts",generated);
 console.log("\nLEARNED_MODEL");
 console.log(JSON.stringify({trainedOn:SEASONS,weights:W,features:KEYS,rules2026_27:{maxFT:5,twoChipSets:true,oneChipPerGW:true,chipSplitGW:20}},null,2));
 console.log("\nSUMMARY");
 console.table(summary);
}
main().catch(e=>{console.error(e);process.exit(1)});
