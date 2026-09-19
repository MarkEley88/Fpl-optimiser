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
  // Deployment sync: keep the live fixture model source explicit.
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
  const attack=pos===1?4:pos===2?6:pos===3?5:4;
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

const WEEK_SCORE_CACHE=new Map<string,number>();
const SCORE_STATE_CACHE=new Map<string,any>();

function weekScore(p:any,fixtures:any[],gw:number){
  const cacheKey=String(p.id)+":"+String(gw);
  const cached=WEEK_SCORE_CACHE.get(cacheKey);
  if(cached!==undefined)return cached;
  const fs=eventFixtures(p.team,fixtures,gw);if(!fs.length)return 0;
  const raw=p.raw||p;
  const minutes=Number(p.expectedMinutes||expectedMinutes(p));
  const scores=fs.map(f=>expectedFixturePoints({...raw,...p},f,minutes));
  const sum=scores.reduce((a,b)=>a+b,0);
  const hs=Number(p.historicalScore||0);
  const modelBase=clamp(2+hs*.55,0,10);
  const currentBase=Math.max(0,sum);
  const modelAdjusted=modelBase*fs.reduce((s,f)=>s+fixtureScore(f,p.team),0)/fs.length;
  // IMPORTANT: no player price, transfer cost or budget value enters this
  // score. This function measures expected FPL output only.
  const value=Number(Math.max(0,currentBase*.88+modelAdjusted*.12).toFixed(2));
  WEEK_SCORE_CACHE.set(cacheKey,value);
  return value;
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
  // Price is an eligibility constraint only. It is deliberately never part of
  // player quality, transfer ranking, projected points or strategic value.
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
  // delta is a pure points differential. cost is retained only so callers can
  // explain/enforce affordability; it is never used in this ordering.
  return out.sort((a,b)=>b.delta-a.delta);
}
function candidates(squad:any[],pool:any[],bank:number,fixtures:any[],startGw:number,horizon=5){
  return makeCandidates(squad,pool,bank,fixtures,startGw,horizon);
}
function squadHorizonDelta(squad:any[],candidate:any[],fixtures:any[],gw:number,horizon=7){
  let delta=0;
  const end=Math.min(38,gw+horizon-1);
  for(let g=gw;g<=end;g++){
    delta+=scoreState(candidate,fixtures,g,null).points-scoreState(squad,fixtures,g,null).points;
  }
  return Number(delta.toFixed(2));
}
function strategicCandidates(squad:any[],pool:any[],bank:number,fixtures:any[],gw:number,ft:number){
  // First use the player-only differential to cheaply identify plausible
  // candidates from the full legal pool. Then re-rank those candidates using
  // the actual resulting XI and captain score across the 7-GW horizon.
  // This is critical for premium players: selling a player who is also the
  // likely captain must pay for the lost captaincy points.
  const horizon=Math.min(7,39-gw);
  const all=makeCandidates(squad,pool,bank,fixtures,gw-1,horizon);
  const shortlist=[...all.slice(0,80),...all.filter(x=>x.cost<0).slice(0,20)];
  const unique=[...new Map(shortlist.map(x=>[String(x.out.player.id)+":"+String(x.in.id),x])).values()];
  const rows=unique.map(x=>{
    const hit=ft>0?0:4;
    const result=applyTransfer(squad,x);
    const playerValueDelta=squadHorizonDelta(squad,result,fixtures,gw,7);
    return {
      ...x,
      playerValueDelta,
      strategicDelta:Number((playerValueDelta-hit).toFixed(2)),
      hit
    };
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
  const all=candidates(squad,pool,bank,fixtures,gw,7);
  const shortlist=[...all.slice(0,80),...all.filter(x=>x.cost<0).slice(0,20)];
  const unique=[...new Map(shortlist.map(x=>[String(x.out.player.id)+":"+String(x.in.id),x])).values()];
  const baseValue=scoreState(squad,fixtures,gw,null).points;
  const rows=unique.map(x=>{
    const result=applyTransfer(squad,x);
    const horizonDelta=squadHorizonDelta(squad,result,fixtures,gw,7);
    const nextGwGain=scoreState(result,fixtures,gw,null).points-baseValue;
    return {
      in:x.in.name,inId:x.in.id,out:x.out.player.name,outId:x.out.player.id,
      delta:horizonDelta,nextGwGain:Number(nextGwGain.toFixed(2)),
      price:x.in.price,position:posName(x.in.position),cost:x.cost,
      reason:(horizonDelta>=6?"Strong 7-GW upgrade":horizonDelta>=3?"Good 7-GW upgrade":horizonDelta>0.35?"Marginal 7-GW upgrade":"No clear 7-GW upgrade")+"; "+(x.cost>0?"costs £"+x.cost.toFixed(1)+"m":"releases £"+Math.abs(x.cost).toFixed(1)+"m")
    };
  });
  return rows.filter(x=>x.delta>0.35).sort((a,b)=>b.delta-a.delta).slice(0,8);
}
function scoreState(squad:any[],fixtures:any[],gw:number,chip:string|null){
  const key=String(gw)+":"+String(chip||"none")+":"+squad.map(x=>x.player.id).sort((a,b)=>a-b).join(",");
  const cached=SCORE_STATE_CACHE.get(key);
  if(cached)return cached;
  const built=buildXI(squad,fixtures,gw),cap=captainPlan(built.xi,fixtures,gw);
  let points=built.xi.reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0);
  if(cap.captain)points+=weekScore(cap.captain,fixtures,gw);
  if(chip==="3xc"&&cap.captain)points+=weekScore(cap.captain,fixtures,gw);
  if(chip==="bboost")points+=squad.filter(x=>!built.xi.some(y=>y.player.id===x.player.id)).reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0);
  const result={points,xi:built.xi,formation:built.formation,cap};
  SCORE_STATE_CACHE.set(key,result);
  return result;
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
function bestFutureBenchBoost(squad:any[],fixtures:any[],gw:number){
  const end=gw<=19?19:38; const rows:any[]=[];
  for(let g=gw+1;g<=end;g++){
    const built=buildXI(squad,fixtures,g);
    const bench=squad.filter(x=>!built.xi.some(y=>y.player.id===x.player.id));
    const score=bench.reduce((s,x)=>s+weekScore(x.player,fixtures,g),0);
    rows.push({gw:g,score:Number(score.toFixed(2))});
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
  const futureBB=bestFutureBenchBoost(squad,fixtures,gw);
  const currentDouble=cap?eventFixtures(cap.team,fixtures,gw).length>1:false;
  const tcOpportunity=Number((tc-(futureTC?.score||0)).toFixed(2));
  const bbOpportunity=Number((bb-(futureBB?.score||0)).toFixed(2));
  return{doublePlayers,benchScore:bb,captainScore:tc,base,tcGain:tc,bbGain:bb,currentDouble,futureTC,futureBB,tcOpportunity,bbOpportunity};
}
function bestTemporarySquad(initial:any[],pool:any[],fixtures:any[],gw:number,budget:number,lookahead=1){
  const byPos:any={1:[],2:[],3:[],4:[]};
  pool.forEach(p=>byPos[p.position]?.push(p));
  const playerHorizonScore=(p:any)=>{let s=0;for(let g=gw;g<=Math.min(38,gw+lookahead-1);g++)s+=weekScore(p,fixtures,g);return s};
  Object.values(byPos).forEach((a:any[])=>a.sort((x,y)=>playerHorizonScore(y)-playerHorizonScore(x)));
  const squadHorizonScore=(players:any[])=>{
    let total=0;
    for(let g=gw;g<=Math.min(38,gw+lookahead-1);g++){
      const groups:any={1:[],2:[],3:[],4:[]};
      players.forEach(p=>groups[p.position]?.push(p));
      Object.values(groups).forEach((a:any[])=>a.sort((x,y)=>selectionScore(y,fixtures,g)-selectionScore(x,fixtures,g)));
      let best=-Infinity;
      for(const [d,m,f] of FORMATIONS){
        if(groups[1].length<1||groups[2].length<d||groups[3].length<m||groups[4].length<f)continue;
        const xi=[...groups[1].slice(0,1),...groups[2].slice(0,d),...groups[3].slice(0,m),...groups[4].slice(0,f)];
        const score=xi.reduce((s,p)=>s+weekScore(p,fixtures,g),0);
        if(score>best)best=score;
      }
      if(best>-Infinity)total+=best;
    }
    return total;
  };
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
        const nextSquad=[...st.squad,p];
        // Keep beam construction cheap: partial squads use player-level
        // projections for pruning. Once a 15-player squad is complete, the
        // final ranking below uses the actual legal XI only (11 scorers).
        next.push({squad:nextSquad,cost:nc,score:st.score+playerHorizonScore(p),clubs:{...st.clubs,[p.team]:count}});
      }
      next.sort((a,b)=>b.score-a.score);states=next.slice(0,160);
    }
    beams=states;
  }
  const complete=beams.filter(x=>x.squad.length===15);
  const best=complete.sort((a,b)=>squadHorizonScore(b.squad)-squadHorizonScore(a.squad))[0];
  return best?.squad||initial.map(x=>x.player);
}
function chipDecision(chip:string,squad:any[],pool:any[],fixtures:any[],gw:number,history:any){
  const m=chipMetrics(squad,fixtures,gw);
  if(chip==="3xc")return m.tcGain;
  if(chip==="bboost")return m.bbGain;
  const budget=Number((squad.reduce((s,x)=>s+sellPrice(x),0)).toFixed(1));
  if(chip==="freehit"){
    const best=bestTemporarySquad(squad,pool,fixtures,gw,budget,1);
    return Math.max(0,scoreState(best.map(p=>({player:p})),fixtures,gw,null).points-m.base);
  }
  const rebuilt=bestTemporarySquad(squad,pool,fixtures,gw,budget,7);
  return Math.max(0,scoreState(rebuilt.map(p=>({player:p})),fixtures,gw,null).points-m.base);
}
function chipThreshold(chip:string){return chip==="3xc"?2.0:chip==="bboost"?5.0:chip==="freehit"?3.0:4.0}
function chipShouldPlay(chip:string,squad:any[],pool:any[],fixtures:any[],gw:number,history:any){
  if(chipUsed(history,chip,gw))return false;
  if(gw===1&&(chip==="wildcard"||chip==="freehit"))return false;
  if(chip==="freehit"&&freeHitBlocked(history,gw))return false;
  const m=chipMetrics(squad,fixtures,gw);
  if(chip==="3xc"){
    // Triple Captain is not restricted to double gameweeks. Use it when the
    // current captain opportunity materially beats the best remaining captain
    // opportunity in the same half-season and clears a minimum quality bar.
    const benchmark=m.futureTC?.score||0;
    return m.tcGain>=6 && m.tcGain>=benchmark+1.0;
  }
  if(chip==="bboost"){
    // Bench Boost is driven by the four-player bench, not the starting XI.
    // Compare today's bench to the strongest remaining bench opportunity.
    const benchmark=m.futureBB?.score||0;
    return m.bbGain>=6 && m.bbGain>=benchmark+1.0;
  }
  return chipDecision(chip,squad,pool,fixtures,gw,history)>=chipThreshold(chip);
}
function chipReason(chip:string,squad:any[],pool:any[],fixtures:any[],gw:number,history:any){
  const gain=chipDecision(chip,squad,pool,fixtures,gw,history);
  const m=chipMetrics(squad,fixtures,gw);
  if(chip==="3xc"){
    if(chipShouldPlay(chip,squad,pool,fixtures,gw,history))return "Use: "+(m.currentDouble?"Double Gameweek":"strong captain opportunity")+". Expected captain score "+m.captainScore.toFixed(1)+"; best remaining benchmark "+(m.futureTC?.score??0).toFixed(1)+".";
    if(m.futureTC)return "Hold: expected captain score "+m.captainScore.toFixed(1)+"; best remaining projected opportunity is "+m.futureTC.name+" in GW"+m.futureTC.gw+" at "+m.futureTC.score.toFixed(1)+" points.";
  }
  if(chip==="bboost"){
    if(chipShouldPlay(chip,squad,pool,fixtures,gw,history))return "Use: expected incremental Bench Boost gain "+m.bbGain.toFixed(1)+" points; best remaining benchmark "+(m.futureBB?.score??0).toFixed(1)+".";
    if(m.futureBB)return "Hold: expected Bench Boost gain is "+m.bbGain.toFixed(1)+" points; best remaining projected bench is "+m.futureBB.score.toFixed(1)+" in GW"+m.futureBB.gw+".";
  }
  if(chip==="freehit"||chip==="wildcard")return chipShouldPlay(chip,squad,pool,fixtures,gw,history)?"Use: projected immediate gain +"+gain.toFixed(1)+" points.":"Hold: estimated immediate gain is only +"+gain.toFixed(1)+" points; keep the chip for a stronger opportunity.";
  return "Hold: estimated immediate gain is only +"+gain.toFixed(1)+" points; keep the chip for a stronger opportunity.";
}
function improveSquad(initial:any[],pool:any[],fixtures:any[],gw:number,budget:number){
  const best=bestTemporarySquad(initial,pool,fixtures,gw,budget,7);
  const map=new Map(pool.map(p=>[p.id,p]));
  const squad=best.map((p:any)=>({element:p.id,player:map.get(p.id)||p,purchasePrice:p.price,sellPrice:p.price}));
  const cost=squad.reduce((s,x)=>s+x.player.price,0);
  return{squad,bank:Number((budget-cost).toFixed(1))};
}
function buildDecisionPlan(initial:any[],pool:any[],fixtures:any[],startGw:number,bank:number,history:any,entryHistory:any=null){
  let states:any[]=[{squad:initial,bank,ft:getFT(history,startGw,entryHistory),total:0,steps:[],usedChips:[] as string[]}];
  // Start with the current gameweek so the displayed FT balance is the
  // balance the manager actually has now. A free transfer is earned only
  // when moving into the following gameweek.
  const endGw=Math.min(38,startGw+6);
  const lookaheadValue=(squad:any[],fromGw:number)=>{
    let v=0;
    for(let g=fromGw;g<=endGw;g++)v+=scoreState(squad,fixtures,g,null).points;
    return v;
  };
  for(let gw=startGw;gw<=endGw;gw++){
    const next:any[]=[];
    for(const st of states){
      const earned=Math.min(5,st.ft+1);
      const base=scoreState(st.squad,fixtures,gw,null);
      next.push({...st,ft:earned,total:st.total+base.points,rank:st.total+base.points+lookaheadValue(st.squad,gw+1),steps:[...st.steps,{gw,action:"Hold",chip:null,bank:st.bank,ft:st.ft,formation:base.formation,cap:base.cap,projectedGain:0}]});
      // Evaluate the full legal single-transfer pool at every decision state.
      // We deliberately do not truncate this list before legality/affordability
      // checks: every eligible replacement is considered before the strategic
      // search chooses which states to carry forward.
      const cs=strategicCandidates(st.squad,pool,st.bank,fixtures,gw,st.ft)
        .filter((x:any)=>x.cost<=st.bank+.001)
        .slice(0,40);
      for(const c of cs){
        const hit=c.hit;
        const sq=applyTransfer(st.squad,c),nb=Number((st.bank-c.cost).toFixed(1)),gain=scoreState(sq,fixtures,gw,null),nf=Math.min(5,Math.max(0,st.ft-1)+1);
        next.push({...st,squad:sq,bank:nb,ft:nf,total:st.total+gain.points-hit,rank:st.total+gain.points-hit+lookaheadValue(sq,gw+1),steps:[...st.steps,{gw,action:c.in.name+" for "+c.out.player.name+(hit?" (-4 points)":""),chip:null,bank:nb,ft:nf,formation:gain.formation,cap:gain.cap,projectedGain:Number((gain.points-base.points-hit).toFixed(2))}]});
      }
      if(states.indexOf(st)<8){
        // Two transfers are evaluated as one combined squad change. The
        // transfers do not need to be individually affordable in sequence:
        // a downgrade can fund an upgrade elsewhere in the same GW.
        const twoHit=Math.max(0,2-st.ft)*4;
        const firstBase=candidates(st.squad,pool,Infinity,fixtures,gw-1,7);
        const firstRows=firstBase.map(x=>({...x,hit:st.ft>0?0:4,playerValueDelta:x.delta,strategicDelta:x.delta-(st.ft>0?0:4)})).sort((a,b)=>b.strategicDelta-a.strategicDelta);
        const firstFunding=[...firstRows].filter(x=>x.cost<0).sort((a,b)=>a.cost-b.cost).slice(0,10);
        const firstPool=[...new Map([...firstRows.slice(0,16),...firstFunding].map(x=>[String(x.out.player.id)+":"+String(x.in.id),x])).values()];
        const pairStates:any[]=[];
        for(const a of firstPool){
          const afterA=applyTransfer(st.squad,a);
          const secondRows=candidates(afterA,pool,Infinity,fixtures,gw,2);
          const secondFunding=[...secondRows].filter(x=>x.cost<0).sort((x,y)=>x.cost-y.cost).slice(0,8);
          const secondPool=[...new Map([...secondRows.slice(0,14),...secondFunding].map(x=>[String(x.out.player.id)+":"+String(x.in.id),x])).values()];
          for(const b of secondPool){
            if(Number(a.out.player.id)>=Number(b.out.player.id))continue;
            const totalCost=Number((a.cost+b.cost).toFixed(1));
            if(totalCost>st.bank+.001)continue;
            const sq=applyTransfer(afterA,b);
            if(!validSquad(sq))continue;
            const gain=scoreState(sq,fixtures,gw,null);
            pairStates.push({a,b,sq,totalCost,gain});
          }
        }
        // Score the combined squads, then spend the expensive 7-GW lookahead
        // only on the strongest combined outcomes.
        const baseFuture=lookaheadValue(st.squad,gw+1);
        pairStates.sort((x,y)=>{
          const xv=x.gain.points+lookaheadValue(x.sq,gw+1)-baseFuture-twoHit;
          const yv=y.gain.points+lookaheadValue(y.sq,gw+1)-baseFuture-twoHit;
          return yv-xv;
        });
        for(const p of pairStates.slice(0,6)){
          const future=lookaheadValue(p.sq,gw+1);
          const nf=Math.min(5,Math.max(0,st.ft-2)+1);
          const total=st.total+p.gain.points-twoHit;
          next.push({...st,squad:p.sq,bank:Number((st.bank-p.totalCost).toFixed(1)),ft:nf,total,rank:total+future,steps:[...st.steps,{gw,action:p.a.in.name+" for "+p.a.out.player.name+" + "+p.b.in.name+" for "+p.b.out.player.name+(twoHit?" (-"+twoHit+" points)":""),chip:null,bank:Number((st.bank-p.totalCost).toFixed(1)),ft:nf,formation:p.gain.formation,cap:p.gain.cap,projectedGain:Number((p.gain.points-base.points-twoHit).toFixed(2))}]});
        }
      }
      if(states.indexOf(st)<8) for(const chip of CHIP_NAMES){
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
    next.sort((a,b)=>(b.rank??b.total)-(a.rank??a.total));
    // Keep a materially wider frontier so a locally weaker move is not able
    // to eliminate a stronger multi-transfer path in the next GW.
    states=next.slice(0,32);
  }
  return states[0]?.steps||[];
}
export async function optimiseSquad(picks:any[],elements:Player[],fixtures:any[],gw:number,bank=0,history:any=null,entryHistory:any=null,includeDecisionPlan=true,fastMode=false,planOnly=false){
  WEEK_SCORE_CACHE.clear();
  SCORE_STATE_CACHE.clear();
  const horizon=Math.min(38,gw+6);
  let pool=elements.map(p=>projectPlayer(p,fixtures,horizon,gw));
  // Recent element-summary calls are intentionally not made at request time. The
  // optimiser runs from the GitHub-refreshed live FPL cache so the Vercel
  // function is not dependent on dozens of direct FPL API calls or their
  // rate limits. Bootstrap data still supplies the live season metrics.
  const norm=normaliseModelPool(pool.map(x=>({...x,...x.modelFeatures})));
  const scored=norm.map(x=>({...x,historicalScore:historicalModelScore(x)}));
  const byId=new Map(scored.map(p=>[p.id,p]));
  pool=scored.map((p:any)=>({...p,projected:Number(weekScore(p,fixtures,gw).toFixed(2))}));
  const current=picks.map(x=>{const player=byId.get(x.element);return{...x,player,purchasePrice:Number(x.purchase_price??x.purchasePrice??x.now_cost??player?.price??0)/10,sellPrice:Number(x.selling_price??x.now_cost??player?.price??0)/10}}).filter(x=>x.player);
  const built=buildXI(current,fixtures,gw),xi=built.xi,xiIds=new Set(xi.map(x=>x.player.id));
  const currentXI=current.filter((x:any)=>Number((x as any).position||0)>=1&&Number((x as any).position||0)<=11);
  const currentBench=current.filter((x:any)=>Number((x as any).position||0)>=12&&Number((x as any).position||0)<=15);

  const bench=current.filter(x=>!xiIds.has(x.player.id)).sort((a,b)=>selectionScore(b.player,fixtures,gw)-selectionScore(a.player,fixtures,gw));
  if(planOnly){
    return {pool,current,decisionPlan:buildDecisionPlan(current,pool,fixtures,gw,Number(bank||0),history,entryHistory)};
  }
  const starters=[...xi].sort((a,b)=>selectionScore(b.player,fixtures,gw)-selectionScore(a.player,fixtures,gw));
  const remaining=remainingChips(history,gw),usedChips=history?.chips||[];
  const chips=fastMode?[]:remaining.map((c:string)=>({chip:c,reason:chipReason(c,current,pool,fixtures,gw,history)}));
  return{
    pool,current,starters,bench,
    transferIdeas:transferIdeas(current,pool,Number(bank||0),fixtures,gw),substitutionPlan:substitutionPlan(current,fixtures,gw),currentStartingXI:currentXI.sort((a:any,b:any)=>Number(a.position)-Number(b.position)).map((x:any)=>x.player.name),currentBench:currentBench.sort((a:any,b:any)=>Number(a.position)-Number(b.position)).map((x:any)=>x.player.name),
    bank:Number(bank||0),freeTransfers:getFT(history,gw,entryHistory),currentGameweek:gw,
    rules:{squadSize:15,maxPlayersPerClub:3,formation:"1 GK, 3–5 DEF, 2–5 MID, 1–3 FWD",transferPositionLock:false,budgetConstraint:true,transferHit:4,maxFreeTransfers:5,sellingValueUsed:true,freeHitCannotBeConsecutive:true,twoChipSets:true,oneChipPerGameweek:true,chipResetGameweek:20},
    model:{name:"FPL Decision Engine v1.0",method:"broader FPL statistical model + live per-fixture projections + 7-GW transfer timing search + chip opportunity-cost layer",horizon:7,transferHitPoints:4,principles:["Optimise cumulative future gameweek points, not just the next GW","Evaluate every candidate's upcoming fixture run and transfer timing","Compare transfer cost, free-transfer state and future points together","Avoid hits unless the projected future gain exceeds the 4-point cost","Preserve information value and avoid reactive price chasing","Captain the highest expected-value option; use ceiling only as a tie-break","Wildcard for structural repair and future fixture runs, not one-week problems","Use Free Hit for genuine blank-gameweek damage","Benchmark chips by incremental points versus saving them"]},
    chips:{remaining,suggestions:chips,used:usedChips},
    projectedGameweek:{points:Number(scoreState(current,fixtures,gw,null).points.toFixed(2)),captain:captainPlan(xi,fixtures,gw).captain,vice:captainPlan(xi,fixtures,gw).vice,formation:built.formation},
    decisionPlan:includeDecisionPlan?buildDecisionPlan(current,pool,fixtures,gw,Number(bank||0),history,entryHistory):[],
  };
}