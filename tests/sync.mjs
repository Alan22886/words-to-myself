import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch();
let cloud=null;
const pages=[];
const sdk=`
const user={uid:'same-user'};
const auth={currentUser:localStorage.getItem('mock-auth')?user:null,authStateReady:async()=>{}};
let app;export const browserLocalPersistence={};
export const getApps=()=>app?[app]:[];
export const initializeApp=config=>(app={options:config});
export const deleteApp=async()=>{app=null};
export const getAuth=()=>auth;export const getDatabase=()=>({});
export const setPersistence=async()=>{};
export const signInWithEmailAndPassword=async()=>{auth.currentUser=user;localStorage.setItem('mock-auth','yes');return {user}};
export const ref=(db,path)=>path;
export const get=async()=>{const data=await window.cloudGet();return {val:()=>data}};
export const onValue=(path,fn)=>{
 if(path==='.info/connected'){queueMicrotask(()=>fn({val:()=>true}));const listener=e=>fn({val:()=>e.detail});window.addEventListener('mock-connected',listener);return ()=>window.removeEventListener('mock-connected',listener);}
 const listener=e=>fn({val:()=>e.detail});window.addEventListener('mock-update',listener);
 window.cloudGet().then(value=>fn({val:()=>value}));
 return ()=>window.removeEventListener('mock-update',listener);
};
export const runTransaction=async(path,update)=>{
 const old=await window.cloudGet(),payload=update(old);
 if(payload===undefined)return {committed:false,snapshot:{val:()=>old}};
 const result=await window.cloudCommit(old,payload);
 return {committed:result.committed,snapshot:{val:()=>result.value}};
};`;
async function newPage(){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const page=await context.newPage();pages.push(page);
 await page.exposeFunction('cloudGet',()=>cloud);
 await page.exposeFunction('cloudCommit',async(old,payload)=>{
  if(JSON.stringify(old)!==JSON.stringify(cloud))return {committed:false,value:cloud};
  cloud=payload;
  await Promise.all(pages.map(p=>p.evaluate(value=>window.dispatchEvent(new CustomEvent('mock-update',{detail:value})),cloud)));
  return {committed:true,value:cloud};
 });
 await page.route('https://www.gstatic.com/firebasejs/**',route=>route.fulfill({contentType:'text/javascript',body:sdk}));
 await page.goto('http://127.0.0.1:4181/');
 await page.locator('#email').fill('same@example.com');await page.locator('#password').fill('shared-password');await page.locator('#login').click();
 await page.locator('#edit').waitFor();await page.waitForFunction(()=>document.querySelector('#status').textContent==='已同步');return page;
}
async function edit(page,title){await page.locator('#edit').click();await page.locator('#title').fill(title);}
async function reading(page,text){await page.waitForFunction(text=>document.querySelector('#reading').textContent.includes(text),text);}
try{
 const a=await newPage(),b=await newPage();
 await edit(a,'第一版');await a.locator('#editor').fill('今天认真做事');await a.locator('#addTodo').click();
 await a.keyboard.type('完成一个任务');await a.locator('#save').click();await reading(b,'完成一个任务');
 assert.ok(!JSON.stringify(cloud).includes('完成一个任务'));
 await b.locator('#reading input[type=checkbox]').check();
 await a.waitForFunction(()=>document.querySelector('#reading input')?.checked);
 await edit(a,'电脑草稿');await edit(b,'手机先保存');await b.locator('#save').click();
 await a.locator('#conflictActions').waitFor();assert.equal(await a.locator('#title').inputValue(),'电脑草稿');
 assert.ok(!(await a.locator('#editing').isHidden()));
 a.once('dialog',dialog=>dialog.accept());await a.locator('#useMine').click();await reading(b,'电脑草稿');
 await edit(a,'应当丢弃');await edit(b,'另一端最终内容');await b.locator('#save').click();await a.locator('#conflictActions').waitFor();
 a.once('dialog',dialog=>dialog.accept());await a.locator('#useRemote').click();await reading(a,'另一端最终内容');
 // Offline saves retain the current editor and never replace the server value.
 await edit(a,'离线草稿');await a.evaluate(()=>window.dispatchEvent(new CustomEvent('mock-connected',{detail:false})));
 const before=JSON.stringify(cloud);await a.locator('#save').click();assert.equal(JSON.stringify(cloud),before);assert.equal(await a.locator('#title').inputValue(),'离线草稿');
 await a.evaluate(()=>window.dispatchEvent(new CustomEvent('mock-connected',{detail:true})));await a.locator('#save').click();await reading(b,'离线草稿');
 // A real touch double tap opens the cover without changing the page scale.
 const heading=b.locator('#reading h1'),bounds=await heading.boundingBox();
 await b.touchscreen.tap(bounds.x+30,bounds.y+15);await b.touchscreen.tap(bounds.x+30,bounds.y+15);
 await b.locator('#cover').waitFor();assert.equal(await b.evaluate(()=>window.visualViewport.scale),1);
 assert.equal(await b.locator('main').evaluate(el=>getComputedStyle(el).visibility),'hidden');
 assert.equal(await b.locator('#cover img,#cover button,#cover time').count(),0);
 await b.locator('#cover').evaluate(el=>el.scrollTop=500);assert.ok(await b.locator('#cover').evaluate(el=>el.scrollTop>0));
 // Move far enough from the entry tap to begin an independent gesture.
 await new Promise(resolve=>setTimeout(resolve,420));
 await b.touchscreen.tap(100,300);await b.touchscreen.tap(100,300);await b.locator('#cover').waitFor({state:'hidden'});
 assert.ok(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await b.locator('#reading h1').evaluate(el=>el.textContent='x'.repeat(500));assert.ok(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await b.screenshot({path:'/tmp/reminder-new-mobile.png'});
 console.log('PASS: two-device realtime updates; checkbox autosave; both conflict choices; offline draft; touch cover enter/scroll/exit; zoom locked; no horizontal overflow');
}finally{await browser.close();}
