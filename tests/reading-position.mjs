import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
async function reveal(page){await page.locator('#cover').waitFor();await page.locator('#cover').click({clickCount:3,position:{x:30,y:200}});await page.locator('#cover').waitFor({state:'hidden'});}
const browser=await (process.env.EDIT_BROWSER==='webkit'?webkit:chromium).launch();
try {
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>console.error('PAGE',error.message));
await page.route('https://www.gstatic.com/firebasejs/**',route=>route.fulfill({contentType:'text/javascript',body:`
const user={uid:'test-user'};
const auth={currentUser:localStorage.getItem('mock-auth')?user:null,authStateReady:async()=>{}};
let app; export const browserLocalPersistence={};
export const getApps=()=>app?[app]:[];
export const initializeApp=config=>(app={options:config});
export const deleteApp=async()=>{app=null};
export const getAuth=()=>auth;
export const getDatabase=()=>({});
export const setPersistence=async()=>{};
export const signInWithEmailAndPassword=async(a,email,password)=>{if(password!=='test-password')throw Object.assign(Error('bad'),{code:'auth/invalid-credential'});localStorage.setItem('mock-auth','yes');auth.currentUser=user;return {user}};
export const signOut=async()=>{auth.currentUser=null;localStorage.removeItem('mock-auth')};
export const ref=(db,path)=>path;
const value=()=>JSON.parse(localStorage.getItem('mock-cloud')||'null');
export const get=async()=>({val:value});
export const onValue=(path,fn)=>{queueMicrotask(()=>fn({val:()=>path==='.info/connected'?true:value()}));return ()=>{}};
export const runTransaction=async(path,update)=>{const result=update(value());if(result!==undefined)localStorage.setItem('mock-cloud',JSON.stringify(result));return {committed:result!==undefined,snapshot:{val:value}}};
`}));
await page.goto('http://127.0.0.1:4181/');await reveal(page);
await page.locator('#email').fill('me@example.com');await page.locator('#password').fill('wrong-password');await page.locator('#login').click();
await page.getByRole('alert').filter({hasText:'邮箱或密码不正确'}).waitFor();
await page.locator('#password').fill('test-password');await page.locator('#login').click();await Promise.race([page.locator('#edit').waitFor(),page.waitForFunction(()=>document.querySelector('#notice').textContent.length>0).then(async()=>{throw Error(await page.locator('#notice').textContent());})]);
assert.equal(await page.locator('#password').inputValue(),'');



await page.locator('#edit').click();await page.locator('#title').fill('A long reading page');
await page.locator('#editor').evaluate(el=>{
 const long='在这一段很长的文字里，我们希望每次调整字号之后，都能继续从刚才读到的地方往下阅读，不需要再寻找位置。 A calm reader follows one sentence at a time. '.repeat(140);
 el.innerHTML='<h2>Opening</h2><p>'+long+'</p>'+Array.from({length:70},(_,i)=>'<p><b>Paragraph '+i+'</b> '+('Every small step matters. Reading slowly can be enough. ').repeat(5)+'</p>').join('');
});await page.locator('#save').click();await page.locator('#edit').waitFor();
const cloud=await page.evaluate(()=>localStorage.getItem('mock-cloud'));
async function settle(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function snapshot(){return page.locator('#readingSize').evaluate(el=>{const a=el.getBoundingClientRect(),buttons=[...el.querySelectorAll('button')].map(n=>n.getBoundingClientRect());return {top:a.top,right:innerWidth-a.right,gap:buttons[1].left-buttons[0].right,size:buttons[0].width,position:getComputedStyle(el).position};});}
const control=await snapshot();assert.equal(control.position,'fixed');assert.ok(control.gap>=16);assert.ok(control.size>=40);
await page.evaluate(()=>window.scrollTo(0,4000));await settle();assert.deepEqual(await snapshot(),control);
// Track the actual first visible character deep inside ONE long paragraph.
async function markTop(){return page.locator('#reading').evaluate(root=>{
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;
 while(n=walker.nextNode()){
  if(!n.textContent.trim())continue;const r=document.createRange();r.selectNodeContents(n);if(![...r.getClientRects()].some(x=>x.bottom>1&&x.top<innerHeight))continue;
  for(let i=0;i<n.length;i++){r.setStart(n,i);r.setEnd(n,i+1);const rect=r.getBoundingClientRect();if(rect.bottom>1&&rect.top<innerHeight&&rect.width>0&&n.textContent[i].trim()){window.testReadingAnchor=r.cloneRange();return {top:rect.top,offset:i,context:n.textContent.slice(i,i+25)};}}
 }
 throw Error('No visible text');
});}
async function resize(name){const before=await markTop();await page.getByRole('button',{name,exact:true}).click();await settle();const top=await page.evaluate(()=>testReadingAnchor.getBoundingClientRect().top);assert.ok(Math.abs(top-before.top)<3,JSON.stringify({before,top,name,scroll:await page.evaluate(()=>scrollY)}));assert.deepEqual(await snapshot(),control);assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('overflow-anchor')),'');return before;}
const middle=await resize('放大阅读字号');assert.ok(middle.offset>100,'Must test a wrapped line inside the paragraph, not a block start');
await resize('放大阅读字号');await resize('缩小阅读字号');await resize('缩小阅读字号');
await page.setViewportSize({width:900,height:900});await page.evaluate(()=>window.scrollTo(0,0));await settle();assert.ok(await page.evaluate(()=>document.querySelector('#accountSettings').getBoundingClientRect().right+8<=document.querySelector('#readingSize').getBoundingClientRect().left));
await page.setViewportSize({width:1280,height:900});await settle();await page.evaluate(()=>window.scrollTo(0,Math.floor(document.documentElement.scrollHeight*.6)));await settle();await resize('放大阅读字号');await resize('缩小阅读字号');
// A size change followed immediately by a page switch must not pull the new page to an old anchor.
await page.evaluate(()=>{document.querySelector('#readingLarger').click();document.querySelector('[data-page="1"]').click();});await settle();assert.equal(await page.evaluate(()=>scrollY),0);assert.ok(await page.locator('#readingSize').isVisible());assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('overflow-anchor')),'');
await page.locator('[data-page="0"]').click();await settle();
// Clamp cleanly at page edges; repeated fast taps must leave no stale scroll-anchoring override.
await page.evaluate(()=>window.scrollTo(0,0));await page.locator('#readingLarger').click();await settle();assert.equal(await page.evaluate(()=>scrollY),0);
await page.evaluate(()=>{window.scrollTo(0,document.documentElement.scrollHeight);for(let i=0;i<4;i++)document.querySelector('#readingSmaller').click();});await settle();assert.ok(await page.evaluate(()=>Number.isFinite(scrollY)&&scrollY>=0&&scrollY<=document.documentElement.scrollHeight-innerHeight+1));assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('overflow-anchor')),'');
assert.equal(await page.evaluate(()=>localStorage.getItem('mock-cloud')),cloud);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,2500));await settle();await page.screenshot({path:'/tmp/reading-position-'+(process.env.EDIT_BROWSER||'chromium')+'.png'});
await page.locator('#edit').click();assert.ok(await page.locator('#readingSize').isHidden());await page.locator('#cancel').click();await page.locator('#markdownButton').click();assert.ok(await page.locator('#readingSize').isHidden());await page.locator('#markdownCancel').click();
await page.locator('#reading').click({clickCount:3,position:{x:20,y:30}});await page.locator('#cover').waitFor();assert.ok(!await page.locator('#readingSize').isVisible());
console.log('PASS reading position: fixed separated controls; wrapped-character anchor within 3px across zoom in/out on mobile and desktop; page-switch race; rapid taps; top/bottom clamping; hidden in editors/news; no cloud writes');
}finally{await browser.close();}
