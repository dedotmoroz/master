import {Suspense} from 'react';
import {SessionGate} from '../../../components/session-gate';
import {OwnBids} from '../../../components/bids';
export const metadata={title:'Мои отклики',robots:{index:false,follow:false}};
export default function Bids(){return <Suspense fallback={<p role="status">Загрузка…</p>}><SessionGate><OwnBids/></SessionGate></Suspense>;}
