export type CatalogView = 'orders' | 'masters';
export type SearchParams = Record<string, string | string[] | undefined>;
export const PAGE_SIZE = 20;
export type Budget = { minMinor: number | null; maxMinor: number | null; currency: 'RUB' };
export type Named = { id: string; name: string };
export type Category = Named & { active: boolean; selectable: boolean; children: Category[] };
export type Region = Named & { active: boolean };
export type Order = { id: string; title: string; categoryName: string; locationName: string; regionName: string; descriptionPreview?: string; description?: string; budget: Budget; publishedAt: string; bidCount: number; attachmentIds?: string[] };
export type Master = { id: string; displayName: string | null; bioPreview?: string; bio?: string; avatarAttachmentId?:string|null; specializations: Named[]; serviceLocations: Named[]; ratingAverage: number | null; reviewCount: number; completedOrderCount: number; portfolio?: {title: string; description: string; attachmentIds: string[]}[] };
export type Page<T> = {items: T[]; total: number; limit: number; offset: number};
export const single = (value: string | string[] | undefined) => typeof value === 'string' ? value : '';
export function rublesToMinor(value: string): number | undefined {
  if (!value) return undefined;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) throw new Error('Укажите бюджет в рублях, не более двух знаков после запятой.');
  const [whole='0', fraction=''] = value.replace(',','.').split('.');
  const minor = BigInt(whole)*100n + BigInt(fraction.padEnd(2,'0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Слишком большой бюджет.');
  return Number(minor);
}
export function catalogQuery(view: CatalogView, params: SearchParams) {
  const query = single(params.q).trim();
  if (query && (query.length < 2 || query.length > 200)) throw new Error('Поисковый запрос должен содержать от 2 до 200 символов.');
  const value = Number(single(params.page) || '1');
  const page = Number.isSafeInteger(value) && value > 0 ? value : 1;
  if ((page-1)*PAGE_SIZE > 1_000_000) throw new Error('Слишком большой номер страницы.');
  const sortValue = single(params.sort);
  const allowed = view === 'orders' ? ['newest','budget_desc','budget_asc','popular','relevance'] : ['rating','completed','newest','relevance'];
  const sort = allowed.includes(sortValue) && (sortValue !== 'relevance' || query) ? sortValue : query ? 'relevance' : view === 'orders' ? 'newest' : 'rating';
  const regionId = single(params.regionId); const categoryId = single(params.categoryId);
  const budget = view === 'orders' ? rublesToMinor(single(params.budget)) : undefined;
  const api = new URLSearchParams({limit:String(PAGE_SIZE),offset:String((page-1)*PAGE_SIZE),sort});
  if (query) api.set('query',query);
  if (regionId) api.set('regionId',regionId);
  if (categoryId) api.set(view === 'orders' ? 'categoryId' : 'specializationId',categoryId);
  if (budget !== undefined) api.set('budgetMinMinor',String(budget));
  return {api,page,query,sort,regionId,categoryId,budget:single(params.budget)};
}
export function pageHref(view: CatalogView, params: SearchParams, page: number) {
  const query = new URLSearchParams();
  for (const key of ['q','regionId','categoryId','budget','sort']) {const value=single(params[key]);if(value)query.set(key,value);}
  if(page>1)query.set('page',String(page));
  return `/${view}/${query.size?'?'+query:''}`;
}
export function paginationPages(page: number, total: number) {
  return [...new Set([1,total,...Array.from({length:5},(_,i)=>page+i-2)])].filter(n=>n>=1&&n<=total).sort((a,b)=>a-b);
}
export function flattenCategories(items: Category[]): Named[] {
  return items.flatMap(item => item.active ? [...(item.selectable ? [{id:item.id,name:item.name}] : []),...flattenCategories(item.children)] : []);
}
export const detailHref = (view: CatalogView,id: string) => `/${view}/view/?id=${encodeURIComponent(id)}`;
export function formatBudget(budget: Budget) {
  const money = (value: number) => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value/100);
  const min=budget.minMinor,max=budget.maxMinor;
  if(min===null&&max===null)return 'По договорённости';
  if(min===max)return `${money(min!)} ₽`;
  if(min===null)return `до ${money(max!)} ₽`;
  if(max===null)return `от ${money(min)} ₽`;
  return `${money(min)}–${money(max)} ₽`;
}
export function formatRating(master: Pick<Master,'ratingAverage'|'reviewCount'>) {
  return master.ratingAverage === null || !master.reviewCount ? 'Без отзывов' : `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(master.ratingAverage)} / 5 · отзывов: ${master.reviewCount}`;
}
