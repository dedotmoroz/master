import { Suspense } from 'react';
import { Catalog } from './catalog';
import { CatalogFromUrl } from './catalog-from-url';
import type { CatalogView } from '../lib/catalog';

// Export contains the static shell; live data is loaded only in the browser.
export function CatalogPage({ view }: { view: CatalogView }) {
  return <Suspense fallback={<Catalog view={view} params={{}}/>}>
    <CatalogFromUrl view={view}/>
  </Suspense>;
}
