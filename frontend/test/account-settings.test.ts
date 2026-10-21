import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountActionError,accountSettingsApi,confirmAccountAction,newEmail} from '../lib/account-settings.ts';
import {AuthError,consumeConfirmationUrl} from '../lib/auth.ts';
test('new email trims, normalizes and rejects unchanged or malformed addresses',()=>{
  assert.equal(newEmail(' NEW@Example.com ','old@example.com'),'new@example.com');
  for(const email of ['bad','CURRENT@example.com','x'.repeat(255)+'@example.com'])assert.throws(()=>newEmail(email,'current@example.com'));
});
test('email/deletion requests are authenticated JSON but confirmation uses only the email token body',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(options?.credentials,'omit');assert.equal(options?.cache,'no-store');assert.equal(options?.redirect,'error');assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer session');assert.deepEqual(JSON.parse(String(options?.body)),calls===1?{email:'new@example.com'}:{});assert.equal(url,calls===1?'/api/v1/auth/email-change-requests':'/api/v1/auth/account-deletion-requests');return Response.json({status:'pending_email'},{status:202});};
  await accountSettingsApi.requestEmail('session','new@example.com');await accountSettingsApi.requestDeletion('session');
  globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/v1/auth/email-change-requests/confirm');assert.equal((options?.headers as Record<string,string>).Authorization,undefined);assert.deepEqual(JSON.parse(String(options?.body)),{token:'one-use'});return new Response(null,{status:204});};
  await accountSettingsApi.confirm('email-change','one-use');
});
test('account action errors are safe and distinguish ongoing jobs, taken email and cooldown',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  for(const [status,code,match] of [[409,'ACCOUNT_HAS_ONGOING_ORDERS',/Сначала завершите/],[409,'EMAIL_ALREADY_IN_USE',/уже занят/],[422,'EMAIL_UNCHANGED',/отличный/],[410,'DELETION_TOKEN_EXPIRED',/истекла/],[500,'INTERNAL_ERROR',/Не удалось/]] as const){globalThis.fetch=async()=>Response.json({error:{code,message:'PRIVATE DATABASE STACK'}},{status});await assert.rejects(accountSettingsApi.requestDeletion('session'),error=>error instanceof AccountActionError&&match.test(error.message)&&!error.message.includes('PRIVATE'));}
  globalThis.fetch=async()=>new Response('{}',{status:429,headers:{'retry-after':'93'}});await assert.rejects(accountSettingsApi.requestDeletion('session'),error=>error instanceof AccountActionError&&error.retryAfter===93);
  globalThis.fetch=async()=>new Response('{}',{status:401});await assert.rejects(accountSettingsApi.requestDeletion('session'),AuthError);
});
test('confirmation never reports success for an unexpected response and revalidates on success or unknown network outcome',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let checked=0;const controller={restore:async()=>{checked++;}};
  globalThis.fetch=async()=>new Response(null,{status:204});await confirmAccountAction('account-deletion','token',controller);assert.equal(checked,1);
  globalThis.fetch=async()=>{throw new Error('offline');};await assert.rejects(confirmAccountAction('email-change','token',controller),AccountActionError);assert.equal(checked,2);
  globalThis.fetch=async()=>new Response('{}',{status:404});await assert.rejects(confirmAccountAction('email-change','token',controller),AccountActionError);assert.equal(checked,2);
  globalThis.fetch=async()=>Response.json({ok:true});await assert.rejects(confirmAccountAction('email-change','token',controller),AccountActionError);assert.equal(checked,3);
});
test('confirmation strips URL token and hash; malformed/duplicate tokens cannot become requests',()=>{
  assert.deepEqual(consumeConfirmationUrl('https://example.test/auth/account-deletion/confirm/?token=one-use#secret'),{token:'one-use',cleanUrl:'/auth/account-deletion/confirm/'});
  assert.equal(consumeConfirmationUrl('https://example.test/auth/email-change/confirm/?token=one&token=two').token,null);
  assert.throws(()=>accountSettingsApi.confirm('account-deletion','bad token'));
});
