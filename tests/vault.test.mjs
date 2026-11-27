import {test} from 'node:test';
import assert from 'node:assert/strict';
import {keyFromSalt,newVaultSalt,sealDraft,openDraft} from '../src/features/vault.ts';
test('device draft encryption preserves Unicode and rejects wrong passphrases, tampering and expiry',async()=>{
  const salt=newVaultSalt(),passphrase='synthetic private device phrase',key=await keyFromSalt(passphrase,salt);
  const data={source:{text:'ಕನ್ನಡ हिन्दी remembered job'},fields:{place:'Synthetic private place'}};
  const snapshot={workerId:'synthetic-worker',intakeId:'synthetic-intake',version:2,saved:'',data,attempt:null};
  const sealed=await sealDraft(snapshot,key,salt);assert.ok(!JSON.stringify(sealed).includes('Synthetic private place'));assert.ok(!key.extractable);
  assert.deepEqual((await openDraft(sealed,passphrase)).snapshot,snapshot);
  await assert.rejects(()=>openDraft(sealed,'wrong synthetic private phrase'));
  await assert.rejects(()=>openDraft({...sealed,expires:sealed.expires+86400000},passphrase));
  await assert.rejects(()=>openDraft({...sealed,ciphertext:sealed.ciphertext.slice(4)},passphrase));
  await assert.rejects(()=>openDraft({...sealed,expires:Date.now()-1},passphrase),/expired/);
});
