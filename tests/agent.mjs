import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await (process.env.AGENT_BROWSER==='webkit'?webkit:chromium).launch();
let cloud=null;const pages=[];
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

async function open(mode='human'){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const page=await context.newPage();pages.push(page);page.on('dialog',d=>d.accept());
 await page.exposeFunction('cloudGet',()=>cloud);
 await page.exposeFunction('cloudCommit',async(old,payload)=>{if((cloud?.iv||null)!==(old?.iv||null))return {committed:false,value:cloud};cloud=payload;for(const other of pages)await other.evaluate(value=>dispatchEvent(new CustomEvent('mock-update',{detail:value})),cloud).catch(()=>{});return {committed:true,value:cloud};});
 await page.route('https://www.gstatic.com/firebasejs/**',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
 await page.goto('http://127.0.0.1:4181/'+(mode==='agent'?'?mode=agent':''));
 if(mode==='human')await reveal(page);else assert.ok(await page.locator('#cover').isHidden());
 assert.equal(await page.evaluate(()=>word2myself.status().ready),false);
 await page.locator('#email').fill('me@example.com');await page.locator('#password').fill('test-password');await page.locator('#login').click();
 await page.waitForFunction(()=>word2myself.status().ready);return {page,context};
}
async function reveal(page){await page.locator('#cover').click({clickCount:3,position:{x:30,y:200}});await page.locator('#cover').waitFor({state:'hidden'});}
async function edit(page,index,title,html){await page.locator('[data-page="'+index+'"]').click();await page.locator('#edit').click();await page.locator('#title').fill(title);await page.locator('#editor').evaluate((el,html)=>el.innerHTML=html,html);await page.locator('#save').click();await page.locator('#edit').waitFor();}
async function read(page){return page.evaluate(()=>word2myself.read());}
async function write(page,args){return page.evaluate(async args=>{try{return await word2myself.write(args);}catch(e){return {error:e.message};}},args);}
try{
 const {page:human}=await open();
 await edit(human,0,'First','<p><b>Keep first</b></p><div class="todo-row"><input type="checkbox"><span>Keep task</span></div>');
 await edit(human,1,'Second','<h2>Keep second</h2><p style="color:rgb(239,115,115)">red text</p>');
 await edit(human,2,'Third','<p>Keep third</p><img src="data:image/png;base64,iVBORw0KGgo=">');
 // Genuine legacy three-page ciphertext, not a clear-text migration fixture.
 cloud=await human.evaluate(async payload=>{const meta=JSON.parse(localStorage.getItem('one-page:v1'));const raw=Uint8Array.from(atob(meta.key),x=>x.charCodeAt(0));const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);const decode=v=>Uint8Array.from(atob(v),x=>x.charCodeAt(0));const value=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(payload.iv)},key,decode(payload.data))));value.pages=value.pages.slice(0,3);const iv=crypto.getRandomValues(new Uint8Array(12)),data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));const b64=v=>btoa(String.fromCharCode(...new Uint8Array(v)));return {v:1,iv:b64(iv),data:b64(data)};},cloud);
 const {page:agent,context:agentContext}=await open('agent');
 assert.equal(await agent.locator('[data-page]').count(),4);assert.equal(await agent.locator('[data-page="3"]').getAttribute('aria-current'),'page');
 const before=await read(agent);assert.equal(before.pages.length,4);assert.equal(before.pages[3].html,'');assert.equal(before.pages[0].writable,false);
 for(let i=0;i<3;i++){await agent.locator('[data-page="'+i+'"]').click();assert.ok(await agent.locator('#edit').isHidden());await agent.locator('#edit').evaluate(el=>el.click());assert.ok(await agent.locator('#editing').isHidden());await agent.locator('#markdownButton').click();assert.ok(await agent.locator('#markdownText').evaluate(el=>el.readOnly));assert.ok(await agent.locator('#markdownSave').isHidden());await agent.locator('#markdownCancel').click();}
 await agent.locator('[data-page="0"]').click();assert.ok(await agent.locator('#reading input').isDisabled());
 assert.match((await write(agent,{page:'01',title:'wrong',markdown:'wrong',expectedRevision:before.pages[0].revision})).error,/只能修改/);
 assert.equal(JSON.stringify(cloud).includes('Keep first'),false);
 const md='## Clear action\n\n- [ ] Read a page\n- [x] Open the book\n\n**Bold** and *italic*.\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| --- | --- |\n| one | two |\n\n[Safe](https://example.com) [Bad](javascript:alert(1))\n\n<script>window.injection=true</script><img src="https://example.com/tracker.png" onerror="window.injection=true">';
 const result=await write(agent,{title:'Agent',markdown:md,expectedRevision:before.pages[3].revision});assert.equal(result.saved,true);
 const after=await read(agent);assert.deepEqual(after.pages.slice(0,3),before.pages.slice(0,3));assert.equal(after.pages[3].markdown,md);assert.ok(after.pages[3].html.includes('<table>'));assert.ok(!after.pages[3].html.includes('javascript:'));assert.ok(!after.pages[3].html.includes('<script'));assert.ok(!after.pages[3].html.includes('tracker.png'));assert.ok(!await agent.evaluate(()=>window.injection));
 await human.locator('[data-page="3"]').click();await human.waitForFunction(()=>document.querySelector('#reading').textContent.includes('Clear action'));assert.equal(await human.locator('#reading input[type=checkbox]').count(),2);await human.locator('#reading input').first().check();await human.waitForFunction(()=>!word2myself.status().busy);await human.locator('#edit').click();await human.locator('#editor .todo-text').first().evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);r.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(r);el.closest('[contenteditable]').focus();});await human.keyboard.press('Enter');assert.equal(await human.locator('#editor .todo-row').count(),3);await human.keyboard.press('Enter');assert.equal(await human.locator('#editor .todo-row').count(),2);await human.locator('#cancel').click();assert.match((await write(agent,{title:'stale',markdown:'stale',expectedRevision:result.revision})).error,/已更新/);
 const revision=(await read(agent)).pages[3].revision;await edit(human,0,'First revised','<p>human changed page one</p>');
 assert.equal((await write(agent,{title:'Agent second',markdown:'## Next step\n\nStart small.',expectedRevision:revision})).saved,true);assert.equal((await read(agent)).pages[0].title,'First revised');
 await agent.clock.install();await agent.clock.fastForward(130000);assert.ok(await agent.locator('#cover').isHidden());await agent.locator('[data-page="2"]').click();assert.equal(await agent.locator('[data-page="2"]').getAttribute('aria-current'),'page');await agent.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});assert.ok(await agent.locator('#cover').isHidden());await agent.locator('#reading').click({clickCount:3});assert.ok(await agent.locator('#cover').isHidden());
 await agent.goto('http://127.0.0.1:4181/');await agent.waitForFunction(()=>word2myself.status().ready);assert.ok(await agent.locator('#cover').isHidden());assert.equal(await agent.evaluate(()=>word2myself.status().mode),'agent');
 await agentContext.setOffline(true);assert.match((await write(agent,{title:'Offline',markdown:'offline',expectedRevision:revision})).error,/联网/);await agentContext.setOffline(false);
 // Concurrent Markdown changes retain local input and provide an explicit reload path.
 await human.locator('[data-page="3"]').click();await human.locator('#markdownButton').click();await human.locator('#markdownText').fill('local unfinished change');
 const latest=(await read(agent)).pages[3];assert.equal((await write(agent,{title:'Remote Agent',markdown:'## Remote Agent note',expectedRevision:latest.revision})).saved,true);
 await human.locator('#markdownSave').click();await human.locator('#markdownNotice').filter({hasText:'另一端'}).waitFor();assert.equal(await human.locator('#markdownText').inputValue(),'local unfinished change');assert.ok(await human.locator('#conflictActions').isHidden());
 await human.locator('#markdownReload').click();await human.waitForFunction(()=>document.querySelector('#markdownText').value==='## Remote Agent note');await human.locator('#markdownCancel').click();
 // Human Markdown editing keeps encrypted drafts and the rich-text editor remains available.
 await human.locator('[data-page="3"]').click();await human.locator('#markdownButton').click();await human.locator('#markdownText').fill('## Human Markdown draft\n\n- one\n- two');await human.locator('#markdownText').click({clickCount:3});assert.ok(await human.locator('#cover').isHidden());await human.waitForTimeout(500);await human.reload();await reveal(human);await human.locator('#edit').waitFor();await human.locator('[data-page="3"]').click();
 // Restored Markdown is also editable through the original rich-text interface.
 assert.ok(await human.locator('#editing').isVisible());assert.ok((await human.locator('#editor').innerText()).includes('Human Markdown draft'));await human.locator('#save').click();await human.locator('#edit').waitFor();
 await human.locator('#markdownButton').click();assert.ok((await human.locator('#markdownText').inputValue()).includes('Human Markdown draft'));await human.locator('#markdownText').fill('## Human final\n\n**Readable**');await human.locator('#markdownSave').click();await human.locator('#markdownPanel').waitFor({state:'hidden'});assert.ok(await human.locator('#reading strong').isVisible());
 await human.goto('http://127.0.0.1:4181/?mode=agent');await human.locator('#cover').waitFor();await reveal(human);await human.locator('#edit').waitFor();assert.equal(await human.evaluate(()=>word2myself.status().mode),'human');
 const final=await read(agent);assert.equal(final.pages[3].markdown,'## Human final\n\n**Readable**');assert.equal(final.pages[1].title,'Second');assert.ok(final.pages[2].html.includes('data:image/png'));
 assert.equal(await human.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(0, 0, 0)');assert.ok(await human.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await human.screenshot({path:'/tmp/word2myself-agent-human.png'});
 console.log('PASS agent: legacy 3 to 4 pages; role persistence; read-only first three pages; safe Markdown; direct API; stale rejection; unrelated-page preservation; human rich-text/Markdown/draft; idle/background/triple bypass in agent only; offline rejection; encrypted storage');
}finally{await browser.close();}
