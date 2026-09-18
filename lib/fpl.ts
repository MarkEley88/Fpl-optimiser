const BASE="https://fantasy.premierleague.com/api";
export async function fpl(path:string){const r=await fetch(BASE+path,{cache:"no-store",headers:{"User-Agent":"FPL-Optimiser/0.3"}});if(!r.ok)throw Error("FPL "+r.status);return r.json();}
export const getBootstrap=()=>fpl("/bootstrap-static/");
export const getTeam=(id:string)=>fpl("/entry/"+id+"/");
export const getHistory=(id:string)=>fpl("/entry/"+id+"/history/");
export const getPicks=(id:string,gw:number)=>fpl("/entry/"+id+"/event/"+gw+"/picks/");
export const getFixtures=()=>fpl("/fixtures/");
export const getElementSummary=(id:number|string)=>fpl("/element-summary/"+id+"/");