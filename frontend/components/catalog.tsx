'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {apiGet,assertPage} from '../lib/api';
import {catalogQuery,detailHref,flattenCategories,formatBudget,formatRating,pageHref,paginationPages} from '../lib/catalog';
import type {CatalogView,SearchParams,Page,Order,Master,Category,Region} from '../lib/catalog';
import {useResource} from './use-resource';
import {DemoAction} from './demo-action';

export function Catalog({view,params}:{view:CatalogView;params:SearchParams}) {
  const router=useRouter();
  let query: ReturnType<typeof catalogQuery>|undefined; let validation='';
  try {query=catalogQuery(view,params);}catch(error){validation=error instanceof Error?error.message:'Неверные параметры.';}
  const isOrders=view==='orders'; const request=query?.api.toString() || '';
  const listing=useResource<Page<Order|Master>>(`${view}?${request}:${validation}`,async signal=>{
    if(validation)throw new Error(validation);
    const result=await apiGet<Page<Order|Master>>(`/${isOrders?'orders':'contractors'}?${request}`,signal);assertPage(result);return result;
  });
  const dictionaries=useResource('dictionaries',async signal=>{
    const [categories,regions]=await Promise.all([apiGet<{items:Category[]}>('/work-categories',signal),apiGet<{items:Region[]}>('/regions',signal)]);
    return {categories:flattenCategories(categories.items),regions:regions.items.filter(item=>item.active)};
  });
  const total=listing.data?.total; const page=query?.page||1;
  const pages=total===undefined?0:Math.min(Math.ceil(total/20),50001);
  return <>
    <div className="breadcrumbs"><Link href="/">Главная</Link><span> / </span><span>{isOrders?'Заказы':'Мастера'}</span></div>
    <div className="page-heading"><div><h1>{isOrders?'Заказы на ремонт и строительство':'Мастера по ремонту и строительству'}</h1><p>{isOrders?'Найдите работу по своей специальности и договоритесь с заказчиком.':'Выберите специалиста по виду работ, региону и отзывам.'}</p></div><span className="country">Россия</span></div>
    <form action={`/${view}/`} id="catalog-form" className="search" key={JSON.stringify(params)}><label className="sr-only" htmlFor="query">Поиск по каталогу</label><span aria-hidden="true" className="search-icon">⌕</span><input id="query" name="q" type="search" minLength={2} maxLength={200} defaultValue={query?.query} placeholder="Например, укладка плитки или ремонт квартиры"/><button className="primary" type="submit">Найти</button></form>
    <div className="catalog-layout"><aside className="filters" key={'filters'+JSON.stringify(params)}>
      <div className="filter-heading"><h2>Фильтры</h2><Link className="text-button" href={`/${view}/`}>Сбросить</Link></div>
      <label htmlFor="region">Регион</label><select key={'region:'+!!dictionaries.data} form="catalog-form" id="region" name="regionId" defaultValue={query?.regionId} disabled={!dictionaries.data}><option value="">Вся Россия</option>{dictionaries.data?.regions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <label htmlFor="category">Виды работ</label><select key={'category:'+!!dictionaries.data} form="catalog-form" id="category" name="categoryId" defaultValue={query?.categoryId} disabled={!dictionaries.data}><option value="">Все виды работ</option>{dictionaries.data?.categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
      {isOrders&&<div id="budget-filter"><label htmlFor="budget">Бюджет от, ₽</label><input form="catalog-form" id="budget" name="budget" type="number" min="0" step="0.01" defaultValue={query?.budget} placeholder="Любой"/></div>}
      <button className="outline apply-filters" form="catalog-form" type="submit">Применить</button>
      {dictionaries.loading&&<p className="card-description">Загрузка справочников…</p>}{dictionaries.error&&<div role="alert"><p>{dictionaries.error}</p><button className="text-button" onClick={dictionaries.reload}>Повторить загрузку фильтров</button></div>}
      <div className="filter-help"><h3>Не нашли подходящее?</h3><p>Попробуйте соседний регион или другой вид работ.</p></div>
    </aside><section aria-label="Результаты поиска" aria-busy={listing.loading}>
      <div className="results-toolbar"><p role="status">{total===undefined?'Загрузка…':`${isOrders?'Заказов':'Мастеров'} найдено: ${total}`}</p><label className="sort-label">Сначала <select form="catalog-form" name="sort" defaultValue={query?.sort} key={query?.sort}>{(isOrders?[['newest','новые'],['budget_desc','с большим бюджетом'],['budget_asc','с меньшим бюджетом'],['popular','популярные']]:[['rating','по рейтингу'],['completed','по выполненным заказам'],['newest','новые']]).map(([value,name])=><option key={value} value={value}>{name}</option>)}{query?.query&&<option value="relevance">по совпадению</option>}</select></label></div>
      {listing.loading&&<div className="empty" role="status">Загружаем актуальные данные…</div>}
      {listing.error&&<div className="empty" role="alert"><p>{listing.error}</p><button className="outline" onClick={listing.reload}>Повторить</button></div>}
      {listing.data?.items.map(item=><CatalogCard key={item.id} item={item} view={view}/>)}
      {listing.data&&!listing.data.items.length&&<div className="empty"><strong>{total?'На этой странице нет записей':'Ничего не найдено'}</strong><p>Попробуйте изменить запрос или сбросить фильтры.</p>{!!total&&<Link href={pageHref(view,params,1)}>На первую страницу</Link>}</div>}
      <nav className="pagination" aria-label="Страницы каталога">{paginationPages(page,pages).map((n,i,array)=><span key={n} className="page-entry">{i>0&&n-array[i-1]>1&&<span aria-hidden="true">…</span>}<Link href={pageHref(view,params,n)} aria-current={page===n?'page':undefined}>{n}</Link></span>)}</nav>
      {pages>1&&<form className="page-jump" onSubmit={event=>{event.preventDefault();const selected=Number(new FormData(event.currentTarget).get('page'));if(Number.isSafeInteger(selected)&&selected>=1&&selected<=pages)router.push(pageHref(view,params,selected));}}><label>Перейти на страницу <input name="page" type="number" min="1" max={pages} required defaultValue={page} key={page}/></label><button className="outline" type="submit">Перейти</button></form>}
    </section></div>
    <section className="bottom-callout"><div><h2>{isOrders?'Нужен мастер для вашей задачи?':'Вы занимаетесь ремонтом и строительством?'}</h2><p>{isOrders?'Опишите работу и получите предложения от исполнителей.':'Создайте профиль, добавьте работы и находите заказчиков.'}</p></div><DemoAction kind={isOrders?'order':'master'} className="outline">{isOrders?'Разместить заказ':'Добавить мастера'} →</DemoAction></section>
  </>;
}
function CatalogCard({item,view}:{item:Order|Master;view:CatalogView}) {
  const order=view==='orders'?item as Order:undefined; const master=view==='masters'?item as Master:undefined;
  const name=order?.title||master?.displayName||'Мастер';const href=detailHref(view,item.id);
  return <article className="result-card"><div className="card-top">{master?<><div className="master-heading"><div className="avatar" aria-hidden="true">{name.slice(0,2).toLocaleUpperCase('ru')}</div><h2><Link className="title-button" href={href}>{name}</Link></h2></div><span className="rating">{formatRating(master)}</span></>:<><h2><Link className="title-button" href={href}>{name}</Link></h2><span className="price">{formatBudget(order!.budget)}</span></>}</div>
    <p className="card-description">{order?.descriptionPreview||master?.bioPreview||'Описание не указано'}</p><div className="card-meta"><span>⌖ {order?.locationName||master?.serviceLocations.map(item=>item.name).join(', ')||'Регион не указан'}</span><span className="category-tag">{order?.categoryName||master?.specializations.map(item=>item.name).join(', ')}</span></div>
    <div className="card-bottom"><span>{order?`Откликов: ${order.bidCount}`:`Выполнено заказов: ${master!.completedOrderCount}`}</span><Link href={href}>{order?'Посмотреть заказ':'Открыть профиль'} →</Link></div></article>;
}
