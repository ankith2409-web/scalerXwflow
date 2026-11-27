import { RequestError } from './errors.mjs';

export function featureStore(db, history) {
  db.exec(`CREATE TABLE IF NOT EXISTS feature_items (
    scope TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL,
    history_id TEXT REFERENCES histories(id) ON DELETE CASCADE, data TEXT NOT NULL,
    version INTEGER NOT NULL, actor TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(scope,id)); CREATE INDEX IF NOT EXISTS feature_history ON feature_items(history_id);`);
  const unpack = row => row ? { id:row.id,kind:row.kind,historyId:row.history_id,data:JSON.parse(row.data),version:row.version,actor:row.actor,updatedAt:row.updated_at } : null;
  const safe = row => { if (!row) return row; const {base64,...data}=row.data; return {...row,data}; };
  return {
    run(actor, action, input) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = execute(actor,action,input); db.exec('COMMIT'); return result; }
      catch(error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  function execute(actor,action,input) {
    const scope=actor.scope, get=id=>unpack(db.prepare('SELECT * FROM feature_items WHERE scope=? AND id=?').get(scope,id));
    const rows=(kind)=>db.prepare('SELECT * FROM feature_items WHERE scope=? AND kind=? ORDER BY updated_at DESC,id').all(scope,kind).map(unpack);
    const write=(id,kind,historyId,data,version)=>{
      const current=get(id); if((current?.version??0)!==version||(current&&(current.kind!==kind||current.historyId!==historyId))) throw new RequestError(409,'This information changed. Reopen it before saving.');
      const at=new Date().toISOString();
      db.prepare(`INSERT INTO feature_items VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET data=excluded.data,version=excluded.version,actor=excluded.actor,updated_at=excluded.updated_at`).run(scope,id,kind,historyId,JSON.stringify(data),version+1,actor.label,at);
      return get(id);
    };
    const members=()=>[{id:actor.memberId,label:actor.label}];
    if(action==='timeline')return db.prepare("SELECT * FROM feature_items WHERE scope=? AND kind IN ('details','link','attachment') ORDER BY updated_at,id").all(scope).map(unpack).filter(row=>history(actor,row.historyId)).map(safe);
    if(['workplaces','cases'].includes(action)&&!actor.staff) throw new RequestError(401,'Sign in to the staff workspace.');
    if(action==='workplaces') {
      const all=rows('workplace').filter(row=>[row.data.name,row.data.locality,...row.data.aliases].join(' ').toLocaleLowerCase().includes(input.query.toLocaleLowerCase()));
      return {items:all.slice(input.page*25,input.page*25+25),total:all.length,page:input.page,members:members()};
    }
    if(action==='cases') {
      const all=rows('case').flatMap(row=>{ const record=history(actor,row.historyId); return record?.permissions.outreach&&JSON.stringify({...record.fields,...row.data}).toLocaleLowerCase().includes(input.query.toLocaleLowerCase())?[{...row,record}]:[]; });
      return {items:all.slice(input.page*25,input.page*25+25),total:all.length,page:input.page,members:members()};
    }
    if(input.kind==='workplace') {
      if(!actor.staff) throw new RequestError(401,'Sign in to the staff workspace.');
      return write(input.id,'workplace',null,input.data,input.version);
    }
    const record=history(actor,input.historyId);
    if(!record) throw new RequestError(404,'This history is unavailable.');
    const attachments=rows('attachment').filter(row=>row.historyId===input.historyId);
    if(action==='history') {
      let details=get(input.historyId+':details');
      if(actor.staff&&details?.data.location&&!details.data.location.shared) details={...details,data:{...details.data,location:null}};
      const link=actor.staff&&!record.permissions.matching?null:get(input.historyId+':link');
      return {record,details,link:link?{...link,workplace:get(link.data.workplaceId)}:null,case:actor.staff&&record.permissions.outreach?get(input.historyId+':case'):null,attachments:attachments.filter(row=>!actor.staff||row.data.shared).map(safe),members:actor.staff?members():[]};
    }
    if(input.historyVersion!==undefined&&input.historyVersion!==record.version) throw new RequestError(409,'The worker changed this history. Refresh it.');
    if(action==='save') {
      const {kind}=input;
      if(kind==='details'&&actor.staff) throw new RequestError(403,'Only the worker can change these details.');
      if(kind==='link') {
        if(!actor.staff||!record.permissions.matching) throw new RequestError(403,'Workplace matching permission is required.');
        if(input.data.workplaceId!==null&&get(input.data.workplaceId)?.data.status!=='reviewed') throw new RequestError(409,'Choose a reviewed workplace.');
        const workplace=get(input.data.workplaceId);input.data={...input.data,workplaceVersion:workplace?.version??null,workplaceSnapshot:workplace?{name:workplace.data.name,locality:workplace.data.locality}:null};
      }
      if(kind==='case'&&(!actor.staff||!record.permissions.outreach||input.data.assigneeId!==actor.memberId)) throw new RequestError(403,'Follow-up permission and an active case owner are required.');
      return write(input.id,kind,input.historyId,{...input.data,historyVersion:record.version},input.version);
    }
    if(action==='upload') {
      if(actor.staff) throw new RequestError(403,'Only the worker can attach evidence.');
      const existing=get(input.id); if(existing) {if(existing.historyId!==input.historyId||existing.data.sha256!==input.data.sha256) throw new RequestError(409,'This attachment action was already used.');return safe(existing);}
      if(attachments.length>=3) throw new RequestError(413,'Keep up to three attachments per job.');
      const size=Number(db.prepare("SELECT coalesce(sum(length(data)),0) AS size FROM feature_items WHERE kind='attachment'").get().size);
      if(size>64*1024*1024) throw new RequestError(413,'Attachment storage is full.');
      return safe(write(input.id,'attachment',input.historyId,input.data,0));
    }
    const item=get(input.id);
    if(!item||item.kind!=='attachment'||item.historyId!==input.historyId||(actor.staff&&!item.data.shared)) throw new RequestError(404,'Attachment unavailable.');
    if(action==='download') return item;
    if(item.version!==input.version) throw new RequestError(409,'This attachment changed. Refresh it.');
    if(action==='remove') { if(actor.staff) throw new RequestError(403,'Only the worker can remove evidence.');db.prepare('DELETE FROM feature_items WHERE scope=? AND id=?').run(scope,input.id);return {removed:true}; }
    if(action==='attachment') return safe(write(input.id,'attachment',input.historyId,{...item.data,...input.data,...(actor.staff?{reviewedBy:actor.label,reviewedAt:new Date().toISOString()}:{})},input.version));
    throw new RequestError(404,'This action is unavailable.');
  }
}
