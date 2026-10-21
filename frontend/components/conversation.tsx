'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {useAuth} from './auth-provider';
import {MessageAttempt,MessageError,messagesApi,conversationHref} from '../lib/messages';
import type {MessagePage} from '../lib/messages';
import {UUID} from '../lib/orders';
import {paginationPages} from '../lib/catalog';

export function Conversation(){const id=useSearchParams().get('bidId')||'';return <ConversationBody key={id} bidId={id}/>;}
function ConversationBody({bidId}:{bidId:string}){
  const {state,controller}=useAuth();const params=useSearchParams();const router=useRouter();
  const candidate=Number(params.get('page')||1);const page=Number.isSafeInteger(candidate)&&candidate>=1&&candidate<=50001?candidate:1;
  const [history,setHistory]=useState<{page:number;data?:MessagePage;error?:string;fatal?:boolean}>();const [revision,setRevision]=useState(0);
  const [text,setText]=useState('');const [sending,setSending]=useState(false);const [sendError,setSendError]=useState('');const [notice,setNotice]=useState('');const [pending,setPending]=useState(false);const [waitUntil,setWaitUntil]=useState(0);const [now,setNow]=useState(0);
  const attempt=useRef(new MessageAttempt());const guard=useRef(false);const accountId=state.account!.id;
  useEffect(()=>{
    let active=true,inFlight=false,denied=false;const abort=new AbortController();
    async function refresh(){
      if(inFlight||denied)return;inFlight=true;
      try{const data=await controller.authorized(token=>messagesApi.list(token,bidId,page,abort.signal));if(active)setHistory({page,data});}
      catch(error){if(active&&!abort.signal.aborted){denied=error instanceof MessageError&&error.status===404;setHistory(previous=>({page,data:!denied&&previous?.page===page?previous.data:undefined,error:error instanceof MessageError&&error.status===0?'Не удалось обновить историю. Проверьте соединение.':error instanceof Error?error.message:'Не удалось загрузить историю.',fatal:denied}));}}
      finally{inFlight=false;}
    }
    void refresh();const timer=page===1?setInterval(()=>{if(document.visibilityState==='visible')void refresh();},10000):undefined;
    const visible=()=>{if(page===1&&document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);
    return()=>{active=false;abort.abort();if(timer)clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[controller,accountId,bidId,page,revision]);
  useEffect(()=>{if(!waitUntil)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[waitUntil]);
  const current=history?.page===page?history:undefined;const data=current?.data;const pages=data?Math.min(50001,Math.ceil(data.total/20)):0;
  const remaining=Math.max(0,Math.ceil((waitUntil-now)/1000));const href=(n:number)=>`${conversationHref(bidId)}&page=${n}`;
  function reload(){setRevision(n=>n+1);}
  async function send(){
    if(guard.current||remaining||current?.fatal)return;setSendError('');setNotice('');
    try{
      const body=attempt.current.prepare(text);setText(body.text);setPending(true);guard.current=true;setSending(true);
      await controller.authorized(token=>messagesApi.send(token,bidId,body));attempt.current.complete();setPending(false);setText('');setNotice('Сообщение отправлено.');
      setWaitUntil(0);if(page!==1)router.push(conversationHref(bidId));reload();
    }catch(error){
      setSendError(error instanceof Error?error.message:'Не удалось отправить сообщение.');
      if(error instanceof MessageError){
        if(error.status===429){const time=Date.now();setNow(time);setWaitUntil(time+error.retryAfter*1000);}
        if([400,404,409,422].includes(error.status)){attempt.current.complete();setPending(false);reload();}
      }
    }finally{guard.current=false;setSending(false);}
  }
  if(!UUID.test(bidId))return <section className="order-panel"><h1>Переписка</h1><p role="alert">Откройте диалог из конкретного отклика.</p><Link href="/account/bids/">Мои отклики</Link> · <Link href="/account/orders/">Мои заказы</Link></section>;
  return <section className="order-panel conversation"><div className="breadcrumbs"><Link href="/account/orders/">Мои заказы</Link> · <Link href="/account/bids/">Мои отклики</Link></div>
    <h1>Переписка по отклику</h1><p className="field-hint">Сообщения видят только заказчик и автор этого отклика. Новые сообщения — на странице 1, старые — на следующих.</p>
    <div className="conversation-toolbar"><button className="outline" onClick={reload}>Обновить историю</button><span className="field-hint">{page===1?'Обновление каждые 10 секунд в открытой вкладке.':'История обновляется вручную.'}</span></div>
    {!current&&<p role="status">Загружаем переписку…</p>}{current?.error&&<p className="auth-error" role="alert">{current.error}</p>}
    {data&&<><p className="card-description">Сообщений: {data.total} · Страница {page}</p>
      {!data.items.length&&<p>{data.total?'На этой странице нет сообщений.':'Начните разговор с заказчиком или мастером.'}</p>}
      <ol className="message-history" aria-label="История сообщений">{[...data.items].reverse().map(message=><li key={message.id} className={message.authorId===accountId?'message own-message':'message'}><div className="message-meta"><strong>{message.authorId===null?'Автор не сохранился':message.authorId===accountId?'Вы':'Собеседник'}</strong> <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('ru-RU')}</time></div><p className="preserve-lines">{message.text}</p></li>)}</ol>
      <nav className="pagination" aria-label="Страницы переписки">{paginationPages(page,pages).map(n=><Link key={n} href={href(n)} aria-current={n===page?'page':undefined}>{n}</Link>)}</nav>
      {pages>1&&<form className="page-jump" onSubmit={event=>{event.preventDefault();const n=Number(new FormData(event.currentTarget).get('page'));if(Number.isInteger(n)&&n>=1&&n<=pages)router.push(href(n));}}><label>Перейти на страницу <input name="page" type="number" required min="1" max={pages} defaultValue={page} key={page}/></label><button className="outline">Перейти</button></form>}
      {!data.canSend&&<p className="field-hint">Диалог закрыт для новых сообщений. История остаётся доступна.</p>}
    </>}
    {!current?.fatal&&(data?.canSend||pending)&&<form className="demo-form message-composer" onSubmit={event=>{event.preventDefault();void send();}}>
      <label>Сообщение<textarea value={text} onChange={event=>setText(event.target.value)} required maxLength={5000} rows={4} readOnly={pending||sending} placeholder="Напишите сообщение"/></label>
      {pending&&<p className="field-hint">Пока сервер не подтвердил доставку, текст зафиксирован. Повторная отправка использует тот же идентификатор и не создаст дубликат. Не обновляйте и не закрывайте страницу до подтверждения.</p>}
      <button className="primary" disabled={sending||remaining>0} type="submit">{sending?'Отправляем…':remaining?`Повтор через ${remaining} с`:pending?'Повторить отправку':'Отправить'}</button>
    </form>}
    {sendError&&<p role="alert" className="auth-error">{sendError}</p>}{notice&&<p role="status">{notice}</p>}
    <p className="field-hint">Вложения, редактирование и отметки о прочтении пока не поддерживаются. Черновик хранится только на этой странице, без сохранения в браузерное хранилище.</p>
  </section>;
}
