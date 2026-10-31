import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Header } from '../components/header';
import { AuthProvider } from '../components/auth-provider';
import { NotificationProvider } from '../components/notification-provider';
import { YandexMetrika, YandexMetrikaInformer } from '../components/yandex-metrika';
import './globals.css';
import './next-overrides.css';
export const metadata: Metadata = { title: {default:'Найти мастера',template:'%s — Найти мастера'}, referrer:'no-referrer', description:'Сервис поиска мастеров для ремонта и строительства.' };
export default function RootLayout({children}:{children:ReactNode}) {
  return (
    <html lang="ru">
      <body>
        <AuthProvider>
          <NotificationProvider>
            <Header />
            <main className="container" id="main">{children}</main>
            <footer className="container footer">
              <span>© Найти мастера</span>
              <span>Ремонт и строительство · Россия</span>
              <span>Локальная версия</span>
              <YandexMetrikaInformer />
            </footer>
          </NotificationProvider>
        </AuthProvider>
        <YandexMetrika />
      </body>
    </html>
  );
}
