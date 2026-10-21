import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderRoute,proxyOrders} from '../scripts/orders-proxy.mjs';
const id='00000000-0000-0000-0000-000000000001';
test('notifications proxy is narrow, authenticated and never accepts query tokens or foreign methods',async t=>{
  assert.equal(orderRoute('/api/v1/notifications','GET').session,true);assert.equal(orderRoute(`/api/v1/notifications/${id}/read`,'POST').body,false);assert.equal(orderRoute('/api/v1/notification-preferences','PUT').body,true);
  for(const [path,method] of [['/api/v1/notifications','POST'],['/api/v1/notification-preferences','DELETE'],[`/api/v1/notifications/${id}/read`,'GET'],['/api/v1/notifications/read-all','POST']])assert.equal(orderRoute(path,method),null);
  for(const [req,url,status] of [[request('GET'),'/api/v1/notifications',401],[request('GET',{authorization:'Bearer token'}),'/api/v1/notifications?token=secret',404],[request('POST',{authorization:'Bearer token',origin:'https://foreign.test'}),`/api/v1/notifications/${id}/read`,403],[request('PUT',{authorization:'Bearer token','content-type':'application/json'},'x'.repeat(65537)),'/api/v1/notification-preferences',413]]){const res=response();await proxyOrders(req,res,new URL(url,'http://localhost'));assert.equal(res.status,status);}
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(_url,options)=>{assert.equal(options.headers.Authorization,'Bearer token');assert.equal(options.headers.Cookie,undefined);assert.equal(options.body,undefined);return new Response(null,{status:204});};
  const res=response();await proxyOrders(request('POST',{authorization:'Bearer token',cookie:'private'}),res,new URL(`http://localhost/api/v1/notifications/${id}/read`));assert.equal(res.status,204);assert.equal(res.headers['Cache-Control'],'no-store');
});
test('guest file endpoints are public JSON POST only; owner URLs require a session',()=>{
  assert.equal(orderRoute('/api/v1/guest-attachments/upload-requests','POST').session,false);
  assert.equal(orderRoute(`/api/v1/guest-attachments/${id}/confirm`,'POST').body,true);
  assert.equal(orderRoute(`/api/v1/attachments/${id}/owner-preview-url`,'GET').session,true);
  assert.equal(orderRoute(`/api/v1/attachments/${id}/owner-download-url`,'GET').session,true);
  assert.equal(orderRoute(`/api/v1/attachments/${id}/owner-download-url`,'POST'),null);
  assert.equal(orderRoute(`/api/v1/guest-attachments/${id}/confirm`,'GET'),null);
});
test('profile and upload proxy exposes only own GET/PUT and authenticated upload/confirm',()=>{
  assert.ok(orderRoute('/api/v1/contractor/profile','GET'));assert.equal(orderRoute('/api/v1/contractor/profile','PUT').maxBodyBytes,524288);assert.ok(orderRoute('/api/v1/attachments/upload-requests','POST'));assert.ok(orderRoute(`/api/v1/attachments/${id}/confirm`,'POST'));
  for(const [path,method]of [['/api/v1/contractor/profile','DELETE'],['/api/v1/contractor/profile','POST'],[`/api/v1/attachments/${id}/download-url`,'POST']])assert.equal(orderRoute(path,method),null);
});
test('deal proxy whitelists only private read, completion and review creation',()=>{
  assert.ok(orderRoute(`/api/v1/orders/${id}/deal`,'GET'));assert.ok(orderRoute(`/api/v1/orders/${id}/complete`,'POST'));assert.equal(orderRoute(`/api/v1/orders/${id}/reviews`,'POST').body,true);
  for(const [path,method] of [[`/api/v1/orders/${id}/deal`,'POST'],[`/api/v1/orders/${id}/reviews`,'PUT'],[`/api/v1/orders/${id}/complete`,'GET']])assert.equal(orderRoute(path,method),null);
});
function request(method,headers={},body='{}'){return {method,headers:{host:'127.0.0.1:4178',...headers},async *[Symbol.asyncIterator](){yield Buffer.from(body);}};}
function response(){return {status:0,headers:{},writeHead(status,headers){this.status=status;this.headers=headers;},end(){}};}
test('order proxy allows only explicit order and bid actions',()=>{
  assert.ok(orderRoute('/api/v1/guest-orders','POST'));assert.ok(orderRoute(`/api/v1/customer/orders/${id}`,'PUT'));assert.ok(orderRoute(`/api/v1/customer/orders/${id}/cancel`,'POST'));
  assert.ok(orderRoute(`/api/v1/customer/orders/${id}/bids`,'GET'));assert.ok(orderRoute(`/api/v1/orders/${id}/bids`,'POST'));assert.ok(orderRoute(`/api/v1/customer/orders/${id}/bids/${id}/select`,'POST'));assert.ok(orderRoute(`/api/v1/contractor/bids/${id}/withdraw`,'POST'));assert.ok(orderRoute('/api/v1/contractor/bids','GET'));
  for(const [path,method]of [[`/api/v1/customer/orders/${id}/bids`,'POST'],[`/api/v1/orders/${id}/bids`,'GET'],[`/api/v1/contractor/bids/${id}/select`,'POST'],[`/api/v1/customer/orders/${id}`,'DELETE'],['/api/v1/customer/orders','POST'],['/api/v1/auth/me','GET']])assert.equal(orderRoute(path,method),null);
});
test('order proxy enforces origin, bearer, JSON limit and safe query allowlist',async()=>{
  for(const [req,path,status]of [[request('POST',{origin:'https://evil.test'}),'/api/v1/guest-orders',403],[request('GET'),'/api/v1/customer/orders',401],[request('POST'),'/api/v1/guest-orders',415],[request('POST',{'content-type':'application/json'},'x'.repeat(65537)),'/api/v1/guest-orders',413],[request('GET',{authorization:'Bearer token'}),'/api/v1/customer/orders?token=secret',404]]){const res=response();await proxyOrders(req,res,new URL(path,'http://localhost'));assert.equal(res.status,status);}
});
test('guest publish never forwards a token; private edits forward only Bearer and body',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(_url,options)=>{assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);return Response.json({status:'pending_email'},{status:202});};
  await proxyOrders(request('POST',{'content-type':'application/json',authorization:'Bearer unrelated',cookie:'private'}),response(),new URL('http://localhost/api/v1/guest-orders'));
  globalThis.fetch=async(_url,options)=>{assert.equal(options.headers.Authorization,'Bearer test');assert.equal(options.headers.Cookie,undefined);assert.equal(options.method,'PUT');return Response.json({id});};
  const res=response();await proxyOrders(request('PUT',{'content-type':'application/json',authorization:'Bearer test',cookie:'private'}),res,new URL(`http://localhost/api/v1/customer/orders/${id}`));assert.equal(res.status,200);assert.equal(res.headers['Cache-Control'],'no-store');
});
test('bid routes require Bearer, reject cross-site and forward no cookies',async t=>{
  for(const path of [`/api/v1/orders/${id}/bids`,`/api/v1/customer/orders/${id}/bids/${id}/select`,`/api/v1/contractor/bids/${id}/withdraw`]){
    const res=response();await proxyOrders(request('POST'),res,new URL(path,'http://localhost'));assert.equal(res.status,401);
    const blocked=response();await proxyOrders(request('POST',{authorization:'Bearer test','sec-fetch-site':'cross-site'}),blocked,new URL(path,'http://localhost'));assert.equal(blocked.status,403);
  }
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).pathname,`/api/v1/orders/${id}/bids`);assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer test');assert.equal(options.headers.Cookie,undefined);assert.equal(options.body.toString(),'{}');return Response.json({id},{status:201});};
  const res=response();await proxyOrders(request('POST',{authorization:'Bearer test',cookie:'secret','content-type':'application/json'}),res,new URL(`http://localhost/api/v1/orders/${id}/bids`));assert.equal(res.status,201);
});
test('messages proxy only permits participant GET/POST, with safe query and session forwarding',async t=>{
  const path=`/api/v1/bids/${id}/messages`;assert.ok(orderRoute(path,'GET'));assert.ok(orderRoute(path,'POST'));
  for(const method of ['PUT','DELETE','PATCH'])assert.equal(orderRoute(path,method),null);
  for(const [req,url,status] of [[request('GET'),path,401],[request('POST',{authorization:'Bearer test','sec-fetch-site':'cross-site'}),path,403],[request('GET',{authorization:'Bearer test'}),path+'?token=secret',404],[request('POST',{authorization:'Bearer test'}),path+'?offset=0',404]]){const res=response();await proxyOrders(req,res,new URL(url,'http://localhost'));assert.equal(res.status,status);}
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});globalThis.fetch=async(_url,options)=>{assert.equal(options.headers.Authorization,'Bearer test');assert.equal(options.headers.Cookie,undefined);return Response.json({error:{code:'RATE_LIMIT_EXCEEDED'}},{status:429,headers:{'retry-after':'12'}});};
  const res=response();await proxyOrders(request('POST',{authorization:'Bearer test','content-type':'application/json',cookie:'private'}),res,new URL(path,'http://localhost'));assert.equal(res.headers['Retry-After'],'12');assert.equal(res.headers['Cache-Control'],'no-store');
});
