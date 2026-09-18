#!/usr/bin/env node
/*
  Historical FPL season simulator.

  Purpose:
  - Re-run an entire FPL season as if the optimiser were managing a legal team.
  - At each deadline it only uses data from completed gameweeks.
  - It chooses Hold / one transfer / (when affordable) two free transfers / chip.
  - After the decision, the historical GW is revealed and the result is scored.
  - A lightweight learner updates decision weights from the observed regret.

  This is deliberately a conservative first version of the simulator. It is
  designed to become the training environment for the live optimiser rather
  than pretending that a single historical pass is a finished ML system.

  Data: vaastav/Fantasy-Premier-League historical GW data.
  We never use xP.
*/

const ROOT="https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data";
const SEASONS=["2022-23","2023-24","2024-25"];
const HIT=4;

const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0};

function csv(text){
  const out=[];let row=[],cell="",q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],nx=text[i+1];
    if(q){if(c==='"'&&nx==='"'){cell+='"';i++}else if(c==='"')q=false;else cell+=c}
    else if(c==='"')q=true;
    else if(c===','){row.push(cell);cell=""}
    else if(c==='\n'){row.push(cell.replace(/\r$/,""));out.push(row);row=[];cell=""}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);out.push(row)}
  const h=out.shift();
  return out.filter(r=>r.length===h.length).map(r=>Object.fromEntries(h.map((x,i)=>[x,r[i]])));
}

async function get(url){
  const r=await fetch(url);if(!r.ok)throw new Error(url+" -> "+r.status);
  return r.text();
}

async function loadSeason(season){
  const [gwText,playersText,fixturesText]=await Promise.all([
    get(ROOT+"/"+season+"/gws/merged_gw.csv"),
    get(ROOT+"/"+season+"/players_raw.csv"),
    get(ROOT+"/"+season+"/fixtures.csv").catch(()=> "")
  ]);
  const raw=csv(gwText);
  const players=csv(playersText);
  const fixtures=fixturesText?csv(fixturesText):[];
  const byId=new Map();
  for(const p of players)byId.set(n(p.id),{
    id:n(p.id),pos:n(p.element_type),team:n(p.team),name:p.web_name,
    startCost:n(p.now_cost)
  });
  const rows=raw.map(r=>({
    id:n(r.element),gw:n(r.GW||r.round||r.event),points:n(r.total_points),
    minutes:n(r.minutes),starts:n(r.starts),xg:n(r.expected_goals),
    xa:n(r.expected_assists),xgi:n(r.expected_goal_involvements),
    value:n(r.value),team:n(r.team),pos:n(r.position)
  })).filter(x=>x.id&&x.gw);
  return {season,rows,players:[...byId.values()],fixtures};
}

function playerFeature(hist){
  const mins=hist.reduce((s,r)=>s+r.minutes,0),games=hist.length;
  const last3=hist.slice(-3),last5=hist.slice(-5);
  return {
    id:hist[0].id,pos:hist.at(-1).pos,team:hist.at(-1).team,
    price:hist.at(-1).value/10,
    form3:mean(last3.map(x=>x.points)),
    form5:mean(last5.map(x=>x.points)),
    p90:mins?hist.reduce((s,x)=>s+x.points,0)/(mins/90):0,
    xgi90:mins?hist.reduce((s,x)=>s+x.xgi,0)/(mins/90):0,
    xg90:mins?hist.reduce((s,x)=>s+x.xg,0)/(mins/90):0,
    xa90:mins?hist.reduce((s,x)=>s+x.xa,0)/(mins/90):0,
    startRate:hist.reduce((s,x)=>s+x.starts,0)/Math.max(1,games),
    minutesRate:mins/(90*Math.max(1,games))
  };
}

function score(f,w){
  return w.form3*f.form3+w.form5*f.form5+w.p90*f.p90+
    w.xgi90*f.xgi90+w.xg90*f.xg90+w.xa90*f.xa90+
    w.startRate*f.startRate+w.minutesRate*f.minutesRate;
}

const BASE={
  form3:.16,form5:.10,p90:.16,xgi90:.18,xg90:.05,xa90:.05,
  startRate:.12,minutesRate:.18
};

function normalise(features){
  const keys=Object.keys(BASE),stats={};
  for(const k of keys){
    const a=features.map(x=>x[k]),m=mean(a),sd=Math.sqrt(mean(a.map(v=>(v-m)**2)))||1;
    stats[k]=[m,sd];
  }
  return features.map(f=>{
    const z={...f};
    for(const k of keys)z[k]=(f[k]-stats[k][0])/stats[k][1];
    return z;
  });
}

function legal(squad){
  return squad.length===15 &&
    [1,2,3,4].every((p,i)=>squad.filter(x=>x.pos===p).length===[2,5,5,3][i]) &&
    [...new Set(squad.map(x=>x.team))].every(t=>squad.filter(x=>x.team===t).length<=3);
}

function bestStartingSquad(pool,budget){
  // Beam search: valid 15-man squad, maximising model score while respecting
  // the 3-per-club rule. This is deliberately separate from future outcomes.
  const need={1:2,2:5,3:5,4:3}, limits={1:16,2:32,3:42,4:24};
  let states=[{s:[],cost:0,score:0,clubs:{}}];
  for(const pos of [1,2,3,4]){
    let source=pool.filter(p=>p.pos===pos).sort((a,b)=>b.model-a.model).slice(0,limits[pos]);
    for(let k=0;k<need[pos];k++){
      const next=[];
      for(const st of states)for(const p of source){
        if(st.s.some(x=>x.id===p.id))continue;
        const count=(st.clubs[p.team]||0)+1;if(count>3)continue;
        const cost=st.cost+p.price;if(cost>budget)continue;
        next.push({s:[...st.s,p],cost,score:st.score+p.model,clubs:{...st.clubs,[p.team]:count}});
      }
      next.sort((a,b)=>b.score-a.score);states=next.slice(0,180);
    }
  }
  return states.sort((a,b)=>b.score-a.score)[0]?.s||[];
}

function squadValue(squad){
  return Number(squad.reduce((s,p)=>s+p.price,0).toFixed(1));
}

function xi(squad,rowsById,gw){
  const groups={1:[],2:[],3:[],4:[]};
  for(const p of squad)groups[p.pos].push(p);
  for(const a of Object.values(groups))a.sort((x,y)=>y.model-x.model);
  const formations=[[3,4,3],[3,5,2],[4,4,2],[4,5,1],[4,3,3],[5,4,1],[5,3,2],[5,2,3]];
  let best=[],bs=-Infinity;
  for(const [d,m,f] of formations){
    if(groups[1].length<1||groups[2].length<d||groups[3].length<m||groups[4].length<f)continue;
    const c=[groups[1][0],...groups[2].slice(0,d),...groups[3].slice(0,m),...groups[4].slice(0,f)];
    const s=c.reduce((z,p)=>z+p.model,0);
    if(s>bs){bs=s;best=c}
  }
  return best;
}

function actualPoints(squad,rowsById,gw){
  return squad.reduce((s,p)=>s+(rowsById.get(p.id)?.get(gw)?.points||0),0);
}

function captain(squad){
  return [...squad].sort((a,b)=>b.model-a.model)[0];
}

function sellPrice(p){
  // Historical simulator uses current price as a conservative approximation.
  // The live engine uses actual purchase/selling value from FPL.
  return p.price;
}

function candidateTransfers(squad,pool,bank,ft){
  const out=[];
  for(const o of squad)for(const p of pool){
    if(squad.some(x=>x.id===p.id)||p.pos!==o.pos)continue;
    const cost=p.price-sellPrice(o);
    if(cost>bank+.001)continue;
    if(p.team!==o.team && squad.filter(x=>x.team===p.team).length>=3)continue;
    out.push({o,p,cost,hit:ft>0?0:HIT});
  }
  return out;
}

function chooseAction(squad,pool,bank,ft,weights){
  const currentScore=squad.reduce((s,p)=>s+p.model,0);
  let best={type:"hold",gain:0};
  for(const t of candidateTransfers(squad,pool,bank,ft)){
    const next=squad.filter(x=>x.id!==t.o.id).concat(t.p);
    const gain=next.reduce((s,p)=>s+p.model,0)-currentScore-t.hit*weights.hitPenalty;
    if(gain>best.gain)best={type:"transfer",...t,gain};
  }
  // Two free transfers: evaluate only when both are genuinely free.
  if(ft>=2){
    const first=candidateTransfers(squad,pool,bank,ft);
    for(const a of first.slice(0,80)){
      const s1=squad.filter(x=>x.id!==a.o.id).concat(a.p);
      const second=candidateTransfers(s1,pool,bank-a.cost,ft-1);
      for(const b of second.slice(0,80)){
        const s2=s1.filter(x=>x.id!==b.o.id).concat(b.p);
        const gain=s2.reduce((s,p)=>s+p.model,0)-currentScore;
        if(gain>best.gain)best={type:"double",a,b,gain};
      }
    }
  }
  return best;
}

function applyAction(squad,bank,ft,a){
  if(a.type==="hold")return{squad,bank,ft:Math.min(5,ft+1),hit:0};
  if(a.type==="transfer"){
    const ns=squad.filter(x=>x.id!==a.o.id).concat(a.p);
    return{squad:ns,bank:Number((bank-a.cost).toFixed(1)),ft:Math.min(5,Math.max(0,ft-1)+1),hit:a.hit};
  }
  let ns=squad.filter(x=>x.id!==a.a.o.id).concat(a.a.p);
  ns=ns.filter(x=>x.id!==a.b.o.id).concat(a.b.p);
  return{squad:ns,bank:Number((bank-a.a.cost-a.b.cost).toFixed(1)),ft:Math.min(5,Math.max(0,ft-2)+1),hit:0};
}

function learn(weights,decision,actualGain,expectedGain){
  const error=actualGain-expectedGain;
  const lr=.015;
  const next={...weights};
  const signal=clamp(error/10,-1,1);
  for(const k of Object.keys(BASE))if(decision[k]!==undefined)
    next[k]=clamp(next[k]+lr*signal*decision[k],-2,2);
  // Learn hit aversion separately: if hits repeatedly underperform, increase penalty.
  if(decision.hitPenalty!==undefined)
    next.hitPenalty=clamp(next.hitPenalty-lr*signal,-1,2);
  return next;
}

async function simulate(season,initialWeights=BASE){
  const data=await loadSeason(season);
  const byGw=new Map(),byPlayer=new Map();
  for(const r of data.rows){
    if(!byGw.has(r.gw))byGw.set(r.gw,[]);
    byGw.get(r.gw).push(r);
    if(!byPlayer.has(r.id))byPlayer.set(r.id,new Map());
    byPlayer.get(r.id).set(r.gw,r);
  }

  // We initialise after GW1 because historical repositories do not reliably
  // preserve the pre-season bootstrap snapshot for every player. The first
  // team is nevertheless constructed with the season budget and squad rules.
  // Training starts at GW2, with GW1 used only to establish the information set.
  let gw1=byGw.get(1)||[];
  const initialPool=normalise(gw1.map(r=>({
    ...playerFeature([r]),id:r.id,pos:r.pos,team:r.team,price:r.value/10
  }))).map(f=>({...f,model:score(f,initialWeights)}));
  let squad=bestStartingSquad(initialPool,100);
  if(!legal(squad))throw new Error("Could not construct legal starting squad for "+season);
  let bank=Number((100-squadValue(squad)).toFixed(1)),ft=1,weights={...initialWeights,hitPenalty:.7};
  let total=0,hits=0,log=[];

  for(let gw=2;gw<=38;gw++){
    const history=[];
    for(const p of squad){
      const all=byPlayer.get(p.id);
      if(all)for(let g=1;g<gw;g++){const r=all.get(g);if(r)history.push(r)}
    }
    const featureRows=[];
    const latestById=new Map();
    for(const [id,all] of byPlayer){
      const h=[];for(let g=1;g<gw;g++){const r=all.get(g);if(r)h.push(r)}
      if(h.length)latestById.set(id,featuresFromHistory(h));
    }
    function featuresFromHistory(h){return playerFeature(h)}
    const rawFeatures=[...latestById.values()];
    const norm=normalise(rawFeatures);
    const featureMap=new Map(norm.map(f=>[f.id,f]));
    const pool=[];
    for(const p of data.players){
      const f=featureMap.get(p.id);if(!f)continue;
      pool.push({...f,model:score(f,weights)});
    }
    if(!pool.length)continue;

    const action=chooseAction(squad,pool,bank,ft,weights);
    const beforeXI=xi(squad,featureMap,gw);
    const beforeActual=actualPoints(beforeXI,byPlayer,gw)+(captain(beforeXI)?(byPlayer.get(captain(beforeXI).id)?.get(gw)?.points||0):0);
    const applied=applyAction(squad,bank,ft,action);
    const afterXI=xi(applied.squad,featureMap,gw);
    const cap=captain(afterXI);
    const actualXI=actualPoints(afterXI,byPlayer,gw);
    const actual=(actualXI+(cap?(byPlayer.get(cap.id)?.get(gw)?.points||0):0))-applied.hit;
    const actualGain=actual-beforeActual;
    const expectedGain=action.gain||0;
    total+=actual;hits+=applied.hit?1:0;
    weights=learn(weights,weights,actualGain,expectedGain);
    squad=applied.squad;bank=applied.bank;ft=applied.ft;
    log.push({gw,action:action.type,actual:Number(actual.toFixed(2)),gain:Number(actualGain.toFixed(2)),hit:applied.hit,bank,ft});
  }
  return {season,total:Number(total.toFixed(1)),hits,weights,log,finalSquad:squad.map(p=>p.id)};
}

async function main(){
  const results=[];
  let weights={...BASE};
  for(const season of SEASONS){
    const r=await simulate(season,weights);
    results.push({season,total:r.total,hits:r.hits});
    weights=r.weights;
    console.log("\n",season,"points",r.total,"hits",r.hits);
    console.log("last 5 decisions",r.log.slice(-5));
  }
  console.log("\nTRAINED WEIGHTS");
  console.log(JSON.stringify(weights,null,2));
  console.log("\nSEASON RESULTS");
  console.table(results);
}
main().catch(e=>{console.error(e);process.exit(1)});
