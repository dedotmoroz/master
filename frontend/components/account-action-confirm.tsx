'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {consumeConfirmationUrl} from '../lib/auth';
import {confirmAccountAction} from '../lib/account-settings';
import type {AccountAction} from '../lib/account-settings';
import {useAuth} from './auth-provider';
export function AccountActionConfirm({kind}:{kind:AccountAction}){
  const [understood,setUnderstood]=useState(false);
  const {controller,state}=useAuth();const [token,setToken]=useState<string|null>();const [busy,setBusy]=useState(false);const [done,setDone]=useState(false);const [error,setError]=useState('');const read=useRef(false);const guard=useRef(false);const abort=useRef<AbortController|null>(null);const deletion=kind==='account-deletion';
  useEffect(()=>{if(!read.current){read.current=true;const value=consumeConfirmationUrl(window.location.href);window.history.replaceState(window.history.state,'',value.cleanUrl);setToken(value.token);}return()=>abort.current?.abort();},[]);
  return <section className="order-panel account-action-confirm"><h1>{deletion?'Подтверждение удаления аккаунта':'Подтверждение нового email'}</h1>
    {done?<div className="success" role="status"><h2>{deletion?'Аккаунт удалён':'Email изменён'}</h2><p>{deletion?'Сеансы удалённого аккаунта завершены. Очистка файлов выполняется в фоне.':'Все прежние сеансы этого аккаунта завершены. Для продолжения войдите через новый email.'}</p>{state.account?<p>В этой вкладке открыт другой действующий аккаунт. Его сеансы не изменены. <Link href="/account/">Перейти к аккаунту</Link></p>:<Link href="/auth/login/">{deletion?'На страницу входа':'Войти через новый email'}</Link>}</div>:token===undefined?<p role="status">Проверяем ссылку…</p>:!token?<div role="alert"><p>Ссылка не содержит корректного токена. Откройте письмо ещё раз или запросите новое в настройках.</p><Link href="/account/settings/">Настройки аккаунта</Link></div>:<>
      <p className="detail-text">{deletion?'Удаляется аккаунт, для которого пришло письмо, а не обязательно аккаунт, открытый в этой вкладке. Не подтверждайте удаление, если письмо запросили не вы.':'Изменится email аккаунта, для которого пришло письмо. Не подтверждайте действие, если вы не запрашивали смену адреса.'}</p>
      {deletion&&<div className="danger-zone"><h2>Отменить удаление будет нельзя</h2><p className="detail-text">Профиль, переписка и файлы будут удалены, email обезличен, все сеансы завершены. Завершённые сделки и отзывы сохраняются. При наличии заказов «В работе» сервер отклонит удаление.</p></div>}
      <form className="demo-form" onSubmit={async event=>{event.preventDefault();if(guard.current||state.busy||state.checking||deletion&&new FormData(event.currentTarget).get('understood')!=='on')return;guard.current=true;setBusy(true);setError('');const request=new AbortController();abort.current=request;
        try{await confirmAccountAction(kind,token,controller,request.signal);if(!request.signal.aborted){setToken(null);setDone(true);}}
        catch(error){if(!request.signal.aborted)setError(error instanceof Error?error.message:'Не удалось подтвердить действие.');}
        finally{guard.current=false;if(!request.signal.aborted)setBusy(false);}
      }}><fieldset className="form-fieldset" disabled={busy||state.busy||state.checking}>{deletion&&<label className="consent"><input type="checkbox" name="understood" required checked={understood} onChange={event=>setUnderstood(event.target.checked)}/><span>Я понимаю последствия и подтверждаю необратимое удаление аккаунта из письма.</span></label>}<button type="submit" disabled={deletion&&!understood} className={deletion?'primary danger-confirm':'primary'}>{busy?'Подтверждаем…':deletion?'Удалить аккаунт безвозвратно':'Подтвердить новый email'}</button></fieldset></form>
      {error&&<p className="auth-error" role="alert">{error}</p>}<p className="field-hint">При потере ответа действие могло выполниться. Для смены email попробуйте войти через новый адрес. Ошибка при повторном использовании ссылки не означает, что первое действие не выполнилось. Не обновляйте страницу до получения ответа.</p><p><Link href="/account/settings/">Не подтверждать — к настройкам аккаунта</Link></p>
    </>}
  </section>;
}
