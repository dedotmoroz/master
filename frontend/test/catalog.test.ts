import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogQuery,detailHref,flattenCategories,formatBudget,formatRating,pageHref,paginationPages,rublesToMinor} from '../lib/catalog.ts';
test('public API parameters use real IDs, minor units and offset',()=>{
  const {api}=catalogQuery('orders',{q:' плитка ',categoryId:'tile',regionId:'ru-region-1',budget:'1200.50',page:'10',sort:'budget_desc'});
  assert.equal(api.get('offset'),'180');assert.equal(api.get('limit'),'20');assert.equal(api.get('budgetMinMinor'),'120050');assert.equal(api.get('query'),'плитка');assert.equal(api.get('categoryId'),'tile');assert.equal(api.get('regionId'),'ru-region-1');
});
test('contractor params use specialization and real sort, never budget or name',()=>{
  const {api}=catalogQuery('masters',{categoryId:'tile',budget:'invalid',sort:'name'});
  assert.equal(api.get('sort'),'rating');assert.equal(api.get('specializationId'),'tile');assert.equal(api.has('categoryId'),false);assert.equal(api.has('budgetMinMinor'),false);
  assert.equal(catalogQuery('masters',{q:'мастер'}).sort,'relevance');
});
test('invalid URL query and money rejected without float rounding',()=>{
  assert.equal(rublesToMinor('0.29'),29);assert.equal(rublesToMinor('10,05'),1005);
  for(const budget of ['-1','1.001','NaN','1e6','99999999999999999'])assert.throws(()=>rublesToMinor(budget));
  assert.throws(()=>catalogQuery('orders',{q:'x'}));assert.throws(()=>catalogQuery('orders',{page:'50002'}));
  assert.equal(catalogQuery('orders',{page:'NaN'}).page,1);
});
test('no-budget and unrated profiles do not become zero rating/zero cost',()=>{
  assert.equal(formatBudget({minMinor:null,maxMinor:null,currency:'RUB'}),'По договорённости');
  assert.equal(formatBudget({minMinor:0,maxMinor:0,currency:'RUB'}),'0 ₽');
  assert.equal(formatRating({ratingAverage:null,reviewCount:0}),'Без отзывов');
  assert.match(formatRating({ratingAverage:3.67,reviewCount:3}),/3,67/);
});
test('categories flatten active selectable leaves only',()=>{
  assert.deepEqual(flattenCategories([{id:'root',name:'Root',active:true,selectable:false,children:[{id:'tile',name:'Tile',active:true,selectable:true,children:[]},{id:'hidden',name:'Hidden',active:false,selectable:true,children:[]}]}]),[{id:'tile',name:'Tile'}]);
});
test('pagination and detail links preserve static URLs and URL encode',()=>{
  const url=new URL(pageHref('orders',{q:'плитка & ремонт',regionId:'r1'},10),'http://localhost');
  assert.equal(url.searchParams.get('q'),'плитка & ремонт');assert.equal(url.searchParams.get('page'),'10');
  assert.deepEqual(paginationPages(10,161),[1,8,9,10,11,12,161]);assert.deepEqual(paginationPages(1,0),[]);
  assert.equal(detailHref('orders','id?&'),'/orders/view/?id=id%3F%26');
});
