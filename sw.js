const name='one-page-shell-dev';
const files=['./','./index.html','./style.css','./app.js','./config.js','./icon.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(name);
  await cache.addAll(files.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  await self.clients.claim();
  const names=await caches.keys();
  await Promise.all(names.filter(key=>key.startsWith('one-page-shell-')&&key!==name).map(key=>caches.delete(key)));
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),scope=new URL(self.registration.scope);
  if(event.request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  const path=url.pathname.slice(scope.pathname.length);
  if(!['','index.html','app.js','config.js','style.css','icon.svg','manifest.webmanifest'].includes(path))return;
  // A release shell stays internally consistent until a complete new worker installs.
  event.respondWith(caches.open(name).then(async cache=>
    (await cache.match(event.request,{ignoreSearch:true}))||fetch(event.request)));
});
