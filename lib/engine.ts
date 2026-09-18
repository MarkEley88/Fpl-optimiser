export type Player=any;
const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
function fixtureScore(f:any,teamId:number){if(!f)return 0.5;const home=f.team_h===teamId;const diff=home?f.team_h_difficulty:f.team_a_difficulty;return clamp(1-(Number(diff||3)-1)/5,.08,.92);}
function minutesProb(p:any){const m=Number(p.minutes||0),starts=Number(p.starts||0);if(starts>=3)return .88;if(starts>=1)return .78;if(m>0)return .55;return .25;}
export function projectPlayer(p:Player,fixtures:any[],horizon=5){
 const games=fixtures.filter(f=>f.event&&f.event<=horizon&&(f.team_h===p.team||f.team_a===p.team));
 const fs=games.length?games.reduce((s,f)=>s+fixtureScore(f,p.team),0)/games.length:.5;
 const form=Number(p.form||0),ppg=Number(p.points_per_game||0),xgi=(Number(p.expected_goal_involvements||0)/(Number(p.minutes||1)/90||1));
 const mins=minutesProb(p);
 const base=ppg*.38+form*.24+Math.min(2.5,xgi)*.9+fs*2.2;
 return {id:p.id,name:p.web_name,team:p.team,position:p.element_type,price:Number(p.now_cost||0)/10,startProbability:Math.round(mins*100),fixtureScore:fs,projected:Number((base*mins).toFixed(2))};
}
export function squadValue(picks:any[],elements:Player[]){return picks.reduce((s,x)=>{const p=elements.find(e=>e.id===x.element);return s+Number(p?.now_cost||0)/10},0);}
export function optimiseSquad(picks:any[],elements:Player[],fixtures:any[],gw:number){
 const horizon=gw+5;const pool=elements.map(p=>projectPlayer(p,fixtures,horizon));
 const byId=new Map(pool.map(p=>[p.id,p]));
 const current=picks.map(x=>({...x,player:byId.get(x.element)})).filter(x=>x.player);
 const bench=current.filter(x=>!x.multiplier).sort((a,b)=>a.player.projected-b.player.projected);
 const starters=current.filter(x=>x.multiplier!==0).sort((a,b)=>b.player.projected-a.player.projected);
 const candidates=pool.filter(p=>!current.some(x=>x.player.id===p.id)).sort((a,b)=>b.projected-a.projected);
 const transferIdeas=candidates.slice(0,8).map(to=>{const out=current.slice().sort((a,b)=>a.player.projected-b.player.projected)[0];return {in:to.name,inId:to.id,out:out?.player.name,outId:out?.player.id,delta:Number((to.projected-(out?.player.projected||0)).toFixed(2)),price:to.price};});
 return {pool,current,starters,bench,transferIdeas};
}