'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {consumeConfirmationUrl} from '../lib/auth';
import type {AuthKind} from '../lib/auth';
import {useAuth} from './auth-provider';
export function AuthConfirm({kind}:{kind:AuthKind}){
  const {state,controller}=useAuth();const read=useRef(false);const [token,setToken]=useState<string|null>();
  const [done,setDone]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{
    if(read.current)return;read.current=true;
    const result=consumeConfirmationUrl(window.location.href);
    window.history.replaceState(window.history.state,'',result.cleanUrl);
    setToken(result.token);
  },[]);
  return <section className="auth-panel"><h1>{kind==='login'?'Подтверждение входа':'Подтверждение регистрации'}</h1>
    {done?<div className="success" role="status"><strong>Вы вошли в аккаунт</strong><p><Link href="/account/">Перейти к аккаунту →</Link></p></div>:token===undefined?<p role="status">Проверяем ссылку…</p>:!token?state.account?<div className="success"><p>В этой вкладке уже открыт аккаунт. Вы можете продолжить работу.</p><Link href="/account/">Перейти к аккаунту</Link></div>:<div role="alert"><p>Ссылка не содержит токен подтверждения. Запросите новое письмо.</p><Link href={`/auth/${kind}/`}>Получить новую ссылку</Link></div>:<>
      <p className="detail-text">Нажмите кнопку, чтобы {kind==='login'?'войти в аккаунт':'подтвердить email и создать аккаунт'}. Не подтверждайте вход, если письмо запросили не вы.</p>
      {state.account&&<p className="demo-note">Сейчас открыт аккаунт {state.account.email}. Подтверждение ссылки может переключить аккаунт в этой вкладке.</p>}
      <button className="primary" disabled={state.busy} onClick={async()=>{try{await controller.confirm(kind,token);setToken(null);setDone(true);}catch(error){setError(error instanceof Error?error.message:'Не удалось подтвердить вход.');}}}>{state.busy?'Подтверждаем…':kind==='login'?'Подтвердить вход':'Подтвердить email'}</button>
      {error&&<p className="auth-error" role="alert">{error}</p>}
      <p><Link href={`/auth/${kind}/`}>Запросить новую ссылку</Link></p>
    </>}
  </section>;
}
