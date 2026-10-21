import {Suspense} from 'react';
import {Detail} from '../../../components/detail';
export const metadata={title:'Профиль мастера'};
export default function MasterPage(){return <Suspense fallback={<div className="empty" role="status">Загрузка записи…</div>}><Detail view="masters"/></Suspense>;}
