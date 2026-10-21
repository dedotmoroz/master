import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { runMigrations } from "../../src/adapters/out/postgres/migrations.ts";
import { PgDatabase, PgTransactionManager } from "../../src/adapters/out/postgres/database.ts";
import { PgSessionIssuer, CryptoIdGenerator } from "../../src/adapters/out/security/crypto-services.ts";
import { createApplication } from "../../src/app/create-application.ts";
import { loadConfig } from "../../src/app/config.ts";
import { captureOpenApiResponseValidation } from "../helpers/openapi-response-validation.ts";
import { BidMessaging } from "../../src/modules/marketplace/application/bid-messages.ts";
import { PgBidMessageRepository } from "../../src/adapters/out/postgres/bid-message-repository.ts";
import { PgAccountRepository, PgOrderRepository, PgBidRepository } from "../../src/adapters/out/postgres/repositories.ts";
import { PgNotificationRepository } from "../../src/adapters/out/postgres/notification-repository.ts";
import { PgNotificationPreferencesRepository } from "../../src/adapters/out/postgres/notification-preferences-repository.ts";
import { PgPublicRateLimiter } from "../../src/adapters/out/postgres/public-rate-limiter.ts";
import { PgAccountErasure } from "../../src/adapters/out/postgres/account-deletion-repository.ts";
import { SendNotificationEmailHandler } from "../../src/modules/notifications/application/notifications.ts";
import { PgOutboxRepository } from "../../src/adapters/out/postgres/outbox-repository.ts";
import { ProcessOutboxBatchHandler } from "../../src/modules/notifications/application/process-outbox.ts";

test("private messages combine safe legacy history, serialize retries, notify atomically and enforce privacy", { skip: !process.env.TEST_DATABASE_URL }, async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const schema=`messages_${randomUUID().replaceAll("-","_")}`;
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set("options",`-c search_path=${schema}`);
  const pool=new Pool({connectionString:url.toString()});
  const db=new PgDatabase(pool);
  const clock={now:()=>new Date()};
  const secret="messages-integration-secret-32-bytes-minimum";
  await runMigrations(pool,resolve("migrations"));
  const app=await createApplication(loadConfig({NODE_ENV:"test",DATABASE_URL:url.toString(),VERIFICATION_TOKEN_SECRET:secret,RUN_MIGRATIONS_ON_START:"false"}));
  const verify=captureOpenApiResponseValidation(app.server);
  context.after(async()=>{await app.close();try{verify();}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}});
  const [customer,contractor,outsider,administrator,orderId,otherOrder,bidId,otherBid]=Array.from({length:8},randomUUID);
  const issuer=new PgSessionIssuer(db,clock);
  const headers=new Map<string,{authorization:string}>();
  for(const id of [customer!,contractor!,outsider!,administrator!]) {
    await pool.query("INSERT INTO accounts(id,email,status,created_at) VALUES($1,$2,'active',now())",[id,`${id}@example.com`]);
    if(id===administrator)await pool.query("INSERT INTO account_capabilities VALUES($1,'admin')",[id]);
    headers.set(id,{authorization:`Bearer ${await issuer.issue(id)}`});
  }
  for(const id of [orderId,otherOrder])await pool.query(`INSERT INTO orders
    (id,customer_id,category_id,location_id,title,description,status,created_at,published_at)
    VALUES($1,$2,'house-building','ru-locality-1','Work','Description','published',now(),now())`,[id,customer]);
  for(const [id,author]of [[bidId,contractor],[otherBid,outsider]])await pool.query(`INSERT INTO bids
    (id,order_id,contractor_id,message,visibility,status,submitted_at) VALUES($1,$2,$3,'Offer','public','submitted',now())`,[id,orderId,author]);
  const historical=[
    {bid:bidId,order:orderId,author:customer,text:"old-known"},
    {bid:bidId,order:orderId,author:null,text:"old-deleted-author"},
    {bid:null,order:orderId,author:customer,text:"unlinked-private"},
    {bid:bidId,order:otherOrder,author:customer,text:"wrong-order-private"},
    {bid:bidId,order:orderId,author:outsider,text:"outsider-private"},
  ];
  for(const [i,row]of historical.entries())await pool.query(`INSERT INTO legacy_bid_messages
    (id,legacy_id,order_id,bid_id,author_id,legacy_author_id,text,created_at)
    VALUES($1,$2,$3,$4,$5,1,$6,now()-interval '1 day')`,[randomUUID(),i+1,row.order,row.bid,row.author,row.text]);
  const path=`/api/v1/bids/${bidId}/messages`;
  const read=(id:string)=>app.server.inject({method:"GET",url:path,headers:headers.get(id)!});
  const post=(id:string,text:string,clientMessageId=randomUUID())=>app.server.inject({method:"POST",url:path,headers:headers.get(id)!,payload:{text,clientMessageId}});
  assert.equal((await app.server.inject({method:"GET",url:path})).statusCode,401);
  for(const id of [outsider!,administrator!]) {
    assert.equal((await read(id)).statusCode,404);
    assert.equal((await post(id,"forbidden")).statusCode,404);
  }
  const legacy=await read(customer!);
  assert.equal(legacy.statusCode,200);assert.equal(legacy.json().total,2);
  assert.equal(legacy.json().canSend,true);
  assert.ok(legacy.json().items.some((m:{authorId:string|null})=>m.authorId===null));
  assert.doesNotMatch(legacy.body,/unlinked-private|wrong-order-private|outsider-private/);
  const offset=await app.server.inject({method:"GET",url:`${path}?limit=1&offset=1`,headers:headers.get(contractor!)!});
  assert.equal(offset.json().total,2);assert.equal(offset.json().items.length,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM notifications")).rows[0].n,0);
  const nonce=randomUUID();
  const [first,retry]=await Promise.all([post(customer!,"PRIVATE_BODY",nonce),post(customer!,"PRIVATE_BODY",nonce)]);
  assert.equal(first.statusCode,201);assert.equal(retry.statusCode,201);assert.equal(first.json().id,retry.json().id);
  assert.equal(first.json().authorId,customer);assert.equal(first.json().orderId,orderId);
  assert.equal((await post(customer!,"DIFFERENT",nonce)).statusCode,409);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM bid_messages")).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM notifications")).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM outbox_events")).rows[0].n,1);
  const inbox=await app.server.inject({method:"GET",url:"/api/v1/notifications",headers:headers.get(contractor!)!});
  assert.equal(inbox.json().items[0].bidId,bidId);assert.equal(inbox.json().items[0].kind,"message_received");
  assert.doesNotMatch(inbox.body,/PRIVATE_BODY/);
  assert.equal((await post(contractor!,"REPLY_BODY")).statusCode,201);
  const preferencePath="/api/v1/notification-preferences";
  const email={bidSubmitted:true,bidSelected:true,orderCompleted:true,messageReceived:false};
  assert.equal((await app.server.inject({method:"PUT",url:preferencePath,headers:headers.get(contractor!)!,payload:{email}})).statusCode,200);
  const {messageReceived:ignored,...oldClient}=email;
  const compat=await app.server.inject({method:"PUT",url:preferencePath,headers:headers.get(contractor!)!,payload:{email:oldClient}});
  assert.equal(compat.json().email.messageReceived,false);
  const sent:Array<{text:string;bidId?:string|null}>=[];
  const mail=new SendNotificationEmailHandler({accounts:new PgAccountRepository(db),notifications:new PgNotificationRepository(db),
    preferences:new PgNotificationPreferencesRepository(db),clock,email:{sendNotification:async(value)=>{sent.push(value);}}});
  const worker=new ProcessOutboxBatchHandler(new PgOutboxRepository(db),new Map([["NotificationEmailRequested",m=>mail.execute(m.aggregateId)]]));
  await worker.execute("messages-test");
  assert.equal(sent.length,1);assert.equal(sent[0]!.bidId,bidId);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE_BODY|REPLY_BODY/);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE email_skipped_at IS NOT NULL")).rows[0].n,1);
  for(const payload of [{text:"x",clientMessageId:randomUUID(),authorId:outsider},{text:"x",clientMessageId:"bad"},{text:"x".repeat(5001),clientMessageId:randomUUID()}]) {
    assert.equal((await app.server.inject({method:"POST",url:path,headers:headers.get(customer!)!,payload})).statusCode,400);
  }
  assert.equal((await post(customer!,"   ")).statusCode,422);
  await pool.query("UPDATE orders SET status='cancelled' WHERE id=$1",[orderId]);
  assert.equal((await post(customer!,"closed")).statusCode,409);
  assert.equal((await post(customer!,"PRIVATE_BODY",nonce)).json().id,first.json().id);
  assert.equal((await read(customer!)).json().total,4);
  assert.equal((await read(customer!)).json().canSend,false);
  await pool.query("UPDATE orders SET status='published' WHERE id=$1",[orderId]);

  // Roll back the message AND rate counter when notification/outbox persistence fails.
  class FailingNotifications extends PgNotificationRepository { override async save():Promise<void>{throw new Error("test failure");} }
  const handler=(notifications:PgNotificationRepository)=>new BidMessaging({accounts:new PgAccountRepository(db),orders:new PgOrderRepository(db),
    bids:new PgBidRepository(db),messages:new PgBidMessageRepository(db),transactions:new PgTransactionManager(db),notifications,
    ids:new CryptoIdGenerator(),clock,rateLimiter:new PgPublicRateLimiter(db,secret)});
  await assert.rejects(handler(new FailingNotifications(db)).send({accountId:customer!,bidId:bidId!,text:"rollback",clientMessageId:randomUUID()}));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM bid_messages")).rows[0].n,2);
  for(let i=0;i<19;i++)assert.equal((await post(customer!,`message-${i}`)).statusCode,201);
  const limited=await post(customer!,"too many");assert.equal(limited.statusCode,429);assert.ok(Number(limited.headers["retry-after"])>0);

  // Account erasure races sending under the same account locks; no surviving private messages/notifications.
  const sending=handler(new PgNotificationRepository(db)).send({accountId:contractor!,bidId:bidId!,text:"race",clientMessageId:randomUUID()});
  const deleting=db.transaction(async()=>{
    await db.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[contractor]);
    await db.query("UPDATE accounts SET status='deleted',email=$2 WHERE id=$1",[contractor,`deleted-${contractor}@accounts.invalid`]);
    await new PgAccountErasure(db).erasePersonalData(contractor!,`${contractor}@example.com`,`deleted-${contractor}@accounts.invalid`,clock.now());
  });
  const outcome=await Promise.allSettled([sending,deleting]);assert.equal(outcome[1]!.status,"fulfilled");
  if(outcome[0]!.status==="rejected")assert.equal(outcome[0]!.reason.code,"BID_NOT_FOUND");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM bid_messages WHERE bid_id=$1",[bidId])).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM legacy_bid_messages WHERE bid_id=$1",[bidId])).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE kind='message_received'")).rows[0].n,0);
  assert.equal((await read(customer!)).statusCode,404);assert.equal((await read(contractor!)).statusCode,401);
});
