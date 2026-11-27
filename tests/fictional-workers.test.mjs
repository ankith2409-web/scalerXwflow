import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openStore} from '../server/store.mjs';
import {fictionalWorkers,fictionalSummary} from '../server/fictional-workers.mjs';
test('broader fictional comparisons are diverse, stable, isolated and reviewable',()=>{
  const db=openStore(':memory:');try{
    const session=db.createSession(),matches=db.demo.candidates(session);
    assert.equal(fictionalWorkers.length,40);assert.equal(fictionalSummary.workers,43);
    assert.ok(matches.length>=100);assert.equal(new Set(matches.flatMap(m=>[m.left.label,m.right.label])).size,43);
    assert.equal(new Set(matches.map(m=>m.id)).size,matches.length);
    for(const state of ['overlap','separate','unknown'])assert.ok(matches.some(m=>m.overlap===state));
    assert.ok(matches.some(m=>!m.outreach));assert.ok(matches.some(m=>m.conflict&&!m.eligible));
    assert.ok(matches.some(m=>(m.left.quote+m.right.quote).includes('साल')));assert.ok(matches.some(m=>(m.left.quote+m.right.quote).includes('ಕೆಲಸ')));
    const conflict=matches.find(m=>m.conflict);
    assert.throws(()=>db.demo.decide(session,conflict.id,{version:0,status:'accepted',reason:'Synthetic test decision.',operation:randomUUID()}),/conflict/);
    const candidate=matches.find(m=>m.left.label.startsWith('Fictional')&&m.eligible);
    db.demo.decide(session,candidate.id,{version:0,status:'accepted',reason:'Synthetic source comparison checked.',operation:randomUUID()});
    assert.equal(db.demo.candidates(session).find(m=>m.id===candidate.id).status,'accepted');
    assert.equal(db.demo.candidates(db.createSession()).find(m=>m.id===candidate.id).status,'waiting');
    db.workspace.signIn('synthetic local staff phrase');assert.deepEqual(db.demo.candidates(db.workspace.staffScope()),[]);
    assert.equal(db.history(session).length,0);
    console.log('Fictional demo:',fictionalSummary.workers,'workers,',matches.length,'comparisons; no real-worker records seeded.');
  }finally{db.close();}
});
