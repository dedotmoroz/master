'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {useAuth} from './auth-provider';
import {useNotificationCounter} from './notification-provider';
import {useResource} from './use-resource';
import {emailLabels,notificationHref,notificationLabels,notificationsApi,NotificationError} from '../lib/notifications';
import type {EmailPreferences,NotificationPage} from '../lib/notifications';
import {paginationPages} from '../lib/catalog';

export function Notifications(){
  const params=useSearchParams();const candidate=Number(params.get('page')||1);const page=Number.isSafeInteger(candidate)&&candidate>=1&&candidate<=50001?candidate:1;
  return <NotificationList key={page} page={page}/>;
}
function NotificationList({page}:{page:number}){
  const {controller,state}=useAuth();const {counter}=useNotificationCounter();const router=useRouter();
  const [result,setResult]=useState<{data?:NotificationPage;error?:string}>();const [revision,setRevision]=useState(0);const [reading,setReading]=useState<string|null>(null);const [readError,setReadError]=useState('');const [notice,setNotice]=useState('');
  const guard=useRef(false);const lifetime=useRef<AbortController|null>(null);const id=state.account!.id;
  useEffect(()=>{const abort=new AbortController();lifetime.current=abort;return()=>abort.abort();},[]);
  useEffect(()=>{
    const abort=new AbortController();let inFlight=false;
    async function refresh(){
      if(inFlight)return;inFlight=true;
      try{const data=await controller.authorized(token=>notificationsApi.list(token,20,(page-1)*20,abort.signal));if(!abort.signal.aborted)setResult({data});}
      catch(error){if(!abort.signal.aborted)setResult(previous=>({data:error instanceof NotificationError&&error.status===404?undefined:previous?.data,error:error instanceof Error?error.message:'Не удалось получить уведомления.'}));}
      finally{inFlight=false;}
    }
    void refresh();const visible=()=>{if(page===1&&document.visibilityState==='visible')void refresh();};const timer=page===1?setInterval(visible,30000):undefined;
    document.addEventListener('visibilitychange',visible);
    return()=>{abort.abort();if(timer)clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[controller,id,page,revision]);
  function reload(){setRevision(value=>value+1);void counter.refresh(true);}
  async function read(notificationId:string){
    if(guard.current)return;guard.current=true;setReading(notificationId);setReadError('');setNotice('');const signal=lifetime.current!.signal;
    try{
      await controller.authorized(token=>notificationsApi.read(token,notificationId,signal));
      if(signal.aborted)return;
      setResult(previous=>previous?.data?{...previous,data:{...previous.data,items:previous.data.items.map(item=>item.id===notificationId?{...item,readAt:item.readAt||new Date().toISOString()}:item)}}:previous);
      setNotice('Уведомление отмечено прочитанным.');reload();
    }catch(error){if(!signal.aborted){setReadError(error instanceof Error?error.message:'Не удалось отметить уведомление.');if(error instanceof NotificationError&&error.status===404)reload();}}
    finally{guard.current=false;if(!signal.aborted)setReading(null);}
  }
  const data=result?.data;const pages=data?Math.min(50001,Math.ceil(data.total/20)):0;
  return <section className="order-panel notifications-panel"><div className="breadcrumbs"><Link href="/account/">← Мой аккаунт</Link></div>
    <div className="page-heading"><h1>Уведомления</h1><Link href="/account/notifications/settings/" className="outline">Настройки email</Link></div>
    <div className="conversation-toolbar"><button className="outline" onClick={reload}>Обновить список</button><span className="field-hint">{page===1?'Автообновление раз в 30 секунд в открытой вкладке.':'Старые уведомления обновляются вручную.'}</span></div>
    {!result&&<p role="status">Загружаем уведомления…</p>}{result?.error&&<p role="alert" className="auth-error">{result.error}</p>}
    {readError&&<p role="alert" className="auth-error">{readError}</p>}{notice&&<p role="status">{notice}</p>}
    {data&&<><p className="card-description">Всего: {data.total} · Непрочитанных: {data.unreadCount} · Страница {page}</p>
      {!data.items.length&&<div className="empty"><h2>{data.total?'На этой странице нет уведомлений':'Пока всё спокойно'}</h2><p>{data.total?'Перейдите на первую страницу.':'Здесь появятся новые отклики, выбор исполнителя, сообщения и завершённые заказы.'}</p>{data.total>0&&<Link href="/account/notifications/">На первую страницу</Link>}</div>}
      <ol className="notification-list" aria-label="Список уведомлений">{data.items.map(item=>{const href=notificationHref(item);return <li key={item.id} className={`notification-card${item.readAt?'':' unread'}`}>
        <div className="notification-meta"><span>{notificationLabels[item.kind]}</span><span className="notification-state">{item.readAt?'Прочитано':'Не прочитано'}</span></div>
        <h2>{item.title}</h2><p className="preserve-lines">{item.text}</p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ru-RU')}</time>
        <div className="account-actions">{href?<Link className="outline" href={href}>{item.kind==='message_received'?'Открыть переписку':item.kind==='bid_submitted'?'Открыть отклики':'Открыть заказ'}</Link>:<span className="field-hint">Ссылка на диалог не сохранилась.</span>}
          {!item.readAt&&<button type="button" className="outline" disabled={reading!==null} onClick={()=>void read(item.id)}>{reading===item.id?'Отмечаем…':'Отметить прочитанным'}</button>}
        </div>
      </li>;})}</ol>
      <nav className="pagination" aria-label="Страницы уведомлений">{paginationPages(page,pages).map(n=><Link key={n} href={`/account/notifications/?page=${n}`} aria-current={n===page?'page':undefined}>{n}</Link>)}</nav>
      {pages>1&&<form className="page-jump" onSubmit={event=>{event.preventDefault();const n=Number(new FormData(event.currentTarget).get('page'));if(Number.isInteger(n)&&n>=1&&n<=pages)router.push(`/account/notifications/?page=${n}`);}}><label>Перейти на страницу <input name="page" type="number" min="1" max={pages} required defaultValue={page}/></label><button className="outline">Перейти</button></form>}
      <p className="field-hint">Отметка прочтения не удаляет уведомление. Переход по ссылке сам по себе не меняет статус. При поступлении новых событий старые страницы могут сдвигаться.</p>
    </>}
  </section>;
}

export function NotificationSettings(){
  const {controller,state}=useAuth();const resource=useResource(`email-preferences:${state.account!.id}`,signal=>controller.authorized(token=>notificationsApi.preferences(token,signal)));
  return <section className="order-panel"><div className="breadcrumbs"><Link href="/account/notifications/">← Уведомления</Link></div><h1>Настройки email</h1>
    <p className="detail-text">Выберите, какие события биржи дублировать на почту. Уведомления в кабинете останутся включены.</p>
    {resource.loading&&<p role="status">Загружаем настройки…</p>}{resource.error&&<div role="alert"><p className="auth-error">{resource.error}</p><button className="outline" onClick={resource.reload}>Повторить</button></div>}
    {resource.data&&<PreferencesForm initial={resource.data}/>}
    <p className="field-hint">Письма для входа, подтверждения email и безопасности отключить нельзя. Повторное включение уведомлений не отправляет ранее пропущенные письма.</p>
  </section>;
}
function PreferencesForm({initial}:{initial:EmailPreferences}){
  const {controller}=useAuth();const [value,setValue]=useState(initial);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const guard=useRef(false);const lifetime=useRef<AbortController|null>(null);
  useEffect(()=>{const abort=new AbortController();lifetime.current=abort;return()=>abort.abort();},[]);
  return <form className="demo-form notification-settings" onSubmit={async event=>{
    event.preventDefault();if(guard.current)return;guard.current=true;setBusy(true);setError('');setNotice('');const signal=lifetime.current!.signal;
    try{const saved=await controller.authorized(token=>notificationsApi.savePreferences(token,value,signal));if(!signal.aborted){setValue(saved);setNotice('Настройки сохранены.');}}
    catch(error){if(!signal.aborted)setError(error instanceof Error?`${error.message} Если ответ потерялся, повторите сохранение этих же настроек.`:'Не удалось сохранить настройки.');}
    finally{guard.current=false;if(!signal.aborted)setBusy(false);}
  }}><fieldset className="form-fieldset" disabled={busy}><legend className="sr-only">Письма о событиях биржи</legend>
    {(Object.keys(emailLabels) as (keyof EmailPreferences['email'])[]).map(key=><label key={key} className="consent"><input type="checkbox" checked={value.email[key]} onChange={event=>{setNotice('');setValue(previous=>({email:{...previous.email,[key]:event.target.checked}}));}}/><span>{emailLabels[key]}</span></label>)}
    <button className="primary" type="submit">{busy?'Сохраняем…':'Сохранить настройки'}</button></fieldset>
    {error&&<p role="alert" className="auth-error">{error}</p>}{notice&&<p role="status" className="success">{notice}</p>}
  </form>;
}
