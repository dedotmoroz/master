import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AuthError} from '../lib/auth.ts';
import type {Account,Authentication} from '../lib/auth.ts';
import {SESSION_KEY,SessionController} from '../lib/session.ts';
const account:Account={id:'account-id',email:'test@example.com',capabilities:['contractor']};
const confirmation:Authentication={account,createdAccount:true,session:{type:'Bearer',token:'test-session'}};
function storage(){const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};}
test('confirmation persists only session token, reload restores, logout clears',async()=>{
  const memory=storage();let allFlag:boolean|undefined;
  const transport={me:async()=>account,confirm:async()=>confirmation,logout:async(_token:string,all?:boolean)=>{allFlag=all;}};
  const first=new SessionController(()=>memory,transport);await first.restore();assert.equal(first.getSnapshot().account,null);
  await first.confirm('register','one-use-token');assert.equal(memory.getItem(SESSION_KEY),'test-session');assert.equal(JSON.stringify(first.getSnapshot()).includes('test-session'),false);
  const reloaded=new SessionController(()=>memory,transport);await reloaded.restore();assert.equal(reloaded.getSnapshot().account?.id,account.id);
  await reloaded.logout(true);assert.equal(allFlag,true);assert.equal(memory.getItem(SESSION_KEY),null);assert.equal(reloaded.getSnapshot().account,null);
});
test('401 removes session but network failure preserves it for retry',async()=>{
  const memory=storage();memory.setItem(SESSION_KEY,'stored');let offline=true;
  const controller=new SessionController(()=>memory,{confirm:async()=>confirmation,me:async()=>{throw offline?new Error('offline'):new AuthError(401);},logout:async()=>{}});
  await controller.restore();assert.equal(memory.getItem(SESSION_KEY),'stored');assert.match(controller.getSnapshot().error!,/offline/);
  offline=false;await controller.restore();assert.equal(memory.getItem(SESSION_KEY),null);assert.equal(controller.getSnapshot().account,null);
});
test('late restore cannot overwrite a confirmed account; duplicate confirmation blocked',async()=>{
  const memory=storage();memory.setItem(SESSION_KEY,'old');let resolve!: (account:Account)=>void;
  const controller=new SessionController(()=>memory,{me:()=>new Promise<Account>(done=>{resolve=done;}),confirm:async()=>confirmation,logout:async()=>{}});
  const pending=controller.restore();const confirm=controller.confirm('login','one-use');
  await assert.rejects(controller.confirm('login','one-use'),/Дождитесь/);await confirm;
  resolve({...account,id:'old-account'});await pending;assert.equal(controller.getSnapshot().account?.id,account.id);assert.equal(memory.getItem(SESSION_KEY),'test-session');
});
test('storage denial revokes issued session and never reports successful login',async()=>{
  let revoked=false;const memory=storage();memory.setItem=()=>{throw new Error('denied');};
  const controller=new SessionController(()=>memory,{me:async()=>account,confirm:async()=>confirmation,logout:async()=>{revoked=true;}});
  await assert.rejects(controller.confirm('register','one-use'),/запретил сохранение/);assert.equal(revoked,true);assert.equal(controller.getSnapshot().account,null);
});
test('logout outage retains token and account so server revocation can be retried',async()=>{
  const memory=storage();let fail=true;const controller=new SessionController(()=>memory,{me:async()=>account,confirm:async()=>confirmation,logout:async()=>{if(fail)throw new Error('offline');}});
  await controller.confirm('login','one-use');await controller.logout();assert.equal(memory.getItem(SESSION_KEY),'test-session');assert.ok(controller.getSnapshot().account);assert.equal(controller.getSnapshot().busy,false);
  fail=false;await controller.logout();assert.equal(memory.getItem(SESSION_KEY),null);assert.equal(controller.getSnapshot().account,null);
});
test('private call 401 clears expired session, and a late response cannot survive logout',async()=>{
  const memory=storage();const controller=new SessionController(()=>memory,{me:async()=>account,confirm:async()=>confirmation,logout:async()=>{}});
  await controller.confirm('login','one-use');await assert.rejects(controller.authorized(async()=>{throw new AuthError(401);}),AuthError);assert.equal(controller.getSnapshot().account,null);assert.equal(memory.getItem(SESSION_KEY),null);
  await controller.confirm('login','one-use');let finish!:(value:string)=>void;const pending=controller.authorized(()=>new Promise<string>(resolve=>{finish=resolve;}));await controller.logout();finish('private data');await assert.rejects(pending,/Сессия изменилась/);
});
