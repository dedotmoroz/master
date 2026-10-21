'use client';
import {useEffect,useState} from 'react';
import {apiGet} from '../lib/api';
import {flattenCategories} from '../lib/catalog';
import type {Category,Region} from '../lib/catalog';
import type {OrderFields} from '../lib/orders';
import {useResource} from './use-resource';
type Locality={id:string;name:string;regionName:string};
export const blankOrder:OrderFields={title:'',description:'',categoryId:'',locationId:'',budgetMin:'',budgetMax:''};
export function fieldsFromForm(data:FormData):OrderFields{return Object.fromEntries(Object.keys(blankOrder).map(key=>[key,String(data.get(key)||'')])) as OrderFields;}
export function OrderFieldsForm({initial=blankOrder}:{initial?:OrderFields}){
  const dictionaries=useResource('order-dictionaries',async signal=>{const [categories,regions]=await Promise.all([apiGet<{items:Category[]}>('/work-categories',signal),apiGet<{items:Region[]}>('/regions',signal)]);return {categories:flattenCategories(categories.items),regions:regions.items.filter(item=>item.active)};});
  return <>
    <label>Название заказа<input name="title" required maxLength={160} defaultValue={initial.title} placeholder="Например, ремонт ванной комнаты"/></label>
    <label>Вид работ<select name="categoryId" required defaultValue={initial.categoryId} key={'category:'+!!dictionaries.data} disabled={!dictionaries.data}><option value="">Выберите вид работ</option>{initial.categoryId&&!dictionaries.data?.categories.some(item=>item.id===initial.categoryId)&&<option value={initial.categoryId}>Текущая категория</option>}{dictionaries.data?.categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {dictionaries.loading&&<p role="status">Загрузка справочников…</p>}{dictionaries.error&&<div role="alert"><p>{dictionaries.error}</p><button type="button" className="outline" onClick={dictionaries.reload}>Повторить загрузку справочников</button></div>}
    <LocationPicker initialId={initial.locationId} regions={dictionaries.data?.regions||[]}/>
    <label>Описание работы<textarea name="description" required maxLength={10000} rows={7} defaultValue={initial.description} placeholder="Расскажите об объёме работ, материалах и пожеланиях"/></label>
    <p className="field-hint">Описание будет публичным. Не указывайте в нём пароли, email, телефон или точный домашний адрес.</p>
    <div className="form-pair"><label>Бюджет от, ₽<input type="number" name="budgetMin" min="0" step="0.01" defaultValue={initial.budgetMin}/></label><label>Бюджет до, ₽<input type="number" name="budgetMax" min="0" step="0.01" defaultValue={initial.budgetMax}/></label></div>
    <p className="field-hint">Бюджет можно не указывать — тогда он будет «По договорённости».</p>
  </>;
}
function LocationPicker({initialId,regions}:{initialId:string;regions:Region[]}){
  const [query,setQuery]=useState('');const [debounced,setDebounced]=useState('');const [region,setRegion]=useState('');
  const [selected,setSelected]=useState<{id:string;name:string}|null>(initialId?{id:initialId,name:'Место работ сохранено'}:null);
  useEffect(()=>{const timer=setTimeout(()=>setDebounced(query.trim()),300);return()=>clearTimeout(timer);},[query]);
  const ready=debounced.length>=2||!!region;
  const results=useResource(`locations:${region}:${debounced}`,async signal=>{if(!ready)return {items:[] as Locality[]};const params=new URLSearchParams({limit:'30'});if(debounced.length>=2)params.set('query',debounced);if(region)params.set('regionId',region);return apiGet<{items:Locality[]}>('/locations?'+params,signal);});
  const current=query.trim()===debounced;
  return <>
    <label>Регион поиска<select value={region} onChange={event=>{setRegion(event.target.value);setSelected(null);setQuery('');}}><option value="">Вся Россия</option>{regions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Населённый пункт<input type="search" value={selected?.name??query} autoComplete="off" placeholder="Начните вводить название" maxLength={160} onChange={event=>{setQuery(event.target.value);setSelected(null);}}/></label>
    <input type="hidden" name="locationId" value={selected?.id||''}/>
    {initialId&&selected?.id===initialId&&<p className="field-hint">Текущее место работ сохранится. Чтобы изменить его, найдите и выберите другой населённый пункт.</p>}
    {!selected&&ready&&current&&<>{results.loading?<p role="status">Ищем населённые пункты…</p>:results.error?<div role="alert"><p>{results.error}</p><button type="button" className="outline" onClick={results.reload}>Повторить поиск</button></div>:results.data?.items.length?<label>Результаты поиска<select size={5} value="" onChange={event=>{const item=results.data?.items.find(item=>item.id===event.target.value);if(item)setSelected({id:item.id,name:`${item.name}, ${item.regionName}`});}}><option value="" disabled>Выберите населённый пункт</option>{results.data.items.map(item=><option key={item.id} value={item.id}>{item.name}, {item.regionName}</option>)}</select></label>:<p className="field-hint">Ничего не найдено. Измените название или регион поиска.</p>}</>}
    {!selected&&<p className="field-hint">Введите минимум два символа и выберите населённый пункт из списка. Страна — Россия.</p>}
  </>;
}
