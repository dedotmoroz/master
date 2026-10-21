import test from 'node:test';
import assert from 'node:assert/strict';
import {guestFilesApi} from '../lib/order-files.ts';
import {buildGuest,buildUpdate} from '../lib/orders.ts';
import {validateFile} from '../lib/profile.ts';
const id='00000000-0000-0000-0000-000000000001';
const fields={title:'Заказ',description:'Описание',categoryId:'house-building',locationId:'ru-locality-1',budgetMin:'',budgetMax:''};
test('order files validate UUIDs, unique count, claims and explicit consent without leaking claims into PUT',()=>{
  const claims=[{attachmentId:id,claimToken:'private-claim'}];const body=buildGuest(fields,'test@example.com','Имя',true,claims);
  assert.deepEqual(body.temporaryAttachments,claims);assert.notEqual(body.temporaryAttachments,claims);assert.equal('attachmentIds'in body,false);
  assert.throws(()=>buildUpdate(fields,['bad']));assert.throws(()=>buildUpdate(fields,[id,id]));assert.throws(()=>buildGuest(fields,'test@example.com','Имя',true,[{attachmentId:id,claimToken:''}]));assert.throws(()=>buildGuest(fields,'test@example.com','Имя',false,claims));
  validateFile({name:'work.pdf',type:'application/pdf',size:20*1024*1024},'order');assert.throws(()=>validateFile({name:'work.pdf',type:'application/pdf',size:20*1024*1024+1},'guest_order'));
});
test('guest file claim stays in JSON body, no session/cookies/query; malicious tickets fail closed',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  const file=new File(['photo'],'photo.png',{type:'image/png'});const upload={attachment:{id,ownerId:null,purpose:'guest_order' as const,status:'pending_upload' as const,originalFileName:file.name},claimToken:'private-claim',uploadUrl:'https://storage.test/signed',uploadHeaders:{'content-type':'image/png'}};
  globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/v1/guest-attachments/upload-requests');assert.equal((options?.headers as Record<string,string>).Authorization,undefined);assert.equal(options?.credentials,'omit');assert.equal(JSON.parse(String(options?.body)).captchaToken,'captcha');return Response.json(upload);};
  const ticket=await guestFilesApi.request(file,'captcha');
  globalThis.fetch=async(url,options)=>{assert.equal(url,`/api/v1/guest-attachments/${id}/confirm`);assert.deepEqual(JSON.parse(String(options?.body)),{claimToken:'private-claim'});return Response.json({...upload.attachment,status:'ready'});};
  assert.equal((await guestFilesApi.confirm(ticket)).status,'ready');
  for(const change of [{uploadUrl:'javascript:alert(1)'},{claimToken:''},{uploadHeaders:{authorization:'Bearer stolen'}}]){globalThis.fetch=async()=>Response.json({...upload,...change});await assert.rejects(guestFilesApi.request(file));}
});
