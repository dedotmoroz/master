'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {AuthError,authTransport} from '../lib/auth';
import type {AuthKind} from '../lib/auth';
import {useAuth} from './auth-provider';
export function AuthForm({kind}:{kind:AuthKind}){
  const {state}=useAuth();const [busy,setBusy]=useState(false);const guard=useRef(false);
  const [sent,setSent]=useState(false);const [error,setError]=useState('');const [cooldown,setCooldown]=useState(0);
  useEffect(()=>{if(!cooldown)return;const timer=setTimeout(()=>setCooldown(value=>Math.max(0,value-1)),1000);return()=>clearTimeout(timer);},[cooldown]);
  const login=kind==='login';
  return <section className="auth-panel"><h1>{login?'Войти по email':'Регистрация'}</h1>
    {state.account?<div className="success"><p>Вы уже вошли как {state.account.email}.</p><Link href="/account/">Перейти к аккаунту</Link></div>:<>
      <p className="detail-text">{login?'Введите email своего аккаунта — мы отправим одноразовую ссылку для входа.':'Укажите email — аккаунт будет создан только после подтверждения по ссылке из письма.'} Пароль не нужен.</p>
      <form className="demo-form" onSubmit={async event=>{
        event.preventDefault();if(guard.current||cooldown)return;guard.current=true;setBusy(true);setError('');
        const email=String(new FormData(event.currentTarget).get('email')||'').trim();
        try{await authTransport.request(kind,email);setSent(true);setCooldown(60);}catch(error){setError(error instanceof Error?error.message:'Не удалось отправить ссылку.');if(error instanceof AuthError&&error.retryAfter)setCooldown(error.retryAfter);}finally{guard.current=false;setBusy(false);}
      }}>
        <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" placeholder="name@example.ru" disabled={busy}/></label>
        <button className="primary" type="submit" disabled={busy||cooldown>0}>{busy?'Отправляем…':cooldown?`Повторить через ${cooldown} с`:sent?'Отправить ссылку ещё раз':'Получить ссылку'}</button>
      </form>
      {sent&&<div className="success" role="status"><strong>Проверьте почту</strong><p>Если адрес подходит для {login?'входа':'регистрации'}, на него отправлена ссылка. Проверьте также папку «Спам».</p><p>Откройте письмо и подтвердите {login?'вход':'регистрацию'} на сайте.</p></div>}
      {error&&<p className="auth-error" role="alert">{error}</p>}
      <p className="detail-text">{login?'Нет аккаунта? ':'Уже зарегистрированы? '}<Link href={login?'/auth/register/':'/auth/login/'}>{login?'Зарегистрироваться':'Войти'}</Link></p>
    </>}
  </section>;
}
