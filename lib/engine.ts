export type Player=any;

const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));

function fixtureScore(f:any,teamId:number){
  if(!f)return 0.5;
  const home=f.team_h===teamId;
  const diff=home?Number(f.team_h_difficulty||3):Number(f.team_a_difficulty||3);
  return clamp(1-(diff-1)/5,.08,.92);
}

function minutesProb(p:any){
  // Use FPL's availability/status fields first. The old version returned 88% for
  // almost every established starter, which was misleading.
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
  const games=fixtures.filter(f=>f.event && f.event>currentGw && f.event<=horizon &&
    (f.team_h===p.team || f.team_a===p.team));
  const fs=games.length?games.reduce((s,f)=>s+fixtureScore(f,p.team),0)/games.length:.5;
  const form=Number(p.form||0),ppg=Number(p.points_per_game||0);
  const xgi=Number(p.expected_goal_involvements||0)/(Math.max(1,Number(p.minutes||0))/90);
  const mins=minutesProb(p);
  const base=ppg*.38+form*.24+Math.min(2.5,xgi)*.9+fs*2.2;
  return {
    id:p.id,name:p.web_name,team:p.team,position:p.element_type,
    price:Number(p.now_cost||0)/10,startProbability:Math.round(mins*100),
    fixtureScore:fs,projected:Number((base*mins).toFixed(2)),
    status:p.status,chanceOfPlaying:p.chance_of_playing_next_round,
    news:p.news||""
  };
}

const posName=(p:number)=>({1:"Goalkeeper",2:"Defender",3:"Midfielder",4:"Forward"} as any)[p]||"Unknown";

function buildXI(players:any[]){
  const groups:any={1:[],2:[],3:[],4:[]};
  players.forEach(x=>groups[x.player.position]?.push(x));
  Object.values(groups).forEach((a:any[])=>a.sort((x,y)=>y.player.projected-x.player.projected));

  // Evaluate standard FPL formations and take the highest projected valid XI.
  const formations=[[3,4,3],[3,5,2],[4,4,2],[4,5,1],[4,3,3],[5,4,1],[5,3,2],[5,2,3]];
  let best:any[]=[]; let bestScore=-Infinity;
  for(const [d,m,f] of formations){
    if(groups[1].length<1||groups[2].length<d||groups[3].length<m||groups[4].length<f) continue;
    const xi=[...groups[1].slice(0,1),...groups[2].slice(0,d),...groups[3].slice(0,m),...groups[4].slice(0,f)];
    const score=xi.reduce((s,x)=>s+x.player.projected,0);
    if(score>bestScore){bestScore=score;best=xi;}
  }
  return best;
}


function teamFixtureScore(team:number, fixtures:any[], event:number){
  const games=fixtures.filter(f=>Number(f.event)===event&&(f.team_h===team||f.team_a===team));
  if(!games.length)return 0;
  return games.reduce((s,f)=>s+fixtureScore(f,team),0)/games.length;
}

function playerWeekScore(p:any, fixtures:any[], event:number){
  const fixture=teamFixtureScore(p.team,fixtures,event);
  const next=fixture||p.fixtureScore||.5;
  return Number((p.projected*(0.65+0.35*next)).toFixed(2));
}

function captainPlan(starters:any[], fixtures:any[], event:number){
  const ranked=[...starters].map(x=>({...x,weekScore:playerWeekScore(x.player,fixtures,event)}))
    .sort((a,b)=>b.weekScore-a.weekScore);
  return {
    captain:ranked[0]?.player||null,
    vice:ranked[1]?.player||null,
    candidates:ranked.slice(0,5).map(x=>({name:x.player.name,id:x.player.id,score:x.weekScore}))
  };
}

function buildFiveWeekPlan(current:any[], pool:any[], fixtures:any[], gw:number){
  const byId=new Map(pool.map(p=>[p.id,p]));
  let squad=current.map(x=>({...x,player:byId.get(x.element)})).filter(x=>x.player);
  const plan:any[]=[];
  for(let event=gw+1;event<=gw+5;event++){
    const projected=squad.map(x=>({...x,weekScore:playerWeekScore(x.player,fixtures,event)}));
    const bestXI=buildXI(projected);
    const captain=captainPlan(bestXI,fixtures,event);

    const clubCount=(team:number)=>squad.filter(x=>x.player.team===team).length;
    const weakest=[...squad].sort((a,b)=>playerWeekScore(a.player,fixtures,event)-playerWeekScore(b.player,fixtures,event));
    let transfer:any=null;
    for(const out of weakest){
      const replacement=pool
        .filter(p=>p.id!==out.player.id && !squad.some(x=>x.player.id===p.id))
        .filter(p=>p.position===out.player.position)
        .filter(p=>p.price<=out.player.price+0.5)
        .filter(p=>clubCount(p.team)<3 || p.team===out.player.team)
        .sort((a,b)=>playerWeekScore(b,fixtures,event)-playerWeekScore(a,fixtures,event))[0];
      if(replacement){
        const gain=playerWeekScore(replacement,fixtures,event)-playerWeekScore(out.player,fixtures,event);
        if(gain>=1.0){
          transfer={out:out.player.name,outId:out.player.id,in:replacement.name,inId:replacement.id,gain:Number(gain.toFixed(2))};
          squad=squad.filter(x=>x.player.id!==out.player.id);
          squad.push({element:replacement.id,player:replacement});
          break;
        }
      }
    }
    plan.push({
      gw:event,
      formation:bestXI.length?bestXI.map(x=>posName(x.player.position)).join("-"):"",
      transfer,
      captain:captain.captain?.name||null,
      captainId:captain.captain?.id||null,
      vice:captain.vice?.name||null,
      topCaptainCandidates:captain.candidates
    });
  }
  return plan;
}
\nexport function optimiseSquad(picks:any[],elements:Player[],fixtures:any[],gw:number,bank=0,history:any=null){
  const horizon=gw+5;
  const pool=elements.map(p=>projectPlayer(p,fixtures,horizon,gw));
  const byId=new Map(pool.map(p=>[p.id,p]));
  const current=picks.map(x=>({...x,player:byId.get(x.element)})).filter(x=>x.player);

  const xi=buildXI(current);
  const xiIds=new Set(xi.map(x=>x.player.id));
  const bench=current.filter(x=>!xiIds.has(x.player.id)).sort((a,b)=>b.player.projected-a.player.projected);
  const starters=[...xi].sort((a,b)=>b.player.projected-a.player.projected);

  const clubCount=(team:number)=>current.filter(x=>x.player.team===team).length;
  const candidates=pool
    .filter(p=>!current.some(x=>x.player.id===p.id))
    .sort((a,b)=>b.projected-a.projected);

  const transferIdeas:any[]=[];
  for(const out of [...current].sort((a,b)=>a.player.projected-b.player.projected)){
    for(const to of candidates){
      if(to.position!==out.player.position) continue; // never suggest GK -> defender etc.
      if(to.price > Number(out.player.price)+Number(bank)+1e-9) continue;
      if(clubCount(to.team) >= 3 && to.team!==out.player.team) continue;
      const delta=Number((to.projected-out.player.projected).toFixed(2));
      if(delta<=0) continue;
      transferIdeas.push({
        in:to.name,inId:to.id,out:out.player.name,outId:out.player.id,
        delta,price:to.price,position:posName(to.position)
      });
      if(transferIdeas.length>=12) break;
    }
    if(transferIdeas.length>=12) break;
  }
  transferIdeas.sort((a,b)=>b.delta-a.delta);

  const fiveWeekPlan=buildFiveWeekPlan(current,pool,fixtures,gw);\n\n  const chips=history?.chips||[];
  const used=new Set(chips.map((c:any)=>c.name));
  const remaining=["wildcard","freehit","bboost","3xc"].filter(x=>!used.has(x));
  const futureFixtures=fixtures.filter(f=>f.event>gw && f.event<=gw+5);
  const avgFixture=futureFixtures.length
    ? futureFixtures.reduce((s,f)=>s+(Number(f.team_h_difficulty||3)+Number(f.team_a_difficulty||3))/2,0)/futureFixtures.length
    : 3;
  const chipSuggestions:any[]=[];
  if(remaining.includes("bboost") && bench.length>=3 && bench.reduce((s,x)=>s+x.player.projected,0)>=12)
    chipSuggestions.push({chip:"Bench Boost",reason:"Your bench has meaningful projected points across the next five gameweeks."});
  if(remaining.includes("3xc")){
    const captain=[...starters].sort((a,b)=>b.player.projected-a.player.projected)[0];
    if(captain) chipSuggestions.push({chip:"Triple Captain",reason:"Monitor "+captain.player.name+" when a confirmed double gameweek appears; do not use it on a normal single fixture."});
  }
  if(remaining.includes("freehit") && avgFixture>=3.5)
    chipSuggestions.push({chip:"Free Hit",reason:"Keep available for a blank/double gameweek rather than forcing a normal-week use."});
  if(remaining.includes("wildcard"))
    chipSuggestions.push({chip:"Wildcard",reason:"Review squad structure when multiple fixture swings or a blank/double gameweek create a larger opportunity."});
  if(!chipSuggestions.length) chipSuggestions.push({chip:"No immediate chip",reason:"Hold chips until a confirmed blank/double gameweek or a materially stronger fixture opportunity."});

  return {
    pool,current,starters,bench,transferIdeas:transferIdeas.slice(0,8),
    bank:Number(bank||0),
    rules:{
      squadSize:15,maxPlayersPerClub:3,
      formation:"1 GK, 3–5 DEF, 2–5 MID, 1–3 FWD",
      transferPositionLock:true,
      budgetConstraint:true
    },
    chips:{remaining,suggestions:chipSuggestions,used:chips},\n    fiveWeekPlan
  };
}
