import {mkdirSync,chmodSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {projectPaths} from '../paths.mjs';
import {safeLocalPath} from './config.mjs';
import {fail} from './contract.mjs';

// This is a local high-water mark, never an alternative intent authority.
// SQLite serialises concurrent CLI/MCP observations so one reader cannot erase
// another reader's acknowledged revision by replacing a JSON connection file.
export function observeRevisions(root,connection,entries,{strict=false,complete=false}={}){
  const path=safeLocalPath(root,resolve(projectPaths(root).runtimeRoot,'runtime/coordination-revisions.sqlite'));
  mkdirSync(dirname(path),{recursive:true,mode:0o700});const db=new DatabaseSync(path);chmodSync(path,0o600);
  try{
    db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS observations(identity TEXT,project TEXT,intent TEXT,revision INTEGER NOT NULL,PRIMARY KEY(identity,project,intent)); BEGIN IMMEDIATE;');
    const acknowledged={...connection.revisions,...Object.fromEntries(db.prepare('SELECT intent,revision FROM observations WHERE identity=? AND project=?').all(connection.identity,connection.projectId).map(row=>[row.intent,row.revision]))};
    if(complete){
      const returned=new Set(entries.map(entry=>entry.record.id));
      if(Object.keys(acknowledged).some(id=>!returned.has(id)))fail('coordination-catalogue-rollback');
    }
    for(const entry of entries){
      const id=entry.record.id,row=db.prepare('SELECT revision FROM observations WHERE identity=? AND project=? AND intent=?').get(connection.identity,connection.projectId,id);
      const previous=Math.max(row?.revision??0,connection.revisions?.[id]??0);
      if(strict&&entry.revision<previous)fail('coordination-revision-rollback');
      db.prepare('INSERT INTO observations VALUES(?,?,?,?) ON CONFLICT(identity,project,intent) DO UPDATE SET revision=MAX(revision,excluded.revision)').run(connection.identity,connection.projectId,id,Math.max(previous,entry.revision));
    }
    const known=Object.fromEntries(db.prepare('SELECT intent,revision FROM observations WHERE identity=? AND project=?').all(connection.identity,connection.projectId).map(row=>[row.intent,row.revision]));
    db.exec('COMMIT;');return {...connection.revisions,...known};
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK;');throw error;}finally{db.close();}
}
