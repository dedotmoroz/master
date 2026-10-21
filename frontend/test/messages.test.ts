import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageAttempt,MessageError,messagesApi,normalizeMessage,conversationHref} from '../lib/messages.ts';
import {AuthError} from '../lib/auth.ts';
const id='00000000-0000-0000-0000-000000000001';
const message={id,bidId:id,orderId:id,authorId:null,text:'<script>plain text</script>',createdAt:'2026-10-18T12:00:00Z'};
test('message attempt freezes text and UUID until acknowledged, including retry after closed conversation',()=>{
  const attempt=new MessageAttempt();let generated=0;const uuid=()=>{generated++;return id;};
  const first=attempt.prepare('  Привет  ',uuid);assert.equal(first.text,'Привет');assert.equal(Object.isFrozen(first),true);
  assert.equal(attempt.prepare('другой текст',uuid),first);assert.equal(generated,1);attempt.complete();assert.equal(attempt.pending(),undefined);
  attempt.prepare('Новое сообщение',uuid);assert.equal(generated,2);
  for(const text of ['  ','x'.repeat(5001),'a\0b'])assert.throws(()=>normalizeMessage(text));
  assert.equal(conversationHref(id),`/account/messages/?bidId=${id}`);
});
test('messages transport uses Bearer only, offset, canSend and chronological page data without HTML parsing',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(url,options)=>{assert.equal(String(url),`/api/v1/bids/${id}/messages?limit=20&offset=180`);assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer private');assert.equal(options?.credentials,'omit');assert.equal(options?.cache,'no-store');return Response.json({items:[message],total:181,limit:20,offset:180,canSend:false});};
  const page=await messagesApi.list('private',id,10);assert.equal(page.canSend,false);assert.equal(page.items[0]?.authorId,null);assert.equal(page.items[0]?.text,message.text);
});
test('messages keep identical POST body on loss, preserve rate cooldown and mask internal errors',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});const attempt=new MessageAttempt();const bodies:string[]=[];
  globalThis.fetch=async(_url,options)=>{bodies.push(String(options?.body));assert.equal(options?.method,'POST');if(bodies.length===1)throw new TypeError('lost response');return Response.json(message,{status:201});};
  await assert.rejects(messagesApi.send('session',id,attempt.prepare(message.text,()=>id)),error=>error instanceof MessageError&&error.status===0);
  await messagesApi.send('session',id,attempt.prepare('changed text',()=>id));assert.equal(bodies[0],bodies[1]);
  globalThis.fetch=async()=>Response.json({error:{code:'RATE_LIMIT_EXCEEDED',message:'database password'}},{status:429,headers:{'retry-after':'17'}});
  await assert.rejects(messagesApi.send('session',id,attempt.prepare('ignored')),error=>error instanceof MessageError&&error.retryAfter===17&&!error.message.includes('password'));
  globalThis.fetch=async()=>Response.json({},{status:401});await assert.rejects(messagesApi.list('expired',id,1),error=>error instanceof AuthError);
  globalThis.fetch=async()=>Response.json({error:{code:'CONVERSATION_READ_ONLY'}},{status:409});await assert.rejects(messagesApi.send('session',id,attempt.prepare('ignored')),error=>error instanceof MessageError&&error.code==='CONVERSATION_READ_ONLY');
});
