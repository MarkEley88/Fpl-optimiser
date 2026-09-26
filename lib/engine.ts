          const totalBudget=Number((st.bank+st.squad.reduce((s,x)=>s+sellPrice(x),0)).toFixed(1));
          const rebuilt=improveSquad(st.squad,pool,fixtures,gw,totalBudget);
          const rg=scoreState(rebuilt.squad,fixtures,gw,null,false);
          if(rg.points>base.points){
            next.push({
              ...st,squad:rebuilt.squad,bank:rebuilt.bank,ft:earned,recentMoves:[],
              total:st.total+rg.points,
              steps:[...st.steps,{
                gw,action:"Wildcard rebuild",chip:"Wildcard",bank:rebuilt.bank,ft:earned,
                formation:rg.formation,cap:rg.cap,
                projectedGain:Number((rg.points-base.points).toFixed(2))
              }],
              usedChips:[...st.usedChips,chip]
            });
          }
        }else if(chip==="freehit"){
          const totalBudget=Number((st.bank+st.squad.reduce((s,x)=>s+sellPrice(x),0)).toFixed(1));
          const best=bestTemporarySquad(st.squad,pool,fixtures,gw,totalBudget);
          const tmp=best.map((p:any)=>({player:p}));
          const fg=scoreState(tmp,fixtures,gw,null,false);
          if(fg.points>base.points){
            next.push({
              ...st,ft:earned,total:st.total+fg.points,
              steps:[...st.steps,{
                gw,action:"Free Hit squad",chip:"Free Hit",bank:st.bank,ft:earned,
                formation:fg.formation,cap:fg.cap,substitutions:plannedSubstitutions(tmp,fixtures,gw),
                projectedGain:Number((fg.points-base.points).toFixed(2))
              }],
              usedChips:[...st.usedChips,chip]
            });
          }
        }else{
          next.push({
            ...st,ft:earned,total:st.total+gain.points,
            steps:[...st.steps,{
              gw,action:"Hold",chip:chip==="bboost"?"Bench Boost":"Triple Captain",
              bank:st.bank,ft:earned,formation:gain.formation,cap:gain.cap,
              projectedGain:Number((gain.points-base.points).toFixed(2))
            }],
            usedChips:[...st.usedChips,chip]
          });
        }
      }
    }

    // Rank once per state. The continuation value for a funding state was
    // calculated when that state was created; do not recursively search future
    // transfers during sorting.
    next.sort((a:any,b:any)=>(b.total+fixedFuture(b.squad,gw+1))-(a.total+fixedFuture(a.squad,gw+1)));
    states=next.slice(0,BEAM);
    console.log("[decision-plan] completed GW",gw,"frontier",states.length);
  }

  states.sort((a:any,b:any)=>b.total-a.total);
  const best=states[0];

  let holdBaseline=0;
  for(let g=startGw;g<=endGw;g++)holdBaseline+=scoreState(initial,fixtures,g,null,false).points;

  if(!best||best.total<=holdBaseline+0.05){
    let ft=getFT(history,startGw,entryHistory);
    const holdSteps:any[]=[];
    for(let g=startGw;g<=endGw;g++){
      const base=scoreState(initial,fixtures,g,null);
      holdSteps.push({
        gw:g,action:"Hold",chip:null,bank:Number(bank||0),ft,
        formation:base.formation,cap:base.cap,projectedGain:0
      });
      ft=Math.min(5,ft+1);
    }
    return holdSteps;
  }
  return best.steps;
}


function buildExactTransferPlan(initial:any[],pool:any[],fixtures:any[],startGw:number,bank:number,history:any,entryHistory:any=null){
  // Exact transfer-only planner. Unlike the production beam search, this
  // enumerates every legal transfer sequence, canonicalises equivalent squad
  // states (including selling values), and uses only an optimistic points bound
  // for pruning. No player-price quality signal is introduced.
  const endGw=Math.min(38,startGw+4);
  type XState={
    gw:number,
    squad:any[],
    bank:number,
    freeTransfers:number,
    chips:string[]
  };
  type Action={gw:number,transfers:any[],hit:number};
  const initialState:XState={
    gw:startGw,
    squad:initial,
    bank:Number(bank||0),
    freeTransfers:getFT(history,startGw,entryHistory),
    chips:[]
  };

  const stateKey=(s:XState)=>{
    const players=[...s.squad].sort((a,b)=>Number(a.player.id)-Number(b.player.id))
      .map(x=>Number(x.player.id)+":"+sellPrice(x).toFixed(1)).join(",");
    return s.gw+"|"+players+"|"+s.bank.toFixed(1)+"|"+s.freeTransfers+"|"+s.chips.sort().join(",");
  };

  const topWeekBound=new Map<number,number>();
  for(let g=startGw;g<=endGw;g++){
    const scores=pool.map(p=>weekScore(p,fixtures,g)).sort((a,b)=>b-a);
    topWeekBound.set(g,scores.slice(0,11).reduce((a,b)=>a+b,0));
  }
  const upperBound=(s:XState)=>{
    let v=0;
    for(let g=s.gw;g<=endGw;g++)v+=topWeekBound.get(g)||0;
    return v;
  };

  const enumerateWeekEnds=(base:XState)=>{
    type Path={squad:any[],bank:number,transfers:any[],seen:Set<string>};
    const results=new Map<string,Path>();
    const startPath:Path={squad:base.squad,bank:base.bank,transfers:[],seen:new Set([stateKey({...base,gw:base.gw})])};
    const visit=(path:Path)=>{
      const stopKey=[...path.squad].sort((a,b)=>Number(a.player.id)-Number(b.player.id))
        .map(x=>Number(x.player.id)+":"+sellPrice(x).toFixed(1)).join(",")+"|"+path.bank.toFixed(1);
      const existing=results.get(stopKey);
      if(!existing||path.transfers.length<existing.transfers.length)results.set(stopKey,path);

      const legal=makeCandidates(path.squad,pool,path.bank,fixtures,base.gw,Math.min(5,endGw-base.gw+1));
      for(const t of legal){
        const nextSquad=applyTransfer(path.squad,t);
        const nextBank=Number((path.bank-t.cost).toFixed(1));
        const nextState:XState={...base,squad:nextSquad,bank:nextBank};
        const k=stateKey(nextState);