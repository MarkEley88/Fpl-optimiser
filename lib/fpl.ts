const BASE="https://fantasy.premierleague.com/api";

const headers={
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Accept":"application/json, text/plain, */*",
  "Accept-Language":"en-GB,en;q=0.9,en-US;q=0.8",
  "Referer":"https://fantasy.premierleague.com/",
  "Origin":"https://fantasy.premierleague.com"
};

export async function fpl(path:string){
  let lastStatus=0;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch(BASE+path,{cache:"no-store",headers,redirect:"follow"});
      if(r.ok)return r.json();
      lastStatus=r.status;
      if(r.status!==403&&r.status!==429)break;
    }catch{
      if(attempt===2)throw Error("FPL unavailable");
    }
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
  }
  throw Error("FPL "+lastStatus);
}

export const getBootstrap=()=>fpl("/bootstrap-static/");
export const getTeam=(id:string)=>fpl("/entry/"+id+"/");
export const getHistory=(id:string)=>fpl("/entry/"+id+"/history/");
export const getPicks=(id:string,gw:number)=>fpl("/entry/"+id+"/event/"+gw+"/picks/");
export const getFixtures=()=>fpl("/fixtures/");
export const getElementSummary=(id:number|string)=>fpl("/element-summary/"+id+"/");