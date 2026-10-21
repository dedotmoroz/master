'use client';
import { useSearchParams } from 'next/navigation';
import { Catalog } from './catalog';
import type { CatalogView, SearchParams } from '../lib/catalog';

export function CatalogFromUrl({ view }: { view: CatalogView }) {
  const query = useSearchParams();
  const params: SearchParams = {};
  for (const key of ['q', 'regionId', 'categoryId', 'budget', 'sort', 'page']) {
    const values = query.getAll(key);
    if (values.length) params[key] = values.length === 1 ? values[0] : values;
  }
  return <Catalog view={view} params={params}/>;
}
