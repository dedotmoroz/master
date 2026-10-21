export type AuthKind = 'login' | 'register';
export type Account = {id: string; email: string; capabilities: ('customer'|'contractor'|'admin')[]};
export type Authentication = {account: Account; createdAccount: boolean; session: {type:'Bearer';token:string}};
export class AuthError extends Error {
  readonly status: number;
  readonly retryAfter: number;
  constructor(status: number, retryAfter=0) {
    super(status===429?'Слишком много попыток. Подождите перед повторной отправкой.':status===401?'Сессия истекла. Войдите ещё раз.':[404,409,410].includes(status)?'Ссылка недействительна, уже использована или срок её действия истёк. Запросите новую.':[400,422].includes(status)?'Проверьте введённые данные.':'Сервис временно недоступен. Повторите попытку.');
    this.status=status;this.retryAfter=retryAfter;
  }
}
export const authEndpoint=(kind:AuthKind)=>kind==='login'?'login-requests':'registrations';
export function assertAccount(value: unknown): asserts value is Account {
  const a=value as Account|null;
  if(!a||typeof a.id!=='string'||!a.id||typeof a.email!=='string'||!a.email||!Array.isArray(a.capabilities)||a.capabilities.some(value=>!['customer','contractor','admin'].includes(value)))throw new Error('Некорректный ответ сервиса входа.');
}
export function assertAuthentication(value: unknown): asserts value is Authentication {
  const a=value as Authentication|null;assertAccount(a?.account);
  if(!a||typeof a.createdAccount!=='boolean'||a.session?.type!=='Bearer'||typeof a.session.token!=='string'||!a.session.token||a.session.token.length>2048||/[\s\x00-\x1f]/.test(a.session.token))throw new Error('Некорректный ответ сервиса входа.');
}
export async function authRequest<T>(method:'GET'|'POST'|'DELETE',path:string,body?:unknown,token?:string):Promise<T> {
  const base=(process.env.NEXT_PUBLIC_API_BASE_URL||'/api/v1').replace(/\/$/,'');
  const headers:Record<string,string>={Accept:'application/json'};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(token)headers.Authorization=`Bearer ${token}`;
  let response:Response;
  try {response=await fetch(`${base}/auth/${path}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch {throw new Error('Не удалось связаться с сервисом входа. Проверьте соединение и повторите попытку.');}
  if(!response.ok){const value=Number(response.headers.get('Retry-After'));throw new AuthError(response.status,Number.isFinite(value)?Math.min(Math.max(Math.ceil(value),0),86400):0);}
  if(response.status===204)return undefined as T;
  try{return await response.json() as T;}catch{throw new Error('Некорректный ответ сервиса входа.');}
}
export const authTransport={
  async request(kind:AuthKind,email:string){const value=await authRequest<{status:string}>('POST',authEndpoint(kind),{email});if(value.status!=='pending_email')throw new Error('Некорректный ответ сервиса входа.');},
  async confirm(kind:AuthKind,token:string){const value=await authRequest<Authentication>('POST',`${authEndpoint(kind)}/confirm`,{token});assertAuthentication(value);return value;},
  async me(token:string){const value=await authRequest<Account>('GET','me',undefined,token);assertAccount(value);return value;},
  async logout(token:string,all=false){await authRequest<void>('DELETE',all?'sessions':'session',undefined,token);},
};
// Remove the one-use token before requests, navigation or error rendering. Never persist it.
export function consumeConfirmationUrl(href:string) {
  const url=new URL(href);const tokens=url.searchParams.getAll('token');url.searchParams.delete('token');url.hash='';
  const candidate=tokens[0];
  const token=tokens.length===1&&candidate&&candidate.length<=1000&&!/[\s\x00-\x1f]/.test(candidate)?candidate:null;
  return {token,cleanUrl:url.pathname+(url.searchParams.size?'?'+url.searchParams:'')};
}
