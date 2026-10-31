import Script from 'next/script';

const counterId = 21668143;

export function YandexMetrikaInformer() {
  return (
    <a
      className="yandex-metrika-informer"
      href={`https://metrika.yandex.ru/stat/?id=${counterId}&from=informer`}
      target="_blank"
      rel="nofollow noopener noreferrer"
    >
      <img
        src={`https://informer.yandex.ru/informer/${counterId}/3_1_FFFFFFFF_EFEFEFFF_0_pageviews`}
        width="88"
        height="31"
        alt="Яндекс.Метрика"
        title="Яндекс.Метрика: данные за сегодня (просмотры, визиты и уникальные посетители)"
        className="ym-advanced-informer"
        data-cid={counterId}
        data-lang="ru"
      />
    </a>
  );
}

export function YandexMetrika() {
  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">
        {`(function(m,e,t,r,i,k,a){
  m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
  m[i].l=1*new Date();
  for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}
  k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a);
})(window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym');
ym(${counterId},'init',{webvisor:true,clickmap:true,referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true});`}
      </Script>
      <noscript>
        <div>
          <img
            className="yandex-metrika-noscript"
            src={`https://mc.yandex.ru/watch/${counterId}`}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
