import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apiGet,ApiError,assertPage} from '../lib/api.ts';
test('API fetch is public, uncached, abortable and handles errors',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async (input,options)=>{assert.equal(input,'/api/v1/orders?limit=20');assert.equal(options?.credentials,'omit');assert.equal(options?.cache,'no-store');assert.ok(options?.signal);return Response.json({items:[],total:0,limit:20,offset:0});};
  const data=await apiGet('/orders?limit=20');assertPage(data as {items:unknown[]});
  globalThis.fetch=async()=>new Response('{}',{status:404});await assert.rejects(apiGet('/orders/id'),(e:unknown)=>e instanceof ApiError&&e.status===404);
  globalThis.fetch=async()=>new Response('broken');await assert.rejects(apiGet('/orders'),/некорректный ответ/);
  globalThis.fetch=async()=>{throw new Error('internal network detail');};await assert.rejects(apiGet('/orders'),/API недоступен/);
  assert.throws(()=>assertPage({items:[],total:-1,limit:20,offset:0}));
});
