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


const button=page.locator('#accountSettings');
await page.locator('#edit').click();await page.locator('#editor').fill(('A quiet sentence to read while scrolling. 向下阅读时，锁头应一直跟着页面。\n').repeat(180));await page.locator('#save').click();await page.locator('#edit').waitFor();
const cloud=await page.evaluate(()=>localStorage.getItem('mock-cloud'));
async function hold(){const b=await button.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.clock.runFor(700);await page.mouse.up();}
async function scrollTo(y){await page.evaluate(y=>window.scrollTo(0,y),y);await page.clock.runFor(100);await page.waitForFunction(y=>document.querySelector('#accountSettings').dataset.floatingLock===String(y>24),y);}
await scrollTo(0);assert.ok(await page.locator('.version-number').isVisible());assert.ok(await page.locator('.version-lock-icon').isHidden());assert.equal(await button.evaluate(el=>getComputedStyle(el).position),'relative');
await hold();assert.equal(await button.getAttribute('aria-pressed'),'true');
await scrollTo(1500);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-1500)<4);assert.ok(await page.locator('.version-number').isHidden());assert.ok(await page.locator('.version-lock-icon').isVisible());assert.equal(await button.evaluate(el=>getComputedStyle(el).position),'fixed');assert.equal(await button.evaluate(el=>getComputedStyle(el).color),'rgb(128, 184, 239)');
async function geometry(){return page.evaluate(()=>{const lock=document.querySelector('#accountSettings').getBoundingClientRect(),minus=document.querySelector('#readingSmaller').getBoundingClientRect(),plus=document.querySelector('#readingLarger').getBoundingClientRect();return {top:lock.top,right:innerWidth-lock.right,width:lock.width,height:lock.height,gap:minus.left-lock.right,aligned:Math.abs(lock.top-minus.top),plusGap:plus.left-minus.right};});}
const floating=await geometry();assert.ok(floating.width>=40&&floating.height>=40);assert.ok(floating.gap>=10);assert.ok(floating.aligned<1);assert.ok(floating.plusGap>=16);
await scrollTo(3000);assert.deepEqual(await geometry(),floating);await page.clock.runFor(180000);assert.ok(await page.locator('#cover').isHidden());
// Unlock and relock from the middle of the article, without scrolling back to the header.
await hold();assert.equal(await button.getAttribute('aria-pressed'),'false');assert.ok(!await page.locator('#passwordDialog').evaluate(el=>el.open));await page.clock.runFor(119000);assert.ok(await page.locator('#cover').isHidden());await page.clock.runFor(1200);await page.locator('#cover').waitFor();await openPrivate();assert.equal(await button.getAttribute('data-floating-lock'),'true');
await hold();assert.equal(await button.getAttribute('aria-pressed'),'true');await page.locator('#readingLarger').click();await page.clock.runFor(100);assert.equal(await button.getAttribute('data-floating-lock'),'true');assert.equal(await button.getAttribute('aria-pressed'),'true');await page.screenshot({path:'/tmp/floating-lock-'+(process.env.PRIVACY_BROWSER||'chromium')+'.png'});
await scrollTo(0);assert.ok(await page.locator('.version-number').isVisible());assert.ok(await page.locator('.version-lock-icon').isHidden());assert.equal(await button.getAttribute('aria-pressed'),'true');assert.equal(await button.evaluate(el=>getComputedStyle(el).color),'rgb(128, 184, 239)');
// Normal editing retains the header version and the existing editing protection.
await page.locator('#edit').click();assert.equal(await button.getAttribute('data-floating-lock'),'false');assert.ok(await page.locator('.version-number').isVisible());await page.locator('#cancel').click();await scrollTo(1500);assert.equal(await button.getAttribute('data-floating-lock'),'true');
assert.equal(await page.evaluate(()=>localStorage.getItem('mock-cloud')),cloud);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
console.log('PASS floating lock: version at top, same button becomes lock after scrolling; fixed left of size controls with stable geometry; blue state retained; long-hold unlock/relock from mid-page; fresh idle timeout; editing header; no cloud writes');
}finally{await browser.close();}
