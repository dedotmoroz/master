import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const output = new URL('../out/', import.meta.url);
test('catalog and fixed detail shells exist as HTML files', async () => {
  const files = ['index.html', '404.html', 'orders/index.html', 'masters/index.html', 'orders/view/index.html', 'masters/view/index.html','auth/login/index.html','auth/register/index.html','auth/login/confirm/index.html','auth/register/confirm/index.html','account/index.html','orders/new/index.html','orders/confirm/index.html','account/orders/index.html','account/orders/view/index.html','account/bids/index.html'];
  files.push('account/messages/index.html');
  files.push('account/deals/view/index.html');
  files.push('account/profile/index.html');
  files.push('account/notifications/index.html','account/notifications/settings/index.html');
  files.push('account/settings/index.html','auth/email-change/confirm/index.html','auth/account-deletion/confirm/index.html');
  for (const file of files) {
    const html = await readFile(new URL(file,output),'utf8');
    assert.match(html, /<!DOCTYPE html>/i, file);
    assert.match(html, /\/assets\/logo.png/, file);
  }
});
test('export includes shell, not hardcoded sample orders or live database data', async () => {
  const html = await readFile(new URL('orders/index.html',output),'utf8');
  assert.doesNotMatch(html, /Укладка плитки в ванной комнате/);
  assert.match(html, /Фильтры/);
  assert.match(html, /metrika\.yandex\.ru\/stat\/\?id=21668143/);
  assert.match(html, /informer\.yandex\.ru\/informer\/21668143/);
  assert.match(html, /mc\.yandex\.ru\/metrika\/tag\.js/);
  assert.match(html, /ym\(21668143,'init'/);
  for (const name of ['logo.png','nm-back.gif','bg-add.png','sw-b-l.png']) assert.ok((await stat(new URL('assets/'+name,output))).size>0);
});
