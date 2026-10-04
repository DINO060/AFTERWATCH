import {db,userId,sameOrigin,stateSchema,readState,errorResponse,aiEnv} from "@/lib/server";
export async function GET(request:Request){try{return Response.json({...await readState(userId(request)),aiReady:!!aiEnv().GEMINI_API_KEY},{headers:{"Cache-Control":"no-store"}})}catch(e){return errorResponse(e)}}
export async function PUT(request:Request){try{
 sameOrigin(request);const id=userId(request);const raw=await request.text();if(raw.length>2000000)return Response.json({error:"Collection trop volumineuse."},{status:413});
 const body=JSON.parse(raw);const state=stateSchema.parse(body.state);const revision=body.revision;
 if(!Number.isSafeInteger(revision)||revision<0)return Response.json({error:"Version invalide."},{status:400});
 const result=await db().prepare("INSERT INTO watch_states (user_id, data, revision, updated_at) SELECT ?, ?, 1, ? WHERE ? = 0 ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, revision = watch_states.revision + 1, updated_at = excluded.updated_at WHERE watch_states.revision = ? RETURNING revision").bind(id,JSON.stringify(state),new Date().toISOString(),revision,revision).first<{revision:number}>();
 // Nonzero revisions must update an existing document.
 if(!result&&revision>0){const updated=await db().prepare("UPDATE watch_states SET data = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ? RETURNING revision").bind(JSON.stringify(state),new Date().toISOString(),id,revision).first<{revision:number}>();if(updated)return Response.json({revision:updated.revision});}
 if(!result)return Response.json({error:"La collection a changé sur un autre appareil. Recharge avant de réessayer."},{status:409});
 return Response.json({revision:result.revision});
}catch(e){return errorResponse(e)}}
