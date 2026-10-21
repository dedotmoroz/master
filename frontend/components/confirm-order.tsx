'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {consumeConfirmationUrl} from '../lib/auth';
import {ordersApi,ownOrderHref} from '../lib/orders';
import {useAuth} from './auth-provider';
export function ConfirmOrder(){
  const {state,controller}=useAuth();const read=useRef(false);const [token,setToken]=useState<string|null>();const [orderId,setOrderId]=useState('');const [error,setError]=useState('');
  useEffect(()=>{if(read.current)return;read.current=true;const value=consumeConfirmationUrl(window.location.href);window.history.replaceState(window.history.state,'',value.cleanUrl);setToken(value.token);},[]);
  return <section className="auth-panel"><h1>Подтверждение заказа</h1>
    {orderId?<div className="success" role="status"><strong>Заказ опубликован</strong><p><Link href={ownOrderHref(orderId)}>Открыть мой заказ →</Link></p></div>:token===undefined?<p role="status">Проверяем ссылку…</p>:!token?<div role="alert"><p>В ссылке нет токена подтверждения. Если заказ уже опубликован, войдите по email, указанному при размещении.</p><Link href="/auth/login/">Войти</Link> · <Link href="/orders/new/">Разместить заказ</Link></div>:<>
      <p className="detail-text">Нажмите кнопку, чтобы опубликовать заказ и войти в аккаунт заказчика. Не подтверждайте публикацию, если письмо запросили не вы.</p>
      {state.account&&<p className="demo-note">Сейчас открыт аккаунт {state.account.email}. После подтверждения откроется аккаунт email, указанного в заказе.</p>}
      <button className="primary" disabled={state.busy} onClick={async()=>{setError('');try{let id='';await controller.establish(async()=>{const result=await ordersApi.confirm(token);id=result.orderId;return ordersApi.authentication(result);});setOrderId(id);setToken(null);}catch(error){setError(error instanceof Error?error.message:'Не удалось подтвердить заказ.');}}}>{state.busy?'Публикуем…':'Подтвердить и опубликовать'}</button>
      {error&&<p className="auth-error" role="alert">{error}</p>}<p className="field-hint">Если публикация уже обработана, но вход не сохранился, войдите по email заказа. Повторное подтверждение этой ссылки не создаёт второй заказ.</p>
    </>}
  </section>;
}
