import {orderRequest,OrderError,UUID} from './orders.ts';
import {safeStorageUrl,validateFile} from './profile.ts';
import type {Attachment,Upload} from './profile.ts';
export type GuestUpload=Upload&{claimToken:string};
export const guestFilesApi={
  async request(file:File,captchaToken?:string,signal?:AbortSignal):Promise<GuestUpload>{
    validateFile(file,'guest_order');
    let ticket:GuestUpload;
    try{ticket=await orderRequest<GuestUpload>('POST','/guest-attachments/upload-requests',{originalFileName:file.name,contentType:file.type,sizeBytes:file.size,...(captchaToken?{captchaToken}:{})},undefined,signal);}catch(error){if(error instanceof OrderError&&error.status===403)throw new Error('Пройдите проверку защиты от роботов перед загрузкой файла.');throw error;}
    if(!ticket?.attachment||!UUID.test(ticket.attachment.id)||ticket.attachment.purpose!=='guest_order'||typeof ticket.claimToken!=='string'||!ticket.claimToken||ticket.claimToken.length>2048||/[\s\x00-\x1f]/.test(ticket.claimToken)||!ticket.uploadHeaders||Object.keys(ticket.uploadHeaders).some(key=>key!=='content-type')||ticket.uploadHeaders['content-type']!==file.type)throw new Error('Некорректные параметры загрузки.');
    safeStorageUrl(ticket.uploadUrl);return ticket;
  },
  async confirm(ticket:GuestUpload,signal?:AbortSignal){
    const file=await orderRequest<Attachment>('POST',`/guest-attachments/${encodeURIComponent(ticket.attachment.id)}/confirm`,{claimToken:ticket.claimToken},undefined,signal);
    if(!file||file.id!==ticket.attachment.id||!['pending_upload','processing','ready','rejected','cleanup_pending'].includes(file.status))throw new Error('Некорректное состояние файла.');return file;
  },
};
