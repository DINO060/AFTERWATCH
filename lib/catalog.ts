import type {Kind,Media} from './watch';
export type CatalogSource='jikan'|'kitsu'|'cinemeta'|'tvmaze';
export type CatalogInfo={source:CatalogSource;id:string;synopsis:string;genres:string[];year:string;score:number|null;episodes:number|null;chapters:number|null;volumes:number|null;seasons:number|null;available:number|null;releaseStatus:string;format:string;durationKnown:boolean};
export type CatalogItem={catalog:CatalogInfo;title:string;kind:Kind;poster:string;sourceUrl:string;total:number;duration:number;subtitle:string};
export type CatalogPage={results:CatalogItem[];page:number;hasNext:boolean;totalResults:number|null;source:string;notice?:string};
export function sameTitle(m:Media,item:CatalogItem){return m.kind===item.kind&&((m.catalog?.source===item.catalog.source&&m.catalog.id===item.catalog.id)||(m.sourceUrl&&m.sourceUrl===item.sourceUrl)||m.title.trim().toLocaleLowerCase()===item.title.trim().toLocaleLowerCase());}
export function mediaFromCatalog(item:CatalogItem):Media{return {...item,id:crypto.randomUUID(),priority:false,status:'later',progress:0,notes:''};}
export function itemFromMedia(m:Media):CatalogItem{return {title:m.title,kind:m.kind,poster:m.poster,sourceUrl:m.sourceUrl,total:m.total,duration:m.duration,subtitle:m.catalog?.year||'',catalog:m.catalog||{source:m.sourceUrl.includes('tvmaze')?'tvmaze':'jikan',id:m.sourceUrl.match(/\/(?:anime|manga|shows)\/(\d+)/)?.[1]||'',synopsis:'',genres:[],year:'',score:null,episodes:m.kind==='anime'||m.kind==='series'?m.total||null:null,chapters:m.kind==='manga'?m.total||null:null,volumes:null,seasons:null,available:null,releaseStatus:'',format:'',durationKnown:false}};}
export function countLabel(item:CatalogItem){const c=item.catalog;if(item.kind==='film')return c.durationKnown?`${item.duration} min`:'Film';if(item.kind==='manga')return c.chapters!==null?`${c.chapters} chapitres`:c.volumes!==null?`${c.volumes} tomes`:'Chapitres non renseignés';if(c.episodes!==null)return `${c.episodes} épisodes`;return c.seasons!==null?`${c.seasons} saisons`:'Épisodes : voir la fiche';}
export function cleanText(value:unknown,max=12000){return String(value||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>/gi,'\n\n').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').trim().slice(0,max);}
export function parseMinutes(value:unknown,fallback:number){const text=String(value||'');const hours=text.match(/(\d+)\s*(?:hr|hour|h)/i);const mins=text.match(/(\d+)\s*(?:min|m\b)/i);const n=(hours?Number(hours[1])*60:0)+(mins?Number(mins[1]):0);return n>0&&n<=600?n:fallback;}
export function normalizeJikan(x:any,kind:'anime'|'manga'):CatalogItem{
 const duration=kind==='manga'?10:parseMinutes(x.duration,24);const total=(kind==='manga'?x.chapters:x.episodes)||0;
 return {title:String(x.title||x.title_english||'Sans titre').slice(0,180),kind,poster:x.images?.webp?.large_image_url||x.images?.jpg?.large_image_url||x.images?.webp?.image_url||'',sourceUrl:x.url||`https://myanimelist.net/${kind}/${x.mal_id}`,total,duration,subtitle:[x.year||x.aired?.prop?.from?.year||x.published?.prop?.from?.year,x.type].filter(Boolean).join(' · '),catalog:{source:'jikan',id:String(x.mal_id),synopsis:cleanText(x.synopsis),genres:[...(x.genres||[]),...(x.themes||[])].map((g:any)=>String(g.name)).slice(0,20),year:String(x.year||x.aired?.prop?.from?.year||x.published?.prop?.from?.year||''),score:typeof x.score==='number'?x.score:null,episodes:typeof x.episodes==='number'?x.episodes:null,chapters:typeof x.chapters==='number'?x.chapters:null,volumes:typeof x.volumes==='number'?x.volumes:null,seasons:null,available:x.status==='Finished Airing'?x.episodes||null:null,releaseStatus:cleanText(x.status,100),format:cleanText(x.type,100),durationKnown:kind!=='manga'&&/\d/.test(x.duration||'')}};
}
export function normalizeCinemeta(x:any,detail=false):CatalogItem{
 const kind:Kind=x.type==='series'?'series':'film';const videos=Array.isArray(x.videos)?x.videos.filter((v:any)=>v.season>0&&v.episode>0):null;const seasons=videos?new Set(videos.map((v:any)=>v.season)).size:null;
 const available=videos?videos.filter((v:any)=>v.released&&!isNaN(Date.parse(v.released))&&Date.parse(v.released)<=Date.now()).length:null;
 return {title:String(x.name||'Sans titre').slice(0,180),kind,poster:x.poster||'',sourceUrl:`https://www.imdb.com/title/${x.id}/`,total:kind==='film'?1:videos?.length||0,duration:parseMinutes(x.runtime,kind==='film'?120:45),subtitle:String(x.releaseInfo||''),catalog:{source:'cinemeta',id:String(x.id),synopsis:cleanText(x.description),genres:(x.genres||[]).map(String).slice(0,20),year:String(x.releaseInfo||''),score:Number.isFinite(Number(x.imdbRating))&&x.imdbRating!==null?Number(x.imdbRating):null,episodes:kind==='series'&&detail?videos?.length||null:null,chapters:null,volumes:null,seasons:seasons||null,available,releaseStatus:kind==='series'?(String(x.releaseInfo||'').endsWith('–')||String(x.releaseInfo||'').endsWith('-')?'En cours':''): '',format:kind==='film'?'Film':'Série',durationKnown:/\d/.test(x.runtime||'')}};
}
export function normalizeTVMaze(x:any):CatalogItem{
 const episodes=Array.isArray(x._embedded?.episodes)?x._embedded.episodes.filter((e:any)=>e.number!==null):null;const total=episodes?.length||0;const available=episodes?episodes.filter((e:any)=>e.airstamp&&Date.parse(e.airstamp)<=Date.now()).length:null;
 return {title:String(x.name).slice(0,180),kind:'series',poster:x.image?.original||x.image?.medium||'',sourceUrl:x.url,total,duration:x.averageRuntime||x.runtime||45,subtitle:[x.premiered?.slice(0,4),x.language].filter(Boolean).join(' · '),catalog:{source:'tvmaze',id:String(x.id),synopsis:cleanText(x.summary),genres:(x.genres||[]).map(String).slice(0,20),year:x.premiered?.slice(0,4)||'',score:x.rating?.average??null,episodes:episodes?total:null,chapters:null,volumes:null,seasons:episodes?new Set(episodes.map((e:any)=>e.season)).size:null,available,releaseStatus:x.status||'',format:x.type||'Série',durationKnown:!!(x.averageRuntime||x.runtime)}};
}

/** Kitsu's public JSON:API returns metadata under attributes. Unknown counts stay null. */
export function normalizeKitsu(resource:any,kind:'anime'|'manga',included:any[]=[]):CatalogItem{
 const x=resource.attributes||{};
 const positive=(v:any):number|null=>typeof v==='number'&&Number.isInteger(v)&&v>0?v:null;
 const episodes=positive(x.episodeCount),chapters=positive(x.chapterCount),volumes=positive(x.volumeCount);
 const duration=kind==='manga'?10:positive(x.episodeLength)||24;
 const categoryIds=new Set((resource.relationships?.categories?.data||[]).map((c:any)=>c.id));
 const genres=included.filter(c=>c.type==='categories'&&categoryIds.has(c.id)).map(c=>String(c.attributes?.title||'')).filter(Boolean).slice(0,20);
 const status:Record<string,string>={current:'En cours',finished:'Terminé',tba:'À confirmer',unreleased:'À venir',upcoming:'À venir'};
 const score=x.averageRating===null||x.averageRating===undefined?null:Number(x.averageRating)/10;
 const year=String(x.startDate||'').slice(0,4);
 return {title:String(x.canonicalTitle||x.titles?.en||x.titles?.en_jp||'Sans titre').slice(0,180),kind,
  poster:x.posterImage?.large||x.posterImage?.medium||x.posterImage?.original||'',
  sourceUrl:`https://kitsu.app/${kind}/${encodeURIComponent(x.slug||resource.id)}`,
  total:(kind==='manga'?chapters:episodes)||0,duration:Math.min(duration,600),subtitle:[year,x.subtype].filter(Boolean).join(' · '),
  catalog:{source:'kitsu',id:String(resource.id),synopsis:cleanText(x.synopsis||x.description),genres,year,
   score:score!==null&&Number.isFinite(score)?Math.min(10,Math.max(0,score)):null,
   episodes,chapters,volumes,seasons:null,available:kind==='anime'&&x.status==='finished'?episodes:null,
   releaseStatus:status[x.status]||cleanText(x.status,100),format:cleanText(x.subtype,100),durationKnown:kind==='anime'&&!!positive(x.episodeLength)}};
}
