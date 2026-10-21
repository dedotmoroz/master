import {AuthError,authTransport} from './auth.ts';
import type {Authentication} from './auth.ts';
import {rublesToMinor} from './catalog.ts';
import type {Budget,Page} from './catalog.ts';
export type OrderStatus='draft'|'published'|'in_progress'|'completed'|'cancelled';
export const statusLabel:Record<OrderStatus,string>={draft:'Черновик',published:'Опубликован',in_progress:'В работе',completed:'Завершён',cancelled:'Отменён'};
export const editable=(status:OrderStatus)=>status==='draft'||status==='published';
export const consentVersion='order-publication-2026-10-18';
export const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export type OwnOrderSummary={id:string;title:string;categoryId:string;locationId:string;budget:Budget;status:OrderStatus;createdAt:string;publishedAt:string|null};
export type OwnOrder=OwnOrderSummary&{customerId:string;description:string;attachmentIds:string[];selectedBidId:string|null;contractorId:string|null;completedAt:string|null};
export type OrderFields={title:string;description:string;categoryId:string;locationId:string;budgetMin:string;budgetMax:string};
export type UpdateBody={title:string;description:string;categoryId:string;locationId:string;budgetMinMinor:number|null;budgetMaxMinor:number|null;attachmentIds:string[]};
export type GuestFileClaim={attachmentId:string;claimToken:string};
export type GuestBody=Omit<UpdateBody,'attachmentIds'>&{email:string;contactName:string;temporaryAttachments:GuestFileClaim[];consentVersion:string};
export type Submission={submissionId:string;status:'pending_email';expiresAt:string};
export type GuestConfirmation={accountId:string;orderId:string;reusedAccount:boolean;alreadyConfirmed:boolean;session:{type:'Bearer';token:string}};
export class OrderError extends Error{
  readonly status:number;readonly code:string;
  constructor(status:number,code=''){
    super(status===404?'Заказ не найден или принадлежит другому аккаунту.':status===410?'Срок действия ссылки истёк. Разместите заказ заново.':status===409?'Состояние заказа изменилось. Обновите страницу: заказ, возможно, уже в работе или отменён.':status===429?'Слишком много запросов. Повторите позже.':status===422||status===400?'Проверьте поля заказа, категорию и место работ.':'Не удалось выполнить действие. Проверьте соединение и повторите попытку.');
    this.status=status;this.code=code;
  }
}
export async function orderRequest<T>(method:'GET'|'POST'|'PUT',path:string,body?:unknown,token?:string,signal?:AbortSignal):Promise<T>{
  const base=(process.env.NEXT_PUBLIC_API_BASE_URL||'/api/v1').replace(/\/$/,'');
  const headers:Record<string,string>={Accept:'application/json'};if(body!==undefined)headers['Content-Type']='application/json';if(token)headers.Authorization=`Bearer ${token}`;
  let response:Response;
  try{response=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});}catch(error){if(signal?.aborted)throw error;throw new OrderError(0);}
  if(response.status===401)throw new AuthError(401);
  if(!response.ok){let code='';try{const value=await response.json();if(typeof value?.error?.code==='string')code=value.error.code;}catch{}throw new OrderError(response.status,code);}
  try{return await response.json() as T;}catch{throw new Error('Сервис вернул некорректный ответ.');}
}
function nonblank(value:string,name:string,max:number){const result=value.trim();if(!result||result.length>max)throw new Error(`${name}: заполните поле, максимум ${max} символов.`);return result;}
export function buildUpdate(fields:OrderFields,attachmentIds:readonly string[]=[]):UpdateBody{
  if(attachmentIds.length>10||new Set(attachmentIds).size!==attachmentIds.length||attachmentIds.some(id=>!UUID.test(id)))throw new Error('Можно добавить до 10 разных проверенных файлов.');
  const min=rublesToMinor(fields.budgetMin.trim())??null,max=rublesToMinor(fields.budgetMax.trim())??null;
  if(min!==null&&max!==null&&min>max)throw new Error('Бюджет «от» не может быть больше бюджета «до».');
  return {title:nonblank(fields.title,'Название',160),description:nonblank(fields.description,'Описание',10000),categoryId:nonblank(fields.categoryId,'Категория',100),locationId:nonblank(fields.locationId,'Выберите место работ из результатов поиска',100),budgetMinMinor:min,budgetMaxMinor:max,attachmentIds:[...attachmentIds]};
}
export function buildGuest(fields:OrderFields,email:string,contactName:string,consent:boolean,claims:readonly GuestFileClaim[]=[]):GuestBody{
  if(!consent)throw new Error('Подтвердите публикацию текста заказа и отправку письма.');
  const address=email.trim();if(address.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(address))throw new Error('Укажите действующий email.');
  const {attachmentIds:_,...body}=buildUpdate(fields,claims.map(item=>item.attachmentId));
  if(claims.some(item=>!item.claimToken||item.claimToken.length>2048||/[\s\x00-\x1f]/.test(item.claimToken)))throw new Error('Недействительное подтверждение файла. Загрузите файл заново.');
  return {...body,email:address,contactName:nonblank(contactName,'Контактное лицо',120),temporaryAttachments:claims.map(item=>({...item})),consentVersion};
}
export const ownOrderHref=(id:string)=>`/account/orders/view/?id=${encodeURIComponent(id)}`;
export function assertOwnOrder(value:OwnOrder):OwnOrder{
  if(!value||!UUID.test(value.id)||typeof value.title!=='string'||!Object.hasOwn(statusLabel,value.status)||!Array.isArray(value.attachmentIds))throw new Error('Сервис вернул некорректный заказ.');return value;
}
export const ordersApi={
  async submit(body:GuestBody){const result=await orderRequest<Submission>('POST','/guest-orders',body);if(result.status!=='pending_email'||!UUID.test(result.submissionId))throw new Error('Сервис вернул некорректное подтверждение отправки.');return result;},
  async confirm(token:string){const value=await orderRequest<GuestConfirmation>('POST','/guest-orders/confirm',{token});if(!UUID.test(value.orderId)||!UUID.test(value.accountId)||typeof value.reusedAccount!=='boolean'||typeof value.alreadyConfirmed!=='boolean'||value.session?.type!=='Bearer'||typeof value.session.token!=='string'||!value.session.token||value.session.token.length>2048||/[\s\x00-\x1f]/.test(value.session.token))throw new Error('Сервис вернул некорректное подтверждение заказа.');return value;},
  async authentication(value:GuestConfirmation):Promise<Authentication>{const account=await authTransport.me(value.session.token);if(account.id!==value.accountId)throw new Error('Не удалось проверить аккаунт заказа.');return {account,createdAccount:!value.reusedAccount,session:value.session};},
  list:(token:string,page:number,signal?:AbortSignal)=>orderRequest<Page<OwnOrderSummary>>('GET',`/customer/orders?limit=20&offset=${(page-1)*20}`,undefined,token,signal),
  async get(token:string,id:string,signal?:AbortSignal){return assertOwnOrder(await orderRequest<OwnOrder>('GET',`/customer/orders/${encodeURIComponent(id)}`,undefined,token,signal));},
  async update(token:string,id:string,body:UpdateBody){return assertOwnOrder(await orderRequest<OwnOrder>('PUT',`/customer/orders/${encodeURIComponent(id)}`,body,token));},
  async cancel(token:string,id:string){return assertOwnOrder(await orderRequest<OwnOrder>('POST',`/customer/orders/${encodeURIComponent(id)}/cancel`,undefined,token));},
};
