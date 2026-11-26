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


await page.locator('#edit').click();await page.locator('#title').fill('Read comfortably');
await page.locator('#editor').evaluate(el=>{el.innerHTML='<h2>Heading</h2><p><span style="font-size:16px">small</span> normal <span style="font-size:26px">large</span></p><img>';const canvas=document.createElement('canvas');canvas.width=40;canvas.height=20;el.querySelector('img').src=canvas.toDataURL('image/png');});
await page.locator('#save').click();await page.locator('#edit').waitFor();
await page.locator('#reading img').evaluate(img=>img.decode());
const cloud=await page.evaluate(()=>localStorage.getItem('mock-cloud'));
const sizes=()=>page.locator('#reading').evaluate(el=>({all:[...el.querySelectorAll('*')].map(n=>parseFloat(getComputedStyle(n).fontSize)),image:el.querySelector('img').getBoundingClientRect().width}));
const original=await sizes();await page.locator('#readingLarger').click();const enlarged=await sizes();original.all.forEach((size,i)=>assert.ok(Math.abs(enlarged.all[i]/size-1.15)<.01));assert.equal(enlarged.image,original.image);assert.equal(await page.evaluate(()=>localStorage.getItem('mock-cloud')),cloud);
await page.reload();await reveal(page);await page.locator('#edit').waitFor();assert.deepEqual(await sizes(),enlarged);await page.locator('[data-page="1"]').click();await page.locator('[data-page="0"]').click();assert.deepEqual(await sizes(),enlarged);await page.locator('#readingSmaller').click();assert.deepEqual(await sizes(),original);
for(let i=0;i<12;i++)if(!await page.locator('#readingLarger').isDisabled())await page.locator('#readingLarger').click();assert.ok(await page.locator('#readingLarger').isDisabled());
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/reading-size-'+(process.env.EDIT_BROWSER||'chromium')+'.png'});
await page.locator('#edit').click();assert.ok(await page.locator('#readingSize').isHidden());assert.equal(await page.locator('#editor [data-read-sized]').count(),0);assert.equal(await page.locator('#editor span').first().evaluate(el=>getComputedStyle(el).fontSize),'16px');
await page.locator('#editor').evaluate(el=>el.innerHTML='<p>alpha keep beta</p><p>gamma keep delta</p>');
await page.locator('#editor').evaluate(el=>{el.focus();const r=document.createRange();r.setStart(el.firstChild.firstChild,0);r.setEnd(el.firstChild.firstChild,5);getSelection().removeAllRanges();getSelection().addRange(r);});
const bounds=await page.locator('#editor p').nth(1).evaluate(el=>{const r=document.createRange();r.setStart(el.firstChild,0);r.setEnd(el.firstChild,5);const b=r.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};});
await page.keyboard.down('Meta');await page.mouse.move(bounds.x+1,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width-.5,bounds.y+bounds.height/2,{steps:8});await page.mouse.up();await page.keyboard.up('Meta');
await page.locator('.multi-selection-hint').filter({hasText:'已选 2 处'}).waitFor();
async function styles(){return page.locator('#editor').evaluate(el=>{const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),result=[];let n;while(n=w.nextNode()){const s=getComputedStyle(n.parentElement);result.push({text:n.textContent,color:s.color,weight:s.fontWeight,italic:s.fontStyle,size:s.fontSize});}return result;});}
for(const name of ['蓝色','粗体','斜体','大字号'])await page.getByRole('button',{name,exact:true}).click();
let result=await styles();for(const word of ['alpha','gamma']){const rows=result.filter(r=>r.text.includes(word));assert.equal(rows.length,1,JSON.stringify(result));const row=rows[0];assert.equal(row.color,'rgb(128, 184, 239)',JSON.stringify(result));assert.ok(Number(row.weight)>=600);assert.equal(row.italic,'italic');assert.equal(row.size,'26px');}
for(const row of result.filter(r=>r.text.includes('keep'))){assert.equal(row.color,'rgb(232, 232, 232)');assert.equal(row.weight,'400');assert.equal(row.size,'19px');}
await page.getByRole('button',{name:'粗体',exact:true}).click();result=await styles();for(const row of result.filter(r=>/alpha|gamma/.test(r.text)))assert.equal(row.weight,'400');
await page.getByRole('button',{name:'清除格式',exact:true}).click();result=await styles();for(const row of result){assert.equal(row.color,'rgb(232, 232, 232)');assert.equal(row.italic,'normal');assert.equal(row.size,'19px');}
await page.screenshot({path:'/tmp/multi-selection-'+(process.env.EDIT_BROWSER||'chromium')+'.png'});await page.locator('#editor').press('Escape');assert.equal(await page.locator('.multi-selection-overlay i').count(),0);
async function paste(text,html=''){await page.locator('#editor').evaluate((el,{text,html})=>{el.focus();const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);const data=new DataTransfer();data.setData('text/plain',text);if(html)data.setData('text/html',html);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},{text,html});}
await paste('## Markdown heading\n\n**bold** and *italic*\n\n- [ ] task\n\n```js\nconst value = 1;\n```');assert.equal(await page.locator('#editor h2').innerText(),'Markdown heading');assert.equal(await page.locator('#editor strong').innerText(),'bold');assert.equal(await page.locator('#editor em').innerText(),'italic');assert.equal(await page.locator('#editor .todo-row').count(),1);assert.ok((await page.locator('#editor pre').innerText()).includes('const value'));
await page.locator('#save').click();await page.locator('#edit').waitFor();assert.ok(await page.locator('#reading h2').isVisible());assert.ok(await page.locator('#reading input').isVisible());await page.locator('#edit').click();assert.ok(await page.locator('#editor strong').isVisible());
await paste('Rendered heading\nBold','<h2>Rendered heading</h2><p><strong>Bold</strong></p><script>window.badPaste=true</script>');assert.equal(await page.locator('#editor h2').innerText(),'Rendered heading');assert.equal(await page.locator('#editor strong').innerText(),'Bold');assert.equal(await page.evaluate(()=>!!window.badPaste),false);
await paste('first line\nsecond line');assert.equal(await page.locator('#editor h2,#editor strong').count(),0);assert.ok((await page.locator('#editor').innerText()).includes('first line'));
await page.locator('#editor').evaluate(el=>{el.dispatchEvent(new KeyboardEvent('keydown',{key:'v',metaKey:true,shiftKey:true,bubbles:true}));});await paste('**literal**');assert.equal(await page.locator('#editor').innerText(),'**literal**');assert.equal(await page.locator('#editor strong').count(),0);
console.log('PASS reading/edit: uniform local reading font scale with bounds/reload; original formatting and image sizes unchanged; Command multi-range color/bold/italic/size/clear without touching gaps; Markdown/rich clipboard/plain paste; safe save/re-edit');
}finally{await browser.close();}
