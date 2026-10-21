import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPublicApiPath,proxyPublicApi} from '../scripts/public-proxy.mjs';
test('preview proxy allows only explicit public read paths',()=>{
  assert.equal(isPublicApiPath('/api/v1/attachments/00000000-0000-0000-0000-000000000001/preview-url'),true);assert.equal(isPublicApiPath('/api/v1/attachments/00000000-0000-0000-0000-000000000001/confirm'),false);
  assert.equal(isPublicApiPath('/api/v1/contractors/00000000-0000-0000-0000-000000000001/reviews'),true);
  assert.equal(isPublicApiPath('/api/v1/orders/00000000-0000-0000-0000-000000000001/reviews'),false);
  for(const path of ['/api/v1/orders','/api/v1/contractors','/api/v1/regions','/api/v1/work-categories','/api/v1/orders/b65fb61d-89dc-4929-bafe-67b2d8716a21'])assert.ok(isPublicApiPath(path),path);
  for(const path of ['/api/v1/auth/me','/api/v1/customer/orders','/api/v1/contractors/id','/api/v1/orders/../auth/me','/api/v1/orders//evil','/api/v1/orders/id/bids'])assert.equal(isPublicApiPath(path),false,path);
});
test('proxy never forwards browser cookies or authorization',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(_url,options)=>{assert.deepEqual(options.headers,{Accept:'application/json'});assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return Response.json({items:[]});};
  let status;const response={writeHead(code){status=code;},end(){}};
  await proxyPublicApi({method:'GET',headers:{cookie:'private',authorization:'Bearer private'}},response,new URL('http://localhost/api/v1/orders'));assert.equal(status,200);
});
