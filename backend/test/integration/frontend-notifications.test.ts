import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {createApplication} from '../../src/app/create-application.ts';
import {loadConfig} from '../../src/app/config.ts';
import {runMigrations} from '../../src/adapters/out/postgres/migrations.ts';
import {PgDatabase} from '../../src/adapters/out/postgres/database.ts';
import {PgSessionIssuer} from '../../src/adapters/out/security/crypto-services.ts';
import {PgAccountRepository} from '../../src/adapters/out/postgres/repositories.ts';
import {PgNotificationRepository} from '../../src/adapters/out/postgres/notification-repository.ts';
import {PgNotificationPreferencesRepository} from '../../src/adapters/out/postgres/notification-preferences-repository.ts';
import {SendNotificationEmailHandler} from '../../src/modules/notifications/application/notifications.ts';
import {notificationsApi,notificationHref,NotificationError} from '../../../frontend/lib/notifications.ts';
import {AuthError} from '../../../frontend/lib/auth.ts';
import {captureOpenApiResponseValidation} from '../helpers/openapi-response-validation.ts';

test('frontend notifications: private offset feed, read idempotency, exact links and email preferences on real PostgreSQL',{skip:!process.env.TEST_DATABASE_URL},async context=>{
  const schema=`frontend_notifications_${randomUUID().replaceAll('-','_')}`;const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema}`);const pool=new Pool({connectionString:url.toString()});const original=globalThis.fetch;let app:Awaited<ReturnType<typeof createApplication>>|undefined;
  context.after(async()=>{globalThis.fetch=original;await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
  await runMigrations(pool,resolve('migrations'));app=await createApplication(loadConfig({NODE_ENV:'test',DATABASE_URL:url.toString(),VERIFICATION_TOKEN_SECRET:'notification-test-secret-at-least-32-bytes',RUN_MIGRATIONS_ON_START:'false'}));const server=app.server;const verify=captureOpenApiResponseValidation(server);context.after(()=>verify());
  globalThis.fetch=async(input,options)=>{const response=await server.inject({method:options?.method as 'GET'|'POST'|'PUT',url:String(input),headers:options?.headers as Record<string,string>,...(options?.body?{payload:String(options.body)}:{})});return new Response(response.statusCode===204?null:response.body,{status:response.statusCode,headers:response.headers as Record<string,string>});};
  const owner=randomUUID(),other=randomUUID(),order=randomUUID(),bid=randomUUID();const db=new PgDatabase(pool),clock={now:()=>new Date()},issuer=new PgSessionIssuer(db,clock);const tokens:string[]=[];
  for(const id of [owner,other]){await pool.query("INSERT INTO accounts(id,email,status,created_at) VALUES($1,$2,'active',now())",[id,`${id}@example.com`]);tokens.push(await issuer.issue(id));}
  const [token,foreign]=tokens as [string,string];
  await pool.query("INSERT INTO orders(id,customer_id,category_id,location_id,title,description,status,created_at,published_at) VALUES($1,$2,'house-building','ru-locality-1','Работа','Описание','published',now(),now())",[order,owner]);
  await pool.query("INSERT INTO bids(id,order_id,contractor_id,message,visibility,status,submitted_at) VALUES($1,$2,$3,'Отклик','private','submitted',now())",[bid,order,other]);
  const ids:string[]=[];const kinds=['bid_submitted','bid_selected','message_received','order_completed'] as const;
  for(let n=0;n<25;n++){const id=randomUUID();ids.push(id);await pool.query('INSERT INTO notifications(id,account_id,source_event_id,kind,order_id,bid_id,title,text,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,owner,randomUUID(),kinds[n%4],order,n%4===2?bid:null,'Событие '+n,'<img src=x onerror=alert(1)>',new Date(Date.now()-n*1000)]);}
  const page1=await notificationsApi.list(token),page2=await notificationsApi.list(token,20,20);assert.equal(page1.total,25);assert.equal(page1.unreadCount,25);assert.equal(page1.items.length,20);assert.equal(page2.items.length,5);assert.equal(page2.unreadCount,25);assert.equal(page2.items[0]!.id,ids[20]);
  assert.equal(notificationHref(page1.items[2]!),`/account/messages/?bidId=${bid}`);assert.equal(notificationHref(page1.items[0]!),`/account/orders/view/?id=${order}`);assert.equal(notificationHref(page1.items[1]!),`/account/deals/view/?id=${order}`);
  assert.equal((await notificationsApi.list(foreign)).total,0);await assert.rejects(notificationsApi.read(foreign,ids[0]!),e=>e instanceof NotificationError&&e.status===404);
  await notificationsApi.read(token,ids[0]!);const readAt=(await notificationsApi.list(token)).items[0]!.readAt;assert.ok(readAt);await notificationsApi.read(token,ids[0]!);assert.equal((await notificationsApi.list(token)).items[0]!.readAt,readAt);assert.equal((await notificationsApi.list(token)).unreadCount,24);
  await assert.rejects(notificationsApi.list('bad-session'),e=>e instanceof AuthError&&e.status===401);
  const defaults={email:{bidSubmitted:true,bidSelected:true,messageReceived:true,orderCompleted:true}};assert.deepEqual(await notificationsApi.preferences(token),defaults);
  const off={email:{bidSubmitted:false,bidSelected:false,messageReceived:false,orderCompleted:false}};assert.deepEqual(await notificationsApi.savePreferences(token,off),off);assert.deepEqual(await notificationsApi.preferences(token),off);assert.deepEqual(await notificationsApi.preferences(foreign),defaults);
  let emails=0;const mail=new SendNotificationEmailHandler({accounts:new PgAccountRepository(db),notifications:new PgNotificationRepository(db),preferences:new PgNotificationPreferencesRepository(db),clock,email:{sendNotification:async()=>{emails++;}}});
  await mail.execute(ids[2]!);assert.equal(emails,0);assert.equal((await notificationsApi.list(token)).total,25);await notificationsApi.savePreferences(token,defaults);await mail.execute(ids[2]!);assert.equal(emails,0,'re-enabling must not resend skipped mail');
  await mail.execute(ids[3]!);assert.equal(emails,1);await mail.execute(ids[3]!);assert.equal(emails,1);
});
