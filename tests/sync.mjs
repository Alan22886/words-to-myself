import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
async function reveal(page){await page.locator('#cover').waitFor();await page.locator('#cover').click({clickCount:3,position:{x:30,y:200}});await page.locator('#cover').waitFor({state:'hidden'});}
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
export const signOut=async()=>{auth.currentUser=null;localStorage.removeItem('mock-auth')};
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
 await page.goto('http://127.0.0.1:4181/');await reveal(page);
 await page.locator('#email').fill('same@example.com');await page.locator('#password').fill('shared-password');await page.locator('#login').click();
 await page.locator('#edit').waitFor();await page.waitForFunction(()=>document.querySelector('#status').textContent==='已同步');return page;
}
async function edit(page,title){await page.locator('#edit').click();assert.ok(await page.evaluate(()=>!['title','editor'].includes(document.activeElement.id)));await page.locator('#title').fill(title);}
async function reading(page,text){await page.waitForFunction(text=>document.querySelector('#reading').textContent.includes(text),text);}
try{
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode('shared-password'),'PBKDF2',false,['deriveKey']);
 const legacyKey=await crypto.subtle.deriveKey({name:'PBKDF2',salt:new TextEncoder().encode('one-page:v1:same-user'),iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt']);
 const legacyIV=crypto.getRandomValues(new Uint8Array(12));const legacyBytes=await crypto.subtle.encrypt({name:'AES-GCM',iv:legacyIV},legacyKey,new TextEncoder().encode(JSON.stringify({title:'legacy page',html:'<p>old content retained</p>',updated:12345})));
 cloud={v:1,iv:Buffer.from(legacyIV).toString('base64'),data:Buffer.from(legacyBytes).toString('base64')};
 const a=await newPage(),b=await newPage();await reading(a,'old content retained');assert.equal(await a.locator('[data-page]').count(),3);
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
 await b.touchscreen.tap(bounds.x+30,bounds.y+15);await b.touchscreen.tap(bounds.x+30,bounds.y+15);await b.touchscreen.tap(bounds.x+30,bounds.y+15);
 await b.locator('#cover').waitFor();assert.equal(await b.evaluate(()=>window.visualViewport.scale),1);
 assert.equal(await b.locator('main').evaluate(el=>getComputedStyle(el).visibility),'hidden');
 assert.equal(await b.locator('#cover img,#cover button,#cover time').count(),0);
 await b.locator('#cover').evaluate(el=>el.scrollTop=500);assert.ok(await b.locator('#cover').evaluate(el=>el.scrollTop>0));
 // Move far enough from the entry tap to begin an independent gesture.
 await new Promise(resolve=>setTimeout(resolve,420));
 await b.touchscreen.tap(100,300);await b.touchscreen.tap(100,300);await b.touchscreen.tap(100,300);await b.locator('#cover').waitFor({state:'hidden'});
 assert.ok(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await b.locator('#reading h1').evaluate(el=>el.textContent='x'.repeat(500));assert.ok(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));

 // Paste five actual lines, then convert without selecting them.
 await edit(a,'五行待办');await a.locator('#clearTitle').click();assert.equal(await a.locator('#title').inputValue(),'');assert.notEqual(await a.evaluate(()=>document.activeElement.id),'title');await a.locator('#title').fill('五行待办');await a.locator('#editor').fill('');await a.locator('#editor').focus();
 await a.locator('#editor').evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','one\ntwo\nthree\nfour\nfive');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 await a.locator('#addTodo').click();assert.equal(await a.locator('#editor .todo-row').count(),5);
 assert.equal(await a.locator('#editor .todo-row').nth(4).innerText(),'five');
 await a.keyboard.press('Enter');await a.keyboard.type('six');assert.equal(await a.locator('#editor .todo-row').count(),6);
 await a.keyboard.press('Enter');await a.keyboard.press('Enter');await a.keyboard.type('normal paragraph');
 assert.equal(await a.locator('#editor .todo-row').count(),6);assert.ok(!(await a.locator('#editor .todo-row').allInnerTexts()).join('').includes('normal paragraph'));
 // Only selected lines become tasks; surrounding content survives.
 await a.locator('#editor').evaluate(el=>{el.innerHTML='<div>one</div><div>two</div><div>three</div><div>four</div><div>five</div>';const range=document.createRange();range.setStart(el.children[1].firstChild,0);range.setEnd(el.children[3].firstChild,4);getSelection().removeAllRanges();getSelection().addRange(range);});
 await a.locator('#addTodo').click();assert.equal(await a.locator('#editor .todo-row').count(),3);assert.ok((await a.locator('#editor').innerText()).includes('one'));assert.ok((await a.locator('#editor').innerText()).includes('five'));
 await a.locator('#editor').evaluate(el=>{el.innerHTML='<div>prefix selected suffix</div>';const range=document.createRange();range.setStart(el.firstChild.firstChild,7);range.setEnd(el.firstChild.firstChild,15);getSelection().removeAllRanges();getSelection().addRange(range);});
 await a.locator('#addTodo').click();assert.equal(await a.locator('#editor .todo-row').count(),1);assert.ok((await a.locator('#editor').innerText()).includes('prefix'));assert.ok((await a.locator('#editor').innerText()).includes('suffix'));
 // Long list: checking does not swap layouts or move the viewport.
 await a.locator('#editor').fill(Array.from({length:35},(_,i)=>'task '+i).join('\n'));await a.locator('#addTodo').click();await a.locator('#save').click();await reading(b,'task 34');
 const checkbox=b.locator('#reading input').nth(15);await checkbox.scrollIntoViewIfNeeded();
 const scrollBefore=await b.evaluate(()=>window.scrollY);
 await b.evaluate(()=>{window.layoutSwapped=false;new MutationObserver(()=>{if(!document.querySelector('#editing').hidden)window.layoutSwapped=true;}).observe(document.querySelector('#editing'),{attributes:true,attributeFilter:['hidden']});});
 await checkbox.check();await b.waitForFunction(()=>document.querySelector('#status').textContent==='已同步');
 assert.ok(Math.abs((await b.evaluate(()=>window.scrollY))-scrollBefore)<2);assert.equal(await b.evaluate(()=>window.layoutSwapped),false);
 // Separate pages merge when saved concurrently.
 await b.locator('[data-page="1"]').click();await edit(a,'page one');await edit(b,'page two');
 await Promise.all([a.locator('#save').click(),b.locator('#save').click()]);
 await Promise.all([a.waitForFunction(()=>document.querySelector('#status').textContent==='已同步'),b.waitForFunction(()=>document.querySelector('#status').textContent==='已同步')]);
 assert.ok(await a.locator('#conflictActions').isHidden());assert.ok(await b.locator('#conflictActions').isHidden());
 await a.locator('[data-page="1"]').click();await reading(a,'page two');await b.locator('[data-page="0"]').click();await reading(b,'page one');
 // Exactly three slots and independent in-memory drafts.
 assert.equal(await a.locator('[data-page]').count(),3);
 await a.locator('[data-page="2"]').click();await edit(a,'third draft');await a.locator('#editor').fill('do not lose this');
 await a.locator('[data-page="0"]').click();await reading(a,'page one');await a.locator('[data-page="2"]').click();assert.equal(await a.locator('#title').inputValue(),'third draft');assert.equal(await a.locator('#editor').innerText(),'do not lose this');await a.locator('#save').click();
 await b.locator('[data-page="2"]').click();await reading(b,'third draft');
 // Blank bottom area also opens the cover; editor never does.
 await b.evaluate(()=>window.scrollTo(0,0));await new Promise(resolve=>setTimeout(resolve,420));
 await b.touchscreen.tap(20,680);await b.touchscreen.tap(20,680);await b.touchscreen.tap(20,680);await b.locator('#cover').waitFor();
 assert.ok((await b.locator('#cover').innerText()).includes('The Evening Times'));
 await b.screenshot({path:'/tmp/reminder-english-news.png'});
 await new Promise(resolve=>setTimeout(resolve,420));await b.touchscreen.tap(20,680);await b.touchscreen.tap(20,680);await b.touchscreen.tap(20,680);await b.locator('#cover').waitFor({state:'hidden'});
 await edit(b,'editor stays');const editorBox=await b.locator('#editor').boundingBox();await b.touchscreen.tap(editorBox.x+20,editorBox.y+30);await b.touchscreen.tap(editorBox.x+20,editorBox.y+30);await b.touchscreen.tap(editorBox.x+20,editorBox.y+30);assert.ok(await b.locator('#cover').isHidden());await b.touchscreen.tap(20,680);await b.touchscreen.tap(20,680);await b.touchscreen.tap(20,680);assert.ok(await b.locator('#cover').isHidden());
 await a.screenshot({path:'/tmp/reminder-three-pages.png'});
 const cloudBeforeLogout=JSON.stringify(cloud);b.once('dialog',dialog=>dialog.accept());await b.locator('#date').click();await b.locator('#loginForm').waitFor();
 assert.equal(await b.evaluate(()=>localStorage.getItem('one-page:v1')),null);assert.equal(JSON.stringify(cloud),cloudBeforeLogout);assert.equal(await b.locator('#reading').innerText(),'');
 await b.locator('#password').fill('shared-password');await b.locator('#login').click();await b.locator('#edit').waitFor();await b.locator('[data-page="2"]').click();await reading(b,'third draft');
 // Three text colors survive encryption and remote rendering.
 await edit(b,'colored text');await b.locator('#editor').fill('red blue white');
 for(const [start,end,color] of [[0,3,'红色'],[4,8,'蓝色'],[9,14,'白色']]){
   await b.locator('#editor').evaluate((el,{start,end})=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node,total=0,a,b;while(node=walker.nextNode()){if(!a&&total+node.length>start)a=[node,start-total];if(total+node.length>=end){b=[node,end-total];break;}total+=node.length;}const range=document.createRange();range.setStart(...a);range.setEnd(...b);getSelection().removeAllRanges();getSelection().addRange(range);},{start,end});
   await b.getByRole('button',{name:color,exact:true}).click();
 }
 await b.locator('#save').click();await reading(b,'colored text');
 const colors=await b.locator('#reading .body').evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),colors=[];let node;while(node=walker.nextNode())if(node.textContent.trim())colors.push(getComputedStyle(node.parentElement).color);return colors;});assert.ok(colors.includes('rgb(239, 115, 115)'));assert.ok(colors.includes('rgb(128, 184, 239)'));assert.ok(colors.includes('rgb(232, 232, 232)'));
 await a.locator('[data-page="2"]').click();await reading(a,'colored text');assert.ok((await a.locator('#reading .body').innerHTML()).includes('rgb(128, 184, 239)'));
 await edit(b,'colored tasks');await b.locator('#addTodo').click();assert.equal(await b.locator('#editor .todo-row').count(),1);await b.locator('#save').click();await reading(b,'colored tasks');assert.ok((await b.locator('#reading .body').innerHTML()).includes('rgb(239, 115, 115)'));
 // Cross the old storage ceiling: encrypted chunks persist in IndexedDB and survive reload.
 await b.locator('[data-page="1"]').click();await edit(b,'large cached page');
 await b.locator('#editor').evaluate(el=>{el.innerHTML='<img src="data:image/png;base64,'+'A'.repeat(3300000)+'" alt="capacity fixture">';});
 await b.locator('#save').click();await b.waitForFunction(()=>document.querySelector('#status').textContent==='已同步');
 assert.equal(cloud.v,2);assert.ok(Array.isArray(cloud.data));assert.ok(cloud.data.every(chunk=>chunk.length<=1000000));
 assert.ok((await b.evaluate(()=>localStorage.getItem('one-page:v1'))).length<2000);
 await b.reload();await reveal(b);await b.locator('#edit').waitFor();await b.locator('[data-page="1"]').click();await reading(b,'large cached page');assert.ok((await b.locator('#reading img').getAttribute('src')).length>3000000);
 assert.ok((await b.locator('#date').innerText()).startsWith('保存于 '));assert.equal(await b.locator('#status svg').count(),1);
 const stored=JSON.stringify(cloud);await edit(b,'over capacity');
 await b.locator('#editor').evaluate(el=>{el.textContent='z'.repeat(10*1024*1024+1);el.style.display='none';});
 await b.locator('#save').click();await b.getByRole('alert').filter({hasText:'超过 10 MB'}).waitFor();assert.equal(JSON.stringify(cloud),stored);
 console.log('PASS: legacy single-page migration, chunked large save, IndexedDB reload and 10 MB rejection');
 console.log('PASS: date logout clears local login/key/cache, keeps cloud data, and permits re-login');
 console.log('PASS: realtime sync, conflict choices, offline draft, cover and zoom; five-line paste, selected conversion, Enter and exit, stable checkbox viewport; concurrent different-page merge, three fixed slots, draft switching, blank-area cover and editor exclusion');
}finally{await browser.close();}
