'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from './auth-provider';
import {AccountActionError,accountSettingsApi,newEmail} from '../lib/account-settings';

export function LogoutAllButton(){
  const {controller,state}=useAuth();const dialog=useRef<HTMLDialogElement>(null);
  return <><button type="button" className="outline" disabled={state.busy} onClick={()=>dialog.current?.showModal()}>Выйти на всех устройствах</button>
    <dialog ref={dialog} aria-label="Выход на всех устройствах"><h2>Завершить все сеансы?</h2><p className="detail-text">Вы выйдете из аккаунта на всех устройствах, включая эту вкладку. Для нового входа понадобится ссылка из письма.</p>
      {state.error&&<p role="alert" className="auth-error">{state.error}</p>}<div className="account-actions"><button type="button" className="outline" disabled={state.busy} onClick={()=>dialog.current?.close()}>Не выходить</button><button type="button" className="primary" disabled={state.busy} onClick={async()=>{await controller.logout(true);if(!controller.getSnapshot().account)dialog.current?.close();}}>{state.busy?'Завершаем сеансы…':'Подтвердить выход везде'}</button></div>
    </dialog></>;
}
export function AccountSettings(){
  const [understood,setUnderstood]=useState(false);const [errorFor,setErrorFor]=useState<'email'|'deletion'>('email');
  const {controller,state}=useAuth();const [busy,setBusy]=useState<'email'|'deletion'|null>(null);const [error,setError]=useState('');const [emailSent,setEmailSent]=useState('');const [deletionSent,setDeletionSent]=useState(false);const [cooldown,setCooldown]=useState(0);const guard=useRef(false);const lifetime=useRef<AbortController|null>(null);
  useEffect(()=>{const abort=new AbortController();lifetime.current=abort;return()=>abort.abort();},[]);
  useEffect(()=>{if(!cooldown)return;const timer=setTimeout(()=>setCooldown(value=>Math.max(0,value-1)),1000);return()=>clearTimeout(timer);},[cooldown]);
  async function send(kind:'email'|'deletion',email?:string){
    if(guard.current||cooldown)return;guard.current=true;setBusy(kind);setError('');setErrorFor(kind);const signal=lifetime.current!.signal;
    try{if(kind==='email'){await controller.authorized(token=>accountSettingsApi.requestEmail(token,email!,signal));if(!signal.aborted)setEmailSent(email!);}else{await controller.authorized(token=>accountSettingsApi.requestDeletion(token,signal));if(!signal.aborted)setDeletionSent(true);}if(!signal.aborted)setCooldown(60);}
    catch(error){if(!signal.aborted){setError(error instanceof Error?error.message:'Не удалось запросить письмо.');if(error instanceof AccountActionError&&error.retryAfter)setCooldown(error.retryAfter);}}
    finally{guard.current=false;if(!signal.aborted)setBusy(null);}
  }
  return <section className="order-panel account-settings"><div className="breadcrumbs"><Link href="/account/">← Мой аккаунт</Link></div><h1>Настройки аккаунта</h1><p className="detail-text">Текущий email: <strong>{state.account!.email}</strong></p>
    <section className="settings-section"><h2>Сменить email</h2><p className="detail-text">Ссылка придёт на новый адрес. До подтверждения email не изменится. После подтверждения все сеансы завершатся, а на прежний адрес придёт уведомление.</p>
      <form className="demo-form" onSubmit={event=>{event.preventDefault();try{const value=newEmail(String(new FormData(event.currentTarget).get('email')||''),state.account!.email);void send('email',value);}catch(error){setErrorFor('email');setError(error instanceof Error?error.message:'Проверьте email.');}}}><label>Новый email<input name="email" type="email" required maxLength={254} autoComplete="email" disabled={busy!==null}/></label><button className="primary" disabled={busy!==null||cooldown>0}>{busy==='email'?'Отправляем…':cooldown?`Повторить через ${cooldown} с`:'Отправить подтверждение на новый email'}</button></form>
      {error&&errorFor==='email'&&<p className="auth-error" role="alert">{error}</p>}
      {emailSent&&<div className="success" role="status">Письмо для смены email на {emailSent} запрошено. Проверьте почту и «Спам». Действует только последнее запрошенное письмо смены адреса.</div>}
    </section>
    <section className="settings-section"><h2>Устройства и сеансы</h2><p className="detail-text">Если входили с чужого устройства, завершите все сеансы. Повторный вход — через email.</p><LogoutAllButton/>{state.error&&<p className="auth-error" role="alert">{state.error}</p>}</section>
    <section className="settings-section danger-zone"><h2>Удалить аккаунт</h2><p className="detail-text">Это необратимо. Профиль, переписка и файлы будут удалены, email обезличен, сеансы завершены. История завершённых сделок и отзывов сохраняется. Очистка файлов выполняется в фоне.</p>
      <p className="detail-text">Удаление запрещено, пока есть заказы «В работе», где вы заказчик или выбранный исполнитель. Сервер проверит это и сейчас, и при подтверждении.</p>
      <form className="demo-form" onSubmit={event=>{event.preventDefault();if(new FormData(event.currentTarget).get('understood')==='on')void send('deletion');}}><fieldset className="form-fieldset" disabled={busy!==null}><label className="consent"><input name="understood" type="checkbox" required checked={understood} onChange={event=>setUnderstood(event.target.checked)}/><span>Я понимаю последствия и хочу получить письмо для удаления аккаунта.</span></label><button className="outline danger" disabled={cooldown>0||!understood}>{busy==='deletion'?'Отправляем…':cooldown?`Повторить через ${cooldown} с`:'Запросить письмо для удаления'}</button></fieldset></form>
      {error&&errorFor==='deletion'&&<p className="auth-error" role="alert">{error}</p>}
      {deletionSent&&<div className="success" role="status">Проверьте письмо на текущем email. Аккаунт пока не удалён. Открытие ссылки без нажатия кнопки подтверждения ничего не удалит.</div>}
    </section>
    <p className="field-hint">При потере ответа сначала проверьте почту. Новый запрос отменяет предыдущую ссылку того же действия. В локальном режиме письма доступны в журнале бэкенда.</p>
  </section>;
}
