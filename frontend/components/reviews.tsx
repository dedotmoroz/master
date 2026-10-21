'use client';
import Link from 'next/link';
import {useSearchParams,useRouter} from 'next/navigation';
import {apiGet,assertPage} from '../lib/api';
import type {Page} from '../lib/catalog';
import {paginationPages} from '../lib/catalog';
import {useResource} from './use-resource';
type PublicReview={id:string;orderId:string|null;orderTitle:string|null;authorId:string;score:number;text:string;createdAt:string};
export function PublicReviews({contractorId}:{contractorId:string}){
  const params=useSearchParams();const router=useRouter();const candidate=Number(params.get('reviewsPage')||1);const page=Number.isSafeInteger(candidate)&&candidate>=1&&candidate<=50001?candidate:1;
  const resource=useResource(`reviews:${contractorId}:${page}`,async signal=>{const data=await apiGet<Page<PublicReview>>(`/contractors/${encodeURIComponent(contractorId)}/reviews?limit=20&offset=${(page-1)*20}`,signal);assertPage(data);return data;});
  const pages=resource.data?Math.min(50001,Math.ceil(resource.data.total/20)):0;
  const href=(n:number)=>`/masters/view/?id=${encodeURIComponent(contractorId)}&reviewsPage=${n}#reviews`;
  return <section id="reviews" className="order-panel"><h2>Отзывы о мастере</h2><p className="field-hint">Все опубликованные отзывы учитываются в общей оценке.</p>
    {resource.loading&&<p role="status">Загружаем отзывы…</p>}{resource.error&&<div role="alert"><p>{resource.error}</p><button className="outline" onClick={resource.reload}>Повторить</button></div>}
    {resource.data&&<><p>Всего отзывов: {resource.data.total}</p>{resource.data.items.map(review=><article className="result-card" key={review.id}><h3>{review.score} / 5</h3><p className="detail-text preserve-lines">{review.text}</p>{review.orderTitle&&<p className="card-description">Заказ: {review.orderTitle}</p>}<time className="field-hint" dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString('ru-RU')}</time></article>)}
      {!resource.data.items.length&&<p>{resource.data.total?'На этой странице нет отзывов.':'Пока нет отзывов.'}</p>}
      <nav className="pagination" aria-label="Страницы отзывов">{paginationPages(page,pages).map(n=><Link key={n} href={href(n)} aria-current={n===page?'page':undefined}>{n}</Link>)}</nav>
      {pages>1&&<form className="page-jump" onSubmit={event=>{event.preventDefault();const n=Number(new FormData(event.currentTarget).get('page'));if(Number.isInteger(n)&&n>=1&&n<=pages)router.push(href(n));}}><label>Перейти на страницу <input name="page" type="number" required min="1" max={pages} defaultValue={page} key={page}/></label><button className="outline">Перейти</button></form>}
    </>}
  </section>;
}
