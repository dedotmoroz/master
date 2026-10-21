import {AuthError} from './auth.ts';
import type {SessionController} from './session.ts';
export type AccountAction='email-change'|'account-deletion';
export class AccountActionError extends Error{
  readonly status:number;readonly code:string;readonly retryAfter:number;
  constructor(status:number,code='',retryAfter=0){
    super(code==='ACCOUNT_HAS_ONGOING_ORDERS'?'Сначала завершите все заказы в работе — и как заказчик, и как выбранный исполнитель.':code==='EMAIL_ALREADY_IN_USE'?'Этот email уже занят. Укажите другой адрес.':code==='EMAIL_UNCHANGED'?'Укажите новый email, отличный от текущего.':status===429?'Слишком много попыток. Подождите перед повторной отправкой.':[404,409,410].includes(status)?'Ссылка недействительна, уже использована или истекла. Запросите новое письмо в настройках аккаунта.':[400,422].includes(status)?'Проверьте email или ссылку подтверждения.':'Не удалось получить подтверждение от сервера. Проверьте соединение. Запрос мог успеть обработаться.');
    this.status=status;this.code=code;this.retryAfter=retryAfter;
  }
}
export function newEmail(value:string,current:string){const email=value.trim().toLowerCase();if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Укажите действующий новый email.');if(email===current.trim().toLowerCase())throw new Error('Новый email совпадает с текущим.');return email;}
async function request(kind:AccountAction,confirm:boolean,body:unknown,token?:string,signal?:AbortSignal){
  const base=(process.env.NEXT_PUBLIC_API_BASE_URL||'/api/v1').replace(/\/$/,'');let response:Response;
  try{response=await fetch(`${base}/auth/${kind}-requests${confirm?'/confirm':''}`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});}catch(error){if(signal?.aborted)throw error;throw new AccountActionError(0);}
  if(response.status===401)throw new AuthError(401);
  if(!response.ok){let code='';try{const value=await response.json();if(typeof value?.error?.code==='string')code=value.error.code;}catch{}const retry=response.headers.get('retry-after')||'';throw new AccountActionError(response.status,code,response.status===429?(/^\d+$/.test(retry)?Math.min(86400,Math.max(1,Number(retry))):60):0);}
  if(confirm){if(response.status!==204)throw new AccountActionError(0);return;}
  let value;try{value=await response.json();}catch{throw new AccountActionError(0);}if(response.status!==202||value?.status!=='pending_email')throw new AccountActionError(0);
}
export const accountSettingsApi={
  requestEmail:(token:string,email:string,signal?:AbortSignal)=>request('email-change',false,{email},token,signal),
  requestDeletion:(token:string,signal?:AbortSignal)=>request('account-deletion',false,{},token,signal),
  confirm:(kind:AccountAction,token:string,signal?:AbortSignal)=>{if(!token||token.length>1000||/[\s\x00-\x1f]/.test(token))throw new Error('Недействительная ссылка.');return request(kind,true,{token},undefined,signal);},
};
// Confirmation can belong to another account. Revalidate, never blindly log out
// the currently open account or revoke its sessions.
export async function confirmAccountAction(kind:AccountAction,token:string,controller:Pick<SessionController,'restore'>,signal?:AbortSignal){
  try{await accountSettingsApi.confirm(kind,token,signal);await controller.restore();}
  catch(error){if(error instanceof AccountActionError&&error.status===0)await controller.restore();throw error;}
}
