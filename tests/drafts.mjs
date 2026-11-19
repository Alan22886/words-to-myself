import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
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
export const get=async()=>({val:value});
export const onValue=(path,fn)=>{queueMicrotask(()=>fn({val:()=>path==='.info/connected'?true:value()}));return ()=>{}};
export const runTransaction=async(path,update)=>{const result=update(value());if(result!==undefined)localStorage.setItem('mock-cloud',JSON.stringify(result));return {committed:result!==undefined,snapshot:{val:value}}};
`}));
await page.goto('http://127.0.0.1:4181/');
await page.locator('#email').fill('me@example.com');await page.locator('#password').fill('wrong-password');await page.locator('#login').click();
await page.getByRole('alert').filter({hasText:'邮箱或密码不正确'}).waitFor();
await page.locator('#password').fill('test-password');await page.locator('#login').click();await page.locator('#edit').waitFor();
assert.equal(await page.locator('#password').inputValue(),'');

let dialogs=0;page.on('dialog',async dialog=>{dialogs++;await dialog.accept();});
await page.locator('#edit').click();await page.locator('#cancel').click();assert.equal(dialogs,0);assert.ok(await page.locator('#editing').isHidden());
await page.locator('#edit').click();await page.locator('#title').fill('unsaved title');await page.locator('#editor').fill('private draft text');
await page.waitForTimeout(600);
const encrypted=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('one-page-encrypted-cache');r.onsuccess=()=>resolve(r.result);});return await new Promise(resolve=>{const r=db.transaction('current').objectStore('current').get('drafts');r.onsuccess=()=>resolve(JSON.stringify(r.result));});});assert.ok(!encrypted.includes('private draft text'));
await page.reload();await page.locator('#edit').waitFor();await page.locator('#edit').click();assert.equal(await page.locator('#title').inputValue(),'unsaved title');assert.equal(await page.locator('#editor').innerText(),'private draft text');
await page.locator('#cancel').click();assert.ok(await page.locator('#editing').isHidden());await page.locator('#edit').click();assert.equal(await page.locator('#editor').innerText(),'');
await page.locator('#editor').fill(Array.from({length:50},(_,i)=>'line '+i).join('\n'));await page.locator('#save').click();await page.locator('#edit').waitFor();
await page.evaluate(()=>window.scrollTo(0,500));const y=await page.evaluate(()=>scrollY);await page.locator('[data-page="1"]').click();await page.locator('[data-page="0"]').click();assert.ok(Math.abs((await page.evaluate(()=>scrollY))-y)<2);
await page.locator('#edit').click();await page.locator('#editor').fill('');await page.locator('#addTodo').click();await page.keyboard.press('Backspace');assert.equal(await page.locator('#editor .todo-row').count(),0);await page.keyboard.type('ordinary paragraph');assert.ok((await page.locator('#editor').innerText()).includes('ordinary paragraph'));
// Re-login after a reset with the retained device key also restores encrypted drafts.
await page.locator('#title').fill('cached recovery draft');await page.waitForTimeout(400);
await page.evaluate(()=>{localStorage.removeItem('mock-auth');localStorage.setItem('mock-valid-pass','new-test-password');});await page.reload();await page.locator('#loginForm').waitFor();
await page.locator('#password').fill('new-test-password');await page.locator('#login').click();await page.locator('#edit').waitFor();assert.ok(await page.locator('#recoveryField').isHidden());
await page.locator('#edit').click();assert.equal(await page.locator('#title').inputValue(),'cached recovery draft');assert.ok((await page.locator('#editor').innerText()).includes('ordinary paragraph'));
console.log('PASS: no-change cancel; confirmed cancel; one encrypted draft per page survives reload; cancelled draft removed; page scroll memory; empty-task Backspace; retained-key password migration preserves draft');
} finally { await browser.close(); }
