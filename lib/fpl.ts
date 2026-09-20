const BASE_URL="https://fantasy.premierleague.com/api";
const DEFAULT_HEADERS={
  "User-Agent":"Mozilla/5.0 FPL Optimiser",
  "Accept":"application/json",
  "Referer":"https://fantasy.premierleague.com/"
};

type Cache=Record<string,any>;

let cached:Cache|null=null;
let cachedAt=0;
const CACHE_TTL_MS=30000;

async function getLive(path:string):Promise<any>{
  const r=await fetch(BASE_URL+path,{cache:"no-store",headers:DEFAULT_HEADERS});
  if(!r.ok)throw Error("FPL API "+r.status+" for "+path);
  return r.json();
}

async function getCache():Promise<Cache>{
  const now=Date.now();
  if(cached && now-cachedAt<CACHE_TTL_MS)return cached;

  const id=process.env.FPL_TEAM_ID||"1187241";
  const [bootstrap,fixtures,team,history]=await Promise.all([
    getLive("/bootstrap-static/"),
    getLive("/fixtures/"),
    getLive("/entry/"+id+"/"),
    getLive("/entry/"+id+"/history/")
  ]);

  const gw=Number(team?.current_event||history?.current?.at(-1)?.event||1);
  const picks=await getLive("/entry/"+id+"/event/"+gw+"/picks/");

  cached={generatedAt:new Date().toISOString(),bootstrap,fixtures,team,history,picks};
  cachedAt=now;
  return cached;
}

export async function fpl(path:string){
  const c=await getCache();
  if(path==="/bootstrap-static/")return c.bootstrap;
  if(path==="/fixtures/")return c.fixtures;
  const teamMatch=path.match(/^\/entry\/([^/]+)\/$/);
  if(teamMatch)return c.team;
  const historyMatch=path.match(/^\/entry\/([^/]+)\/history\/$/);
  if(historyMatch)return c.history;
  const picksMatch=path.match(/^\/entry\/([^/]+)\/event\/([0-9]+)\/picks\/$/);
  if(picksMatch)return c.picks;
  throw Error("Unsupported FPL endpoint");
}

export const getBootstrap=()=>fpl("/bootstrap-static/");
export const getTeam=(id:string)=>fpl("/entry/"+id+"/");
export const getHistory=(id:string)=>fpl("/entry/"+id+"/history/");
export const getPicks=(id:string,gw:number)=>fpl("/entry/"+id+"/event/"+gw+"/picks/");
export const getFixtures=()=>fpl("/fixtures/");
export const getElementSummary=(id:number|string)=>fpl("/element-summary/"+id+"/");
