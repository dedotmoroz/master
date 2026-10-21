import {OrderError,orderRequest,UUID} from './orders.ts';
export type PortfolioItem={title:string;description:string;attachmentIds:string[]};
export type ProfileBody={displayName:string;bio:string;avatarAttachmentId:string|null;specializationIds:string[];serviceLocationIds:string[];portfolio:PortfolioItem[]};
export type OwnProfile=ProfileBody&{accountId:string;createdAt:string;updatedAt:string};
export type Attachment={id:string;ownerId:string|null;purpose:'profile_avatar'|'portfolio'|'order'|'guest_order';status:'pending_upload'|'processing'|'ready'|'rejected'|'cleanup_pending';originalFileName:string};
export type Upload={attachment:Attachment;uploadUrl:string;uploadHeaders:Record<string,string>};
export class ProfileError extends Error{
  readonly status:number;readonly code:string;
  constructor(error:OrderError){super(error.code==='ATTACHMENT_NOT_USABLE'?'Файл ещё проверяется, отклонён или принадлежит другому аккаунту.':error.code==='CONTRACTOR_PROFILE_NOT_FOUND'?'Профиль ещё не создан.':error.status===404?'Профиль или файл недоступен этому аккаунту.':error.status===410?'Срок загрузки истёк. Выберите файл заново.':error.status===400||error.status===422?'Проверьте поля профиля, категории, места работ и файлы.':error.status===409?'Не удалось использовать файл. Проверьте состояние загрузки.':'Не удалось выполнить действие. Проверьте соединение. Если сохранение не подтверждено, проверьте публичный профиль перед повтором.');this.status=error.status;this.code=error.code;}
}
async function request<T>(method:'GET'|'PUT'|'POST',path:string,token:string,body?:unknown,signal?:AbortSignal){try{return await orderRequest<T>(method,path,body,token,signal);}catch(error){if(error instanceof OrderError)throw new ProfileError(error);throw error;}}
export const blankProfile=():ProfileBody=>({displayName:'',bio:'',avatarAttachmentId:null,specializationIds:[],serviceLocationIds:[],portfolio:[]});
export function buildProfile(input:ProfileBody):ProfileBody{
  const text=(value:string,label:string,max:number,required=false)=>{const result=value.trim();if((required&&!result)||result.length>max)throw new Error(`${label}: ${required?'заполните поле, ':''}максимум ${max} символов.`);return result;};
  const ids=(values:string[],max:number)=>{if(values.length>max||new Set(values).size!==values.length||values.some(id=>!id||id.length>100))throw new Error(`Выберите не более ${max} разных значений.`);return [...values];};
  if(input.portfolio.length>20)throw new Error('В портфолио допускается до 20 проектов.');
  if(input.avatarAttachmentId!==null&&!UUID.test(input.avatarAttachmentId))throw new Error('Некорректный аватар.');
  return {displayName:text(input.displayName,'Имя мастера или бригады',120,true),bio:text(input.bio,'Описание',5000),avatarAttachmentId:input.avatarAttachmentId,specializationIds:ids(input.specializationIds,50),serviceLocationIds:ids(input.serviceLocationIds,50),portfolio:input.portfolio.map(item=>{if(!item.attachmentIds.length||item.attachmentIds.some(id=>!UUID.test(id)))throw new Error('Добавьте проверенные фотографии или файлы в каждый проект.');return {title:text(item.title,'Название проекта',160,true),description:text(item.description,'Описание проекта',2000),attachmentIds:ids(item.attachmentIds,10)};})};
}
function assertProfile(value:OwnProfile){if(!value||!UUID.test(value.accountId)||typeof value.displayName!=='string'||typeof value.bio!=='string'||!Array.isArray(value.specializationIds)||!Array.isArray(value.serviceLocationIds)||!Array.isArray(value.portfolio))throw new Error('Сервис вернул некорректный профиль.');return value;}
function assertAttachment(value:Attachment){if(!value||!UUID.test(value.id)||!['pending_upload','processing','ready','rejected','cleanup_pending'].includes(value.status))throw new Error('Сервис вернул некорректный файл.');return value;}
export function safeStorageUrl(value:string){const url=new URL(value);if(url.username||url.password||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new Error('Хранилище вернуло небезопасный адрес.');return url.toString();}
export function validateFile(file:Pick<File,'name'|'type'|'size'>,purpose:Attachment['purpose']){
  const allowed=['image/jpeg','image/png','image/webp',...(purpose!=='profile_avatar'?['application/pdf']:[])];const limit=(purpose==='profile_avatar'?5:20)*1024*1024;
  if(!allowed.includes(file.type))throw new Error('Поддерживаются JPEG, PNG, WebP'+(purpose!=='profile_avatar'?' и PDF.':'.'));
  if(!Number.isSafeInteger(file.size)||file.size<1||file.size>limit)throw new Error(`Файл должен быть не пустым и не больше ${limit/1024/1024} МБ.`);
  if(!file.name.trim()||file.name.length>255)throw new Error('Имя файла должно содержать от 1 до 255 символов.');
}
export const profileApi={
  async get(token:string,signal?:AbortSignal){try{return assertProfile(await request<OwnProfile>('GET','/contractor/profile',token,undefined,signal));}catch(error){if(error instanceof ProfileError&&error.code==='CONTRACTOR_PROFILE_NOT_FOUND')return null;throw error;}},
  async save(token:string,body:ProfileBody){return assertProfile(await request<OwnProfile>('PUT','/contractor/profile',token,body));},
  async uploadRequest(token:string,file:File,purpose:'profile_avatar'|'portfolio'|'order',signal?:AbortSignal){validateFile(file,purpose);const value=await request<Upload>('POST','/attachments/upload-requests',token,{purpose,originalFileName:file.name,contentType:file.type,sizeBytes:file.size},signal);assertAttachment(value.attachment);safeStorageUrl(value.uploadUrl);if(value.attachment.purpose!==purpose||!value.uploadHeaders||Object.keys(value.uploadHeaders).some(key=>key.toLowerCase()!=='content-type')||value.uploadHeaders['content-type']!==file.type)throw new Error('Некорректные параметры загрузки.');return value;},
  async put(upload:Upload,file:File,signal?:AbortSignal){let response:Response;try{response=await fetch(safeStorageUrl(upload.uploadUrl),{method:'PUT',headers:upload.uploadHeaders,body:file,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});}catch(error){if(signal?.aborted)throw error;throw new Error('Не удалось загрузить файл в хранилище. Проверьте соединение и настройки CORS, затем повторите загрузку.');}if(!response.ok)throw new Error('Хранилище не подтвердило загрузку. Повторите загрузку того же файла.');},
  async confirm(token:string,id:string,signal?:AbortSignal){return assertAttachment(await request<Attachment>('POST',`/attachments/${encodeURIComponent(id)}/confirm`,token,undefined,signal));},
};
