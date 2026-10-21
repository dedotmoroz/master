'use client';
import Script from 'next/script';
import {useEffect,useRef,useState} from 'react';
type Turnstile={render:(element:HTMLElement,options:Record<string,unknown>)=>string;remove:(id:string)=>void};
declare global{interface Window{turnstile?:Turnstile}}
// Only mounted on the guest upload control, never on email-confirmation pages.
export function UploadChallenge({onToken}:{onToken:(token:string)=>void}){
  const container=useRef<HTMLDivElement>(null);const [loaded,setLoaded]=useState(false);const [failed,setFailed]=useState(false);const callback=useRef(onToken);callback.current=onToken;
  const sitekey=process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  useEffect(()=>{if(!loaded||!sitekey||!container.current||!window.turnstile)return;const api=window.turnstile;const id=api.render(container.current,{sitekey,action:'guest_attachment_upload','response-field':false,callback:(token:string)=>callback.current(token),'expired-callback':()=>callback.current(''),'error-callback':()=>{callback.current('');setFailed(true);}});return()=>api.remove(id);},[loaded,sitekey]);
  if(!sitekey)return null;
  return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={()=>setLoaded(true)} onError={()=>setFailed(true)}/><div ref={container}/>{failed&&<p role="alert" className="field-hint">Не удалось выполнить проверку защиты. Проверьте соединение и перезагрузите страницу.</p>}</>;
}
