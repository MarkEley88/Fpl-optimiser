import {exactSearch} from "./exact-search";

type XState={gw:number,squad:any[],bank:number,freeTransfers:number,chips:string[]};
type Action={gw:number,transfers:any[],hit:number};

export function buildExactTransferPlan(args:{
  initial:any[],pool:any[],fixtures:any[],startGw:number,bank:number,history:any,entryHistory:any,
  getFT:(history:any,gw:number,entry:any)=>number,
  sellPrice:(x:any)=>number,
  makeCandidates:(squad:any[],pool:any[],bank:number,fixtures:any[],gw:number,horizon:number)=>any[],
  applyTransfer:(squad:any[],t:any)=>any[],
  weekScore:(p:any,fixtures:any[],gw:number)=>number,
  scoreState:(squad:any[],fixtures:any[],gw:number,cap:any,includeCaptain?:boolean)=>any
}){
  const {initial,pool,fixtures,startGw,bank,history,entryHistory,getFT,sellPrice,makeCandidates,applyTransfer,weekScore,scoreState}=args;
  const endGw=Math.min(38,startGw+4);
  const initialState:XState={gw:startGw,squad:initial,bank:Number(bank||0),freeTransfers:getFT(history,startGw,entryHistory),chips:[]};
  const stateKey=(s:XState)=>{
    const players=[...s.squad].sort((a,b)=>Number(a.player.id)-Number(b.player.id))
      .map(x=>Number(x.player.id)+":"+sellPrice(x).toFixed(1)).join(",");
    return s.gw+"|"+players+"|"+s.bank.toFixed(1)+"|"+s.freeTransfers+"|"+[...s.chips].sort().join(",");
  };
  const topWeekBound=new Map<number,number>();
  for(let g=startGw;g<=endGw;g++){
    const scores=pool.map(p=>weekScore(p,fixtures,g)).sort((a,b)=>b-a);
    topWeekBound.set(g,scores.slice(0,11).reduce((a,b)=>a+b,0));
  }
  const upperBound=(s:XState)=>{
    let v=0;for(let g=s.gw;g<=endGw;g++)v+=topWeekBound.get(g)||0;return v;
  };
  const enumerateWeekEnds=(base:XState)=>{
    type Path={squad:any[],bank:number,transfers:any[],seen:Set<string>};
    const results=new Map<string,Path>();
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
        const k=stateKey(nextState);if(path.seen.has(k))continue;
        const nextSeen=new Set(path.seen);nextSeen.add(k);
        visit({squad:nextSquad,bank:nextBank,transfers:[...path.transfers,t],seen:nextSeen});
      }
    };
    visit({squad:base.squad,bank:base.bank,transfers:[],seen:new Set([stateKey(base)])});
    return [...results.values()].map(path=>{
      const hit=Math.max(0,path.transfers.length-base.freeTransfers)*4;
      return{
        state:{gw:base.gw+1,squad:path.squad,bank:path.bank,freeTransfers:Math.min(5,Math.max(0,base.freeTransfers-path.transfers.length)+1),chips:base.chips} as XState,
        action:{gw:base.gw,transfers:path.transfers.map(t=>({out:t.out.player.name,in:t.in.name,cost:t.cost})),hit} as Action,
        points:scoreState(path.squad,fixtures,base.gw,null,false).points-hit
      };
    });
  };
  const result=exactSearch({
    start:initialState,endGw,
    expand:(state:XState)=>state.gw>endGw?[]:enumerateWeekEnds(state),
    terminalScore:()=>0,upperBound,key:stateKey
  });
  const holdBaseline=Array.from({length:endGw-startGw+1},(_,i)=>scoreState(initial,fixtures,startGw+i,null,false).points).reduce((a,b)=>a+b,0);
  if(!result.actions.length||result.score<=holdBaseline+.05){
    const steps:any[]=[];let ft=initialState.freeTransfers;
    for(let g=startGw;g<=endGw;g++){const base=scoreState(initial,fixtures,g,null);steps.push({gw:g,action:"Hold",chip:null,bank:Number(bank||0),ft,formation:base.formation,cap:base.cap,projectedGain:0});ft=Math.min(5,ft+1);}
    return {steps,search:{mode:"exact-transfer",score:result.score,nodes:result.nodes,memoHits:result.memoHits,pruned:result.pruned,complete:result.complete,elapsedMs:result.elapsedMs}};
  }
  let running=0;
  const steps=result.actions.map((a:any)=>{
    const transfers=a.transfers||[];const before=running;running+=a.points;
    const ids=transfers.map((t:any)=>t.in+" for "+t.out).join(" → ");
    return {gw:a.gw,action:transfers.length?ids+(a.hit?" (-"+a.hit+" points)":""):"Hold",chip:null,bank:Number(bank||0),ft:initialState.freeTransfers,transferSequence:transfers,projectedGain:Number((running-before).toFixed(2))};
  });
  return {steps,search:{mode:"exact-transfer",score:result.score,nodes:result.nodes,memoHits:result.memoHits,pruned:result.pruned,complete:result.complete,elapsedMs:result.elapsedMs}};
}
