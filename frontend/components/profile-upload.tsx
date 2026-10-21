'use client';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from './auth-provider';
import {profileApi,validateFile} from '../lib/profile';
import type {Upload} from '../lib/profile';
export function ProfileUpload({purpose,onReady,onBusy}:{purpose:'profile_avatar'|'portfolio';onReady:(id:string,file:File)=>void;onBusy:(busy:boolean)=>void}){
  const {controller}=useAuth();const [busy,setBusy]=useState(false);const [pending,setPending]=useState(false);const [message,setMessage]=useState('');const fileInput=useRef<HTMLInputElement>(null);const abort=useRef<AbortController|null>(null);const ticket=useRef<{file:File;upload?:Upload;transferred:boolean}|undefined>(undefined);const guard=useRef(false);
  useEffect(()=>()=>abort.current?.abort(),[]);
  async function run(file?:File){
    if(guard.current)return;guard.current=true;setMessage('');const request=new AbortController();abort.current=request;
    try{
      if(file){validateFile(file,purpose);ticket.current={file,transferred:false};}const current=ticket.current;if(!current)return;
      setBusy(true);onBusy(true);setPending(true);
      if(!current.upload){setMessage('Готовим загрузку…');current.upload=await controller.authorized(token=>profileApi.uploadRequest(token,current.file,purpose,request.signal));}
      if(!current.transferred){setMessage('Загружаем файл…');await profileApi.put(current.upload,current.file,request.signal);current.transferred=true;}
      for(let n=0;n<20;n++){
        setMessage('Проверяем файл и создаём превью…');const attachment=await controller.authorized(token=>profileApi.confirm(token,current.upload!.attachment.id,request.signal));
        if(attachment.status==='ready'){onReady(attachment.id,current.file);ticket.current=undefined;setPending(false);setMessage('Файл проверен. Нажмите «Сохранить профиль», чтобы опубликовать его.');if(fileInput.current)fileInput.current.value='';return;}
        if(attachment.status==='rejected'||attachment.status==='cleanup_pending'){ticket.current=undefined;setPending(false);throw new Error('Файл не прошёл проверку или больше недоступен. Выберите другой файл.');}
        await new Promise<void>((resolve,reject)=>{if(request.signal.aborted){reject(new Error('Загрузка остановлена.'));return;}const stop=()=>{clearTimeout(timer);reject(new Error('Загрузка остановлена.'));};const timer=setTimeout(()=>{request.signal.removeEventListener('abort',stop);resolve();},1500);request.signal.addEventListener('abort',stop,{once:true});});
      }
      setMessage('Файл ещё проверяется. Повторите проверку позже — заново загружать его не нужно.');
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'Не удалось загрузить файл.');}
    finally{guard.current=false;if(!request.signal.aborted){setBusy(false);onBusy(false);}}
  }
  return <div className="upload-control"><label>{purpose==='profile_avatar'?'Загрузить аватар':'Добавить фото или PDF'}<input ref={fileInput} type="file" accept={purpose==='profile_avatar'?'image/jpeg,image/png,image/webp':'image/jpeg,image/png,image/webp,application/pdf'} disabled={busy||pending} onChange={event=>{const file=event.target.files?.[0];if(file)void run(file);}}/></label><p className="field-hint">{purpose==='profile_avatar'?'JPEG, PNG, WebP — до 5 МБ.':'JPEG, PNG, WebP, PDF — до 20 МБ. Файлы добавляются по одному.'}</p>{message&&<p role="status" className="field-hint">{message}</p>}{pending&&!busy&&<div className="account-actions"><button type="button" className="outline" onClick={()=>void run()}>Повторить загрузку / проверку</button><button type="button" className="outline" onClick={()=>{ticket.current=undefined;setPending(false);setMessage('Файл не добавлен в профиль.');if(fileInput.current)fileInput.current.value='';}}>Выбрать другой файл</button></div>}</div>;
}
