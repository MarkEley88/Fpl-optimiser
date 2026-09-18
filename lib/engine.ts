export type Player=any;

const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));

function fixtureScore(f:any,teamId:number){
  if(!f)return 0.5;
  const home=f.team_h===teamId;
  const diff=home?Number(f.team_h_difficulty||3):Number(f.team_a_difficulty||3);
  return clamp(1-(diff-1)/5,.08,.92);
}

function minutesProb(p:any){
  const status=p.status;
  const chance=p.chance_of_playing_next_round;
  if(status==="i" || status==="s" || status==="u") return 0;
  if(chance!==null && chance!==undefined) return clamp(Number(chance)/100,0,1);
  const starts=Number(p.starts||0);
  const minutes=Number(p.minutes||0);
  if(minutes===0 && starts===0) return 0.25;
  if(starts>0) return clamp(Math.min(1,0.65+0.07*starts),0.65,0.98);
  return 0.55;
}

export function projectPlayer(p:Player,fixtures:any[],horizon=5,currentGw=0){
  const games=fixtures.filter(f=>f.event && f.event>currentGw && f.event<=horizon && (f.team_h===p.team || f.team_a===p.team));
  const fs=games.length?games.reduce((s,f)=>s+fixtureScore(f,p.team),0)/games.length:.5;
  const form=Number(p.form||0),ppg=Number(p.points_per_game||0);
  const xgi=Number(p.expected_goal_involvements||0)/(Math.max(1,Number(p.minutes||0))/90);
  const mins=minutesProb(p);
  const base=ppg*.38+form*.24+Math.min(2.5,xgi)*.9+fs*2.2;
  return {id:p.id,name:p.web_name,team:p.team,position:p.element_type,price:Number(p.now_cost||0)/10,startProbability:Math.round(mins*100),fixtureScore:fs,projected:Number((base*mins).toFixed(2)),status:p.status,chanceOfPlaying:p.chance_of_playing_next_round,news:p.news||""};
}

const posName=(p:number)=>({1:"Goalkeeper",2:"Defender",3:"Midfielder",4:"Forward"} as any)[p]||"Unknown";
const FORMATIONS=[[3,4,3],[3,5,2],[4,4,2],[4,5,1],[4,3,3],[5,4,1],[5,3,2],[5,2,3]];

function eventFixtures(team:number,fixtures:any[],gw:number){return fixtures.filter(f=>Number(f.event)===gw&&(f.team_h===team||f.team_a===team));}
function weekScore(p:any,fixtures:any[],gw:number){const fs=eventFixtures(p.team,fixtures,gw);if(!fs.length)return 0;const fixture=fs.reduce((s,f)=>s+fixtureScore(f,p.team),0)/fs.length;return Number((p.projected*(.55+.45*fixture)*Math.min(1.45,1+.35*(fs.length-1))).toFixed(2));}
function buildXI(squad:any[],fixtures:any[],gw:number){
  const groups:any={1:[],2:[],3:[],4:[]};
  squad.forEach(x=>groups[x.player.position]?.push(x));
  Object.values(groups).forEach((a:any[])=>a.sort((x,y)=>weekScore(y.player,fixtures,gw)-weekScore(x.player,fixtures,gw)));
  let best:any[]=[];let bestScore=-Infinity;let formation="";
  for(const [d,m,f] of FORMATIONS){
    if(groups[1].length<1||groups[2].length<d||groups[3].length<m||groups[4].length<f)continue;
    const candidateXI=[...groups[1].slice(0,1),...groups[2].slice(0,d),...groups[3].slice(0,m),...groups[4].slice(0,f)];
    const score=candidateXI.reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0);
    if(score>bestScore){bestScore=score;best=candidateXI;formation="1-"+d+"-"+m+"-"+f;}
  }
  return{xi,bestScore,formation};
}
function captainPlan(xi:any[],fixtures:any[],gw:number){
  const ranked=[...xi].map(x=>({...x,score:weekScore(x.player,fixtures,gw)})).sort((a,b)=>b.score-a.score);
  return{captain:ranked[0]?.player||null,vice:ranked[1]?.player||null,candidates:ranked.slice(0,5).map(x=>({name:x.player.name,id:x.player.id,score:x.score}))};
}
function clubCount(squad:any[],team:number){return squad.filter(x=>x.player.team===team).length;}
function validSquad(squad:any[]){return squad.length===15&&squad.filter(x=>x.player.position===1).length===2&&squad.filter(x=>x.player.position===2).length===5&&squad.filter(x=>x.player.position===3).length===5&&squad.filter(x=>x.player.position===4).length===3&&[...new Set(squad.map(x=>x.player.team))].every(t=>clubCount(squad,t as number)<=3);}
function getFT(history:any){const c=history?.current?.at(-1);return Math.max(1,Math.min(5,Number(c?.event_transfers_available??c?.event_transfers??1)));}
function remainingChips(history:any){const used=new Set((history?.chips||[]).map((x:any)=>x.name));return["wildcard","freehit","bboost","3xc"].filter(x=>!used.has(x));}
function scoreState(squad:any[],fixtures:any[],gw:number,chip:string|null){
  const built=buildXI(squad,fixtures,gw),cap=captainPlan(built.xi,fixtures,gw);
  let points=built.xi.reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0);
  if(cap.captain)points+=weekScore(cap.captain,fixtures,gw)*(chip==="3xc"?2:1);
  if(chip==="bboost")points+=squad.filter(x=>!built.xi.some(y=>y.player.id===x.player.id)).reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0);
  return{points,xi:built.xi,formation:built.formation,cap};
}
function makeCandidates(squad:any[],pool:any[],bank:number){
  const candidates:any[]=[];
  for(const o of squad)for(const p of pool){
    if(squad.some(x=>x.player.id===p.id)||p.position!==o.player.position)continue;
    if(p.price>o.player.price+bank+.001)continue;
    if(clubCount(squad,p.team)>=3&&p.team!==o.player.team)continue;
    candidates.push({out:o,in:p});
  }
  return candidates.sort((a,b)=>(b.in.projected-b.out.player.projected)-(a.in.projected-a.out.player.projected)).slice(0,20);
}
function applyTransfer(squad:any[],t:any){return[...squad.filter(x=>x.player.id!==t.out.player.id),{element:t.in.id,player:t.in}];}
function chipReason(chip:string,squad:any[],fixtures:any[],gw:number){
  const doubles:any={};
  fixtures.filter(f=>Number(f.event)===gw).forEach(f=>{doubles[f.team_h]=(doubles[f.team_h]||0)+1;doubles[f.team_a]=(doubles[f.team_a]||0)+1;});
  const doublePlayers=squad.filter(x=>(doubles[x.player.team]||0)>1).length;
  const built=buildXI(squad,fixtures,gw),bench=squad.filter(x=>!built.xi.some(y=>y.player.id===x.player.id));
  if(chip==="bboost")return doublePlayers>=5||bench.reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0)>=12?"Strong when the bench also has a double gameweek.":"Hold for a stronger double-gameweek bench.";
  if(chip==="3xc")return doublePlayers>0?"Use only with a high-projection captain who has a confirmed double.":"Hold for a suitable double-gameweek captain.";
  if(chip==="freehit")return"Reserve for a blank/double gameweek where your squad has poor coverage.";
  return"Use when several positions need changing or before a major fixture swing.";
}
function buildDecisionPlan(initial:any[],pool:any[],fixtures:any[],startGw:number,bank:number,history:any){
  const chips=remainingChips(history);
  let states:any[]=[{squad:initial,bank,ft:getFT(history),total:0,steps:[]}];
  for(let gw=startGw+1;gw<=startGw+6;gw++){
    const next:any[]=[];
    for(const st of states){
      const base=scoreState(st.squad,fixtures,gw,null);
      const nextFT=Math.min(5,st.ft+1);
      next.push({...st,total:st.total+base.points,steps:[...st.steps,{gw,action:"Hold transfer",chip:null,bank:st.bank,ft:nextFT,formation:base.formation,cap:base.cap}]});
      const t=makeCandidates(st.squad,pool,st.bank).find(x=>x.in.projected>x.out.player.projected);
      if(t){
        const gain=scoreState(applyTransfer(st.squad,t),fixtures,gw,null);
        const delta=gain.points-base.points;
        const hit=st.ft>0?0:4;
        if(delta>hit){
          const sq=applyTransfer(st.squad,t),cost=t.in.price-t.out.player.price;
          const afterFt=Math.min(5,Math.max(0,st.ft-1)+1);
          next.push({squad:sq,bank:st.bank-cost,ft:afterFt,total:st.total+gain.points-hit,steps:[...st.steps,{gw,action:t.in.name+" for "+t.out.player.name+(hit?" (-4 hit)":""),chip:null,bank:st.bank-cost,ft:afterFt,formation:gain.formation,cap:gain.cap}]});
        }
      }
      for(const chip of chips){
        if(chip!=="bboost"&&chip!=="3xc")continue;
        const gain=scoreState(st.squad,fixtures,gw,chip);
        if(gain.points>base.points)next.push({...st,total:st.total+gain.points,steps:[...st.steps,{gw,action:"Hold transfer",chip:chip==="bboost"?"Bench Boost":"Triple Captain",bank:st.bank,ft:nextFT,formation:gain.formation,cap:gain.cap}]});
      }
    }
    next.sort((a,b)=>b.total-a.total);
    states=next.slice(0,8);
  }
  return states[0]?.steps||[];
}

export function optimiseSquad(picks:any[],elements:Player[],fixtures:any[],gw:number,bank=0,history:any=null){
  const horizon=gw+5;
  const pool=elements.map(p=>projectPlayer(p,fixtures,horizon,gw));
  const byId=new Map(pool.map(p=>[p.id,p]));
  const current=picks.map(x=>({...x,player:byId.get(x.element)})).filter(x=>x.player);

  const built=buildXI(current,fixtures,gw);
  const xi=built.xi;
  const xiIds=new Set(xi.map(x=>x.player.id));
  const bench=current.filter(x=>!xiIds.has(x.player.id)).sort((a,b)=>b.player.projected-a.player.projected);
  const starters=[...xi].sort((a,b)=>b.player.projected-a.player.projected);

  const currentClubCount=(team:number)=>current.filter(x=>x.player.team===team).length;
  const candidates=pool.filter(p=>!current.some(x=>x.player.id===p.id)).sort((a,b)=>b.projected-a.projected);

  const transferIdeas:any[]=[];
  for(const out of [...current].sort((a,b)=>a.player.projected-b.player.projected)){
    for(const to of candidates){
      if(to.position!==out.player.position)continue;
      if(to.price>Number(out.player.price)+Number(bank)+1e-9)continue;
      if(currentClubCount(to.team)>=3&&to.team!==out.player.team)continue;
      const delta=Number((to.projected-out.player.projected).toFixed(2));
      if(delta<=0)continue;
      transferIdeas.push({in:to.name,inId:to.id,out:out.player.name,outId:out.player.id,delta,price:to.price,position:posName(to.position)});
      if(transferIdeas.length>=12)break;
    }
    if(transferIdeas.length>=12)break;
  }
  transferIdeas.sort((a,b)=>b.delta-a.delta);

  const decisionPlan=buildDecisionPlan(current,pool,fixtures,gw,bank,history);
  const usedChips=history?.chips||[];
  const remaining=remainingChips(history);
  const chipSuggestions=remaining.map((chip:string)=>({chip,reason:chipReason(chip,current,fixtures,gw)}));

  return {
    pool,current,starters,bench,transferIdeas:transferIdeas.slice(0,8),
    bank:Number(bank||0),freeTransfers:getFT(history),currentGameweek:gw,
    rules:{squadSize:15,maxPlayersPerClub:3,formation:"1 GK, 3–5 DEF, 2–5 MID, 1–3 FWD",transferPositionLock:true,budgetConstraint:true,transferHit:4,maxFreeTransfers:5},
    chips:{remaining,suggestions:chipSuggestions,used:usedChips},
    projectedGameweek:{points:Number((scoreState(current,fixtures,gw,null).points).toFixed(2)),captain:built.xi.length?captainPlan(built.xi,fixtures,gw).captain:null,vice:built.xi.length?captainPlan(built.xi,fixtures,gw).vice:null,formation:built.formation},
    decisionPlan
  };
}

// V0.6 build verification marker
