import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
async function reveal(page){await page.locator('#cover').waitFor();await page.locator('#cover').click({clickCount:3,position:{x:30,y:200}});await page.locator('#cover').waitFor({state:'hidden'});}
const browser=await (process.env.READER_BROWSER==='webkit'?webkit:chromium).launch();
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


await page.goto('http://127.0.0.1:4181/');
await page.waitForFunction(()=>document.querySelector('#cover').dataset.readerIndex!==undefined);
assert.equal(await page.locator('.reader-section').count(),30);assert.equal(await page.locator('#cover img,#cover button,#cover time').count(),0);
const stats=await page.locator('#cover').evaluate(el=>({height:el.scrollHeight,view:el.clientHeight,words:el.textContent.trim().split(/\s+/).length,index:el.dataset.readerIndex}));assert.ok(stats.height>stats.view*15);assert.ok(stats.words>1800);
await page.locator('#cover').click({clickCount:2,position:{x:30,y:200}});assert.ok(await page.locator('#cover').isVisible());await reveal(page);
await page.locator('#email').fill('me@example.com');await page.locator('#password').fill('test-password');await page.locator('#login').click();await page.locator('#edit').waitFor();assert.equal(await page.title(),'word 2 myself');const manifest=await page.evaluate(()=>fetch('manifest.webmanifest').then(response=>response.json()));assert.equal(manifest.name,'word 2 myself');
await page.locator('#edit').click();await page.locator('#editor').fill('one task');await page.locator('#addTodo').click();await page.locator('#save').click();await page.locator('#edit').waitFor();
// No flash: the footer, page tabs and sync SVG keep their identity and enabled styling.
await page.evaluate(()=>{window.quietMutations=[];window.quietSvg=document.querySelector('#status svg');new MutationObserver(records=>window.quietMutations.push(...records.map(record=>({id:record.target.id,attribute:record.attributeName})))).observe(document.querySelector('footer'),{attributes:true,subtree:true,childList:true});new MutationObserver(records=>window.quietMutations.push(...records.map(record=>({id:record.target.id,attribute:record.attributeName})))).observe(document.querySelector('.page-tabs'),{attributes:true,subtree:true,childList:true});});
await page.locator('#reading input').check();await page.waitForFunction(()=>document.querySelector('#status').getAttribute('aria-label')==='已同步');
const quiet=await page.evaluate(()=>({svgSame:window.quietSvg===document.querySelector('#status svg'),disabledChanges:window.quietMutations.filter(record=>record.attribute==='disabled').length,disabled:!!document.querySelector('footer button:disabled,.page-tabs button:disabled')}));assert.equal(quiet.svgSame,true);assert.equal(quiet.disabledChanges,0);assert.equal(quiet.disabled,false);
await page.locator('#reading').click({clickCount:2,position:{x:20,y:100}});assert.ok(await page.locator('#cover').isHidden());
let last=stats.index;
for(let i=0;i<6;i++){
 await page.waitForTimeout(450);await page.locator('#reading').click({clickCount:3,position:{x:20,y:100}});await page.locator('#cover').waitFor();
 await page.waitForFunction(previous=>document.querySelector('#cover').dataset.readerIndex!==previous,last);const current=await page.locator('#cover').getAttribute('data-reader-index');assert.notEqual(current,last);last=current;
 const heading=await page.locator('.reader-section').nth(Number(current)).boundingBox();assert.ok(heading.y>=0&&heading.y<60);
 if(i===0)await page.screenshot({path:'/tmp/word-2-myself-reader.png'});
 await page.waitForTimeout(450);await reveal(page);
}
await page.locator('#edit').click();await page.locator('#editor').click({clickCount:3,position:{x:25,y:25}});assert.ok(await page.locator('#cover').isHidden());
console.log('PASS reader: 30 independent original sections, >1800 words, long scroll, no images/buttons/dates; two clicks do nothing; three clicks switch; six entries avoid immediate repeats and align section headings; editor selection remains; checkbox does not disable footer/tabs or replace sync SVG');
} finally { await browser.close(); }
