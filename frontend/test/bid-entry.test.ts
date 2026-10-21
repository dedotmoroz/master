import test from 'node:test';
import assert from 'node:assert/strict';
import {ownsOrder,emptyBidLink} from '../lib/bid-entry.ts';
import {AuthError} from '../lib/auth.ts';
import {OrderError} from '../lib/orders.ts';
const id='00000000-0000-0000-0000-000000000001';
test('ownership uses private endpoint and only a normal 404 allows bidding; failures do not reveal a form',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(url,options)=>{assert.equal(url,`/api/v1/customer/orders/${id}`);assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer session');assert.equal(options?.credentials,'omit');return Response.json({id,title:'Мой заказ',status:'published',attachmentIds:[]});};
  assert.equal(await ownsOrder('session',id),true);
  globalThis.fetch=async()=>Response.json({error:{code:'ORDER_NOT_FOUND'}},{status:404});assert.equal(await ownsOrder('session',id),false);
  globalThis.fetch=async()=>Response.json({},{status:401});await assert.rejects(ownsOrder('session',id),AuthError);
  globalThis.fetch=async()=>{throw new Error('offline');};await assert.rejects(ownsOrder('session',id),e=>e instanceof OrderError&&e.status===0);
  globalThis.fetch=async()=>Response.json({bad:true});await assert.rejects(ownsOrder('session',id));
});
test('empty own bid list links to catalog, customer empty list has no self-loop, out-of-range pages keep their own first page',()=>{
  assert.deepEqual(emptyBidLink(false,0,'/account/bids/?page=1'),{href:'/orders/',label:'Смотреть заказы →'});
  assert.equal(emptyBidLink(true,0,`/account/orders/view/?id=${id}&bidsPage=1`),null);
  const first=`/account/orders/view/?id=${id}&bidsPage=1`;assert.deepEqual(emptyBidLink(true,3,first),{href:first,label:'На первую страницу'});
  assert.deepEqual(emptyBidLink(false,3,'/account/bids/?page=1'),{href:'/account/bids/?page=1',label:'На первую страницу'});
});
