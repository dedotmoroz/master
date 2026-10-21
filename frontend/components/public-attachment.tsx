'use client';
import {useEffect,useRef,useState} from 'react';
import {apiGet,ApiError} from '../lib/api';
import {safeStorageUrl} from '../lib/profile';
import {useResource} from './use-resource';
import {useAuth} from './auth-provider';
import {orderRequest,OrderError} from '../lib/orders';
export function PublicAttachment({id,alt,owned=false}:{id:string;alt:string;owned?:boolean}){
  const {controller,state}=useAuth();
  const element=useRef<HTMLDivElement>(null);const [visible,setVisible]=useState(false);const [imageFailed,setImageFailed]=useState(false);
  useEffect(()=>{if(!('IntersectionObserver'in window)){setVisible(true);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});if(element.current)observer.observe(element.current);return()=>observer.disconnect();},[]);
  const resource=useResource(`file:${id}:${visible}:${owned?state.account?.id:'public'}`,async signal=>{if(!visible)return null;const get=(action:string)=>owned?controller.authorized(token=>orderRequest<{url:string;contentType:string}>('GET',`/attachments/${encodeURIComponent(id)}/owner-${action}-url`,undefined,token,signal)):apiGet<{url:string;contentType:string}>(`/attachments/${encodeURIComponent(id)}/${action}-url`,signal);let value:{url:string;contentType:string};try{value=await get('preview');}catch(error){if(!((error instanceof ApiError||error instanceof OrderError)&&error.status===404))throw error;value=await get('download');}return {...value,url:safeStorageUrl(value.url)};});
  return <div ref={element} className="public-attachment">{imageFailed?<><span className="field-hint">Фото не загрузилось или ссылка истекла.</span><button type="button" className="outline" onClick={()=>{setImageFailed(false);resource.reload();}}>Обновить ссылку на фото</button></>:resource.data?(resource.data.contentType.startsWith('image/')?<a href={resource.data.url} target="_blank" rel="noopener noreferrer"><img src={resource.data.url} alt={alt} loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" onError={()=>setImageFailed(true)}/><span className="field-hint">Открыть превью</span></a>:<a href={resource.data.url} target="_blank" rel="noopener noreferrer">Открыть файл PDF</a>):resource.error?<><span className="field-hint">Изображение недоступно.</span><button className="outline" type="button" onClick={resource.reload}>Повторить загрузку фото</button></>:<span className="field-hint">Загрузка изображения…</span>}</div>;
}
