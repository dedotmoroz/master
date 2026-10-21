import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BidMessaging } from "../../src/modules/marketplace/application/bid-messages.ts";
import { BidMessage } from "../../src/modules/marketplace/domain/bid-message.ts";
import { Order } from "../../src/modules/marketplace/domain/order.ts";
import { Bid } from "../../src/modules/marketplace/domain/bid.ts";
import { Account } from "../../src/modules/identity/domain/account.ts";
import { MoneyRange } from "../../src/shared/domain/value-objects.ts";
import type { Notification } from "../../src/modules/notifications/application/notifications.ts";

function fixture() {
  const now = new Date("2026-01-01");
  let order = Order.createPublished({ id: "order", customerId: "customer", title: "Работа", description: "Описание",
    categoryId: "category", locationId: "location", budget: MoneyRange.unspecified(), attachmentIds: [], createdAt: now }, now);
  let bid = Bid.submit({ id: "bid", contractorId: "contractor", message: "Отклик", price: MoneyRange.unspecified(),
    durationDaysMin: null, durationDaysMax: null, visibility: "public", submittedAt: now }, order);
  let inactive: string | null = null;
  let allowed = true;
  let rateCalls = 0;
  const messages: BidMessage[] = [];
  const notifications: Notification[] = [];
  const handler = new BidMessaging({
    accounts: { findById: async (id) => Account.restore({ id,email:`${id}@example.com`,status:id===inactive?"deleted":"active",capabilities:[],createdAt:now }), save: async () => {}, findByEmail: async () => null },
    orders: { findById: async (id) => id === "order" ? order : null, save: async () => {} },
    bids: { findById: async (id) => id === "bid" ? bid : null, save: async () => {}, findActiveByOrderAndContractor: async () => bid, findSubmittedByOrder: async () => [bid] },
    messages: {
      save: async (m) => { messages.push(m); },
      findByClientId: async (bidId,author,id) => messages.find((m) => { const s=m.toSnapshot(); return s.bidId===bidId && s.authorId===author && s.clientMessageId===id; }) ?? null,
      list: async (_bidId,pagination) => ({ items: messages.map((m) => m.toSnapshot()),total:messages.length,...pagination }),
    },
    transactions: { execute: async (work) => work() }, ids: { next: randomUUID }, clock: { now: () => new Date(now) },
    rateLimiter: { consume: async () => { rateCalls++; return { allowed,retryAfterSeconds:30 }; } },
    notifications: { save: async (n) => { notifications.push(n); }, findById: async () => null,
      list: async (_id,p) => ({ items:notifications,total:notifications.length,unreadCount:notifications.length,...p }),
      markRead: async () => true,markEmailed:async()=>{},markEmailSkipped:async()=>{} },
  });
  return { handler,messages,notifications,rateCalls:()=>rateCalls, disable:()=>{allowed=false;},
    inactive:(id:string)=>{inactive=id;}, close:()=>{order=Order.restore({...order.toSnapshot(),status:"completed"});},
    withdraw:()=>{bid=Bid.restore({...bid.toSnapshot(),status:"withdrawn"});} };
}

test("private conversation is only for its two participants, even when the bid is public", async () => {
  const f=fixture();
  await assert.rejects(f.handler.list("outsider","bid",{limit:20,offset:0}), { code:"BID_NOT_FOUND" });
  await assert.rejects(f.handler.send({accountId:"outsider",bidId:"bid",text:"private",clientMessageId:randomUUID()}), { code:"BID_NOT_FOUND" });
  await assert.rejects(f.handler.list("customer","missing",{limit:20,offset:0}), { code:"BID_NOT_FOUND" });
  assert.equal(f.rateCalls(),0);
  await f.handler.send({accountId:"customer",bidId:"bid",text:"private-text",clientMessageId:randomUUID()});
  await f.handler.send({accountId:"contractor",bidId:"bid",text:"reply",clientMessageId:randomUUID()});
  assert.deepEqual(f.notifications.map(n=>n.accountId),["contractor","customer"]);
  assert.ok(f.notifications.every(n=>n.bidId==="bid" && n.kind==="message_received"));
  assert.doesNotMatch(JSON.stringify(f.notifications),/private-text|reply/);
  assert.equal((await f.handler.list("contractor","bid",{limit:20,offset:0})).total,2);
});

test("message retries are idempotent, conflicts are explicit, and closed conversations remain readable", async () => {
  const f=fixture();const request={accountId:"customer",bidId:"bid",text:" hello ",clientMessageId:randomUUID()};
  const first=await f.handler.send(request);
  f.close();
  assert.deepEqual(await f.handler.send({...request,text:"hello"}),first);
  await assert.rejects(f.handler.send({...request,text:"different"}),{code:"MESSAGE_IDEMPOTENCY_CONFLICT"});
  await assert.rejects(f.handler.send({...request,clientMessageId:randomUUID()}),{code:"CONVERSATION_READ_ONLY"});
  assert.equal(f.messages.length,1);assert.equal(f.notifications.length,1);assert.equal(f.rateCalls(),1);
  assert.equal((await f.handler.list("customer","bid",{limit:20,offset:0})).total,1);
});

test("withdrawn bids, inactive participants, invalid pages and rate limits cannot create messages", async () => {
  const send=(f:ReturnType<typeof fixture>)=>f.handler.send({accountId:"customer",bidId:"bid",text:"x",clientMessageId:randomUUID()});
  const closed=fixture();closed.withdraw();await assert.rejects(send(closed),{code:"CONVERSATION_READ_ONLY"});
  const inactive=fixture();inactive.inactive("contractor");await assert.rejects(send(inactive),{code:"BID_NOT_FOUND"});
  const limited=fixture();limited.disable();await assert.rejects(send(limited),{code:"RATE_LIMIT_EXCEEDED"});
  assert.equal(limited.messages.length,0);assert.equal(limited.notifications.length,0);
  await assert.rejects(limited.handler.list("customer","bid",{limit:0,offset:0}),{code:"INVALID_PAGINATION"});
});
