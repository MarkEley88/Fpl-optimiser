#!/usr/bin/env node
/*
  FPL Optimiser historical walk-forward backtest.

  Data source:
    vaastav/Fantasy-Premier-League
  We deliberately DO NOT use the dataset's xP field: the dataset documents that
  xP can contain post-match information and therefore creates look-ahead bias.

  The test asks a simple question first: can the information available BEFORE a
  deadline rank the players who actually score well in the following GW?

  It then tunes a small, interpretable linear model on earlier seasons and
  evaluates it on a held-out season. This is a guardrail against overfitting.
*/

const ROOT="https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data";
const SEASONS=["2022-23","2023-24","2024-25","2025-26"];

function csv(text){
  const rows=[]; let row=[], cell="", quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i], nx=text[i+1];
    if(quoted){
      if(ch==='"'&&nx==='"'){cell+='"';i++}
      else if(ch==='"') quoted=false;
      else cell+=ch;
    }else{
      if(ch==='"') quoted=true;
      else if(ch===','){row.push(cell);cell=""}
      else if(ch==='\n'){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell=""}
      else cell+=ch;
    }
  }
  if(cell.length||row.length){row.push(cell);rows.push(row)}
  const head=rows.shift();
  return rows.filter(r=>r.length===head.length).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]])));
}
const n=(v,d=0)=>{const x=Number(v);return Number.isFinite(x)?x:d};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const z=(x,mu,sd)=>sd?((x-mu)/sd):0;

async function loadSeason(season){
  const url=ROOT+"/"+season+"/gws/merged_gw.csv";
  const r=await fetch(url); if(!r.ok) throw new Error("Download failed "+season+" "+r.status);
  const rows=csv(await r.text());
  return rows.map(r=>({
    element:n(r.element),event:n(r.round||r.event),points:n(r.total_points),
    minutes:n(r.minutes),starts:n(r.starts),price:n(r.value),
    xg:n(r.expected_goals),xa:n(r.expected_assists),xgi:n(r.expected_goal_involvements),
    pos:n(r.position),team:n(r.team),home:n(r.was_home)===1||r.was_home==="true",
    opponent:n(r.opponent_team)
  })).filter(r=>r.element&&r.event);
}

function features(history){
  const rows=history;
  const mins=rows.reduce((s,r)=>s+r.minutes,0);
  const starts=rows.reduce((s,r)=>s+r.starts,0);
  const last=rows.slice(-3), last5=rows.slice(-5);
  const points90=mins?rows.reduce((s,r)=>s+r.points,0)/(mins/90):0;
  const xgi90=mins?rows.reduce((s,r)=>s+r.xgi,0)/(mins/90):0;
  const xg90=mins?rows.reduce((s,r)=>s+r.xg,0)/(mins/90):0;
  const xa90=mins?rows.reduce((s,r)=>s+r.xa,0)/(mins/90):0;
  return {
    form3:mean(last.map(r=>r.points)),
    form5:mean(last5.map(r=>r.points)),
    points90, xgi90, xg90, xa90,
    startRate:starts/Math.max(1,rows.length),
    minuteRate:mins/(90*Math.max(1,rows.length)),
    value:rows.at(-1)?.price||0,
    position:rows.at(-1)?.pos||0
  };
}

function percentile(rows,key){
  const vals=rows.map(r=>r.f[key]).sort((a,b)=>a-b);
  return x=>{let lo=0,hi=vals.length;while(lo<hi){const m=(lo+hi)>>1;if(vals[m]<x)lo=m+1;else hi=m}return vals.length?lo/(vals.length-1||1):0};
}

function normalise(rows){
  const keys=["form3","form5","points90","xgi90","xg90","xa90","startRate","minuteRate","value"];
  const stats={};
  for(const k of keys){
    const a=rows.map(r=>r.f[k]),mu=mean(a),sd=Math.sqrt(mean(a.map(x=>(x-mu)**2)))||1;
    stats[k]=[mu,sd];
  }
  for(const r of rows) for(const k of keys) r.f[k+"Z"]=z(r.f[k],...stats[k]);
  return rows;
}

function score(f,w){
  return w.form3*f.form3Z+w.form5*f.form5Z+w.points90*f.points90Z+
    w.xgi90*f.xgi90Z+w.xg90*f.xg90Z+w.xa90*f.xa90Z+
    w.startRate*f.startRateZ+w.minuteRate*f.minuteRateZ+w.value*f.valueZ;
}

function evaluate(seasonRows,w){
  const byPlayer=new Map(), results=[];
  for(const r of seasonRows){
    if(!byPlayer.has(r.element))byPlayer.set(r.element,[]);
    const h=byPlayer.get(r.element);
    if(r.event>=6 && h.length>=3){
      const f=features(h);
      results.push({element:r.element,event:r.event,actual:r.points,price:r.price,position:r.pos,f});
    }
    h.push(r);
  }
  let corrSum=0,top10Hits=0,top10N=0;
  const byGw=new Map();
  for(const r of results){if(!byGw.has(r.event))byGw.set(r.event,[]);byGw.get(r.event).push(r)}
  for(const [gw,rows] of byGw){
    normalise(rows);
    rows.sort((a,b)=>score(b.f,w)-score(a.f,w));
    const top=rows.slice(0,10);
    top10Hits+=top.filter(x=>x.actual>=5).length; top10N+=top.length;
    const a=rows.map(x=>x.actual), b=rows.map(x=>score(x.f,w));
    const ma=mean(a),mb=mean(b);
    const cov=mean(a.map((x,i)=>(x-ma)*(b[i]-mb)));
    const sa=Math.sqrt(mean(a.map(x=>(x-ma)**2))),sb=Math.sqrt(mean(b.map(x=>(x-mb)**2)));
    if(sa&&sb)corrSum+=cov/(sa*sb);
  }
  const nGw=byGw.size;
  return {corr:nGw?corrSum/nGw:0,top10HitRate:top10N?top10Hits/top10N:0,gws:nGw};
}

const BASE={form3:.25,form5:.15,points90:.15,xgi90:.20,xg90:.05,xa90:.05,startRate:.07,minuteRate:.06,value:.02};

function mutate(w,key,delta){
  const x={...w};x[key]=clamp(x[key]+delta,0,0.8);return x;
}
function tune(train){
  let w={...BASE},best=-Infinity;
  const keys=Object.keys(w);
  for(let pass=0;pass<4;pass++){
    for(const k of keys){
      for(const d of [-.08,-.04,-.02,.02,.04,.08]){
        const t=mutate(w,k,d);
        const vals=train.map(s=>evaluate(s,t).corr);
        const avg=mean(vals);
        if(avg>best){best=avg;w=t}
      }
    }
  }
  return w;
}

async function main(){
  const data={};
  for(const s of SEASONS){console.log("Loading",s);data[s]=await loadSeason(s);console.log(" ",data[s].length,"rows")}
  const train=SEASONS.slice(0,3).map(s=>data[s]);
  const holdout=data["2025-26"];
  const tuned=tune(train);
  const baseline=SEASONS.map(s=>({season:s,...evaluate(data[s],BASE)}));
  const tunedScores=SEASONS.map(s=>({season:s,...evaluate(data[s],tuned)}));
  console.log("\nBASELINE");
  console.table(baseline);
  console.log("\nTUNED WALK-FORWARD MODEL (trained only on 22/23-24/25)");
  console.table(tunedScores);
  console.log("\nTUNED WEIGHTS");
  console.log(JSON.stringify(tuned,null,2));
  console.log("\nHOLDOUT DELTA 2025-26");
  const b=baseline.at(-1),t=tunedScores.at(-1);
  console.log(JSON.stringify({correlationDelta:t.corr-b.corr,top10HitRateDelta:t.top10HitRate-b.top10HitRate},null,2));
}
main().catch(e=>{console.error(e);process.exit(1)});
