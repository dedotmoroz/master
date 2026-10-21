import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthError} from '../lib/auth.ts';
import {notificationHref,notificationsApi,NotificationError} from '../lib/notifications.ts';
import {NotificationCounter} from '../lib/notification-counter.ts';
const id='00000000-0000-0000-0000-000000000001',bid='00000000-0000-0000-0000-000000000002';
const item={id,kind:'bid_submitted' as const,orderId:id,bidId:null,title:'Новый отклик',text:'Текст',createdAt:'2026-10-18T12:00:00Z',readAt:null};
const page={items:[item],total:25,unreadCount:23,limit:20,offset:20};
test('notifications route to own bids, deal and exact conversation; missing legacy dialog is not invented',()=>{
  assert.equal(notificationHref(item),`/account/orders/view/?id=${id}`);
  assert.equal(notificationHref({...item,kind:'bid_selected'}),`/account/deals/view/?id=${id}`);
  assert.equal(notificationHref({...item,kind:'order_completed'}),`/account/deals/view/?id=${id}`);
  assert.equal(notificationHref({...item,kind:'message_received',bidId:bid}),`/account/messages/?bidId=${bid}`);
  assert.equal(notificationHref({...item,kind:'message_received'}),null);
  assert.throws(()=>notificationHref({...item,orderId:'javascript:alert(1)'}));
});
test('notifications use private no-store Bearer requests, offset and idempotent bodyless 204 read',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/v1/notifications?limit=20&offset=20');assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer private');assert.equal(options?.credentials,'omit');assert.equal(options?.cache,'no-store');assert.equal(options?.redirect,'error');return Response.json(page);};
  assert.equal((await notificationsApi.list('private',20,20)).unreadCount,23);
  globalThis.fetch=async(url,options)=>{assert.equal(url,`/api/v1/notifications/${id}/read`);assert.equal(options?.method,'POST');assert.equal(options?.body,undefined);return new Response(null,{status:204});};
  await notificationsApi.read('private',id);await notificationsApi.read('private',id);
  await assert.rejects(notificationsApi.list('private',20,-1));await assert.rejects(notificationsApi.read('private','bad'));
});
test('all four email switches round-trip; protected fields never enter PUT and errors reveal no server details',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});const value={email:{bidSubmitted:false,bidSelected:true,messageReceived:false,orderCompleted:true}};
  globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/v1/notification-preferences');assert.equal(options?.method,'PUT');assert.deepEqual(JSON.parse(String(options?.body)),value);return Response.json(value);};
  assert.deepEqual(await notificationsApi.savePreferences('private',{...value,accountId:'spoof'} as typeof value),value);
  for(const status of [401,404,429,500]){globalThis.fetch=async()=>Response.json({error:{message:'PRIVATE STACK TRACE'}},{status});await assert.rejects(notificationsApi.preferences('private'),error=>{assert.doesNotMatch(String(error),/PRIVATE STACK TRACE/);return status===401?error instanceof AuthError:error instanceof NotificationError&&error.status===status;});}
});
test('malformed notifications, counts, dates and preferences fail closed rather than showing false zero',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  for(const value of [{...page,unreadCount:-1},{...page,unreadCount:26},{...page,items:[{...item,kind:'new-unsupported'}]},{...page,items:[{...item,createdAt:'not-date'}]},{...page,items:[{...item,bidId:'bad'}]}]){globalThis.fetch=async()=>Response.json(value);await assert.rejects(notificationsApi.list('private',20,20));}
  globalThis.fetch=async()=>Response.json({email:{bidSubmitted:true,bidSelected:true,orderCompleted:true}});await assert.rejects(notificationsApi.preferences('private'));
});
test('counter does not overlap polls; forced refresh ignores late counts and cancel discards old-session responses',async()=>{
  const loads:{signal:AbortSignal;resolve:(n:number)=>void}[]=[];
  const counter=new NotificationCounter(signal=>new Promise(resolve=>loads.push({signal,resolve})));
  const first=counter.refresh();await counter.refresh();assert.equal(loads.length,1);
  const afterRead=counter.refresh(true);assert.equal(loads[0]!.signal.aborted,true);loads[1]!.resolve(2);await afterRead;loads[0]!.resolve(7);await first;assert.equal(counter.getSnapshot().count,2);
  const stale=counter.refresh();counter.cancel();loads[2]!.resolve(9);await stale;assert.equal(counter.getSnapshot().count,2);
  const other=new NotificationCounter(async()=>0);assert.equal(other.getSnapshot().count,null);await other.refresh();assert.equal(other.getSnapshot().count,0);
});
test('counter shows unavailable on network failure and can recover instead of retaining an inaccurate count',async()=>{
  let fail=false;const counter=new NotificationCounter(async()=>{if(fail)throw new Error('offline');return 3;});await counter.refresh();assert.equal(counter.getSnapshot().count,3);fail=true;await counter.refresh();assert.deepEqual(counter.getSnapshot(),{count:null,error:'offline'});fail=false;await counter.refresh();assert.deepEqual(counter.getSnapshot(),{count:3,error:null});
});
