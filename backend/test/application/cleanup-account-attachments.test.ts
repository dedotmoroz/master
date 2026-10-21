import test from 'node:test';
import assert from 'node:assert/strict';
import {Attachment} from '../../src/modules/attachments/domain/attachment.ts';
import {CleanupUnusedAccountAttachmentsHandler} from '../../src/modules/attachments/application/cleanup-account-attachments.ts';
import type {AttachmentRepository,ObjectStorage} from '../../src/modules/attachments/application/ports/attachment-ports.ts';
const now=new Date('2026-10-18T12:00:00Z');
function fixture(key='attachments/owner/file'){
  const file=Attachment.requestUpload({id:'file',ownerId:'owner',purpose:'order',originalFileName:'work.pdf',contentType:'application/pdf',sizeBytes:10,storageKey:key,createdAt:new Date(now.getTime()-3*86400000),expiresAt:new Date(now.getTime()-2*86400000)});
  const saved:string[]=[];const deleted:string[]=[];const removed:string[]=[];
  const attachments:AttachmentRepository={save:async value=>{saved.push(value.status);},findById:async()=>file,findByIds:async()=>[file],isPubliclyReferenced:async()=>false,findGuestCleanupCandidates:async()=>[],deleteCleanupPending:async id=>{removed.push(id);}};
  const storage:ObjectStorage={createUploadUrl:async()=>({url:'',headers:{}}),stat:async()=>null,get:async()=>Buffer.alloc(0),put:async()=>{},createDownloadUrl:async()=>'',delete:async key=>{deleted.push(key);}};
  const unused={observeUnreferenced:async()=>{},findCandidates:async()=>[file],isReferenced:async()=>false};
  const dependencies={attachments,unused,storage,transactions:{execute:async<T>(work:()=>Promise<T>)=>work()},clock:{now:()=>now}};
  return {file,deleted,saved,removed,dependencies};
}
test('account cleanup marks before deleting and never touches legacy keys or current references',async()=>{
  const active=fixture();active.dependencies.unused.isReferenced=async()=>true;assert.equal(await new CleanupUnusedAccountAttachmentsHandler(active.dependencies).execute('worker'),0);assert.deepEqual(active.deleted,[]);
  const legacy=fixture('legacy/imported-file');assert.equal(await new CleanupUnusedAccountAttachmentsHandler(legacy.dependencies).execute('worker'),0);assert.deepEqual(legacy.saved,[]);
  const orphan=fixture();assert.equal(await new CleanupUnusedAccountAttachmentsHandler(orphan.dependencies).execute('worker'),1);assert.deepEqual(orphan.saved,['cleanup_pending']);assert.deepEqual(orphan.deleted,['attachments/owner/file']);assert.deepEqual(orphan.removed,['file']);
});
test('account cleanup keeps cleanup_pending for retry after storage failure and enforces at least one day retention',async()=>{
  const context=fixture();let fail=true;context.dependencies.storage.delete=async()=>{if(fail){fail=false;throw new Error('storage unavailable');}};
  const handler=new CleanupUnusedAccountAttachmentsHandler(context.dependencies);await assert.rejects(handler.execute('worker'),/storage unavailable/);assert.equal(context.file.status,'cleanup_pending');assert.deepEqual(context.removed,[]);assert.equal(await handler.execute('worker'),1);
  await assert.rejects(new CleanupUnusedAccountAttachmentsHandler({...context.dependencies,retentionMs:1000}).execute('worker'),/24 hours/);
});
