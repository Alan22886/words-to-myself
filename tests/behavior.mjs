import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
async function reveal(page){await page.locator('#cover').waitFor();await page.locator('#cover').click({clickCount:3,position:{x:30,y:200}});await page.locator('#cover').waitFor({state:'hidden'});}
const browser=await (process.env.BEHAVIOR_BROWSER==='webkit'?webkit:chromium).launch();
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
async function newPage(clock=false){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const page=await context.newPage();pages.push(page);if(clock)await page.clock.install({time:new Date('2026-11-20T04:00:00Z')});
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
async function revealIfCovered(page){if(await page.locator('#cover').isVisible()){await page.clock.runFor(500);await reveal(page);}}
async function more(page,tool){await page.locator('#behaviorMore').click();await page.getByRole('button',{name:tool,exact:true}).click();}
async function selectText(page,selector){await page.locator(selector).evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);});}
function seconds(text){const [m,s]=text.split(':').map(Number);return m*60+s;}
try{
 const a=await newPage(true),b=await newPage();
 await edit(a,'original page');await a.locator('#editor').fill('Read a SQL question');await a.locator('#save').click();await reading(b,'Read a SQL question');
 await a.locator('#edit').click();await a.locator('#editor').fill('Read a SQL question');await a.locator('#addTodo').click();await a.locator('#save').click();await a.locator('#edit').waitFor();await a.locator('#reading .todo-text').click();await a.locator('#behaviorStart').click();assert.equal(await a.locator('#focusTask').inputValue(),'Read a SQL question');await a.locator('#behaviorBack').click();
 const cloudBefore=JSON.stringify(cloud);await selectText(a,'#reading .body');await a.locator('#behaviorStart').click();assert.equal(await a.locator('#focusTask').inputValue(),'Read a SQL question');await a.locator('#focusStep').fill('Open one simple question');await a.getByRole('button',{name:'10 分钟',exact:true}).click();await a.locator('#focusBegin').click();assert.equal(await a.locator('#focusClock').innerText(),'10:00');await a.screenshot({path:'/tmp/word-2-myself-focus.png'});
 await a.clock.fastForward(60000);assert.equal(await a.locator('#focusClock').innerText(),'09:00');
 await a.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await a.clock.fastForward(120000);assert.ok(await a.locator('#cover').isVisible());
 await a.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});await revealIfCovered(a);assert.ok(seconds(await a.locator('#focusClock').innerText())<=420);assert.ok(seconds(await a.locator('#focusClock').innerText())>=418);
 await a.reload();await a.clock.runFor(500);await reveal(a);await a.locator('#behaviorStart').click();assert.ok(seconds(await a.locator('#focusClock').innerText())<420);assert.ok(seconds(await a.locator('#focusClock').innerText())>390);
 await a.clock.fastForward(430000);await revealIfCovered(a);assert.equal(await a.locator('#focusClock').innerText(),'00:00');assert.ok(await a.locator('#focusContinue').isVisible());await a.locator('#focusContinue').click();assert.equal(await a.locator('#focusClock').innerText(),'05:00');await a.locator('#focusEnd').click();assert.equal(JSON.stringify(cloud),cloudBefore);assert.ok(await a.locator('#behaviorPanel').isHidden());
 // Ending focus never changes the editor or its encrypted draft.
 await edit(a,'unsaved action');await a.locator('#editor').evaluate(el=>{el.innerHTML='<p><b>keep this draft</b></p>';el.dispatchEvent(new Event('input',{bubbles:true}));});const draftHTML=await a.locator('#editor').innerHTML();await selectText(a,'#editor');await a.locator('#behaviorStart').click();await a.getByRole('button',{name:'15 分钟',exact:true}).click();await a.locator('#focusBegin').click();assert.equal(await a.locator('#focusClock').innerText(),'15:00');await a.locator('#focusEnd').click();assert.equal(await a.locator('#editor').innerHTML(),draftHTML);assert.ok(await a.locator('#editing').isVisible());
 a.once('dialog',dialog=>dialog.accept());await a.locator('#cancel').click();
 // A manually entered action also works, without a selected task or text.
 await a.locator('#behaviorStart').click();await a.locator('#focusTask').fill('');await a.locator('#focusBegin').click();await a.getByRole('alert').filter({hasText:'写一句'}).waitFor();await a.locator('#focusTask').fill('Open the document');await a.locator('#focusBegin').click();assert.equal(await a.locator('#focusClock').innerText(),'05:00');await a.locator('#focusEnd').click();
 // One reason, one suggestion, direct path into a concrete first step.
 await more(a,'卡住了？');await a.getByRole('button',{name:'害怕做不好',exact:true}).click();assert.ok((await a.locator('#stuckSuggestion').innerText()).includes('不完美'));await a.locator('#stuckStart').click();assert.ok((await a.locator('#focusStep').inputValue()).includes('粗糙'));await a.locator('#behaviorBack').click();
 await more(a,'卡住了？');await a.getByRole('button',{name:'身体疲惫',exact:true}).click();await a.locator('#stuckStart').click();assert.ok(await a.locator('#behaviorPanel').isHidden());
 // Optional motive answers become an ordinary draft only when explicitly inserted.
 await more(a,'为什么要做');assert.equal(await a.locator('#motiveQuestions li').count(),3);await a.locator('#motiveInsert').click();assert.ok(await a.locator('#motivesTool').isVisible());await a.locator('#motiveAnswer').fill('I choose to learn the basics.');await a.locator('#motiveInsert').click();assert.ok((await a.locator('#editor').innerText()).includes('I choose'));assert.equal(JSON.stringify(cloud),cloudBefore);a.once('dialog',dialog=>dialog.accept());await a.locator('#cancel').click();
 // Page 2 keeps its original rich content and image alongside bounded evidence records.
 await a.locator('[data-page="1"]').click();await edit(a,'my free second page');await a.locator('#editor').evaluate(el=>el.innerHTML='<h2>Existing reminder</h2><p><b><span style="color:rgb(239,115,115)">keep original text</span></b></p><img src="data:image/png;base64,iVBORw0KGgo=" alt="fixture">');await a.locator('#save').click();await a.locator('#edit').waitFor();
 const originalHTML=await a.locator('#reading .body').innerHTML();await more(a,'今天学会了什么');await a.locator('#learningText').fill('I wrote a JOIN without AI.');await a.locator('#learningSave').click();await a.waitForFunction(()=>document.querySelector('#learningText').value==='');await a.locator('#learningRecent').evaluate(el=>el.open=true);assert.equal(await a.locator('.learning-preview').count(),1);await a.screenshot({path:'/tmp/word-2-myself-learning.png'});
 await more(b,'今天学会了什么');await b.locator('#learningRecent').evaluate(el=>el.open=true);await b.locator('.learning-preview').waitFor();await b.locator('#learningText').fill('An unfinished evidence draft.');
 await a.locator('#learningText').fill('I used TEXTSPLIT on my own.');await a.locator('#learningSave').click();await b.waitForFunction(()=>document.querySelectorAll('.learning-preview').length===2);assert.equal(await b.locator('#learningText').inputValue(),'An unfinished evidence draft.');
 await b.locator('#learningCancel').evaluate(el=>{}); // input stays independent of live record list
 const first=a.locator('.learning-preview').filter({hasText:'JOIN'});await first.getByRole('button',{name:'修改',exact:true}).click();await a.locator('#learningText').fill('I wrote a JOIN and explained it.');await a.locator('#learningSave').click();await b.getByText('I wrote a JOIN and explained it.',{exact:true}).waitFor();
 const deleteRow=b.locator('.learning-preview').filter({hasText:'TEXTSPLIT'});b.once('dialog',dialog=>dialog.accept());await deleteRow.getByRole('button',{name:'删除',exact:true}).click();await a.waitForFunction(()=>document.querySelectorAll('.learning-preview').length===1);
 await a.locator('#behaviorBack').click();const baseAfter=await a.locator('#reading .body').evaluate(el=>{const copy=el.cloneNode(true);copy.querySelectorAll('.learning-entry').forEach(node=>node.remove());return copy.innerHTML;});assert.equal(baseAfter,originalHTML);
 // Local recording draft survives reload; successful records remain in normal encrypted page 2.
 await b.waitForTimeout(400);await b.reload();await reveal(b);await more(b,'今天学会了什么');assert.equal(await b.locator('#learningText').inputValue(),'An unfinished evidence draft.');await b.locator('#learningRecent').evaluate(el=>el.open=true);assert.equal(await b.locator('.learning-preview').count(),1);
 // Stale edits are rejected rather than overwriting a newer record.
 await a.locator('#behaviorMore').click();await a.getByRole('button',{name:'今天学会了什么',exact:true}).click();await a.locator('#learningRecent').evaluate(el=>el.open=true);
 const aRow=a.locator('.learning-preview').filter({hasText:'JOIN'}),bRow=b.locator('.learning-preview').filter({hasText:'JOIN'});
 await aRow.getByRole('button',{name:'修改',exact:true}).click();await a.locator('#learningText').fill('A pending edit');
 b.once('dialog',dialog=>dialog.accept());await bRow.getByRole('button',{name:'修改',exact:true}).click();await b.locator('#learningText').fill('B updated this evidence');await b.locator('#learningSave').click();await a.locator('#learningList').getByText('B updated this evidence',{exact:true}).waitFor();
 const savedByB=JSON.stringify(cloud);await a.locator('#learningSave').click();await a.getByRole('alert').filter({hasText:'另一端修改'}).waitFor();assert.equal(JSON.stringify(cloud),savedByB);assert.equal(await a.locator('#learningText').inputValue(),'A pending edit');await a.locator('#learningCancel').click();
 // Independent additions are merged by the original encrypted document transaction.
 await a.locator('#learningText').fill('A separate learning evidence');await b.locator('#learningText').fill('B separate learning evidence');await Promise.all([a.locator('#learningSave').click(),b.locator('#learningSave').click()]);await a.waitForFunction(()=>document.querySelectorAll('.learning-preview').length===3);await b.waitForFunction(()=>document.querySelectorAll('.learning-preview').length===3);
 const onlineCloud=JSON.stringify(cloud);await b.evaluate(()=>window.dispatchEvent(new CustomEvent('mock-connected',{detail:false})));await b.locator('#learningText').fill('offline evidence draft');await b.locator('#learningSave').click();await b.getByRole('alert').filter({hasText:'请联网'}).waitFor();assert.equal(JSON.stringify(cloud),onlineCloud);assert.equal(await b.locator('#learningText').inputValue(),'offline evidence draft');
 await a.locator('#behaviorBack').click();
 await a.locator('[data-page="2"]').click();await edit(a,'free principles');await a.locator('#editor').fill('My own principle remains.');await a.locator('#save').click();await a.locator('#edit').waitFor();await more(a,'补一条长期原则');assert.ok((await a.locator('#editor').innerText()).includes('My own principle remains.'));assert.ok((await a.locator('#editor').innerText()).includes('关于'));
 // The bounded record transform never deletes older entries automatically.
 const cap=await a.evaluate(async()=>{const {changeLearningEntry,readLearningEntries}=await import('/behavior.js');let html='<p>original</p>';for(let i=0;i<20;i++)html=changeLearningEntry(html,{type:'add',id:'entry-'+i,at:Date.now()+i,text:'evidence '+i});let rejected=false;try{changeLearningEntry(html,{type:'add',id:'extra',at:Date.now(),text:'extra'});}catch{rejected=true;}return {count:readLearningEntries(html).length,rejected,original:html.includes('original')};});assert.deepEqual(cap,{count:20,rejected:true,original:true});
 console.log('PASS behavior: selected-text focus; 5/10/15 minutes; background and reload deadlines; continue/end; original editor intact; one stuck suggestion; optional motive insertion; evidence create/edit/delete/live sync/local draft; second-page rich text+image retained; bounded 20 records; free principle template');
}finally{await browser.close();}
