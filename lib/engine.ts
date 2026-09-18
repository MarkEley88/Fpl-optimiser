export type Player=any;

const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
const FORMATIONS=[[3,4,3],[3,5,2],[4,4,2],[4,5,1],[4,3,3],[5,4,1],[5,3,2],[5,2,3]];

function fixtureScore(f:any,teamId:number){if(!f)return .5;const home=f.team_h===teamId;const diff=home?Number(f.team_h_difficulty||3):Number(f.team_a_difficulty||3);return clamp(1-(diff-1)/5,.08,.92)}
function minutesProb(p:any){const s=p.status,c=p.chance_of_playing_next_round;if(s==="i"||s==="s"||s==="u")return 0;if(c!==null&&c!==undefined)return clamp(Number(c)/100);const starts=Number(p.starts||0),minutes=Number(p.minutes||0);if(!minutes&&!starts)return .25;if(starts)return clamp(.65+.07*starts,.65,.98);return .55}
function eventFixtures(team:number,fixtures:any[],gw:number){return fixtures.filter(f=>Number(f.event)===gw&&(f.team_h===team||f.team_a===team))}
function weekScore(p:any,fixtures:any[],gw:number){const fs=eventFixtures(p.team,fixtures,gw);if(!fs.length)return 0;const fixture=fs.reduce((s,f)=>s+fixtureScore(f,p.team),0)/fs.length;return Number((p.projected*(.55+.45*fixture)*Math.min(1.45,1+.35*(fs.length-1))).toFixed(2))}

export function projectPlayer(p:Player,fixtures:any[],horizon=5,currentGw=0){
  const games=fixtures.filter(f=>f.event&&Number(f.event)>currentGw&&Number(f.event)<=horizon&&(f.team_h===p.team||f.team_a===p.team));
  const fs=games.length?games.reduce((s,f)=>s+fixtureScore(f,p.team),0)/games.length:.5;
  const form=Number(p.form||0),ppg=Number(p.points_per_game||0),minutes=Number(p.minutes||0);
  const xgi=minutes?Number(p.expected_goal_involvements||0)/(minutes/90):0;
  const mins=minutesProb(p);
  const base=ppg*.38+form*.24+Math.min(2.5,xgi)*.9+fs*2.2;
  return{id:p.id,name:p.web_name,team:p.team,position:p.element_type,price:Number(p.now_cost||0)/10,startProbability:Math.round(mins*100),fixtureScore:fs,projected:Number((base*mins).toFixed(2)),status:p.status,chanceOfPlaying:p.chance_of_playing_next_round,news:p.news||""};
}
const posName=(p:number)=>({1:"Goalkeeper",2:"Defender",3:"Midfielder",4:"Forward"} as any)[p]||"Unknown";
function buildXI(squad:any[],fixtures:any[],gw:number){const groups:any={1:[],2:[],3:[],4:[]};squad.forEach(x=>groups[x.player.position]?.push(x));Object.values(groups).forEach((a:any[])=>a.sort((x,y)=>weekScore(y.player,fixtures,gw)-weekScore(x.player,fixtures,gw)));let best:any[]=[];let bestScore=-Infinity;let formation="";for(const [d,m,f] of FORMATIONS){if(groups[1].length<1||groups[2].length<d||groups[3].length<m||groups[4].length<f)continue;const candidate=[...groups[1].slice(0,1),...groups[2].slice(0,d),...groups[3].slice(0,m),...groups[4].slice(0,f)];const score=candidate.reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0);if(score>bestScore){bestScore=score;best=candidate;formation="1-"+d+"-"+m+"-"+f}}return{xi:best,bestScore,formation}}
function captainPlan(xi:any[],fixtures:any[],gw:number){const ranked=[...xi].map(x=>({...x,score:weekScore(x.player,fixtures,gw)})).sort((a,b)=>b.score-a.score);return{captain:ranked[0]?.player||null,vice:ranked[1]?.player||null,candidates:ranked.slice(0,5).map(x=>({name:x.player.name,id:x.player.id,score:x.score}))}}
function clubCount(squad:any[],team:number){return squad.filter(x=>x.player.team===team).length}
function validSquad(squad:any[]){return squad.length===15&&squad.filter(x=>x.player.position===1).length===2&&squad.filter(x=>x.player.position===2).length===5&&squad.filter(x=>x.player.position===3).length===5&&squad.filter(x=>x.player.position===4).length===3&&[...new Set(squad.map(x=>x.player.team))].every(t=>clubCount(squad,Number(t))<=3)}
function getFT(history:any){const c=history?.current?.at(-1);const v=c?.event_transfers_available??c?.event_transfers;return Math.max(0,Math.min(5,Number(v??1)))}
function remainingChips(history:any){const used=new Set((history?.chips||[]).map((x:any)=>x.name));return["wildcard","freehit","bboost","3xc"].filter(x=>!used.has(x))}
function scoreState(squad:any[],fixtures:any[],gw:number,chip:string|null){const built=buildXI(squad,fixtures,gw),cap=captainPlan(built.xi,fixtures,gw);let points=built.xi.reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0);if(cap.captain)points+=weekScore(cap.captain,fixtures,gw)*(chip==="3xc"?2:1);if(chip==="bboost")points+=squad.filter(x=>!built.xi.some(y=>y.player.id===x.player.id)).reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0);return{points,xi:built.xi,formation:built.formation,cap}}
function applyTransfer(squad:any[],t:any){return[...squad.filter(x=>x.player.id!==t.out.player.id),{element:t.in.id,player:t.in,sellPrice:t.in.price}]}
function makeCandidates(squad:any[],pool:any[],bank:number){const out:any[]=[];for(const o of squad)for(const p of pool){if(squad.some(x=>x.player.id===p.id)||p.position!==o.player.position)continue;const sell=Number(o.sellPrice??o.player.price);if(p.price>sell+bank+.001)continue;if(clubCount(squad,p.team)>=3&&p.team!==o.player.team)continue;out.push({out:o,in:p,cost:Number((p.price-sell).toFixed(1)),delta:Number((p.projected-o.player.projected).toFixed(2))})}return out.sort((a,b)=>b.delta-a.delta).slice(0,40)}
function transferIdeas(squad:any[],pool:any[],bank:number){return makeCandidates(squad,pool,bank).filter(x=>x.delta>0).slice(0,8).map(x=>({in:x.in.name,inId:x.in.id,out:x.out.player.name,outId:x.out.player.id,delta:x.delta,price:x.in.price,position:posName(x.in.position),cost:x.cost}))}

function chipReason(chip:string,squad:any[],fixtures:any[],gw:number){const doubles:any={};fixtures.filter(f=>Number(f.event)===gw).forEach(f=>{doubles[f.team_h]=(doubles[f.team_h]||0)+1;doubles[f.team_a]=(doubles[f.team_a]||0)+1});const doublePlayers=squad.filter(x=>(doubles[x.player.team]||0)>1).length;const built=buildXI(squad,fixtures,gw),bench=squad.filter(x=>!built.xi.some(y=>y.player.id===x.player.id));if(chip==="bboost")return doublePlayers>=5||bench.reduce((s,x)=>s+weekScore(x.player,fixtures,gw),0)>=12?"Strong candidate: bench has useful double-GW coverage.":"Hold for a stronger bench/double-GW combination.";if(chip==="3xc")return doublePlayers>0?"Consider only when the captain has a strong projection and double fixture.":"Hold for a suitable captain/double-GW.";if(chip==="freehit")return"Reserve for a blank/double GW where temporary squad changes add substantial coverage.";return"Use when several positions need changing and the fixture run justifies a full rebuild."}

function improveSquad(initial:any[],pool:any[],fixtures:any[],gw:number,budget:number){let squad=initial.map(x=>({...x})),bank=Number((budget-squad.reduce((s,x)=>s+Number(x.sellPrice??x.player.price),0)).toFixed(1));for(let i=0;i<8;i++){const c=makeCandidates(squad,pool,bank).filter(x=>x.delta>0)[0];if(!c)break;squad=applyTransfer(squad,c);bank=Number((bank-c.cost).toFixed(1))}return{ squad,bank }}

function buildDecisionPlan(initial:any[],pool:any[],fixtures:any[],startGw:number,bank:number,history:any){
  const chips=remainingChips(history);
  let states:any[]=[{squad:initial,bank,ft:getFT(history),total:0,steps:[],usedChips:[] as string[]}];
  for(let gw=startGw+1;gw<=startGw+6;gw++){
    const next:any[]=[];
    for(const st of states){
      const base=scoreState(st.squad,fixtures,gw,null), earned=Math.min(5,st.ft+1);
      next.push({...st,total:st.total+base.points,steps:[...st.steps,{gw,action:"Hold",chip:null,bank:st.bank,ft:earned,formation:base.formation,cap:base.cap}]});
      const candidates=makeCandidates(st.squad,pool,st.bank);
      for(const c of candidates.slice(0,12)){
        const hit=st.ft>0?0:4;if(c.delta<=hit)continue;
        const sq=applyTransfer(st.squad,c),newBank=Number((st.bank-c.cost).toFixed(1)),gain=scoreState(sq,fixtures,gw,null);
        const newFt=Math.min(5,Math.max(0,st.ft-1)+1);
        next.push({...st,squad:sq,bank:newBank,ft:newFt,total:st.total+gain.points-hit,steps:[...st.steps,{gw,action:c.in.name+" for "+c.out.player.name+(hit?" (-4 hit)":""),chip:null,bank:newBank,ft:newFt,formation:gain.formation,cap:gain.cap}]});
      }
      if(st.ft>=2){
        const first=candidates.slice(0,8);
        for(const a of first)for(const b of makeCandidates(applyTransfer(st.squad,a),pool,Number((st.bank-a.cost).toFixed(1))).slice(0,8)){
          const gain=scoreState(applyTransfer(applyTransfer(st.squad,a),b),fixtures,gw,null);if(gain.points<=base.points)continue;const nb=Number((st.bank-a.cost-b.cost).toFixed(1));if(nb<-0.001)continue;const nf=Math.min(5,st.ft-2+1);next.push({...st,squad:applyTransfer(applyTransfer(st.squad,a),b),bank:nb,ft:nf,total:st.total+gain.points,steps:[...st.steps,{gw,action:a.in.name+" for "+a.out.player.name+" + "+b.in.name+" for "+b.out.player.name,chip:null,bank:nb,ft:nf,formation:gain.formation,cap:gain.cap}]})}
      }
      for(const chip of chips){
        if(st.usedChips.includes(chip))continue;
        if(chip==="bboost"||chip==="3xc"){const gain=scoreState(st.squad,fixtures,gw,chip);const bonus=gain.points-base.points;if(bonus>0)next.push({...st,total:st.total+gain.points,steps:[...st.steps,{gw,action:"Hold",chip:chip==="bboost"?"Bench Boost":"Triple Captain",bank:st.bank,ft:earned,formation:gain.formation,cap:gain.cap}],usedChips:[...st.usedChips,chip]})}
        if(chip==="wildcard"){const totalBudget=Number((st.bank+st.squad.reduce((s,x)=>s+Number(x.sellPrice??x.player.price),0)).toFixed(1));const rebuilt=improveSquad(st.squad,pool,fixtures,gw,totalBudget);const gain=scoreState(rebuilt.squad,fixtures,gw,null);if(gain.points>base.points){next.push({...st,squad:rebuilt.squad,bank:rebuilt.bank,total:st.total+gain.points,steps:[...st.steps,{gw,action:"Wildcard rebuild",chip:"Wildcard",bank:rebuilt.bank,ft:earned,formation:gain.formation,cap:gain.cap}],usedChips:[...st.usedChips,chip]})}}
        if(chip==="freehit"){const totalBudget=Number((st.bank+st.squad.reduce((s,x)=>s+Number(x.sellPrice??x.player.price),0)).toFixed(1));const rebuilt=improveSquad(st.squad,pool,fixtures,gw,totalBudget);const gain=scoreState(rebuilt.squad,fixtures,gw,null);if(gain.points>base.points){next.push({...st,total:st.total+gain.points,steps:[...st.steps,{gw,action:"Free Hit squad",chip:"Free Hit",bank:st.bank,ft:earned,formation:gain.formation,cap:gain.cap}],usedChips:[...st.usedChips,chip]})}}
      }
    }
    next.sort((a,b)=>b.total-a.total);states=next.slice(0,12);
  }
  return states[0]?.steps||[];
}

export function optimiseSquad(picks:any[],elements:Player[],fixtures:any[],gw:number,bank=0,history:any=null){
  const horizon=gw+7,pool=elements.map(p=>projectPlayer(p,fixtures,horizon,gw)),byId=new Map(pool.map(p=>[p.id,p]));
  const current=picks.map(x=>({...x,player:byId.get(x.element),sellPrice:Number(x.selling_price??x.now_cost??byId.get(x.element)?.price??0)/10})).filter(x=>x.player);
  const built=buildXI(current,fixtures,gw),xi=built.xi,xiIds=new Set(xi.map(x=>x.player.id)),bench=current.filter(x=>!xiIds.has(x.player.id)).sort((a,b)=>b.player.projected-a.player.projected),starters=[...xi].sort((a,b)=>b.player.projected-a.player.projected);
  const remaining=remainingChips(history),usedChips=history?.chips||[];
  return{pool,current,starters,bench,transferIdeas:transferIdeas(current,pool,Number(bank||0)),bank:Number(bank||0),freeTransfers:getFT(history),currentGameweek:gw,rules:{squadSize:15,maxPlayersPerClub:3,formation:"1 GK, 3–5 DEF, 2–5 MID, 1–3 FWD",transferPositionLock:true,budgetConstraint:true,transferHit:4,maxFreeTransfers:5,sellingValueUsed:true},chips:{remaining,suggestions:remaining.map((c:string)=>({chip:c,reason:chipReason(c,current,fixtures,gw)})),used:usedChips},projectedGameweek:{points:Number(scoreState(current,fixtures,gw,null).points.toFixed(2)),captain:captainPlan(xi,fixtures,gw).captain,vice:captainPlan(xi,fixtures,gw).vice,formation:built.formation},decisionPlan:buildDecisionPlan(current,pool,fixtures,gw,Number(bank||0),history)};
}
