import {orderRequest,OrderError,UUID,statusLabel} from './orders.ts';
import type {OrderStatus} from './orders.ts';
export type Review={id:string;orderId:string;authorId:string;subjectId:string;score:number;text:string;status:'published'|'hidden'|'disputed';createdAt:string};
export type Deal={orderId:string;title:string;status:OrderStatus;customerId:string;contractorId:string|null;selectedBidId:string|null;completedAt:string|null;ownReview:Review|null};
export type Completion={orderId:string;status:'completed';customerId:string;contractorId:string;completedAt:string};
export const dealHref=(id:string)=>`/account/deals/view/?id=${encodeURIComponent(id)}`;
export function buildReview(score:string,text:string){const value=Number(score),trimmed=text.trim();if(!/^[1-5]$/.test(score)||!Number.isInteger(value))throw new Error('Выберите оценку от 1 до 5.');if(!trimmed||trimmed.length>5000)throw new Error('Напишите отзыв: от 1 до 5000 символов.');return {score:value,text:trimmed};}
export class DealError extends Error{
  readonly status:number;readonly code:string;
  constructor(error:OrderError){super(error.status===404?'Сделка не найдена или вы не являетесь её участником.':error.code==='REVIEW_ALREADY_EXISTS'?'Вы уже оставили отзыв по этому заказу. Обновляем данные.':error.code==='ORDER_NOT_COMPLETED'?'Оставить отзыв можно только после завершения работы.':error.status===409?'Состояние заказа изменилось. Обновите данные перед повтором.':error.status===400||error.status===422?'Проверьте оценку и текст; завершать можно только заказ в работе.':'Не удалось получить подтверждение. Обновите состояние сделки перед повтором.');this.status=error.status;this.code=error.code;}
}
async function request<T>(method:'GET'|'POST',path:string,token:string,body?:unknown,signal?:AbortSignal){try{return await orderRequest<T>(method,path,body,token,signal);}catch(error){if(error instanceof OrderError)throw new DealError(error);throw error;}}
function review(value:Review){if(!value||!UUID.test(value.id)||!UUID.test(value.authorId)||!UUID.test(value.subjectId)||!UUID.test(value.orderId)||!Number.isInteger(value.score)||value.score<1||value.score>5||typeof value.text!=='string'||!['published','hidden','disputed'].includes(value.status))throw new Error('Некорректный ответ с отзывом.');return value;}
export const dealsApi={
  async get(token:string,id:string,signal?:AbortSignal){if(!UUID.test(id))throw new Error('Укажите корректный идентификатор заказа.');const value=await request<Deal>('GET',`/orders/${id}/deal`,token,undefined,signal);if(!value||value.orderId!==id||typeof value.title!=='string'||!Object.hasOwn(statusLabel,value.status)||!UUID.test(value.customerId)||(value.contractorId!==null&&!UUID.test(value.contractorId))||(value.selectedBidId!==null&&!UUID.test(value.selectedBidId)))throw new Error('Некорректное состояние сделки.');if(value.ownReview!==null)review(value.ownReview);return value;},
  async complete(token:string,id:string){const value=await request<Completion>('POST',`/orders/${encodeURIComponent(id)}/complete`,token);if(value.orderId!==id||value.status!=='completed'||!UUID.test(value.customerId)||!UUID.test(value.contractorId)||!Number.isFinite(Date.parse(value.completedAt)))throw new Error('Не удалось проверить завершение. Обновите состояние сделки.');return value;},
  async review(token:string,id:string,body:{score:number;text:string}){const value=review(await request<Review>('POST',`/orders/${encodeURIComponent(id)}/reviews`,token,body));if(value.orderId!==id)throw new Error('Некорректный заказ в отзыве.');return value;},
};
