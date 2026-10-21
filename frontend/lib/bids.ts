import {AuthError} from './auth.ts';
import {OrderError,orderRequest,UUID} from './orders.ts';
import {rublesToMinor} from './catalog.ts';
import type {Budget,Page} from './catalog.ts';
import {assertPage} from './api.ts';

export const bidStatusLabel={submitted:'Отправлен',selected:'Выбран исполнителем',rejected:'Выбран другой мастер',withdrawn:'Отозван',cancelled:'Заказ отменён'};
export type BidStatus=keyof typeof bidStatusLabel;
export type Bid={id:string;orderId:string;orderTitle?:string;contractorId:string;message:string;price:Budget;durationDaysMin:number|null;durationDaysMax:number|null;visibility:'public'|'private';status:BidStatus;submittedAt:string;decidedAt:string|null};
export type BidFields={message:string;priceMin:string;priceMax:string;daysMin:string;daysMax:string;visibility:string};
export type BidBody={message:string;priceMinMinor:number|null;priceMaxMinor:number|null;durationDaysMin:number|null;durationDaysMax:number|null;visibility:'public'|'private'};
export type Selection={orderId:string;bidId:string;contractorId:string;orderStatus:'in_progress'};
export function buildBid(fields:BidFields):BidBody{
  const message=fields.message.trim();if(!message||message.length>5000)throw new Error('Напишите отклик: от 1 до 5000 символов.');
  const min=rublesToMinor(fields.priceMin.trim())??null,max=rublesToMinor(fields.priceMax.trim())??null;
  if(min!==null&&max!==null&&min>max)throw new Error('Цена «от» не может быть больше цены «до».');
  const days=(value:string)=>{if(!value.trim())return null;if(!/^\d+$/.test(value.trim())||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>100000)throw new Error('Срок указывается целым числом дней от 1 до 100000.');return Number(value);};
  const from=days(fields.daysMin),to=days(fields.daysMax);if(from!==null&&to!==null&&from>to)throw new Error('Срок «от» не может быть больше срока «до».');
  if(fields.visibility!=='private'&&fields.visibility!=='public')throw new Error('Выберите видимость отклика.');
  return {message,priceMinMinor:min,priceMaxMinor:max,durationDaysMin:from,durationDaysMax:to,visibility:fields.visibility};
}
export class BidError extends Error{
  readonly status:number;readonly code:string;
  constructor(error:OrderError){
    const messages:Record<string,string>={SELF_BID:'Нельзя откликаться на собственный заказ.',BID_ALREADY_EXISTS:'У вас уже есть активный отклик на этот заказ. Откройте «Мои отклики».',ORDER_NOT_ACCEPTING_BIDS:'Заказ больше не принимает отклики.',BID_NOT_SELECTABLE:'Этот отклик больше нельзя выбрать. Обновите список.',BID_NOT_WITHDRAWABLE:'Этот отклик уже нельзя отозвать. Обновите список.',ACCOUNT_NOT_ACTIVE:'Аккаунт одного из участников недоступен.'};
    super(messages[error.code]||(error.status===404?'Заказ или отклик не найден либо недоступен этому аккаунту.':error.status===409?'Состояние заказа или отклика изменилось. Обновите данные.':error.status===400||error.status===422?'Проверьте текст, цену и срок отклика.':error.status===429?'Слишком много запросов. Повторите позже.':'Не удалось выполнить действие. Проверьте соединение. Перед повторной отправкой проверьте «Мои отклики».'));
    this.status=error.status;this.code=error.code;
  }
}
function assertBid(value:Bid):Bid{
  if(!value||!UUID.test(value.id)||!UUID.test(value.orderId)||!UUID.test(value.contractorId)||!Object.hasOwn(bidStatusLabel,value.status)||typeof value.message!=='string'||!value.price||!['private','public'].includes(value.visibility))throw new Error('Сервис вернул некорректный отклик.');return value;
}
async function request<T>(method:'GET'|'POST',path:string,token:string,body?:unknown,signal?:AbortSignal){try{return await orderRequest<T>(method,path,body,token,signal);}catch(error){if(error instanceof AuthError)throw error;if(error instanceof OrderError)throw new BidError(error);throw error;}}
async function list(path:string,token:string,page:number,signal?:AbortSignal){const value=await request<Page<Bid>>('GET',`${path}?limit=20&offset=${(page-1)*20}`,token,undefined,signal);assertPage(value);value.items.forEach(assertBid);return value;}
export const bidsApi={
  async submit(token:string,orderId:string,body:BidBody){return assertBid(await request<Bid>('POST',`/orders/${encodeURIComponent(orderId)}/bids`,token,body));},
  own:(token:string,page:number,signal?:AbortSignal)=>list('/contractor/bids',token,page,signal),
  forOrder:(token:string,orderId:string,page:number,signal?:AbortSignal)=>list(`/customer/orders/${encodeURIComponent(orderId)}/bids`,token,page,signal),
  async withdraw(token:string,id:string){return assertBid(await request<Bid>('POST',`/contractor/bids/${encodeURIComponent(id)}/withdraw`,token));},
  async select(token:string,orderId:string,id:string){const value=await request<Selection>('POST',`/customer/orders/${encodeURIComponent(orderId)}/bids/${encodeURIComponent(id)}/select`,token);if(value.orderId!==orderId||value.bidId!==id||!UUID.test(value.contractorId)||value.orderStatus!=='in_progress')throw new Error('Сервис вернул некорректное подтверждение выбора.');return value;},
};
