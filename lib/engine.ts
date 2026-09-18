import {HISTORICAL_MODEL} from "./historical-model";
export type Player=any;

const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
const FORMATIONS=[[3,4,3],[3,5,2],[4,4,2],[4,5,1],[4,3,3],[5,4,1],[5,3,2],[5,2,3]];
const HALF=(gw:number)=>gw<=19?1:2;
const CHIP_NAMES=["wildcard","freehit","bboost","3xc"];

function fixtureScore(f:any,teamId:number){
  if(!f)return .5;
  const home=f.team_h===teamId;
  const venue=home?1.05:.95;
  // Do not use FPL's FDR. The optimiser uses the live league table position
  // and live team form supplied by the bootstrap-static API instead.
  const opponentRank=Number(home?f.team_a_rank:f.team_h_rank)||0;
  const teamRank=Number(home?f.team_h_rank:f.team_a_rank)||0;
  const rankFactor=opponentRank
    ? clamp(1-(10-opponentRank)*.012,.88,1.12)
    : 1;
  const teamForm=Number(home?f.team_h_form:f.team_a_form)||0;
  const opponentForm=Number(home?f.team_a_form:f.team_h_form)||0;
  const formFactor=teamForm||opponentForm
    ? clamp(1+(teamForm-opponentForm)*.018,.88,1.12)
    : 1;
  // Small team-strength adjustment from the same live table data.
  const teamRankFactor=teamRank
    ? clamp(1+(10-teamRank)*.006,.94,1.06)
    : 1;
  return clamp(venue*rankFactor*teamRankFactor*formFactor,.55,1.45);
}
function eventFixtures(team:number,fixtures:any[],gw:number){return fixtures.filter(f=>Number(f.event)===gw&&(f.team_h===team||f.team_a===team))}
function modelFeatures(p:any,currentGw=1){
  const mins=Math.max(1,Number(p.minutes||0)), gws=Math.max(1,currentGw);
  const p90=Number(p.total_points||p.points||0)/(mins/90);
  const xgi90=rate(p.expected_goal_involvements,mins,rate(Number(p.goals_scored||0)+Number(p.assists||0),mins));
  const xg90=rate(p.expected_goals,mins,rate(p.goals_scored,mins));
  const xa90=rate(p.expected_assists,mins,rate(p.assists,mins));
  const dc90=rate(p.defensive_contribution,mins);
  const gamesPlayed=Math.max(1,Number(p.appearances||p.minutes?1:0));
  return {
    form3:Number(p.form||0),form5:Number(p.form||0),p90,xgi90,xg90,xa90,dc90,
    bonus90:rate(p.bonus,mins),bps90:rate(p.bps,mins),ict90:rate(p.ict_index,mins),
    threat90:rate(p.threat,mins),creativity90:rate(p.creativity,mins),influence90:rate(p.influence,mins),
    goals90:rate(p.goals_scored,mins),assists90:rate(p.assists,mins),saves90:rate(p.saves,mins),
    cleanSheetRate:Number(p.clean_sheets||0)/Math.max(1,gws),startRate:Number(p.starts||0)/gws,
    minutesRate:mins/(90*gws),recentMinutesRate:Number(p.minutes||0)/(90*Math.max(1,gws))
  };
}
function normaliseModelPool(rows:any[]){
  const keys=["form3","form5","p90","xgi90","xg90","xa90","dc90","bonus90","bps90","ict90","threat90","creativity90","influence90","goals90","assists90","saves90","cleanSheetRate","startRate","minutesRate","recentMinutesRate"];
  const stats:any={};
  for(const k of keys){
    const vals=rows.map(x=>Number(x[k]||0)),mean=vals.reduce((a,b)=>a+b,0)/Math.max(1,vals.length);
    const sd=Math.sqrt(vals.reduce((a,v)=>a+(v-mean)**2,0)/Math.max(1,vals.length))||1;
    stats[k]=[mean,sd];
  }
  return rows.map(x=>({...x,...Object.fromEntries(keys.map(k=>[k,(Number(x[k]||0)-stats[k][0])/stats[k][1]]))}));
}
function historicalModelScore(p:any){
  const f=p.modelFeatures||{};
  const w=HISTORICAL_MODEL.weights;
  return Number(w.bias||0)+Object.entries(w).filter(([k])=>k!=="bias").reduce((s,[k,v])=>s+Number(v)*Number(f[k]||0),0);
}
function availabilityProb(p:any){
  const s=p.status,c=p.chance_of_playing_next_round;
  if(s==="i"||s==="s"||s==="u")return 0;
  if(c!==null&&c!==undefined)return clamp(Number(c)/100);
  return 1;
}
function startProbability(p:any){
  if(!availabilityProb(p))return 0;
  if(p.recentStartRate!==undefined){
    const recent=clamp(Number(p.recentStartRate||0));
    const season=Number(p.appearances||0)>0?clamp(Number(p.starts||0)/Number(p.appearances)):recent;
    const recentMinutes=clamp(Number(p.recentMinutesRate||0));
    return clamp(availabilityProb(p)*(.62*recent+.28*season+.10*recentMinutes),.02,.98);
  }
  const starts=Number(p.starts||0),apps=Number(p.appearances||0);
  if(!apps&&!starts)return .2*availabilityProb(p);
  const season=starts/Math.max(1,apps||starts);
  const minutesRate=Number(p.minutes||0)/(90*Math.max(1,apps||starts));
  return clamp(availabilityProb(p)*(.62*clamp(season)+.28*clamp(minutesRate)+.10),.02,.98);
}
function expectedMinutes(p:any){
  const start=startProbability(p),availability=availabilityProb(p);
  const startMinutes=Number(p.recentStartMinutes||0)||78;
  const benchMinutes=Number(p.recentBenchMinutes||0)||18;
  const benchAppear=availability*(1-start)*.72;
  return Math.round(start*startMinutes+benchAppear*benchMinutes);
}
function rate(total:any,minutes:number,fallback=0){const m=Math.max(1,minutes);return Number(total||0)/(m/90)}
function fixtureFactor(p:any,fixtures:any[],gw:number){
  const fs=eventFixtures(p.team,fixtures,gw);if(!fs.length)return 0;
  return fs.reduce((s,f)=>s+fixtureScore(f,p.team),0)/fs.length;
}
function expectedFixturePoints(p:any,f:any,minutes:number){
  const pos=Number(p.position??p.element_type),m=minutes/90,home=f.team_h===p.team;
  const ff=fixtureScore(f,p.team);
  const xg90=rate(p.expected_goals,p.minutes,rate(p.goals_scored,p.minutes));
  const xa90=rate(p.expected_assists,p.minutes,rate(p.assists,p.minutes));
  const g90=Math.max(.01,xg90)*(.78+.22*ff);
  const a90=Math.max(.01,xa90)*(.82+.18*ff);
  const goals=g90*m,assists=a90*m;
  const attack=pos===1?10:pos===2?6:pos===3?5:4;
  const assist=3*assists;
  const app=m>=.66?2:(m>.12?1:0);
  const csBase=pos===1||pos===2?.32:.10;
  const cs=clamp(csBase+(ff-1)*.23,.02,.72)*m*(pos===1||pos===2?4:1);
  const saves=pos===1?rate(p.saves,p.minutes)*m/3:0;
  const dcRate=rate(p.defensive_contribution,p.minutes);
  const dcThreshold=pos===2?10:12;
  const dc=pos===1?0:2*(1-Math.exp(-Math.max(0,dcRate*m)/(dcThreshold*.72)));
  const bonusRate=rate(p.bonus,p.minutes);
  const bonus=clamp(bonusRate*m*.22,0,2.1);
  const goalsPts=goals*attack;
  const concededPenalty=(pos===1||pos===2)?Math.max(0,(1.05-ff)*.8*m):0;
  const appearanceRisk=(1-availabilityProb(p))*.45;
  const cards=.18*m;
  return app+goalsPts+assist+cs+saves+dc+bonus-concededPenalty-appearanceRisk-cards;
}
export function projectPlayer(p:Player,fixtures:any[],horizon=7,currentGw=0){
  const games=fixtures.filter(f=>f.event&&Number(f.event)>=currentGw&&Number(f.event)<=horizon&&(f.team_h===p.team||f.team_a===p.team));
  const availability=availabilityProb(p),start=startProbability(p),mins=expectedMinutes(p),ppg=Number(p.points_per_game||0),form=Number(p.form||0),totalMinutes=Number(p.minutes||0);
  const xgi90=rate(p.expected_goal_involvements,totalMinutes,rate(Number(p.goals_scored||0)+Number(p.assists||0),totalMinutes));
  const ict90=rate(p.ict_index,totalMinutes),threat90=rate(p.threat,totalMinutes),creativity90=rate(p.creativity,totalMinutes);
  const bonus90=rate(p.bonus,totalMinutes),bps90=rate(p.bps,totalMinutes);
  const attackingSignal=xgi90*.48+rate(p.goals_scored,totalMinutes)*.16+rate(p.assists,totalMinutes)*.12+threat90*.015+creativity90*.008;
  const allRoundSignal=ict90*.012+bonus90*.08+bps90*.004+rate(p.defensive_contribution,totalMinutes)*.10;
  const per90=Math.max(0.05,(ppg/Math.max(.35,mins/90))*.38+attackingSignal*.42+allRoundSignal*.20);
  const historicalSignal=clamp(Number(p.historicalScore||0)*.55,-2,2);
  const recent=Math.max(0,form)*.18+Math.max(0,ppg)*.32+per90*.35+historicalSignal*.12;
  const fixtureAvg=games.length?games.reduce((s,f)=>s+fixtureScore(f,p.team),0)/games.length:1;
  const next=games.length?games[0]:null;
  // Upcoming fixtures are explicitly part of the transfer decision: every
  // fixture from the current GW through the 7-GW horizon is projected.
  const nextPts=next?Math.max(0,expectedFixturePoints(p,next,mins)):0;
  const expected=games.reduce((s,f)=>{
    const fs=eventFixtures(p.team,fixtures,Number(f.event));
    const em=expectedMinutes(p);
    return s+Math.max(0,expectedFixturePoints(p,f,em))*(fs.length>1?1.03:1);
  },0);
  const projection=clamp((nextPts*.58+recent*.42)*(.82+.18*fixtureAvg)*availability,0,20);
  return{
    id:p.id,name:p.web_name,team:p.team,position:p.element_type,price:Number(p.now_cost||0)/10,
    startProbability:Math.round(start*100),availabilityProbability:Math.round(availability*100),expectedMinutes:mins,fixtureScore:fixtureAvg,
    projected:Number(projection.toFixed(2)),projectedHorizon:Number(expected.toFixed(2)),
    xg90:Number(rate(p.expected_goals,p.minutes,rate(p.goals_scored,p.minutes)).toFixed(3)),
    xa90:Number(rate(p.expected_assists,p.minutes,rate(p.assists,p.minutes)).toFixed(3)),
    dc90:Number(rate(p.defensive_contribution,p.minutes).toFixed(2)),
    ceiling:Number((projection+(xgi90*2.2)+(Number(p.bonus||0)/Math.max(1,totalMinutes/90))*.4).toFixed(2)),
    status:p.status,chanceOfPlaying:p.chance_of_playing_next_round,news:p.news||"",
    modelFeatures:modelFeatures(p,currentGw),historicalScore:0,raw:p
  };
}
const posName=(p:number)=>({1:"Goalkeeper",2:"Defender",3:"Midfielder",4:"Forward"} as any)[p]||"Unknown";

function weekScore(p:any,fixtures:any[],gw:number){
  const fs=eventFixtures(p.team,fixtures,gw);if(!fs.length)return 0;
  const raw=p.raw||p;
  const minutes=Number(p.expectedMinutes||expectedMinutes(p));
  const scores=fs.map(f=>expectedFixturePoints({...raw,...p},f,minutes));
  const sum=scores.reduce((a,b)=>a+b,0);
  const hs=Number(p.historicalScore||0);
  const modelBase=clamp(2+hs*.55,0,10);
  const currentBase=Math.max(0,sum);
  const modelAdjusted=modelBase*fs.reduce((s,f)=>s+fixtureScore(f,p.team),0)/fs.length;
  return Number(Math.max(0,currentBase*.72+modelAdjusted*.28).toFixed(2));
}
function selectionScore(p:any,fixtures:any[],gw:number){
  const current=weekScore(p,fixtures,gw);
  const start=Number(p.startProbability||0)/100;
  const horizon=Number(p.projected||0);
  return current*1000 + start*10 + horizon*.01;
}
function buildXI(squad:any[],fixtures:any[],gw:number){
  const groups:any={1:[],2:[],3:[],4:[]};squad.forEach(x=>groups[x.player.position]?.push(x));
  Object.values(groups).forEach((a:any[])=>a.sort((x,y)=>selectionScore(y.player,fixtures,gw)-selectionScore(x.player,fixtures,gw)));
  let best:any[]=[],bestScore=-Infinity,formation="";
  for(const [d,m,f] of FORMATIONS){
    if(groups[1].length<1||groups[2].length<d||groups[3].length<m||groups[4].length<f)continue;
    const candidate=[...groups[1].slice(0,1),...groups[2].slice(0,d),...groups[3].slice(0,m),...groups[4].slice(0,f)];
    const score=candidate.reduce((s,x)=>s+selectionScore(x.player,fixtures,gw),0);
    if(score>bestScore){bestScore=score;best=candidate;formation="1-"+d+"-"+m+"-"+f}
  }
  return{xi:best,bestScore,formation};
}
function captainPlan(xi:any[],fixtures:any[],gw:number){
  const ranked=[...xi].map(x=>({...x,score:weekScore(x.player,fixtures,gw),ceiling:x.player.ceiling||0})).sort((a,b)=>(b.score+b.ceiling*.12)-(a.score+a.ceiling*.12));
  return{captain:ranked[0]?.player||null,vice:ranked[1]?.player||null,candidates:ranked.slice(0,5).map(x=>({name:x.player.name,id:x.player.id,score:x.score,ceiling:x.ceiling}))};
}
function clubCount(squad:any[],team:number){return squad.filter(x=>x.player.team===team).length}
function validSquad(squad:any[]){return squad.length===15&&squad.filter(x=>x.player.position===1).length===2&&squad.filter(x=>x.player.position===2).length===5&&squad.filter(x=>x.player.position===3).length===5&&squad.filter(x=>x.player.position===4).length===3&&[...new Set(squad.map(x=>x.player.team))].every(t=>clubCount(squad,Number(t))<=3)}
function getFT(history:any,currentGw=0,live:any=null){
  const rows=Array.isArray(history?.current)?history.current:[];
  const latest=rows.at(-1);
  const lastEvent=Number(latest?.event||0);
  const liveEvent=Number(live?.event||0);
  const liveTransfers=Number(live?.event_transfers||0);
  const liveAvailable=live?.event_transfers_available;
  // Prefer the live current-GW value when FPL exposes it.
  if(liveEvent===currentGw&&liveAvailable!==null&&liveAvailable!==undefined&&liveAvailable!==""){
    return Math.max(0,Math.min(5,Number(liveAvailable)));
  }
  // If the current picks feed knows how many transfers were made this GW,
  // derive the remaining balance from the previous completed row. This
  // distinguishes a transfer from a bench/starting XI change.
  if(liveEvent===currentGw&&live?.event_transfers!==null&&live?.event_transfers!==undefined){
    const prior=rows.filter((x:any)=>Number(x.event||0)<currentGw).at(-1);
    if(prior?.event_transfers_available!==null&&prior?.event_transfers_available!==undefined){
      return Math.max(0,Math.min(5,Number(prior.event_transfers_available)+1-liveTransfers));
    }
  }
  // Fallback when the history feed is one GW behind.
  if(lastEvent<currentGw&&latest?.event_transfers_available!==null&&latest?.event_transfers_available!==undefined){
    return Math.max(0,Math.min(5,Number(latest.event_transfers_available)+1));
  }
  if(latest?.event_transfers_available!==null&&latest?.event_transfers_available!==undefined){
    return Math.max(0,Math.min(5,Number(latest.event_transfers_available)));
  }
  return 1;
}
function chipUsed(history:any,chip:string,gw:number){
  const half=HALF(gw);
  return (history?.chips||[]).some((x:any)=>x.name===chip&&HALF(Number(x.event||gw))===half);
}
function freeHitBlocked(history:any,gw:number){
  return (history?.chips||[]).some((x:any)=>x.name==="freehit"&&Number(x.event||0)===gw-1);
}
function remainingChips(history:any,gw:number){
  return CHIP_NAMES.filter(c=>!chipUsed(history,c,gw));
}
function sellPrice(p:any){
  const current=Number(p.player?.price??p.price??0),purchase=Number(p.purchasePrice??p.purchase_price??current);
  if(current<=purchase)return current;
  return Number((purchase+Math.floor((current-purchase)*10/2)/10).toFixed(1));
}
function transferCost(o:any,inPlayer:any,bank:number){
  const sell=sellPrice(o);return Number((inPlayer.price-sell).toFixed(1));
}
function applyTransfer(squad:any[],t:any){
  return[...squad.filter(x=>x.player.id!==t.out.player.id),{
    element:t.in.id,player:t.in,purchasePrice:t.in.price,sellPrice:t.in.price
  }];
}
function multiWeekDelta(out:any,inP:any,fixtures:any[],startGw:number,horizon=5){
  let d=0;for(let g=startGw+1;g<=startGw+horizon;g++)d+=weekScore(inP,fixtures,g)-weekScore(out.player,fixtures,g);
  return d;
}
function makeCandidates(squad:any[],pool:any[],bank:number,fixtures:any[],startGw:number,horizon=5){
  const out:any[]=[];
  for(const o of squad)for(const p of pool){
    if(squad.some(x=>x.player.id===p.id))continue;
    const sell=sellPrice(o),cost=Number((p.price-sell).toFixed(1));
    if(cost>bank+.001)continue;
    if(clubCount(squad,p.team)>=3&&p.team!==o.player.team)continue;
    const trial=[...squad.filter(x=>x.player.id!==o.player.id),{element:p.id,player:p,purchasePrice:p.price,sellPrice:p.price}];
    const counts=[1,2,3,4].map(pos=>trial.filter(x=>Number(x.player.position)===pos).length);
    if(counts[0]!==2||counts[1]!==5||counts[2]!==5||counts[3]!==3)continue;
    const delta=multiWeekDelta(o,p,fixtures, startGw,horizon);
    out.push({out:o,in:p,cost,delta:Number(delta.toFixed(2))});
  }
  return out.sort((a,b)=>b.delta-a.delta);
}
function candidates(squad:any[],pool:any[],bank:number,fixtures:any[],startGw:number,horizon=5){
  return makeCandidates(squad,pool,bank,fixtures,startGw,horizon);
}
function strategicCandidates(squad:any[],pool:any[],bank:number,fixtures:any[],gw:number,ft:number){
  // Rank transfers by cumulative future points while enforcing the squad,
  // club, bank and free-transfer rules at the actual decision point.
  const horizon=Math.min(6,38-gw);
  const all=makeCandidates(squad,pool,bank,fixtures,gw-1,horizon);
  const rows=all.map(x=>{
    const hit=ft>0?0:4;
    let future=0;
    for(let g=gw;g<=Math.min(38,gw+5);g++){
      future+=weekScore(x.in,fixtures,g)-weekScore(x.out.player,fixtures,g);
    }
    return {...x,strategicDelta:Number((future-hit).toFixed(2)),hit};
  });
  return rows.sort((a,b)=>b.strategicDelta-a.strategicDelta);
}
function substitutionPlan(squad:any[],fixtures:any[],gw:number){
  const currentXI=squad.filter((x:any)=>Number(x.position)>=1&&Number(x.position)<=11);
  const currentBench=squad.filter((x:any)=>Number(x.position)>=12&&Number(x.position)<=15);
  const rows:any[]=[];
  if(currentXI.length!==11)return rows;
  for(const b of currentBench)for(const st of currentXI){
    if(Number(b.player.position)===1&&Number(st.player.position)!==1)continue;
    const trial=currentXI.map((x:any)=>x.player.id===st.player.id?{...x,player:b.player}:x);
    const counts=[1,2,3,4].map(pos=>trial.filter((x:any)=>Number(x.player.position)===pos).length);
    const legal=counts[0]===1&&counts[1]>=3&&counts[1]<=5&&counts[2]>=2&&counts[2]<=5&&counts[3]>=1&&counts[3]<=3;
    if(!legal)continue;
    const before=weekScore(st.player,fixtures,gw);
    const after=weekScore(b.player,fixtures,gw);
    const gain=after-before;
    if(gain<=.15)continue;
    rows.push({bench:b.player.name,starter:st.player.name,benchProjected:Number(after.toFixed(2)),starterProjected:Number(before.toFixed(2)),benchStart:b.player.startProbability,starterStart:st.player.startProbability,gain:Number(gain.toFixed(2)),formation:"1-"+counts[1]+"-"+counts[2]+"-"+counts[3],reason:"Legal change from your actual current XI; the replacement has a higher projected score and the resulting formation remains valid."});
  }
  return rows.sort((a,b)=>b.gain-a.gain).slice(0,5);
}
function transferIdeas(squad:any[],pool:any[],bank:number,fixtures:any[],gw:number){
  return candidates(squad,pool,bank,fixtures,gw,5).filter(x=>x.delta>0.35).slice(0,8).map(x=>({
    in:x.in.name,inId:x.in.id,out:x.out.player.name,outId:x.out.player.id,
    delta:x.delta,nextGwGain:Number((weekScore(x.in,fixtures,gw+1)-weekScore(x.out.player,fixtures,gw+1)).toFixed(2)),
    price:x.in.price,position:posName(x.in.position),cost:x.cost,
    reason:(x.delta>=4?"Strong 3-GW upgrade":x.delta>=2?"Good 3-GW upgrade":"Marginal upgrade")+"; "+(x.cost>0?"costs £"+x.cost.toFixed(1)+"m":"releases £"+Math.abs(x.cost).toFixed(1)+"m")
  }));
}
function scoreState(squad:any[],fixtures:any[],gw:number,chip:string|null){
  const built=buildXI(squad,fixtures,gw),cap=captainPlan(built.xi,fixtures,gw);
  let points=built.xi.reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0);
  if(cap.captain)points+=weekScore(cap.captain,fixtures,gw);
  if(chip==="3xc"&&cap.captain)points+=weekScore(cap.captain,fixtures,gw);
  if(chip==="bboost")points+=squad.filter(x=>!built.xi.some(y=>y.player.id===x.player.id)).reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0);
  return{points,xi:built.xi,formation:built.formation,cap};
}
function bestFutureCaptain(squad:any[],fixtures:any[],gw:number){
  const end=gw<=19?19:38; const rows:any[]=[];
  for(let g=gw+1;g<=end;g++){
    const built=buildXI(squad,fixtures,g),cap=captainPlan(built.xi,fixtures,g).captain;
    if(!cap)continue;
    const score=weekScore(cap,fixtures,g);
    rows.push({gw:g,score:Number(score.toFixed(2)),name:cap.name,double:eventFixtures(cap.team,fixtures,g).length>1});
  }
  return rows.sort((a,b)=>b.score-a.score)[0]||null;
}
function chipMetrics(squad:any[],fixtures:any[],gw:number){
  const doubles:any={};
  fixtures.filter(f=>Number(f.event)===gw).forEach(f=>{doubles[f.team_h]=(doubles[f.team_h]||0)+1;doubles[f.team_a]=(doubles[f.team_a]||0)+1});
  const doublePlayers=squad.filter(x=>(doubles[x.player.team]||0)>1).length;
  const built=buildXI(squad,fixtures,gw),bench=squad.filter(x=>!built.xi.some(y=>y.player.id===x.player.id));
  const cap=captainPlan(built.xi,fixtures,gw).captain;
  const base=scoreState(squad,fixtures,gw,null).points;
  const tc=cap?weekScore(cap,fixtures,gw):0;
  const bb=bench.reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0);
  const futureTC=bestFutureCaptain(squad,fixtures,gw);
  const currentDouble=cap?eventFixtures(cap.team,fixtures,gw).length>1:false;
  const tcOpportunity=Number((tc-(futureTC?.score||0)).toFixed(2));
  return{doublePlayers,benchScore:bb,captainScore:tc,base,tcGain:tc,bbGain:bb,currentDouble,futureTC,tcOpportunity};
}
function bestTemporarySquad(initial:any[],pool:any[],fixtures:any[],gw:number,budget:number){
  const byPos:any={1:[],2:[],3:[],4:[]};
  pool.forEach(p=>byPos[p.position]?.push(p));
  Object.values(byPos).forEach((a:any[])=>a.sort((x,y)=>weekScore(y,fixtures,gw+0)-weekScore(x,fixtures,gw+0)));
  const limits:any={1:18,2:35,3:45,4:25}; let beams:any=[{squad:[],cost:0,score:0,clubs:{}}];
  for(const pos of [1,2,3,4]){
    const need=pos===1?2:pos===2?5:pos===3?5:3,source=byPos[pos].slice(0,limits[pos]);
    let states=beams;
    for(let k=0;k<need;k++){
      const next:any[]=[];
      for(const st of states)for(const p of source){
        if(st.squad.some(x=>x.id===p.id))continue;
        const nc=Number((st.cost+p.price).toFixed(1));if(nc>budget+.001)continue;
        const count=(st.clubs[p.team]||0)+1;if(count>3)continue;
        next.push({squad:[...st.squad,p],cost:nc,score:st.score+weekScore(p,fixtures,gw),clubs:{...st.clubs,[p.team]:count}});
      }
      next.sort((a,b)=>b.score-a.score);states=next.slice(0,160);
    }
    beams=states;
  }
  const best=beams.filter(x=>x.squad.length===15).sort((a,b)=>b.score-a.score)[0];
  return best?.squad||initial.map(x=>x.player);
}
function chipDecision(chip:string,squad:any[],pool:any[],fixtures:any[],gw:number,history:any){
  const m=chipMetrics(squad,fixtures,gw);
  if(chip==="3xc")return m.tcGain;
  if(chip==="bboost")return m.bbGain;
  const budget=Number((squad.reduce((s,x)=>s+sellPrice(x),0)).toFixed(1));
  if(chip==="freehit"){
    const best=bestTemporarySquad(squad,pool,fixtures,gw,budget);
    return Math.max(0,scoreState(best.map(p=>({player:p})),fixtures,gw,null).points-m.base);
  }
  const rebuilt=bestTemporarySquad(squad,pool,fixtures,gw,budget);
  return Math.max(0,scoreState(rebuilt.map(p=>({player:p})),fixtures,gw,null).points-m.base);
}
function chipThreshold(chip:string){return chip==="3xc"?2.0:chip==="bboost"?5.0:chip==="freehit"?3.0:4.0}
function chipShouldPlay(chip:string,squad:any[],pool:any[],fixtures:any[],gw:number,history:any){
  if(chipUsed(history,chip,gw))return false;
  if(gw===1&&(chip==="wildcard"||chip==="freehit"))return false;
  if(chip==="freehit"&&freeHitBlocked(history,gw))return false;
  if(chip==="3xc"){
    const m=chipMetrics(squad,fixtures,gw);
    return m.currentDouble && m.tcGain>=chipThreshold(chip) && m.tcOpportunity>=1.5;
  }
  return chipDecision(chip,squad,pool,fixtures,gw,history)>=chipThreshold(chip);
}
function chipReason(chip:string,squad:any[],pool:any[],fixtures:any[],gw:number,history:any){
  const gain=chipDecision(chip,squad,pool,fixtures,gw,history);
  const tc=chip==="3xc"?chipMetrics(squad,fixtures,gw):null;
  if(chipShouldPlay(chip,squad,pool,fixtures,gw,history))return "Triple Captain: "+(tc?.currentDouble?"Double Gameweek":"strong opportunity")+". Expected captain score "+gain.toFixed(1)+"; best remaining benchmark "+(tc?.futureTC?.score??0).toFixed(1)+".";
  if(chip==="3xc"&&tc?.futureTC)return "Hold: expected captain score "+gain.toFixed(1)+"; best remaining projected opportunity is "+tc.futureTC.name+" in GW"+tc.futureTC.gw+" at "+tc.futureTC.score.toFixed(1)+" points." ;
  return "Hold: estimated immediate gain is only +"+gain.toFixed(1)+" points; the optimiser will keep the chip for a stronger opportunity.";
}
function improveSquad(initial:any[],pool:any[],fixtures:any[],gw:number,budget:number){
  const best=bestTemporarySquad(initial,pool,fixtures,gw,budget);
  const map=new Map(pool.map(p=>[p.id,p]));
  const squad=best.map((p:any)=>({element:p.id,player:map.get(p.id)||p,purchasePrice:p.price,sellPrice:p.price}));
  const cost=squad.reduce((s,x)=>s+x.player.price,0);
  return{squad,bank:Number((budget-cost).toFixed(1))};
}
function buildDecisionPlan(initial:any[],pool:any[],fixtures:any[],startGw:number,bank:number,history:any,live:any=null){
  let states:any[]=[{squad:initial,bank,ft:getFT(history,startGw,live),total:0,steps:[],usedChips:[] as string[]}];
  // Start with the current gameweek so the displayed FT balance is the
  // balance the manager actually has now. A free transfer is earned only
  // when moving into the following gameweek.
  for(let gw=startGw;gw<=Math.min(38,startGw+5);gw++){
    const next:any[]=[];
    for(const st of states){
      const earned=Math.min(5,st.ft+1);
      const base=scoreState(st.squad,fixtures,gw,null);
      next.push({...st,ft:earned,total:st.total+base.points,steps:[...st.steps,{gw,action:"Hold",chip:null,bank:st.bank,ft:st.ft,formation:base.formation,cap:base.cap,projectedGain:0}]});
      const cs=strategicCandidates(st.squad,pool,st.bank,fixtures,gw,st.ft)
        .filter((x:any)=>x.strategicDelta>0 && x.cost<=st.bank+.001)
        .slice(0,18);
      for(const c of cs){
        const hit=c.hit;
        const sq=applyTransfer(st.squad,c),nb=Number((st.bank-c.cost).toFixed(1)),gain=scoreState(sq,fixtures,gw,null),nf=Math.min(5,Math.max(0,st.ft-1)+1);
        next.push({...st,squad:sq,bank:nb,ft:nf,total:st.total+gain.points-hit,steps:[...st.steps,{gw,action:c.in.name+" for "+c.out.player.name+(hit?" (-4 points)":""),chip:null,bank:nb,ft:nf,formation:gain.formation,cap:gain.cap,projectedGain:Number((gain.points-base.points-hit).toFixed(2))}]});
      }
      if(st.ft>=2){
        for(const a of cs.slice(0,10)){
          const afterA=applyTransfer(st.squad,a);
          const bankAfterA=Number((st.bank-a.cost).toFixed(1));
          if(bankAfterA<-.001)continue;
          for(const b of candidates(afterA,pool,bankAfterA,fixtures,gw,3).slice(0,10)){
          const nb=Number((st.bank-a.cost-b.cost).toFixed(1));if(nb<-.001)continue;
          const sq=applyTransfer(applyTransfer(st.squad,a),b),gain=scoreState(sq,fixtures,gw,null);
          if(gain.points<=base.points)continue;
          const nf=Math.min(5,st.ft-2+1);
          next.push({...st,squad:sq,bank:nb,ft:nf,total:st.total+gain.points,steps:[...st.steps,{gw,action:a.in.name+" for "+a.out.player.name+" + "+b.in.name+" for "+b.out.player.name,chip:null,bank:nb,ft:nf,formation:gain.formation,cap:gain.cap,projectedGain:Number((gain.points-base.points).toFixed(2))}]});
          }
        }
      }
      for(const chip of CHIP_NAMES){
        if(st.usedChips.includes(chip)||chipUsed(history,chip,gw))continue;
        if(!chipShouldPlay(chip,st.squad,pool,fixtures,gw,history))continue;
        const gain=scoreState(st.squad,fixtures,gw,chip);
        if(chip==="wildcard"){
          const totalBudget=Number((st.bank+st.squad.reduce((s,x)=>s+sellPrice(x),0)).toFixed(1));
          const rebuilt=improveSquad(st.squad,pool,fixtures,gw,totalBudget),rg=scoreState(rebuilt.squad,fixtures,gw,null);
          if(rg.points>base.points){next.push({...st,squad:rebuilt.squad,bank:rebuilt.bank,ft:earned,total:st.total+rg.points,steps:[...st.steps,{gw,action:"Wildcard rebuild",chip:"Wildcard",bank:rebuilt.bank,ft:earned,formation:rg.formation,cap:rg.cap,projectedGain:Number((rg.points-base.points).toFixed(2))}],usedChips:[...st.usedChips,chip]})}
        }else if(chip==="freehit"){
          const totalBudget=Number((st.bank+st.squad.reduce((s,x)=>s+sellPrice(x),0)).toFixed(1));
          const best=bestTemporarySquad(st.squad,pool,fixtures,gw,totalBudget),tmp=best.map((p:any)=>({player:p}));
          const fg=scoreState(tmp,fixtures,gw,null);
          if(fg.points>base.points){next.push({...st,ft:earned,total:st.total+fg.points,steps:[...st.steps,{gw,action:"Free Hit squad",chip:"Free Hit",bank:st.bank,ft:earned,formation:fg.formation,cap:fg.cap,projectedGain:Number((fg.points-base.points).toFixed(2))}],usedChips:[...st.usedChips,chip]})}
        }else{
          next.push({...st,ft:earned,total:st.total+gain.points,steps:[...st.steps,{gw,action:"Hold",chip:chip==="bboost"?"Bench Boost":"Triple Captain",bank:st.bank,ft:earned,formation:gain.formation,cap:gain.cap,projectedGain:Number((gain.points-base.points).toFixed(2))}],usedChips:[...st.usedChips,chip]});
        }
      }
    }
    next.sort((a,b)=>b.total-a.total);states=next.slice(0,24);
  }
  return states[0]?.steps||[];
}
export async function optimiseSquad(picks:any[],elements:Player[],fixtures:any[],gw:number,bank=0,history:any=null,picksEntryHistory:any=null){
  const horizon=Math.min(38,gw+7);
  let pool=elements.map(p=>projectPlayer(p,fixtures,horizon,gw));
  // Enrich the current squad and the highest-value candidates with the live
  // element-summary history so starting probability reflects recent selection,
  // not just season-long starts. This runs on every optimisation.
  const priority=pool.slice().sort((a,b)=>weekScore(b,fixtures,gw)-weekScore(a,fixtures,gw));
  const ids=[...new Set([...picks.map((x:any)=>Number(x.element)),...priority.slice(0,80).map((x:any)=>Number(x.id))])].filter(Boolean).slice(0,95);
  if(ids.length){
    const summaries=await Promise.all(ids.map(async id=>{
      try{
        const r=await fetch("https://fantasy.premierleague.com/api/element-summary/"+id+"/",{cache:"no-store",headers:{"User-Agent":"FPL-Optimiser/0.3"}});
        if(!r.ok)return null;
        return{id,data:await r.json()};
      }catch{return null;}
    }));
    const byId=new Map(summaries.filter(Boolean).map((x:any)=>[x.id,x.data]));
    pool=pool.map(p=>{
      const h=(byId.get(Number(p.id))?.history||[]).filter((x:any)=>Number(x.round||0)<gw).slice(-6);
      if(!h.length)return p;
      const weights=h.map((_:any,i:number)=>i+1),den=weights.reduce((a,b)=>a+b,0);
      const recentStartRate=h.reduce((s:any,x:any,i:number)=>s+weights[i]*(Number(x.starts||0)>0?1:0),0)/den;
      const recentMinutesRate=h.reduce((s:any,x:any,i:number)=>s+weights[i]*clamp(Number(x.minutes||0)/90),0)/den;
      const started=h.filter((x:any)=>Number(x.starts||0)>0);
      const bench=h.filter((x:any)=>Number(x.starts||0)<=0&&Number(x.minutes||0)>0);
      const recentStartMinutes=started.length?started.reduce((s:number,x:any)=>s+Number(x.minutes||0),0)/started.length:78;
      const recentBenchMinutes=bench.length?bench.reduce((s:number,x:any)=>s+Number(x.minutes||0),0)/bench.length:18;
      return{...p,recentStartRate,recentMinutesRate,recentStartMinutes,recentBenchMinutes};
    });
  }
  const norm=normaliseModelPool(pool.map(x=>({...x,...x.modelFeatures})));
  const scored=norm.map(x=>({...x,historicalScore:historicalModelScore(x)}));
  const byId=new Map(scored.map(p=>[p.id,p]));
  pool=scored;
  const current=picks.map(x=>{const player=byId.get(x.element);return{...x,player,purchasePrice:Number(x.purchase_price??x.purchasePrice??x.now_cost??player?.price??0)/10,sellPrice:Number(x.selling_price??x.now_cost??player?.price??0)/10}}).filter(x=>x.player);
  const built=buildXI(current,fixtures,gw),xi=built.xi,xiIds=new Set(xi.map(x=>x.player.id));
  const currentXI=current.filter((x:any)=>Number((x as any).position||0)>=1&&Number((x as any).position||0)<=11);
  const currentBench=current.filter((x:any)=>Number((x as any).position||0)>=12&&Number((x as any).position||0)<=15);

  const bench=current.filter(x=>!xiIds.has(x.player.id)).sort((a,b)=>selectionScore(b.player,fixtures,gw)-selectionScore(a.player,fixtures,gw));
  const starters=[...xi].sort((a,b)=>selectionScore(b.player,fixtures,gw)-selectionScore(a.player,fixtures,gw));
  const remaining=remainingChips(history,gw),usedChips=history?.chips||[];
  const chips=remaining.map((c:string)=>({chip:c,reason:chipReason(c,current,pool,fixtures,gw,history)}));
  return{
    pool,current,starters,bench,
    transferIdeas:transferIdeas(current,pool,Number(bank||0),fixtures,gw),substitutionPlan:substitutionPlan(current,fixtures,gw),currentStartingXI:currentXI.sort((a:any,b:any)=>Number(a.position)-Number(b.position)).map((x:any)=>x.player.name),currentBench:currentBench.sort((a:any,b:any)=>Number(a.position)-Number(b.position)).map((x:any)=>x.player.name),
    bank:Number(bank||0),freeTransfers:getFT(history,gw,picks.entry_history),currentGameweek:gw,
    rules:{squadSize:15,maxPlayersPerClub:3,formation:"1 GK, 3–5 DEF, 2–5 MID, 1–3 FWD",transferPositionLock:false,budgetConstraint:true,transferHit:4,maxFreeTransfers:5,sellingValueUsed:true,freeHitCannotBeConsecutive:true,twoChipSets:true,oneChipPerGameweek:true,chipResetGameweek:20},
    model:{name:"FPL Decision Engine v1.0",method:"broader FPL statistical model + live per-fixture projections + 6-GW transfer timing search + chip opportunity-cost layer",horizon:6,transferHitPoints:4,principles:["Optimise cumulative future gameweek points, not just the next GW","Evaluate every candidate's upcoming fixture run and transfer timing","Compare transfer cost, free-transfer state and future points together","Avoid hits unless the projected future gain exceeds the 4-point cost","Preserve information value and avoid reactive price chasing","Captain the highest expected-value option; use ceiling only as a tie-break","Wildcard for structural repair and future fixture runs, not one-week problems","Use Free Hit for genuine blank-gameweek damage","Benchmark chips by incremental points versus saving them"]},
    chips:{remaining,suggestions:chips,used:usedChips},
    projectedGameweek:{points:Number(scoreState(current,fixtures,gw,null).points.toFixed(2)),captain:captainPlan(xi,fixtures,gw).captain,vice:captainPlan(xi,fixtures,gw).vice,formation:built.formation},
    decisionPlan:buildDecisionPlan(current,pool,fixtures,gw,Number(bank||0),history,picks.entry_history)
  };
}