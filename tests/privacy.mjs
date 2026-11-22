import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
async function reveal(page){await page.locator('#cover').waitFor();await page.locator('#cover').click({clickCount:3,position:{x:30,y:200}});await page.locator('#cover').waitFor({state:'hidden'});}
const browser=await (process.env.PRIVACY_BROWSER==='webkit'?webkit:chromium).launch();
try {
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});const page=await context.newPage();
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

await page.clock.install({time:new Date('2026-11-20T04:00:00Z')});
page.on('dialog',dialog=>dialog.accept());
async function openPrivate(){await page.clock.runFor(450);await reveal(page);}
await page.goto('http://127.0.0.1:4181/');
assert.ok(await page.locator('#cover').isVisible());assert.equal(await page.locator('main').evaluate(el=>el.inert),true);assert.equal(await page.title(),'The Evening Times');
await openPrivate();await page.locator('#email').fill('me@example.com');await page.locator('#password').fill('test-password');await page.locator('#login').click();await page.locator('#edit').waitFor();
await page.locator('#edit').click();await page.locator('#title').fill('private title');await page.locator('#editor').fill(Array.from({length:45},(_,i)=>'private line '+i).join('\n'));await page.locator('#save').click();await page.locator('#edit').waitFor();
await page.evaluate(()=>new Promise(resolve=>{if(scrollY===450){resolve();return;}const done=()=>{if(scrollY===450){document.removeEventListener('scroll',done);resolve();}};document.addEventListener('scroll',done);window.scrollTo(0,450);}));const position=await page.evaluate(()=>scrollY),cloud=await page.evaluate(()=>localStorage.getItem('mock-cloud'));
await page.clock.runFor(100);await page.clock.runFor(119000);assert.ok(await page.locator('#cover').isHidden());await page.keyboard.press('Shift');
await page.clock.runFor(100);await page.clock.runFor(119000);assert.ok(await page.locator('#cover').isHidden());await page.clock.runFor(1100);await page.locator('#cover').waitFor();assert.equal(await page.locator('main').evaluate(el=>el.inert),true);
assert.equal(await page.evaluate(()=>localStorage.getItem('mock-cloud')),cloud);await openPrivate();assert.ok(Math.abs((await page.evaluate(()=>scrollY))-position)<2);
await page.locator('#edit').click();await page.locator('#title').fill('unsaved private draft');await page.clock.runFor(120100);await page.locator('#cover').waitFor();await openPrivate();assert.equal(await page.locator('#title').inputValue(),'unsaved private draft');assert.ok(await page.locator('#editing').isVisible());
// Simulate mobile background/foreground lifecycle, including back-forward cache restoration.
await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await page.locator('#cover').waitFor();
await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});assert.ok(await page.locator('#cover').isVisible());await openPrivate();assert.equal(await page.locator('#title').inputValue(),'unsaved private draft');
await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await page.locator('#cover').waitFor();await openPrivate();
await page.locator('#cancel').click();await page.locator('#accountSettings').click();await page.locator('#newPassword').fill('not-submitted-password');await page.clock.runFor(120100);await page.locator('#cover').waitFor();assert.ok(!(await page.locator('#passwordDialog').evaluate(el=>el.open)));
await page.reload();assert.ok(await page.locator('#cover').isVisible());assert.equal(await page.locator('main').evaluate(el=>el.inert),true);
console.log('PASS: news-first startup and reload; triple-click reveal; idle 2-minute cover; activity extends timeout; scroll and drafts preserved; background and bfcache cover; foreground remains covered; account dialog hidden on idle; no cloud content change');
} finally { await browser.close(); }
