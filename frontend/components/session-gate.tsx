'use client';
import Link from 'next/link';
import {Fragment} from 'react';
import type {ReactNode} from 'react';
import {useAuth} from './auth-provider';
export function SessionGate({children}:{children:ReactNode}){
  const {state,controller}=useAuth();
  if(state.checking||state.busy)return <div className="empty" role="status">Проверяем сессию…</div>;
  if(!state.account)return <section className="auth-panel"><h1>Войдите в аккаунт</h1><p>Личные заказы, отклики и переписка доступны только участникам. После входа вернитесь к нужной странице.</p><Link href="/auth/login/">Войти по email</Link>{state.error&&<div className="auth-error" role="alert"><p>{state.error}</p><button className="outline" onClick={()=>void controller.restore()}>Повторить проверку</button></div>}</section>;
  return <Fragment key={state.account.id}>{children}</Fragment>;
}
