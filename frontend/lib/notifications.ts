import {AuthError} from './auth.ts';
import {assertPage} from './api.ts';
import {UUID,ownOrderHref} from './orders.ts';
import {dealHref} from './deals.ts';
import {conversationHref} from './messages.ts';
import type {Page} from './catalog.ts';

export const notificationLabels={bid_submitted:'Новый отклик',bid_selected:'Выбор исполнителя',message_received:'Новое сообщение',order_completed:'Заказ завершён'};
export type NotificationKind=keyof typeof notificationLabels;
export type Notification={id:string;kind:NotificationKind;orderId:string;bidId:string|null;title:string;text:string;createdAt:string;readAt:string|null};
export type NotificationPage=Page<Notification>&{unreadCount:number};
export type EmailPreferences={email:{bidSubmitted:boolean;bidSelected:boolean;messageReceived:boolean;orderCompleted:boolean}};
export const emailLabels:Record<keyof EmailPreferences['email'],string>={bidSubmitted:'Новые отклики на мои заказы',bidSelected:'Меня выбрали исполнителем',messageReceived:'Новые сообщения в переписке',orderCompleted:'Завершение заказа'};
export class NotificationError extends Error{
  readonly status:number;
  constructor(status:number){super(status===404?'Уведомление недоступно этому аккаунту.':status===429?'Слишком много запросов. Повторите позже.':status===400||status===422?'Проверьте настройки уведомлений.':'Не удалось связаться с сервисом уведомлений. Проверьте соединение и повторите попытку.');this.status=status;}
}
async function request<T>(method:'GET'|'POST'|'PUT',path:string,token:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  const base=(process.env.NEXT_PUBLIC_API_BASE_URL||'/api/v1').replace(/\/$/,'');
  let response:Response;
  try{response=await fetch(base+path,{method,headers:{Accept:'application/json',Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});}catch(error){if(signal?.aborted)throw error;throw new NotificationError(0);}
  if(response.status===401)throw new AuthError(401);
  if(!response.ok)throw new NotificationError(response.status);
  if(method==='POST'){if(response.status!==204)throw new Error('Сервис не подтвердил прочтение уведомления.');return undefined as T;}
  try{return await response.json() as T;}catch{throw new Error('Сервис вернул некорректные уведомления.');}
}
export function assertPreferences(value:EmailPreferences):EmailPreferences{
  if(!value?.email||Object.keys(emailLabels).some(key=>typeof value.email[key as keyof EmailPreferences['email']]!=='boolean'))throw new Error('Сервис вернул некорректные настройки email.');
  return {email:{bidSubmitted:value.email.bidSubmitted,bidSelected:value.email.bidSelected,messageReceived:value.email.messageReceived,orderCompleted:value.email.orderCompleted}};
}
export function notificationHref(item:Pick<Notification,'kind'|'orderId'|'bidId'>){
  if(!UUID.test(item.orderId)||(item.bidId!==null&&!UUID.test(item.bidId)))throw new Error('Некорректная ссылка уведомления.');
  if(item.kind==='message_received')return item.bidId?conversationHref(item.bidId):null;
  return item.kind==='bid_submitted'?ownOrderHref(item.orderId):dealHref(item.orderId);
}
export const notificationsApi={
  async list(token:string,limit=20,offset=0,signal?:AbortSignal):Promise<NotificationPage>{
    if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new Error('Неверная страница уведомлений.');
    const value=await request<NotificationPage>('GET',`/notifications?limit=${limit}&offset=${offset}`,token,undefined,signal);assertPage(value);
    if(!Number.isSafeInteger(value.unreadCount)||value.unreadCount<0||value.unreadCount>value.total||value.limit!==limit||value.offset!==offset||value.items.length>limit)throw new Error('Некорректный список уведомлений.');
    for(const item of value.items){if(!item||!UUID.test(item.id)||!Object.hasOwn(notificationLabels,item.kind)||typeof item.title!=='string'||typeof item.text!=='string'||!Number.isFinite(Date.parse(item.createdAt))||(item.readAt!==null&&!Number.isFinite(Date.parse(item.readAt))))throw new Error('Некорректное уведомление.');notificationHref(item);}
    return value;
  },
  async read(token:string,id:string,signal?:AbortSignal){if(!UUID.test(id))throw new Error('Некорректное уведомление.');await request<void>('POST',`/notifications/${encodeURIComponent(id)}/read`,token,undefined,signal);},
  async preferences(token:string,signal?:AbortSignal){return assertPreferences(await request<EmailPreferences>('GET','/notification-preferences',token,undefined,signal));},
  async savePreferences(token:string,value:EmailPreferences,signal?:AbortSignal){return assertPreferences(await request<EmailPreferences>('PUT','/notification-preferences',token,assertPreferences(value),signal));},
};
