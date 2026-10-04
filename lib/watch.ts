import type {CatalogInfo} from "./catalog";
export const kinds = {anime:"Anime",manga:"Manga",series:"Série",film:"Film"} as const;
export type Kind = keyof typeof kinds;
export type Media = {id:string;title:string;kind:Kind;priority:boolean;status:"watching"|"later"|"paused"|"completed";progress:number;total:number;duration:number;poster:string;sourceUrl:string;notes:string;catalog?:CatalogInfo};
export type Session = {id:string;mediaId:string;date:string;time:string;from:number;to:number;duration:number;done:boolean};
export type Settings = {budget:number;time:string;days:number[];reminders:boolean;timezone:string};
export type WatchState = {media:Media[];sessions:Session[];settings:Settings};
export const defaults:WatchState={media:[],sessions:[],settings:{budget:60,time:"21:00",days:[0,1,2,3,4,5,6],reminders:true,timezone:"America/New_York"}};
export const unit=(m:Media)=>m.kind==="manga"?"chap.":m.kind==="film"?"film":"ép.";
export const localDate=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
export function dayPlus(date:string,n:number){const d=new Date(date+"T12:00:00");d.setDate(d.getDate()+n);return localDate(d);}
export function planWeek(state:WatchState,start:string):Session[]{
 const candidates=state.media.filter(m=>m.status!=="completed"&&m.status!=="paused"&&(m.total===0||m.progress<m.total)).sort((a,b)=>Number(b.priority)-Number(a.priority)||a.title.localeCompare(b.title));
 const next=new Map(candidates.map(m=>[m.id,Math.max(m.progress,...state.sessions.filter(s=>s.mediaId===m.id).map(s=>s.to))+1]));
 const result:Session[]=[];
 for(let d=0;d<7;d++){
  const date=dayPlus(start,d);if(!state.settings.days.includes(new Date(date+"T12:00:00").getDay()))continue;
  const existing=state.sessions.filter(s=>s.date===date);
  let budget=state.settings.budget-existing.reduce((n,s)=>n+s.duration,0);
  const [h,mi]=state.settings.time.split(":").map(Number);let minute=Math.max(h*60+mi,...existing.map(s=>{const[t,u]=s.time.split(":").map(Number);return t*60+u+s.duration}));
  for(const m of candidates){
   const from=next.get(m.id)!;const limit=Math.min(m.total>0?m.total:Infinity,m.catalog?.available??Infinity);const remaining=Number.isFinite(limit)?Math.max(0,limit-from+1):(from===m.progress+1?1:0);
   const count=Math.min(remaining,Math.floor(budget/m.duration),Math.floor((1440-minute)/m.duration));
   if(count<=0)continue;
   const length=count*m.duration;
   result.push({id:crypto.randomUUID(),mediaId:m.id,date,time:`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`,from,to:from+count-1,duration:length,done:false});
   next.set(m.id,from+count);budget-=length;minute+=length;
  }
 }
 return result;
}
export function completeSession(state:WatchState,id:string):WatchState{
 const s=state.sessions.find(x=>x.id===id);if(!s)return state;
 return {...state,sessions:state.sessions.map(x=>x.id===id?{...x,done:true}:x),media:state.media.map(m=>m.id!==s.mediaId?m:{...m,progress:Math.max(m.progress,s.to),status:m.total>0&&Math.max(m.progress,s.to)>=m.total?"completed":"watching"})};
}
