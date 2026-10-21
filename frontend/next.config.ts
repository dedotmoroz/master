import type { NextConfig } from 'next';
export default function config(phase: string): NextConfig {
  const development=phase==='phase-development-server';
  const api=new URL(process.env.API_PROXY_TARGET||'http://127.0.0.1:3000');
  if(!['http:','https:'].includes(api.protocol)||api.username||api.password)throw new Error('Invalid API_PROXY_TARGET');
  return {
  output: development ? undefined : 'export',
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  ...(development ? {rewrites: async()=>[
    {source:'/api/v1/:resource(orders|contractors|work-categories|regions|locations)',destination:`${api.origin}/api/v1/:resource`},
    {source:'/api/v1/:resource(orders|contractors)/:id',destination:`${api.origin}/api/v1/:resource/:id`},
    {source:'/api/v1/auth/:action(registrations|login-requests|me|session|sessions|email-change-requests|account-deletion-requests)',destination:`${api.origin}/api/v1/auth/:action`},
    {source:'/api/v1/auth/:action(registrations|login-requests|email-change-requests|account-deletion-requests)/confirm',destination:`${api.origin}/api/v1/auth/:action/confirm`},
    {source:'/api/v1/guest-orders',destination:`${api.origin}/api/v1/guest-orders`},
    {source:'/api/v1/guest-orders/confirm',destination:`${api.origin}/api/v1/guest-orders/confirm`},
    {source:'/api/v1/customer/orders',destination:`${api.origin}/api/v1/customer/orders`},
    {source:'/api/v1/customer/orders/:id',destination:`${api.origin}/api/v1/customer/orders/:id`},
    {source:'/api/v1/customer/orders/:id/cancel',destination:`${api.origin}/api/v1/customer/orders/:id/cancel`},
    {source:'/api/v1/orders/:id/bids',destination:`${api.origin}/api/v1/orders/:id/bids`},
    {source:'/api/v1/customer/orders/:id/bids',destination:`${api.origin}/api/v1/customer/orders/:id/bids`},
    {source:'/api/v1/customer/orders/:id/bids/:bidId/select',destination:`${api.origin}/api/v1/customer/orders/:id/bids/:bidId/select`},
    {source:'/api/v1/contractor/bids',destination:`${api.origin}/api/v1/contractor/bids`},
    {source:'/api/v1/contractor/bids/:id/withdraw',destination:`${api.origin}/api/v1/contractor/bids/:id/withdraw`},
    {source:'/api/v1/bids/:id/messages',destination:`${api.origin}/api/v1/bids/:id/messages`},
    {source:'/api/v1/orders/:id/:action(deal|complete|reviews)',destination:`${api.origin}/api/v1/orders/:id/:action`},
    {source:'/api/v1/contractors/:id/reviews',destination:`${api.origin}/api/v1/contractors/:id/reviews`},
    {source:'/api/v1/contractor/profile',destination:`${api.origin}/api/v1/contractor/profile`},
    {source:'/api/v1/notifications',destination:`${api.origin}/api/v1/notifications`},
    {source:'/api/v1/notifications/:id/read',destination:`${api.origin}/api/v1/notifications/:id/read`},
    {source:'/api/v1/notification-preferences',destination:`${api.origin}/api/v1/notification-preferences`},
    {source:'/api/v1/attachments/upload-requests',destination:`${api.origin}/api/v1/attachments/upload-requests`},
    {source:'/api/v1/guest-attachments/upload-requests',destination:`${api.origin}/api/v1/guest-attachments/upload-requests`},
    {source:'/api/v1/guest-attachments/:id/confirm',destination:`${api.origin}/api/v1/guest-attachments/:id/confirm`},
    {source:'/api/v1/attachments/:id/:action(confirm|preview-url|download-url|owner-preview-url|owner-download-url)',destination:`${api.origin}/api/v1/attachments/:id/:action`},
  ]} : {}),
  };
}
