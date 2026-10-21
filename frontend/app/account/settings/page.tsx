import {SessionGate} from '../../../components/session-gate';
import {AccountSettings} from '../../../components/account-settings';
export const metadata={title:'Настройки аккаунта',robots:{index:false,follow:false}};
export default function Page(){return <SessionGate><AccountSettings/></SessionGate>;}
