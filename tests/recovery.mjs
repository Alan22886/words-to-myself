import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
async function reveal(page){await page.locator('#cover').waitFor();await page.locator('#cover').click({clickCount:3,position:{x:30,y:200}});await page.locator('#cover').waitFor({state:'hidden'});}
const browser=await chromium.launch();
try {
const page=await browser.newPage({viewport:{width:390,height:844}});
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
export const signInWithEmailAndPassword=async(a,email,password)=>{if(password!==(localStorage.getItem('mock-valid-pass')||'test-password'))throw Object.assign(Error('bad'),{code:'auth/invalid-credential'});localStorage.setItem('mock-auth','yes');auth.currentUser=user;return {user}};
export const signOut=async()=>{auth.currentUser=null;localStorage.removeItem('mock-auth')};
export const ref=(db,path)=>path;
const value=()=>JSON.parse(localStorage.getItem('mock-cloud')||'null');
export const get=async path=>({val:()=>path.includes('/keyWraps/')?JSON.parse(localStorage.getItem('mock-wrap:'+path)||'null'):value()});
export const set=async(path,payload)=>localStorage.setItem('mock-wrap:'+path,JSON.stringify(payload));
export const remove=async path=>localStorage.removeItem('mock-wrap:'+path);
export const updatePassword=async(user,password)=>localStorage.setItem('mock-valid-pass',password);
export const onValue=(path,fn)=>{queueMicrotask(()=>fn({val:()=>path==='.info/connected'?true:value()}));return ()=>{}};
export const runTransaction=async(path,update)=>{const result=update(value());if(result!==undefined)localStorage.setItem('mock-cloud',JSON.stringify(result));return {committed:result!==undefined,snapshot:{val:value}}};
`}));
await page.goto('http://127.0.0.1:4181/');await reveal(page);
await page.locator('#email').fill('me@example.com');await page.locator('#password').fill('wrong-password');await page.locator('#login').click();
await page.getByRole('alert').filter({hasText:'邮箱或密码不正确'}).waitFor();
await page.locator('#password').fill('test-password');await page.locator('#login').click();await page.locator('#edit').waitFor();
assert.equal(await page.locator('#password').inputValue(),'');
await page.locator('#edit').click();await page.locator('#title').fill('记住这件事');await page.locator('#editor').fill('只有当前一页');await page.locator('#save').click();
await page.waitForFunction(()=>!document.querySelector('#reading').hidden);
const cloud=await page.evaluate(()=>localStorage.getItem('mock-cloud'));
assert.ok(cloud);assert.ok(!cloud.includes('只有当前一页'));
await page.reload();await reveal(page);await page.waitForFunction(()=>document.querySelector('#reading').textContent.includes('只有当前一页'));
assert.ok(await page.locator('#loginForm').isHidden());
assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(0, 0, 0)');
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));

// Build three populated pages before the account password reset.
for(const index of [1,2]){await page.locator(`[data-page="${index}"]`).click();await page.locator('#edit').click();await page.locator('#title').fill('page '+(index+1));await page.locator('#editor').fill('retained '+index);await page.locator('#save').click();await page.locator('#edit').waitFor();}
const before=await page.evaluate(()=>localStorage.getItem('mock-cloud'));
page.once('dialog',dialog=>dialog.accept());await page.locator('#date').click();await page.locator('#loginForm').waitFor();
await page.evaluate(()=>localStorage.setItem('mock-valid-pass','new-test-password'));
await page.locator('#password').fill('new-test-password');await page.locator('#login').click();await page.locator('#recoveryField').waitFor();
assert.equal(await page.evaluate(()=>localStorage.getItem('mock-cloud')),before);
await page.locator('#recoveryPassword').fill('wrong-old-password');await page.locator('#login').click();await page.getByRole('alert').filter({hasText:'原加密密码不正确'}).waitFor();
assert.equal(await page.evaluate(()=>localStorage.getItem('mock-cloud')),before);
await page.locator('#recoveryPassword').fill('test-password');await page.locator('#login').click();await page.locator('#edit').waitFor();
assert.equal(await page.evaluate(()=>localStorage.getItem('mock-cloud')),before); // key wrapping does not rewrite content
for(const [index,text] of [[0,'只有当前一页'],[1,'retained 1'],[2,'retained 2']]){await page.locator(`[data-page="${index}"]`).click();await page.waitForFunction(text=>document.querySelector('#reading').textContent.includes(text),text);}
assert.equal(await page.locator('#recoveryPassword').inputValue(),'');
page.once('dialog',dialog=>dialog.accept());await page.locator('#date').click();await page.locator('#loginForm').waitFor();
await page.locator('#password').fill('new-test-password');await page.locator('#login').click();await page.locator('#edit').waitFor();assert.ok(await page.locator('#recoveryField').isHidden());
await page.locator('[data-page="2"]').click();await page.waitForFunction(()=>document.querySelector('#reading').textContent.includes('retained 2'));
console.log('PASS: reset-password recovery; wrong original password leaves cloud untouched; three pages retained; password-protected key wrapping; new-password-only re-login; recovery password cleared');
} finally { await browser.close(); }
