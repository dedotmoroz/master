import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReview,dealsApi,DealError,dealHref} from '../lib/deals.ts';
import {AuthError} from '../lib/auth.ts';
const id='00000000-0000-0000-0000-000000000001';
test('review requires explicit 1-5 rating and nonblank bounded text, with no subject spoofing',()=>{
  assert.deepEqual(buildReview('5',' Хорошая работа '),{score:5,text:'Хорошая работа'});
  for(const score of ['','0','6','2.5','05'])assert.throws(()=>buildReview(score,'Работа'));
  for(const text of [' ','x'.repeat(5001)])assert.throws(()=>buildReview('5',text));
  assert.equal(dealHref(id),`/account/deals/view/?id=${id}`);
});
test('deal requests use Bearer, no cookies and only score/text; duplicate and auth errors stay safe',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let call=0;
  globalThis.fetch=async(url,options)=>{call++;assert.equal(options?.credentials,'omit');assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer test');
    if(call===1){assert.equal(String(url),`/api/v1/orders/${id}/deal`);return Response.json({orderId:id,title:'Работа',status:'completed',customerId:id,contractorId:id,selectedBidId:id,completedAt:'2026-10-18T12:00:00Z',ownReview:null});}
    if(call===2){assert.equal(String(url),`/api/v1/orders/${id}/complete`);assert.equal(options?.body,undefined);return Response.json({orderId:id,status:'completed',customerId:id,contractorId:id,completedAt:'2026-10-18T12:00:00Z'});}
    if(call===3){assert.deepEqual(JSON.parse(String(options?.body)),{score:5,text:'Работа'});return Response.json({error:{code:'REVIEW_ALREADY_EXISTS',message:'internal details'}},{status:409});}
    return Response.json({},{status:401});};
  assert.equal((await dealsApi.get('test',id)).ownReview,null);await dealsApi.complete('test',id);
  await assert.rejects(dealsApi.review('test',id,buildReview('5','Работа')),e=>e instanceof DealError&&e.code==='REVIEW_ALREADY_EXISTS'&&!e.message.includes('internal'));
  await assert.rejects(dealsApi.get('test',id),e=>e instanceof AuthError);
});
