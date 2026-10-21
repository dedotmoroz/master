import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildGuest,buildUpdate,editable,ordersApi,OrderError,ownOrderHref} from '../lib/orders.ts';
import {AuthError} from '../lib/auth.ts';
const fields={title:'  Заказ ',description:' Описание ',categoryId:'house-building',locationId:'ru-locality-1',budgetMin:'100.29',budgetMax:'200,50'};
test('order form uses minor units, validates ranges and preserves existing attachments',()=>{
  const ids=['00000000-0000-0000-0000-000000000001'];const body=buildUpdate(fields,ids);assert.equal(body.budgetMinMinor,10029);assert.equal(body.budgetMaxMinor,20050);assert.equal(body.title,'Заказ');assert.deepEqual(body.attachmentIds,ids);assert.notEqual(body.attachmentIds,ids);
  assert.throws(()=>buildUpdate({...fields,budgetMin:'201'}),/не может быть больше/);assert.throws(()=>buildUpdate({...fields,locationId:''}),/место работ/);assert.throws(()=>buildUpdate({...fields,description:' '}));
  assert.equal(buildUpdate({...fields,budgetMin:'',budgetMax:''}).budgetMaxMinor,null);
});
test('guest payload requires explicit publication consent and never sends owner/status fields',()=>{
  assert.throws(()=>buildGuest(fields,'test@example.com','Имя',false),/Подтвердите/);
  assert.throws(()=>buildGuest(fields,'bad','Имя',true),/email/);
  const body=buildGuest(fields,' test@example.com ',' Имя ',true);assert.equal(body.email,'test@example.com');assert.equal(body.contactName,'Имя');assert.deepEqual(body.temporaryAttachments,[]);assert.equal(Object.hasOwn(body,'customerId'),false);assert.equal(Object.hasOwn(body,'attachmentIds'),false);
});
test('only draft/published orders can be edited or cancelled in UI',()=>{
  assert.equal(editable('draft'),true);assert.equal(editable('published'),true);for(const state of ['in_progress','completed','cancelled'] as const)assert.equal(editable(state),false);
  assert.equal(ownOrderHref('id?&'),'/account/orders/view/?id=id%3F%26');
});
test('guest requests omit auth, private requests attach it and preserve full update',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(input,options)=>{assert.equal(input,'/api/v1/guest-orders');assert.equal((options?.headers as Record<string,string>).Authorization,undefined);assert.equal(options?.credentials,'omit');return Response.json({submissionId:'00000000-0000-0000-0000-000000000001',status:'pending_email',expiresAt:new Date().toISOString()});};
  await ordersApi.submit(buildGuest(fields,'test@example.com','Имя',true));
  globalThis.fetch=async(input,options)=>{assert.match(String(input),/offset=180/);assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer test-token');return Response.json({items:[],total:0,limit:20,offset:180});};await ordersApi.list('test-token',10);
  globalThis.fetch=async()=>new Response('{}',{status:401});await assert.rejects(ordersApi.get('test','id'),error=>error instanceof AuthError&&error.status===401);
  globalThis.fetch=async()=>Response.json({error:{code:'ORDER_NOT_EDITABLE',message:'private raw data'}},{status:409});await assert.rejects(ordersApi.cancel('test','id'),error=>error instanceof OrderError&&error.code==='ORDER_NOT_EDITABLE'&&!error.message.includes('private'));
});
