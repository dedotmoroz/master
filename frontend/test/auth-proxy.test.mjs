import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authRoute,proxyAuthentication} from '../scripts/auth-proxy.mjs';
function request(method,path,headers={},body='{}'){return {method,headers:{host:'127.0.0.1:4178',...headers},async *[Symbol.asyncIterator](){yield Buffer.from(body);}};}
function response(){return {status:0,headers:{},body:undefined,writeHead(code,headers){this.status=code;this.headers=headers;},end(body){this.body=body;}};}
test('security requests need Bearer; confirms are public POST only and strip unrelated credentials',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  for(const action of ['email-change','account-deletion']){
    const path=`/api/v1/auth/${action}-requests`;assert.equal(authRoute(path,'POST'),'session');assert.equal(authRoute(path+'/confirm','POST'),'public');assert.equal(authRoute(path+'/confirm','GET'),null);
    const missing=response();await proxyAuthentication(request('POST','',{'content-type':'application/json'}),missing,new URL(path,'http://localhost'));assert.equal(missing.status,401);
    globalThis.fetch=async(_url,options)=>{assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);return new Response(null,{status:204});};
    const res=response();await proxyAuthentication(request('POST','',{'content-type':'application/json',authorization:'Bearer unrelated',cookie:'private'},'{"token":"email-token"}'),res,new URL(path+'/confirm','http://localhost'));assert.equal(res.status,204);assert.equal(res.headers['Cache-Control'],'no-store');
    const query=response();await proxyAuthentication(request('POST','',{'content-type':'application/json'}),query,new URL(path+'/confirm?token=secret','http://localhost'));assert.equal(query.status,404);
  }
});
test('auth proxy method/path allowlist excludes mutations outside auth scope',()=>{
  assert.equal(authRoute('/api/v1/auth/registrations','POST'),'public');assert.equal(authRoute('/api/v1/auth/me','GET'),'session');assert.equal(authRoute('/api/v1/auth/sessions','DELETE'),'session');
  for(const [path,method]of [['/api/v1/auth/me','POST'],['/api/v1/auth/registrations','GET'],['/api/v1/auth/account-deletion-requests','DELETE'],['/api/v1/customer/orders','POST']])assert.equal(authRoute(path,method),null);
});
test('auth proxy blocks cross-site, missing authorization, non-JSON and oversized bodies',async()=>{
  for(const [req,path,status]of [
    [request('POST','',{origin:'https://evil.test','content-type':'application/json'}),'/api/v1/auth/login-requests',403],
    [request('GET',''),'/api/v1/auth/me',401],
    [request('POST','',{}),'/api/v1/auth/login-requests',415],
    [request('POST','',{'content-type':'application/json'},'x'.repeat(4097)),'/api/v1/auth/login-requests',413],
  ]){const res=response();await proxyAuthentication(req,res,new URL(path,'http://localhost'));assert.equal(res.status,status);}
});
test('auth proxy forwards only required Bearer and does not forward cookies or cache sessions',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(_url,options)=>{assert.deepEqual(options.headers,{Accept:'application/json',Authorization:'Bearer session-test'});assert.equal(options.credentials,'omit');return Response.json({id:'test'});};
  const res=response();await proxyAuthentication(request('GET','',{cookie:'private',authorization:'Bearer session-test'}),res,new URL('http://localhost/api/v1/auth/me'));assert.equal(res.status,200);assert.equal(res.headers['Cache-Control'],'no-store');
});
test('email request never forwards authorization and preserves Retry-After',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(_url,options)=>{assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);return new Response('{}',{status:429,headers:{'Retry-After':'33'}});};
  const res=response();await proxyAuthentication(request('POST','',{'content-type':'application/json',authorization:'Bearer unrelated'}),res,new URL('http://localhost/api/v1/auth/registrations'));assert.equal(res.status,429);assert.equal(res.headers['Retry-After'],'33');
});
