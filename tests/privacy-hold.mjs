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
async function held(){return await button.getAttribute('aria-pressed')==='true';}
async function hold(){await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.clock.runFor(700);await page.mouse.up();}
async function visibility(state){await page.evaluate(state=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>state});document.dispatchEvent(new Event('visibilitychange'));},state);}
assert.equal(await held(),false);
// A short click remains password settings; holding must not open it.
await button.click();assert.ok(await page.locator('#passwordDialog').evaluate(el=>el.open));await page.locator('#closePasswordDialog').click();await hold();assert.ok(await held());assert.equal(await button.evaluate(el=>getComputedStyle(el).color),'rgb(128, 184, 239)');assert.ok(!await page.locator('#passwordDialog').evaluate(el=>el.open));
await page.clock.runFor(600000);assert.ok(await page.locator('#cover').isHidden());await page.locator('[data-page="1"]').click();assert.ok(await held());assert.ok(await page.locator('#cover').isHidden());
await page.locator('#edit').click();await page.locator('#editor').fill('held draft');await page.locator('#cancel').click();assert.ok(await held());
await visibility('hidden');assert.ok(await page.locator('#cover').isHidden());await visibility('visible');await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));assert.ok(await page.locator('#cover').isHidden());
// Unhold starts a fresh two-minute interval, never an immediate stale timeout.
await hold();assert.equal(await held(),false);assert.equal(await button.evaluate(el=>getComputedStyle(el).color),'rgb(102, 102, 102)');await page.clock.runFor(119000);assert.ok(await page.locator('#cover').isHidden());await page.clock.runFor(1200);await page.locator('#cover').waitFor();await openPrivate();
// Rich-text editing pauses cover and ignores the hold gesture, even after long inactivity.
await page.locator('#edit').click();await page.locator('#title').fill('unsaved title');await page.locator('#editor').fill('unsaved body');await hold();assert.equal(await held(),false);assert.ok(!await page.locator('#passwordDialog').evaluate(el=>el.open));await page.clock.runFor(600000);assert.ok(await page.locator('#cover').isHidden());await visibility('hidden');assert.ok(await page.locator('#cover').isHidden());await visibility('visible');assert.equal(await page.locator('#editor').innerText(),'unsaved body');await page.locator('#cancel').click();
await page.clock.runFor(119000);assert.ok(await page.locator('#cover').isHidden());await page.clock.runFor(1200);await page.locator('#cover').waitFor();await openPrivate();
// Markdown editing has the same protection and resumes the policy when closed.
await page.locator('#markdownButton').click();await page.locator('#markdownText').fill('## unsaved Markdown');await hold();assert.equal(await held(),false);await page.clock.runFor(600000);assert.ok(await page.locator('#cover').isHidden());await visibility('hidden');assert.ok(await page.locator('#cover').isHidden());await visibility('visible');assert.equal(await page.locator('#markdownText').inputValue(),'## unsaved Markdown');await page.locator('#markdownCancel').click();
// Synthetic touch Pointer Events exercise the same hold path, with the generated click suppressed.
await page.clock.runFor(1000);await button.dispatchEvent('pointerdown',{button:0,pointerType:'touch',pointerId:77,clientX:300,clientY:40});await page.clock.runFor(700);await button.dispatchEvent('pointerup',{button:0,pointerType:'touch',pointerId:77,clientX:300,clientY:40});await button.dispatchEvent('click');assert.ok(await held());assert.ok(!await page.locator('#passwordDialog').evaluate(el=>el.open));
// Manual triple cover is still available while held; returning keeps the blue hold.
await page.clock.runFor(450);await page.locator('#reading').click({clickCount:3,position:{x:20,y:30}});await page.locator('#cover').waitFor();await openPrivate();assert.ok(await held());
await hold();assert.equal(await held(),false);await visibility('hidden');await page.locator('#cover').waitFor();await visibility('visible');assert.ok(await page.locator('#cover').isVisible());await openPrivate();
// Movement/cancellation cannot accidentally activate the hold.
await button.dispatchEvent('pointerdown',{button:0,pointerType:'touch',pointerId:78,clientX:300,clientY:40});await button.dispatchEvent('pointermove',{pointerType:'touch',pointerId:78,clientX:325,clientY:40});await page.clock.runFor(700);await button.dispatchEvent('pointercancel',{pointerType:'touch',pointerId:78});assert.equal(await held(),false);
// Keyboard Space supports the same deliberate hold.
await page.clock.runFor(1000);await button.focus();await page.keyboard.down('Space');await page.clock.runFor(700);await page.keyboard.up('Space');assert.ok(await held());assert.ok(!await page.locator('#passwordDialog').evaluate(el=>el.open));await page.screenshot({path:'/tmp/privacy-hold-'+(process.env.PRIVACY_BROWSER||'chromium')+'.png'});
assert.equal(await page.evaluate(()=>localStorage.getItem('mock-cloud')),null);await page.reload();await page.locator('#cover').waitFor();await openPrivate();assert.equal(await held(),false);
console.log('PASS hold: mouse/touch-pointer/keyboard hold; blue state; movement cancellation; click suppression; idle/background/internal navigation; manual triple cover; rich-text/Markdown editing protected; fresh two-minute resume; reload resets; cloud untouched');
}finally{await browser.close();}
