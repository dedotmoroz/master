import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AuthError,authRequest,authTransport,consumeConfirmationUrl} from '../lib/auth.ts';
test('one-use tokens removed from URLs, duplicates and malformed tokens rejected',()=>{
  assert.deepEqual(consumeConfirmationUrl('http://localhost/auth/login/confirm/?token=one-use&next=ignored#fragment'),{token:'one-use',cleanUrl:'/auth/login/confirm/?next=ignored'});
  for(const query of ['','?token=','?token=a&token=b','?token=has%20space','?token='+ 'a'.repeat(1001)])assert.equal(consumeConfirmationUrl('http://localhost/auth/register/confirm/'+query).token,null);
});
test('request email stays public and auth token sent only in Authorization, never query',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(input,options)=>{assert.equal(input,'/api/v1/auth/login-requests');assert.equal(options?.credentials,'omit');assert.equal(options?.cache,'no-store');assert.equal((options?.headers as Record<string,string>).Authorization,undefined);return Response.json({status:'pending_email'});};
  await authTransport.request('login','test@example.com');
  globalThis.fetch=async(input,options)=>{assert.equal(input,'/api/v1/auth/session');assert.equal(options?.method,'DELETE');assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer test-session');return new Response(null,{status:204});};
  await authTransport.logout('test-session');
});
test('rate limits preserved and untrusted API error details never rendered',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>new Response(JSON.stringify({message:'private-token-or-email'}),{status:429,headers:{'Retry-After':'47'}});
  await assert.rejects(authRequest('POST','registrations',{email:'test@example.com'}),(error:unknown)=>error instanceof AuthError&&error.retryAfter===47&&!error.message.includes('private'));
  globalThis.fetch=async()=>new Response('{}',{status:410});await assert.rejects(authTransport.confirm('login','one-use'),/Ссылка недействительна/);
  globalThis.fetch=async()=>Response.json({session:{token:'bad'}});await assert.rejects(authTransport.confirm('register','one-use'),/Некорректный ответ/);
});
