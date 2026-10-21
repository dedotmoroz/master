'use client';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from './auth-provider';
import {PublicAttachment} from './public-attachment';
import {UploadChallenge} from './upload-challenge';
import {profileApi,validateFile} from '../lib/profile';
import {guestFilesApi} from '../lib/order-files';
import type {GuestUpload} from '../lib/order-files';
import type {Upload} from '../lib/profile';
export type OrderFile={id:string;claimToken?:string;file?:File};
function LocalFile({file}:{file:File}){
  const [url,setUrl]=useState('');useEffect(()=>{if(!file.type.startsWith('image/'))return;const value=URL.createObjectURL(file);setUrl(value);return()=>URL.revokeObjectURL(value);},[file]);
  return <>{url&&<img src={url} alt={file.name}/>}<span className="field-hint">{file.name}</span></>;
}
export function OrderFiles({files,onChange,onBusy,guest=false}:{files:OrderFile[];onChange:(files:OrderFile[])=>void;onBusy:(value:boolean)=>void;guest?:boolean}){
  const {controller}=useAuth();const [busy,setBusy]=useState(false);const [pending,setPending]=useState(false);const [message,setMessage]=useState('');const [challenge,setChallenge]=useState(0);const captcha=useRef('');const input=useRef<HTMLInputElement>(null);const abort=useRef<AbortController|null>(null);const guard=useRef(false);
  const ticket=useRef<{file:File;upload?:Upload|GuestUpload;transferred:boolean}|undefined>(undefined);
  useEffect(()=>()=>abort.current?.abort(),[]);
  async function run(file?:File){
    if(guard.current)return;guard.current=true;const request=new AbortController();abort.current=request;setMessage('');
    try{
      if(files.length>=10)throw new Error('К заказу можно добавить до 10 файлов.');
      if(file){validateFile(file,'order');ticket.current={file,transferred:false};}
      const current=ticket.current;if(!current)return;
      setBusy(true);setPending(true);onBusy(true);
      if(!current.upload){
        if(guest&&process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY&&!captcha.current)throw new Error('Сначала пройдите проверку защиты от роботов.');
        setMessage('Готовим загрузку…');
        try{current.upload=guest?await guestFilesApi.request(current.file,captcha.current,request.signal):await controller.authorized(token=>profileApi.uploadRequest(token,current.file,'order',request.signal));}
        finally{if(guest){captcha.current='';setChallenge(value=>value+1);}}
      }
      if(!current.transferred){setMessage('Загружаем файл…');await profileApi.put(current.upload,current.file,request.signal);current.transferred=true;}
      for(let n=0;n<20;n++){
        setMessage('Проверяем файл и готовим превью…');
        const attachment=guest?await guestFilesApi.confirm(current.upload as GuestUpload,request.signal):await controller.authorized(token=>profileApi.confirm(token,current.upload!.attachment.id,request.signal));
        if(attachment.status==='ready'){onChange([...files,{id:attachment.id,file:current.file,...(guest?{claimToken:(current.upload as GuestUpload).claimToken}:{})}]);ticket.current=undefined;setPending(false);onBusy(false);setMessage('Файл проверен. Он будет прикреплён при сохранении заказа.');if(input.current)input.current.value='';return;}
        if(attachment.status==='rejected'||attachment.status==='cleanup_pending'){ticket.current=undefined;setPending(false);onBusy(false);throw new Error('Файл отклонён или больше недоступен. Выберите другой файл.');}
        await new Promise<void>((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(new Error('Проверка остановлена.'));};const timer=setTimeout(()=>{request.signal.removeEventListener('abort',stop);resolve();},1500);request.signal.addEventListener('abort',stop,{once:true});});
      }
      setMessage('Проверка продолжается. Нажмите «Повторить», повторная загрузка не нужна.');
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'Не удалось загрузить файл.');}
    finally{guard.current=false;if(!request.signal.aborted)setBusy(false);}
  }
  function discard(){ticket.current=undefined;setPending(false);onBusy(false);setMessage('Загрузка отменена.');if(input.current)input.current.value='';}
  return <section className="order-file-editor"><h2>Фото и документы <small>({files.length}/10)</small></h2><p className="field-hint">JPEG, PNG, WebP или PDF — до 20 МБ каждый. Не добавляйте паспорта, телефоны и другие личные данные: вложения опубликованного заказа будут доступны всем.</p>
    <div className="attachment-grid">{files.map((item,index)=><div className="public-attachment" key={item.id}>{item.file?<LocalFile file={item.file}/>:<PublicAttachment id={item.id} alt={`Вложение ${index+1}`} owned/>}<button type="button" className="outline" disabled={busy} onClick={()=>onChange(files.filter(value=>value.id!==item.id))}>Убрать вложение {index+1}</button></div>)}</div>
    {guest&&files.length<10&&<UploadChallenge key={challenge} onToken={value=>{captcha.current=value;}}/>}
    <label>Добавить фото или PDF<input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy||pending||files.length>=10} onChange={event=>{const file=event.target.files?.[0];if(file)void run(file);}}/></label>
    {message&&<p className="field-hint" role="status">{message}</p>}{pending&&!busy&&<div className="account-actions"><button type="button" className="outline" onClick={()=>void run()}>Повторить загрузку / проверку</button><button type="button" className="outline" onClick={discard}>Не добавлять этот файл</button></div>}
  </section>;
}
