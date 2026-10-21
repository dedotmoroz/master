export class ApiError extends Error {
  readonly status: number;
  constructor(status: number) { super(status===404?'Запись не найдена или больше не опубликована.':status===400||status===422?'Проверьте параметры поиска.':'Не удалось загрузить данные. Попробуйте ещё раз.'); this.status=status; }
}
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1').replace(/\/$/,'');
  let response: Response;
  try { response = await fetch(base+path,{signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),credentials:'omit',cache:'no-store',redirect:'error'}); }
  catch (error) {if(signal?.aborted)throw error;throw new Error('API недоступен. Проверьте, что бэкенд запущен, и повторите попытку.');}
  if(!response.ok)throw new ApiError(response.status);
  try { return await response.json() as T; } catch {throw new Error('API вернул некорректный ответ.');}
}
export function assertPage<T>(value: {items?:T[];total?:number;limit?:number;offset?:number}): asserts value is {items:T[];total:number;limit:number;offset:number} {
  if(!Array.isArray(value.items)||!Number.isSafeInteger(value.total)||value.total!<0||!Number.isSafeInteger(value.limit)||value.limit!<1||!Number.isSafeInteger(value.offset)||value.offset!<0)throw new Error('API вернул некорректную страницу.');
}
