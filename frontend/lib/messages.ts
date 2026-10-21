import {AuthError} from './auth.ts';
import {assertPage} from './api.ts';
import {UUID} from './orders.ts';
import type {Page} from './catalog.ts';

export type Message={id:string;bidId:string;orderId:string;authorId:string|null;text:string;createdAt:string};
export type MessagePage=Page<Message>&{canSend:boolean};
export type MessageBody=Readonly<{clientMessageId:string;text:string}>;
export const conversationHref=(bidId:string)=>`/account/messages/?bidId=${encodeURIComponent(bidId)}`;
export function normalizeMessage(text:string){const value=text.trim();if(!value||value.length>5000||value.includes('\0'))throw new Error('Введите сообщение: от 1 до 5000 символов, без нулевого символа.');return value;}
// Keep one immutable attempt until acknowledged. A lost response must not create a new nonce.
export class MessageAttempt{
  #pending:MessageBody|undefined;
  prepare(text:string,uuid:()=>string=()=>crypto.randomUUID()):MessageBody{
    if(this.#pending)return this.#pending;
    const value=normalizeMessage(text);const id=uuid();if(!UUID.test(id))throw new Error('Не удалось создать идентификатор сообщения.');
    this.#pending=Object.freeze({clientMessageId:id,text:value});return this.#pending;
  }
  pending(){return this.#pending;}
  complete(){this.#pending=undefined;}
}
export class MessageError extends Error{
  readonly status:number;readonly code:string;readonly retryAfter:number;
  constructor(status:number,code='',retryAfter=0){
    super(status===404?'Переписка не найдена или недоступна этому аккаунту.':code==='CONVERSATION_READ_ONLY'?'Диалог закрыт для новых сообщений. История доступна участникам.':code==='MESSAGE_IDEMPOTENCY_CONFLICT'?'Идентификатор уже использован для другого текста. Обновите историю перед повтором.':status===429?'Слишком много сообщений. Подождите перед повторной отправкой.':status===400||status===422?'Проверьте текст сообщения.':'Не удалось получить подтверждение от сервера. Повторите отправку этой же попытки — дубликат не появится.');
    this.status=status;this.code=code;this.retryAfter=retryAfter;
  }
}
function assertMessage(value:Message,bidId:string):Message{
  if(!value||!UUID.test(value.id)||value.bidId!==bidId||!UUID.test(value.orderId)||(value.authorId!==null&&!UUID.test(value.authorId))||typeof value.text!=='string'||!Number.isFinite(Date.parse(value.createdAt)))throw new Error('Сервис вернул некорректное сообщение.');return value;
}
async function request(method:'GET'|'POST',bidId:string,token:string,page:number,body?:MessageBody,signal?:AbortSignal){
  if(!UUID.test(bidId))throw new Error('В ссылке не указан корректный идентификатор отклика.');
  const base=(process.env.NEXT_PUBLIC_API_BASE_URL||'/api/v1').replace(/\/$/,'');const headers:Record<string,string>={Accept:'application/json',Authorization:`Bearer ${token}`};if(body)headers['Content-Type']='application/json';
  let response:Response;
  try{response=await fetch(`${base}/bids/${encodeURIComponent(bidId)}/messages${method==='GET'?`?limit=20&offset=${(page-1)*20}`:''}`,{method,headers,...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});}catch(error){if(signal?.aborted)throw error;throw new MessageError(0);}
  if(response.status===401)throw new AuthError(401);
  if(!response.ok){let code='';try{const data=await response.json();if(typeof data?.error?.code==='string')code=data.error.code;}catch{}
    const retry=response.headers.get('retry-after')||'';throw new MessageError(response.status,code,response.status===429?(/^\d+$/.test(retry)?Math.min(3600,Math.max(1,Number(retry))):60):0);}
  try{return await response.json();}catch{throw new Error('Сервис вернул некорректный ответ. Повторите ту же попытку отправки.');}
}
export const messagesApi={
  async list(token:string,bidId:string,page:number,signal?:AbortSignal):Promise<MessagePage>{
    if(!Number.isSafeInteger(page)||page<1||page>50001)throw new Error('Неверный номер страницы.');
    const value=await request('GET',bidId,token,page,undefined,signal);assertPage<Message>(value);if(typeof (value as MessagePage).canSend!=='boolean')throw new Error('Сервис вернул некорректную историю.');value.items.forEach(item=>assertMessage(item,bidId));return value as MessagePage;
  },
  async send(token:string,bidId:string,body:MessageBody):Promise<Message>{
    if(!UUID.test(body.clientMessageId)||normalizeMessage(body.text)!==body.text)throw new Error('Некорректная попытка отправки.');
    return assertMessage(await request('POST',bidId,token,1,body),bidId);
  },
};
