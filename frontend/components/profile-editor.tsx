'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from './auth-provider';
import {useResource} from './use-resource';
import {apiGet} from '../lib/api';
import {blankProfile,buildProfile,profileApi} from '../lib/profile';
import type {OwnProfile,ProfileBody,PortfolioItem} from '../lib/profile';
import {flattenCategories} from '../lib/catalog';
import type {Category,Region,Master} from '../lib/catalog';
import {ProfileUpload} from './profile-upload';
import {PublicAttachment} from './public-attachment';

export function ProfileEditor(){
  const {state,controller}=useAuth();const resource=useResource(`profile:${state.account!.id}`,signal=>controller.authorized(token=>profileApi.get(token,signal)));
  return <><div className="breadcrumbs"><Link href="/account/">Мой аккаунт</Link></div><h1>Профиль мастера</h1>
    {resource.loading&&<p role="status">Загружаем ваш профиль…</p>}{resource.error&&<div role="alert"><p>{resource.error}</p><button className="outline" onClick={resource.reload}>Повторить</button></div>}
    {resource.data!==undefined&&<ProfileForm initial={resource.data} accountId={state.account!.id}/>}
  </>;
}
function ProfileForm({initial,accountId}:{initial:OwnProfile|null;accountId:string}){
  const {controller}=useAuth();const [draft,setDraft]=useState<ProfileBody>(()=>initial?{displayName:initial.displayName,bio:initial.bio,avatarAttachmentId:initial.avatarAttachmentId,specializationIds:[...initial.specializationIds],serviceLocationIds:[...initial.serviceLocationIds],portfolio:initial.portfolio.map(item=>({...item,attachmentIds:[...item.attachmentIds]}))}:blankProfile());
  const [saved,setSaved]=useState(initial);const [saving,setSaving]=useState(false);const [uploading,setUploading]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [preview,setPreview]=useState(false);const [filter,setFilter]=useState('');const [placeNames,setPlaceNames]=useState<Record<string,string>>({});const guard=useRef(false);const busy=saving||uploading;
  const dictionaries=useResource('profile-dictionaries',async signal=>{const [categories,regions]=await Promise.all([apiGet<{items:Category[]}>('/work-categories',signal),apiGet<{items:Region[]}>('/regions',signal)]);return {categories:flattenCategories(categories.items),regions:regions.items.filter(region=>region.active)};});
  const labels=useResource(`profile-labels:${initial?.accountId||'new'}`,async signal=>initial?apiGet<Master>(`/contractors/${encodeURIComponent(accountId)}`,signal):null);
  const projectKeys=useRef(initial?.portfolio.map((_,i)=>i)||[]);const nextProjectKey=useRef(20);
  const [localFiles,setLocalFiles]=useState<Record<string,{url:string;type:string}>>({});const objectUrls=useRef(new Set<string>());
  useEffect(()=>()=>{for(const url of objectUrls.current)URL.revokeObjectURL(url);},[]);
  function rememberFile(id:string,file:File){const url=URL.createObjectURL(file);objectUrls.current.add(url);setLocalFiles(old=>({...old,[id]:{url,type:file.type}}));}
  const categories=dictionaries.data?.categories||[];const regions=dictionaries.data?.regions||[];
  const categoryName=(id:string)=>categories.find(item=>item.id===id)?.name||labels.data?.specializations.find(item=>item.id===id)?.name||`Сохранённый вид работ: ${id}`;
  const placeName=(id:string)=>placeNames[id]||regions.find(item=>item.id===id)?.name||labels.data?.serviceLocations.find(item=>item.id===id)?.name||`Сохранённое место: ${id}`;
  const savedIds=new Set([saved?.avatarAttachmentId,...(saved?.portfolio.flatMap(item=>item.attachmentIds)||[])]);
  function renderFile(id:string,label:string){return savedIds.has(id)?<PublicAttachment id={id} alt={label}/>:localFiles[id]?.type.startsWith('image/')?<div className="public-attachment"><img src={localFiles[id].url} alt={label}/><p className="field-hint">Локальный предпросмотр проверенного файла. Публикация — после сохранения.</p></div>:<p className="field-hint">Файл проверен, готов к публикации.</p>;}
  function update<K extends keyof ProfileBody>(key:K,value:ProfileBody[K]){setDraft(old=>({...old,[key]:value}));setNotice('');}
  function project(index:number,change:Partial<PortfolioItem>){setDraft(old=>({...old,portfolio:old.portfolio.map((item,i)=>i===index?{...item,...change}:item)}));setNotice('');}
  async function save(){if(guard.current||uploading)return;setError('');setNotice('');try{const body=buildProfile(draft);guard.current=true;setSaving(true);const value=await controller.authorized(token=>profileApi.save(token,body));setSaved(value);setDraft({displayName:value.displayName,bio:value.bio,avatarAttachmentId:value.avatarAttachmentId,specializationIds:[...value.specializationIds],serviceLocationIds:[...value.serviceLocationIds],portfolio:value.portfolio.map(item=>({...item,attachmentIds:[...item.attachmentIds]}))});setNotice('Профиль сохранён и опубликован.');}catch(error){setError(error instanceof Error?error.message:'Не удалось сохранить профиль.');}finally{guard.current=false;setSaving(false);}}
  return <section className="order-panel profile-editor"><p className="detail-text">{saved?'Редактируйте профиль, не теряя существующие сведения и файлы.':'Расскажите о себе, чтобы заказчики могли найти вас.'} Изменения станут публичными после сохранения.</p>
    {saved&&<p><Link href={`/masters/view/?id=${encodeURIComponent(accountId)}`}>Открыть опубликованный профиль →</Link></p>}
    <form className="demo-form" onSubmit={event=>{event.preventDefault();void save();}}><fieldset className="form-fieldset" disabled={busy}>
      <label>Имя мастера или название бригады<input value={draft.displayName} onChange={event=>update('displayName',event.target.value)} required maxLength={120}/></label>
      <label>О себе и опыте<textarea value={draft.bio} onChange={event=>update('bio',event.target.value)} maxLength={5000} rows={6}/></label><p className="field-hint">Не публикуйте точный домашний адрес, пароли и конфиденциальные сведения.</p>
      <h2>Виды работ</h2>{dictionaries.loading&&<p role="status">Загружаем справочники…</p>}{dictionaries.error&&<div role="alert"><p>{dictionaries.error}</p><button type="button" className="outline" onClick={dictionaries.reload}>Повторить</button></div>}
      <label>Найти вид работ<input type="search" value={filter} onChange={event=>setFilter(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}}/></label><div className="profile-choices" role="group" aria-label="Виды работ мастера">
        {[...categories.map(item=>item.id),...draft.specializationIds.filter(id=>!categories.some(item=>item.id===id))].filter(id=>categoryName(id).toLocaleLowerCase('ru').includes(filter.toLocaleLowerCase('ru'))).map(id=><label className="consent" key={id}><input type="checkbox" checked={draft.specializationIds.includes(id)} disabled={!draft.specializationIds.includes(id)&&draft.specializationIds.length>=50} onChange={event=>update('specializationIds',event.target.checked?[...draft.specializationIds,id]:draft.specializationIds.filter(value=>value!==id))}/>{categoryName(id)}</label>)}
      </div><p className="field-hint">Выбрано: {draft.specializationIds.length} из 50. Сохранённые специализации не сбрасываются при поиске.</p>
      <h2>Где вы работаете</h2><div className="profile-tags">{draft.serviceLocationIds.map(id=><span key={id}>{placeName(id)} <button type="button" className="text-button" aria-label={`Убрать место: ${placeName(id)}`} onClick={()=>update('serviceLocationIds',draft.serviceLocationIds.filter(value=>value!==id))}>×</button></span>)}</div>
      <ProfilePlaces regions={regions} disabled={draft.serviceLocationIds.length>=50} onAdd={item=>{if(draft.serviceLocationIds.includes(item.id))return;update('serviceLocationIds',[...draft.serviceLocationIds,item.id]);setPlaceNames(old=>({...old,[item.id]:item.name}));}}/><p className="field-hint">До 50 регионов и населённых пунктов. Выбирайте значения из справочника; страна — Россия.</p>
      <h2>Аватар</h2>{draft.avatarAttachmentId&&<>{renderFile(draft.avatarAttachmentId,'Аватар мастера')}<button type="button" className="outline" onClick={()=>update('avatarAttachmentId',null)}>Убрать аватар из профиля</button></>}
      <ProfileUpload purpose="profile_avatar" onBusy={setUploading} onReady={(id,file)=>{rememberFile(id,file);update('avatarAttachmentId',id);}}/>
      <h2>Портфолио</h2>{draft.portfolio.map((item,index)=><section key={projectKeys.current[index]} className="portfolio-entry"><h3>Проект {index+1}</h3><label>Название проекта<input required maxLength={160} value={item.title} onChange={event=>project(index,{title:event.target.value})}/></label><label>Описание проекта<textarea maxLength={2000} rows={3} value={item.description} onChange={event=>project(index,{description:event.target.value})}/></label>
        <div className="attachment-grid">{item.attachmentIds.map((id,fileIndex)=><div key={id}>{renderFile(id,`${item.title||'Проект'} — фото ${fileIndex+1}`)}<button type="button" className="outline" onClick={()=>project(index,{attachmentIds:item.attachmentIds.filter(value=>value!==id)})}>Убрать файл {fileIndex+1} из проекта</button></div>)}</div>
        {item.attachmentIds.length<10&&<ProfileUpload purpose="portfolio" onBusy={setUploading} onReady={(id,file)=>{rememberFile(id,file);project(index,{attachmentIds:[...item.attachmentIds,id]});}}/>}
        <button className="outline danger" type="button" onClick={()=>{projectKeys.current.splice(index,1);update('portfolio',draft.portfolio.filter((_,i)=>i!==index));}}>Убрать проект из профиля</button></section>)}
      {draft.portfolio.length<20&&<button className="outline" type="button" onClick={()=>{projectKeys.current.push(nextProjectKey.current++);update('portfolio',[...draft.portfolio,{title:'',description:'',attachmentIds:[]}]);}}>Добавить проект</button>}
      <p className="field-hint">До 20 проектов, от 1 до 10 файлов в каждом. Удаление из формы убирает ссылку после сохранения; исходные файлы здесь не удаляются. Проверка файла может занять время.</p>
      <div className="account-actions"><button className="outline" type="button" onClick={()=>setPreview(value=>!value)}>{preview?'Скрыть предпросмотр':'Предпросмотр профиля'}</button><button className="primary" type="submit">{saving?'Сохраняем…':uploading?'Дождитесь проверки файла…':'Сохранить профиль'}</button></div>
    </fieldset></form>
    {preview&&<section className="result-card"><h2>{draft.displayName||'Имя мастера'}</h2>{draft.avatarAttachmentId&&renderFile(draft.avatarAttachmentId,'Аватар мастера')}<p className="detail-text preserve-lines">{draft.bio}</p><p>{draft.specializationIds.map(categoryName).join(', ')||'Виды работ не выбраны'}</p><p>{draft.serviceLocationIds.map(placeName).join(', ')||'Места работ не выбраны'}</p>{draft.portfolio.map((item,index)=><div key={index}><h3>{item.title||'Новый проект'}</h3><p className="detail-text preserve-lines">{item.description}</p><div className="attachment-grid">{item.attachmentIds.map(id=><div key={id}>{renderFile(id,item.title||'Проект')}</div>)}</div></div>)}<p className="field-hint">Это черновик профиля. Новые фото показаны локально; остальные пользователи увидят их только после сохранения.</p></section>}
    {error&&<p className="auth-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <p className="field-hint">Черновик и незавершённая загрузка хранятся только на этой странице. При перезагрузке несохранённые изменения теряются.</p>
  </section>;
}
function ProfilePlaces({regions,onAdd,disabled}:{regions:Region[];onAdd:(item:{id:string;name:string})=>void;disabled:boolean}){
  const [region,setRegion]=useState('');const [query,setQuery]=useState('');const [debounced,setDebounced]=useState('');useEffect(()=>{const timer=setTimeout(()=>setDebounced(query.trim()),300);return()=>clearTimeout(timer);},[query]);
  const results=useResource(`profile-places:${region}:${debounced}`,async signal=>{if(debounced.length<2)return {items:[] as {id:string;name:string;regionName:string}[]};const params=new URLSearchParams({query:debounced,limit:'30'});if(region)params.set('regionId',region);return apiGet<{items:{id:string;name:string;regionName:string}[]}>('/locations?'+params,signal);});
  return <><label>Регион поиска<select value={region} onChange={event=>setRegion(event.target.value)}><option value="">Все регионы</option>{regions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{region&&<button type="button" className="outline" disabled={disabled} onClick={()=>{const item=regions.find(item=>item.id===region);if(item)onAdd(item);}}>Добавить весь регион</button>}
    <label>Найти населённый пункт<input type="search" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}} maxLength={160} placeholder="Минимум два символа"/></label>
    {query.trim()===debounced&&debounced.length>=2&&(results.loading?<p role="status">Ищем…</p>:results.error?<div role="alert"><p>{results.error}</p><button className="outline" type="button" onClick={results.reload}>Повторить</button></div>:results.data?.items.length?<label>Населённые пункты<select value="" size={5} disabled={disabled} onChange={event=>{const item=results.data?.items.find(item=>item.id===event.target.value);if(item)onAdd({id:item.id,name:`${item.name}, ${item.regionName}`});}}><option value="" disabled>Добавить населённый пункт</option>{results.data.items.map(item=><option key={item.id} value={item.id}>{item.name}, {item.regionName}</option>)}</select></label>:<p className="field-hint">Ничего не найдено.</p>)}
  </>;
}
