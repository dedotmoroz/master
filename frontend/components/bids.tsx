'use client';
import Link from 'next/link';
import {useRef,useState} from 'react';
import {useSearchParams,useRouter} from 'next/navigation';
import {useAuth} from './auth-provider';
import {useResource} from './use-resource';
import {BidError,bidsApi,bidStatusLabel,buildBid} from '../lib/bids';
import type {Bid} from '../lib/bids';
import {formatBudget,paginationPages} from '../lib/catalog';
import {conversationHref} from '../lib/messages';
import {dealHref} from '../lib/deals';
import {ownsOrder,emptyBidLink} from '../lib/bid-entry';
import {ownOrderHref} from '../lib/orders';

export function BidEntry({orderId,submitted=false,onSubmitted}:{orderId:string;submitted?:boolean;onSubmitted?:()=>void}){
  const {state}=useAuth();
  return <section className="order-panel"><h2>Отклик на заказ</h2>{state.checking||state.busy?<p role="status">Проверяем аккаунт…</p>:state.account?<SignedInBidEntry key={`${state.account.id}:${orderId}`} orderId={orderId} submitted={submitted} onSubmitted={onSubmitted}/>:<><p className="detail-text">Войдите или зарегистрируйтесь, чтобы предложить свои услуги.</p><p><Link href="/auth/login/">Войти</Link> · <Link href="/auth/register/">Зарегистрироваться</Link></p><p className="field-hint">После входа вернитесь к этому заказу.</p></>}</section>;
}
function SignedInBidEntry({orderId,submitted,onSubmitted}:{orderId:string;submitted:boolean;onSubmitted?:()=>void}){
  const {state,controller}=useAuth();const access=useResource(`bid-owner:${state.account!.id}:${orderId}`,signal=>controller.authorized(token=>ownsOrder(token,orderId,signal)));
  if(access.loading)return <p role="status">Проверяем возможность отклика…</p>;
  if(access.error)return <div role="alert"><p>{access.error}</p><button type="button" className="outline" onClick={access.reload}>Повторить проверку</button></div>;
  if(access.data)return <><p>Это ваш заказ. Откликаться на него нельзя.</p><Link href={ownOrderHref(orderId)}>Управлять заказом и откликами →</Link></>;
  return <BidForm orderId={orderId} submitted={submitted} onSubmitted={onSubmitted}/>;
}
function BidForm({orderId,submitted,onSubmitted}:{orderId:string;submitted:boolean;onSubmitted?:()=>void}){
  const {controller}=useAuth();const guard=useRef(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [sent,setSent]=useState(false);
  if(sent||submitted)return <div role="status"><p>Отклик отправлен заказчику.</p><Link href="/account/bids/">Мои отклики →</Link></div>;
  return <form className="demo-form" onSubmit={async event=>{event.preventDefault();if(guard.current)return;setError('');const data=new FormData(event.currentTarget);try{const read=(name:string)=>String(data.get(name)||'');const body=buildBid({message:read('message'),priceMin:read('priceMin'),priceMax:read('priceMax'),daysMin:read('daysMin'),daysMax:read('daysMax'),visibility:read('visibility')});guard.current=true;setBusy(true);await controller.authorized(token=>bidsApi.submit(token,orderId,body));setSent(true);onSubmitted?.();}catch(error){setError(error instanceof Error?error.message:'Не удалось отправить отклик.');}finally{guard.current=false;setBusy(false);}}}>
    <fieldset className="form-fieldset" disabled={busy}><label>Ваше предложение<textarea name="message" required maxLength={5000} rows={5} placeholder="Расскажите об опыте и о том, как выполните работу"/></label>
    <p className="field-hint">Не указывайте в тексте пароли и другие личные данные. Цена и срок необязательны: их можно обсудить с заказчиком.</p>
    <div className="form-pair"><label>Цена от, ₽<input name="priceMin" inputMode="decimal" placeholder="По договорённости"/></label><label>Цена до, ₽<input name="priceMax" inputMode="decimal" placeholder="По договорённости"/></label></div>
    <div className="form-pair"><label>Срок от, дней<input name="daysMin" type="number" min="1" max="100000" step="1"/></label><label>Срок до, дней<input name="daysMax" type="number" min="1" max="100000" step="1"/></label></div>
    <label>Видимость отклика<select name="visibility" defaultValue="private"><option value="private">Приватный — для участников заказа</option><option value="public">Публичный — разрешаю показывать на сайте</option></select></label>
    <button className="primary" type="submit">{busy?'Отправляем…':'Отправить отклик'}</button></fieldset>
    {error&&<div role="alert" className="auth-error"><p>{error}</p><Link href="/account/bids/">Проверить мои отклики</Link></div>}
  </form>;
}

export function OwnBids(){return <><div className="breadcrumbs"><Link href="/account/">Мой аккаунт</Link></div><h1>Мои отклики</h1><p className="detail-text">Ваши предложения заказчикам и результат выбора исполнителя.</p><BidList/></>;}
export function OrderBids({orderId,canSelect,onSelected}:{orderId:string;canSelect:boolean;onSelected:()=>void}){return <section className="order-panel"><h2>Отклики мастеров</h2><BidList orderId={orderId} canSelect={canSelect} onSelected={onSelected}/></section>;}

function BidList({orderId,canSelect=false,onSelected}:{orderId?:string;canSelect?:boolean;onSelected?:()=>void}){
  const {state,controller}=useAuth();const params=useSearchParams();const router=useRouter();const pageKey=orderId?'bidsPage':'page';
  const candidate=Number(params.get(pageKey)||1);const page=Number.isSafeInteger(candidate)&&candidate>=1&&candidate<=50001?candidate:1;
  const resource=useResource(`bids:${state.account!.id}:${orderId||'own'}:${page}`,signal=>controller.authorized(token=>orderId?bidsApi.forOrder(token,orderId,page,signal):bidsApi.own(token,page,signal)));
  const [target,setTarget]=useState<Bid>();const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const guard=useRef(false);const dialog=useRef<HTMLDialogElement>(null);
  const pages=resource.data?Math.min(50001,Math.ceil(resource.data.total/20)):0;
  const href=(n:number)=>{const query=new URLSearchParams(params.toString());query.set(pageKey,String(n));return `${orderId?'/account/orders/view/':'/account/bids/'}?${query}`;};
  const emptyLink=emptyBidLink(Boolean(orderId),resource.data?.total||0,href(1));
  async function perform(){
    if(!target||guard.current)return;guard.current=true;setBusy(true);setError('');setNotice('');
    try{await controller.authorized(async token=>{if(orderId)await bidsApi.select(token,orderId,target.id);else await bidsApi.withdraw(token,target.id);});setNotice(orderId?'Исполнитель выбран. Заказ перешёл в работу.':'Отклик отозван.');resource.reload();onSelected?.();}
    catch(error){setError(error instanceof Error?error.message:'Не удалось выполнить действие.');if(error instanceof BidError&&(error.status===409||error.status===404)){resource.reload();onSelected?.();}}
    finally{guard.current=false;setBusy(false);dialog.current?.close();setTarget(undefined);}
  }
  return <>
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="auth-error">{error}</p>}
    {resource.loading&&<p role="status">Загружаем отклики…</p>}
    {resource.error&&<div role="alert"><p>{resource.error}</p><button className="outline" onClick={resource.reload}>Повторить</button></div>}
    {resource.data&&<><p className="card-description">Всего: {resource.data.total}</p>{!resource.data.items.length&&<p>{resource.data.total?'На этой странице нет откликов.':'Откликов пока нет.'} {emptyLink&&<Link href={emptyLink.href}>{emptyLink.label}</Link>}</p>}
      {resource.data.items.map(bid=><article key={bid.id} className="result-card"><div className="card-top"><h3>{orderId?'Предложение мастера':bid.orderTitle||'Заказ'}</h3><span className="order-status">{bidStatusLabel[bid.status]}</span></div>
        <p><strong>{formatBudget(bid.price)}</strong></p><p className="detail-text preserve-lines">{bid.message}</p>
        {bid.status==='selected'&&<p><Link href={dealHref(bid.orderId)}>Работа и отзыв →</Link></p>}
        {(bid.durationDaysMin!==null||bid.durationDaysMax!==null)&&<p>Срок: {bid.durationDaysMin!==null?`от ${bid.durationDaysMin}`:''} {bid.durationDaysMax!==null?`до ${bid.durationDaysMax}`:''} дней</p>}
        <p className="card-description">{new Date(bid.submittedAt).toLocaleDateString('ru-RU')} · {bid.visibility==='private'?'Приватный отклик':'Публичный отклик'}</p>
        <div className="account-actions"><Link href={conversationHref(bid.id)}>Переписка →</Link>{orderId?<Link href={`/masters/view/?id=${encodeURIComponent(bid.contractorId)}`}>Профиль мастера →</Link>:<Link href={`/orders/view/?id=${encodeURIComponent(bid.orderId)}`}>Публичная карточка заказа →</Link>}
          {bid.status==='submitted'&&(!orderId||canSelect)&&<button className="outline" disabled={busy} onClick={()=>{setTarget(bid);setError('');dialog.current?.showModal();}}>{orderId?'Выбрать исполнителем':'Отозвать отклик'}</button>}
        </div>{!orderId&&<p className="field-hint">Если заказ уже снят с публикации или находится в работе, публичная карточка недоступна. Отклик остаётся здесь.</p>}
      </article>)}
      <nav className="pagination" aria-label="Страницы откликов">{paginationPages(page,pages).map(n=><Link key={n} href={href(n)} aria-current={n===page?'page':undefined}>{n}</Link>)}</nav>
      {pages>1&&<form className="page-jump" onSubmit={event=>{event.preventDefault();const n=Number(new FormData(event.currentTarget).get('page'));if(Number.isInteger(n)&&n>=1&&n<=pages)router.push(href(n));}}><label>Перейти на страницу <input name="page" type="number" required min="1" max={pages} defaultValue={page} key={page}/></label><button className="outline">Перейти</button></form>}
    </>}
    <dialog ref={dialog} aria-label={orderId?'Выбор исполнителя':'Отзыв отклика'} onCancel={event=>{if(busy)event.preventDefault();}}><h2>{orderId?'Выбрать этого мастера?':'Отозвать отклик?'}</h2><p className="detail-text">{orderId?'Заказ перейдёт в работу. Остальные активные отклики будут отклонены. Изменить исполнителя в этом интерфейсе нельзя.':'Заказчик больше не сможет выбрать этот отклик.'}</p>{target&&<p>{formatBudget(target.price)}</p>}<div className="account-actions"><button className="outline" disabled={busy} onClick={()=>{dialog.current?.close();setTarget(undefined);}}>Не сейчас</button><button className="primary" disabled={busy||!target} onClick={()=>void perform()}>{busy?'Сохраняем…':'Подтвердить'}</button></div></dialog>
  </>;
}
