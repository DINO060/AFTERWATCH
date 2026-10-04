import {env} from "cloudflare:workers";
import {z} from "zod";
import {defaults} from "./watch";
export function db(){if(!env.DB)throw new Error("Database unavailable");return env.DB;}
export function userId(request:Request){
 const id=request.headers.get("oai-authenticated-user-id");
 if(id)return id;
 if(process.env.NODE_ENV==="development")return "local-preview";
 throw new Response(JSON.stringify({error:"Connecte-toi pour retrouver ta collection."}),{status:401,headers:{"Content-Type":"application/json"}});
}
export function sameOrigin(request:Request){const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)throw new Response("Forbidden",{status:403});}
const imageUrl=z.string().max(2000).refine(s=>!s||/^https:\/\/(media\.kitsu\.app|media\.kitsu\.io|cdn\.myanimelist\.net|static\.tvmaze\.com|images\.metahub\.space|m\.media-amazon\.com|image\.tmdb\.org)\//.test(s));
const sourceUrl=z.string().max(2000).refine(s=>!s||/^https:\/\/(kitsu\.app|kitsu\.io|myanimelist\.net|www\.tvmaze\.com|www\.imdb\.com)\//.test(s));
const mediaSchema=z.object({id:z.string().uuid(),title:z.string().trim().min(1).max(180),kind:z.enum(["anime","manga","series","film"]),priority:z.boolean(),status:z.enum(["watching","later","paused","completed"]),progress:z.number().int().min(0).max(100000),total:z.number().int().min(0).max(100000),duration:z.number().int().min(1).max(600),poster:imageUrl,sourceUrl,notes:z.string().max(2000),catalog:z.object({source:z.enum(['jikan','kitsu','cinemeta','tvmaze']),id:z.string().max(50),synopsis:z.string().max(12000),genres:z.array(z.string().max(100)).max(20),year:z.string().max(40),score:z.number().min(0).max(10).nullable(),episodes:z.number().int().min(0).max(100000).nullable(),chapters:z.number().int().min(0).max(100000).nullable(),volumes:z.number().int().min(0).max(100000).nullable(),seasons:z.number().int().min(0).max(10000).nullable(),available:z.number().int().min(0).max(100000).nullable(),releaseStatus:z.string().max(100),format:z.string().max(100),durationKnown:z.boolean()}).optional()}).refine(m=>m.total===0||m.progress<=m.total,{message:"La progression dépasse le total."});
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s+"T00:00:00Z");return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===s});
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const stateSchema=z.object({media:z.array(mediaSchema).max(1000),sessions:z.array(z.object({id:z.string().uuid(),mediaId:z.string().uuid(),date,time,from:z.number().int().min(1).max(100000),to:z.number().int().min(1).max(100000),duration:z.number().int().min(1).max(1440),done:z.boolean()}).refine(s=>s.to>=s.from)).max(5000),settings:z.object({budget:z.number().int().min(15).max(600),time,days:z.array(z.number().int().min(0).max(6)).min(1).max(7),reminders:z.boolean(),timezone:z.string().max(100).refine(s=>{try{new Intl.DateTimeFormat("fr",{timeZone:s});return true}catch{return false}})})}).superRefine((s,ctx)=>{
 if(new Set(s.media.map(m=>m.id)).size!==s.media.length||new Set(s.sessions.map(m=>m.id)).size!==s.sessions.length)ctx.addIssue({code:"custom",message:"Identifiant en double."});
 for(const session of s.sessions){const m=s.media.find(x=>x.id===session.mediaId);if(!m||(m.total>0&&session.to>m.total))ctx.addIssue({code:"custom",message:"Séance incohérente avec le titre."});}
});
export async function readState(id:string){const row=await db().prepare("SELECT data, revision FROM watch_states WHERE user_id = ?").bind(id).first<{data:string;revision:number}>();return row?{state:JSON.parse(row.data),revision:row.revision}:{state:defaults,revision:0};}
export function errorResponse(e:unknown){if(e instanceof Response)return e;if(e instanceof z.ZodError)return Response.json({error:e.issues[0]?.message||"Informations invalides."},{status:400});console.error("Afterwatch operation failed",e instanceof Error?e.message:"unknown");return Response.json({error:"Impossible de sauvegarder pour le moment. Tes modifications restent affichées ; réessaie."},{status:503});}
export const aiEnv=()=>env as unknown as {GEMINI_API_KEY?:string};
