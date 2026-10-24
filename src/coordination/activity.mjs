import {openRuntimeDatabase} from '../runtime/database.mjs';
export function captureSharedActivity(root,intentId){
  const database=openRuntimeDatabase(root);
  try{
    const session=database.prepare('SELECT owner_id,tool,phase_key,status,summary,awaiting_human,question,started_at,updated_at,ended_at FROM active_sessions WHERE work_item_id=?').get(intentId);
    if(!session)return null;
    const events=database.prepare('SELECT event_type,phase_key,summary,details,tool,metadata_json,requires_human,created_at FROM activity_events WHERE work_item_id=? ORDER BY id DESC LIMIT 100').all(intentId).reverse();
    for(const event of events){
      let metadata;try{metadata=JSON.parse(event.metadata_json);}catch{metadata={};}
      const allowed=['persona','personaRef','personaName','personaTier','personaRole','personaDepth','speech','kind','phase','taskId'];
      event.metadata_json=JSON.stringify(Object.fromEntries(Object.entries(metadata).filter(([key])=>allowed.includes(key))));
    }
    return {session,events};
  }finally{database.close();}
}
export function hydrateSharedActivity(root,intentId,work){
  if(!work?.session)return;
  const database=openRuntimeDatabase(root);
  try{
    if(!database.prepare('SELECT id FROM work_items WHERE id=?').get(intentId))return;
    const s=work.session;
    database.exec('BEGIN IMMEDIATE;');
    database.prepare(`INSERT INTO active_sessions(work_item_id,owner_id,tool,phase_key,status,summary,awaiting_human,question,started_at,updated_at,ended_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(work_item_id) DO UPDATE SET owner_id=excluded.owner_id,tool=excluded.tool,phase_key=excluded.phase_key,status=excluded.status,summary=excluded.summary,awaiting_human=excluded.awaiting_human,question=excluded.question,started_at=excluded.started_at,updated_at=excluded.updated_at,ended_at=excluded.ended_at`).run(intentId,s.owner_id,s.tool,s.phase_key,s.status,s.summary,s.awaiting_human,s.question,s.started_at,s.updated_at,s.ended_at);
    const session=database.prepare('SELECT id FROM active_sessions WHERE work_item_id=?').get(intentId);
    database.prepare('DELETE FROM activity_events WHERE work_item_id=?').run(intentId);
    for(const e of work.events??[])database.prepare('INSERT INTO activity_events(session_id,work_item_id,event_type,phase_key,summary,details,tool,metadata_json,requires_human,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(session.id,intentId,e.event_type,e.phase_key,e.summary,e.details,e.tool,e.metadata_json,e.requires_human,e.created_at);
    database.exec('COMMIT;');
  }catch(error){if(database.isTransaction)database.exec('ROLLBACK;');throw error;}finally{database.close();}
}
