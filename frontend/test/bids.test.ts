import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBid,bidsApi,BidError} from '../lib/bids.ts';
import {AuthError} from '../lib/auth.ts';
const id='00000000-0000-0000-0000-000000000001';
const fields={message:' Готов выполнить ',priceMin:'100.29',priceMax:'200.50',daysMin:'1',daysMax:'2',visibility:'private'};
test('bid payload trims text, uses exact kopeks and optional positive days',()=>{
  assert.deepEqual(buildBid(fields),{message:'Готов выполнить',priceMinMinor:10029,priceMaxMinor:20050,durationDaysMin:1,durationDaysMax:2,visibility:'private'});
  assert.equal(buildBid({...fields,priceMin:'',priceMax:'',daysMin:'',daysMax:''}).priceMinMinor,null);
  for(const change of [{message:' '},{message:'x'.repeat(5001)},{priceMin:'300'},{priceMin:'0.001'},{daysMin:'0'},{daysMin:'1.5'},{daysMin:'3'},{daysMax:'100001'},{visibility:'hidden'}])assert.throws(()=>buildBid({...fields,...change}));
});
test('bid API uses authenticated narrow routes, offset and safe domain errors',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0;
  globalThis.fetch=async(input,options)=>{calls++;assert.equal(options?.credentials,'omit');assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer test');
    if(calls===1){assert.equal(String(input),'/api/v1/contractor/bids?limit=20&offset=180');return Response.json({items:[],total:0,limit:20,offset:180});}
    if(calls===2){assert.equal(String(input),`/api/v1/customer/orders/${id}/bids/${id}/select`);assert.equal(options?.method,'POST');assert.equal(options?.body,undefined);return Response.json({orderId:id,bidId:id,contractorId:id,orderStatus:'in_progress'});}
    if(calls===3)return Response.json({error:{code:'SELF_BID',message:'internal secret'}},{status:422});
    return Response.json({},{status:401});};
  await bidsApi.own('test',10);await bidsApi.select('test',id,id);
  await assert.rejects(bidsApi.submit('test',id,buildBid(fields)),error=>error instanceof BidError&&error.message.includes('собственный')&&!error.message.includes('secret'));
  await assert.rejects(bidsApi.own('test',1),error=>error instanceof AuthError);
});
