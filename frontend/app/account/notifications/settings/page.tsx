import {SessionGate} from '../../../../components/session-gate';
import {NotificationSettings} from '../../../../components/notifications';
export const metadata={title:'Настройки уведомлений',robots:{index:false,follow:false}};
export default function Page(){return <SessionGate><NotificationSettings/></SessionGate>;}
