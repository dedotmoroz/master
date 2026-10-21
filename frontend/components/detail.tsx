'use client';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {useState} from 'react';
import {useAuth} from './auth-provider';
import {apiGet} from '../lib/api';
import type {CatalogView,Order,Master} from '../lib/catalog';
import {formatBudget,formatRating} from '../lib/catalog';
import {useResource} from './use-resource';
import {BidEntry} from './bids';
import {PublicReviews} from './reviews';
import {PublicAttachment} from './public-attachment';
export function Detail({view}:{view:CatalogView}) {
  const {state}=useAuth();const [submittedFor,setSubmittedFor]=useState('');
  const id=useSearchParams().get('id')||'';const isOrder=view==='orders';
  const valid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
  const resource=useResource<Order|Master>(`${view}:${id}`,async signal=>{
    if(!valid)throw new Error('В ссылке не указан корректный идентификатор записи.');
    return apiGet<Order|Master>(`/${isOrder?'orders':'contractors'}/${encodeURIComponent(id)}`,signal);
  });
  const order=isOrder?resource.data as Order|undefined:undefined;
  const master=!isOrder?resource.data as Master|undefined:undefined;
  return <><div className="breadcrumbs"><Link href={`/${view}/`}>← {isOrder?'Заказы':'Мастера'}</Link></div>
    {resource.loading&&<div className="empty" role="status">Загрузка записи…</div>}
    {resource.error&&<div className="empty" role="alert"><p>{resource.error}</p>{valid&&<button className="outline" onClick={resource.reload}>Повторить</button>}</div>}
    {resource.data&&<article className="result-card"><h1>{order?.title||master?.displayName||'Мастер'}</h1>
      <p className="detail-text">{order?.locationName||master?.serviceLocations.map(item=>item.name).join(', ')}</p>
      <p className="category-tag">{order?.categoryName||master?.specializations.map(item=>item.name).join(', ')}</p>
      {order&&<><p><strong>{formatBudget(order.budget)}</strong></p><p className="card-description">Откликов: {order.bidCount}</p></>}
      {master&&<>{master.avatarAttachmentId&&<PublicAttachment id={master.avatarAttachmentId} alt={`Аватар: ${master.displayName||'Мастер'}`}/>}<p>{formatRating(master)}</p><p className="card-description">Выполнено заказов: {master.completedOrderCount}</p></>}
      <p className="detail-text preserve-lines">{order?.description||master?.bio||'Описание не указано'}</p>
      {!!order?.attachmentIds?.length&&<section><h2>Фото и документы</h2><div className="attachment-grid">{order.attachmentIds.map((id,index)=><PublicAttachment key={id} id={id} alt={`Вложение ${index+1} к заказу ${order.title}`}/>)}</div></section>}
      {!!master?.portfolio?.length&&<section><h2>Портфолио</h2>{master.portfolio.map((item,index)=><div className="portfolio-entry" key={index}><h3>{item.title}</h3><p className="detail-text preserve-lines">{item.description}</p><div className="attachment-grid">{item.attachmentIds.map(id=><PublicAttachment key={id} id={id} alt={item.title}/>)}</div></div>)}</section>}
    </article>}
    {order&&<BidEntry key={id} orderId={id} submitted={submittedFor===`${state.account?.id}:${id}`} onSubmitted={()=>{setSubmittedFor(`${state.account?.id}:${id}`);resource.reload();}}/>}
    {master&&<PublicReviews key={id} contractorId={id}/>}
  </>;
}
