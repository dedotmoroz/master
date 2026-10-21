import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProfile,buildProfile,profileApi,validateFile,safeStorageUrl,ProfileError} from '../lib/profile.ts';
const id='00000000-0000-0000-0000-000000000001';
test('profile payload keeps existing avatar, all 50 specializations/locations and portfolio IDs without mutating draft',()=>{
  const draft={...blankProfile(),displayName:' Бригада ',bio:' Опыт ',avatarAttachmentId:id,specializationIds:Array.from({length:50},(_,i)=>`category-${i}`),serviceLocationIds:Array.from({length:50},(_,i)=>`place-${i}`),portfolio:[{title:' Проект ',description:' Текст ',attachmentIds:[id]}]};
  const body=buildProfile(draft);assert.equal(body.displayName,'Бригада');assert.equal(body.specializationIds.length,50);assert.equal(body.serviceLocationIds.length,50);assert.equal(body.avatarAttachmentId,id);assert.equal(body.portfolio[0]?.attachmentIds[0],id);assert.equal(draft.portfolio[0]?.title,' Проект ');
  for(const change of [{displayName:' '},{bio:'x'.repeat(5001)},{specializationIds:['same','same']},{serviceLocationIds:Array.from({length:51},(_,i)=>String(i))},{portfolio:[{title:'Пустой проект',description:'',attachmentIds:[]}]}])assert.throws(()=>buildProfile({...draft,...change}));
});
test('file validation rejects unsupported, empty and oversized inputs; storage URLs never accept scripts or credentials',()=>{
  validateFile({name:'photo.png',type:'image/png',size:100},'profile_avatar');validateFile({name:'work.pdf',type:'application/pdf',size:100},'portfolio');
  for(const file of [{name:'bad.svg',type:'image/svg+xml',size:10},{name:'x.png',type:'image/png',size:0},{name:'x.png',type:'image/png',size:5*1024*1024+1},{name:'x.pdf',type:'application/pdf',size:1}])assert.throws(()=>validateFile(file,'profile_avatar'));
  for(const url of ['javascript:alert(1)','data:text/html,test','https://user:pass@example.com/a','http://external.example/a'])assert.throws(()=>safeStorageUrl(url));
  assert.ok(safeStorageUrl('http://127.0.0.1:59000/bucket/signed?token=test'));
});
test('profile 404 is empty only for missing own profile; upload PUT sends no Bearer or cookies',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>Response.json({error:{code:'CONTRACTOR_PROFILE_NOT_FOUND'}},{status:404});assert.equal(await profileApi.get('token'),null);
  globalThis.fetch=async()=>Response.json({error:{code:'ROUTE_NOT_FOUND'}},{status:404});await assert.rejects(profileApi.get('token'),e=>e instanceof ProfileError);
  const file=new File(['image-bytes'],'photo.png',{type:'image/png'});const upload={attachment:{id,ownerId:id,purpose:'profile_avatar' as const,status:'pending_upload' as const,originalFileName:file.name},uploadUrl:'https://storage.example.test/signed',uploadHeaders:{'content-type':'image/png'}};
  globalThis.fetch=async(url,options)=>{if(String(url).startsWith('/api/')){assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer token');return Response.json(upload,{status:201});}assert.equal(options?.method,'PUT');assert.deepEqual(options?.headers,{'content-type':'image/png'});assert.equal(options?.credentials,'omit');assert.equal(options?.body,file);assert.equal(options?.referrerPolicy,'no-referrer');return new Response(null,{status:200});};
  const ticket=await profileApi.uploadRequest('token',file,'profile_avatar');await profileApi.put(ticket,file);
});
