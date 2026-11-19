import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
async function reveal(page){await page.locator('#cover').waitFor();await page.locator('#cover').dblclick({position:{x:30,y:200}});await page.locator('#cover').waitFor({state:'hidden'});}
const browser=await (process.env.FORMAT_BROWSER==='webkit'?webkit:chromium).launch();
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

await page.locator('#edit').click();
async function select(start=0,end=5){
 await page.locator('#editor').evaluate((el,{start,end})=>{
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node,total=0,a,b;
  while(node=walker.nextNode()){if(!a&&total+node.length>start)a=[node,start-total];if(total+node.length>=end){b=[node,end-total];break;}total+=node.length;}
  const range=document.createRange();range.setStart(...a);range.setEnd(...b);getSelection().removeAllRanges();getSelection().addRange(range);
 },{start,end});
}
async function styleOf(text='alpha',root='#editor'){
 return page.locator(root).evaluate((el,text)=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode())if(node.textContent.includes(text)){const style=getComputedStyle(node.parentElement);return {size:style.fontSize,color:style.color,weight:style.fontWeight,italic:style.fontStyle};}},text);
}
async function press(name){await page.getByRole('button',{name,exact:true}).click();}
for(const [name,size] of [['小字号','16px'],['标准字号','19px'],['大字号','26px']]){
 await page.locator('#editor').evaluate(el=>el.innerHTML='alpha beta gamma');await select();await press(name);assert.equal((await styleOf()).size,size);
}
for(const commands of [['大字号','红色','粗体','斜体'],['蓝色','粗体','小字号','斜体']]){
 await page.locator('#editor').evaluate(el=>el.innerHTML='alpha beta gamma');await select();
 for(const name of commands)await press(name);
 const styled=await styleOf();assert.equal(styled.size,commands.includes('大字号')?'26px':'16px');assert.equal(styled.italic,'italic');assert.ok(Number(styled.weight)>=600);assert.equal(styled.color,commands.includes('红色')?'rgb(239, 115, 115)':'rgb(128, 184, 239)');
 await page.locator('#save').click();await page.locator('#edit').waitFor();
 assert.equal((await styleOf('alpha','#reading')).size,styled.size);await page.locator('#edit').click();assert.deepEqual(await styleOf(),styled);
}
// A size chosen with only a caret applies to subsequently typed text as well.
await page.locator('#editor').evaluate(el=>{el.innerHTML='';el.focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);});
await press('大字号');await page.keyboard.type('alpha');assert.equal((await styleOf()).size,'26px');
// Selected clear restores only the selected text, leaving the other formatted text untouched.
await page.locator('#editor').evaluate(el=>el.innerHTML='alpha beta gamma');await select(0,5);for(const name of ['大字号','红色','粗体','斜体'])await press(name);
await select(6,10);await press('蓝色');await press('小字号');await select(0,5);await press('清除格式');
let alpha=await styleOf();assert.equal(alpha.size,'19px');assert.equal(alpha.color,'rgb(232, 232, 232)');assert.equal(alpha.weight,'400');assert.equal(alpha.italic,'normal');
assert.equal((await styleOf('beta')).color,'rgb(128, 184, 239)');assert.equal((await styleOf('beta')).size,'16px');
// Collapsed selection clears all body inline styles, retaining task/list/image structure and title.
await page.locator('#title').fill('keep title');
await page.locator('#editor').evaluate(el=>{el.innerHTML='<div class="todo-row"><input type="checkbox" checked><span class="todo-text"><b><i><span style="font-size:26px;color:rgb(239,115,115)">alpha</span></i></b></span></div><ul><li><span style="font-size:16px;color:rgb(128,184,239)">beta</span></li></ul><img src="data:image/png;base64,iVBORw0KGgo=" alt="test">';getSelection().removeAllRanges();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);getSelection().addRange(range);});
await press('清除格式');alpha=await styleOf();assert.equal(alpha.size,'19px');assert.equal(alpha.weight,'400');assert.equal(alpha.italic,'normal');assert.equal(alpha.color,'rgb(119, 119, 119)'); // completed task remains dimmed
assert.equal(await page.locator('#editor input[type=checkbox]:checked').count(),1);assert.equal(await page.locator('#editor ul li').count(),1);assert.equal(await page.locator('#editor img').count(),1);assert.equal(await page.locator('#title').inputValue(),'keep title');
assert.equal((await styleOf('beta')).color,'rgb(232, 232, 232)');
await page.locator('#save').click();await page.locator('#edit').waitFor();await page.locator('#edit').click();
await select(0,5);await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');assert.equal(await page.locator('#editor .todo-row').count(),2);
// Metadata uses one baseline; hide only scrollbar tracks, preserve scrolling.
const alignment=await page.evaluate(()=>{const a=document.querySelector('#date').getBoundingClientRect(),b=document.querySelector('main .version').getBoundingClientRect();return Math.abs(a.bottom-b.bottom);});assert.ok(alignment<5);
assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).scrollbarWidth),'none');
await page.locator('#editor').evaluate(el=>{el.innerHTML=Array.from({length:70},(_,i)=>'<div>line '+i+'</div>').join('');});
await page.evaluate(()=>window.scrollTo(0,500));assert.ok(await page.evaluate(()=>scrollY>0));
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>window.scrollTo(0,0));
await page.screenshot({path:'/tmp/reminder-format-'+(process.env.FORMAT_BROWSER||'chromium')+'.png'});
console.log('PASS '+(process.env.FORMAT_BROWSER||'chromium')+': sizes; color/bold/italic combinations; save/re-edit; selected clear; whole-body clear; task/list/image/title preservation; task Enter after clear; metadata alignment; hidden scrollbar with working scroll');
} finally { await browser.close(); }
