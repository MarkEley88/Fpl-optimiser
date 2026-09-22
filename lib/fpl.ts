const BASE_URL="https://fantasy.premierleague.com/api";
const FALLBACK_CACHE_URL="https://raw.githubusercontent.com/MarkEley88/Fpl-optimiser/main/data/fpl-cache.json";
const DEFAULT_HEADERS={
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  "Accept":"application/json, text/plain, */*",
  "Accept-Language":"en-GB,en;q=0.9",
  "Referer":"https://fantasy.premierleague.com/",
  "Origin":"https://fantasy.premierleague.com",
  "Sec-Fetch-Dest":"empty",
  "Sec-Fetch-Mode":"cors",
  "Sec-Fetch-Site":"same-origin"
};

type Cache=Record<string,any>;

let cached:Cache|null=null;
let cachedAt=0;
const CACHE_TTL_MS=30000;

async function getLive(path:string):Promise<any>{
  let lastStatus=0;
  let lastBody="";
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch(BASE_URL+path,{
        cache:"no-store",
        headers:DEFAULT_HEADERS,
        signal:AbortSignal.timeout(15000)
      });
      if(r.ok)return r.json();
      lastStatus=r.status;
      lastBody=(await r.text()).slice(0,200);
      if(![403,429,500,502,503,504].includes(r.status))break;
    }catch(e){
      lastBody=String(e);
    }
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,750*(attempt+1)));
  }
  throw Error("FPL API "+lastStatus+" for "+path+(lastBody?": "+lastBody:""));
}

async function getRemoteFallback():Promise<Cache>{
  const r=await fetch(FALLBACK_CACHE_URL,{
    cache:"no-store",
    headers:{"Accept":"application/json"},
    signal:AbortSignal.timeout(10000)
  });
  if(!r.ok)throw Error("FPL fallback cache "+r.status);
  const data=await r.json();
  if(!data?.bootstrap||!data?.fixtures||!data?.team||!data?.history||!data?.picks){
    throw Error("FPL fallback cache is incomplete");
  }
  return {...data,source:"github-cache"};
}

async function getCache():Promise<Cache>{
  const now=Date.now();
  if(cached && now-cachedAt<CACHE_TTL_MS)return cached;

  const id=process.env.FPL_TEAM_ID||"1187241";
  try{
    const [bootstrap,fixtures,team,history]=await Promise.all([
      getLive("/bootstrap-static/"),
      getLive("/fixtures/"),
      getLive("/entry/"+id+"/"),
      getLive("/entry/"+id+"/history/")
    ]);

    const gw=Number(team?.current_event||history?.current?.at(-1)?.event||1);
    const picks=await getLive("/entry/"+id+"/event/"+gw+"/picks/");

    cached={generatedAt:new Date().toISOString(),bootstrap,fixtures,team,history,picks,source:"live"};
    cachedAt=now;
    return cached;
  }catch(liveError){
    console.warn("FPL live API unavailable; trying GitHub cache",String(liveError));
    try{
      const fallback=await getRemoteFallback();
      cached=fallback;
      cachedAt=now;
      return cached;
    }catch(fallbackError){
      throw Error("FPL live API unavailable and fallback cache unavailable: "+String(fallbackError));
    }
  }
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
export const getFplDataSource=async()=>String((await getCache()).source||"unknown");
