const CACHE_URL="https://raw.githubusercontent.com/MarkEley88/Fpl-optimiser/main/data/fpl-cache.json";

type Cache=Record<string,any>;

let cached:Cache|null=null;
let cachedAt=0;

async function getCache():Promise<Cache>{
  const now=Date.now();
  if(cached && now-cachedAt<15000)return cached;
  const r=await fetch(CACHE_URL+"?t="+now,{cache:"no-store"});
  if(!r.ok)throw Error("FPL cache "+r.status);
  const data=await r.json();
  if(!data.bootstrap || !data.fixtures || !data.team || !data.history || !data.picks){
    throw Error("FPL live cache unavailable");
  }
  cached=data;
  cachedAt=now;
  return data;
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