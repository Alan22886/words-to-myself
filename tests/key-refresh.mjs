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


page.on('dialog',dialog=>dialog.accept());
await page.locator('#edit').click();await page.locator('#title').fill('unsaved draft before other-device migration');await page.waitForTimeout(400);
// Simulate another legacy device re-encrypting the cloud after a password reset.
await page.evaluate(async()=>{
 const metadata=JSON.parse(localStorage.getItem('one-page:v1')),oldKey=await crypto.subtle.importKey('raw',Uint8Array.from(atob(metadata.key),c=>c.charCodeAt(0)),'AES-GCM',true,['decrypt']);
 const envelope=JSON.parse(localStorage.getItem('mock-cloud'));
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(envelope.iv),c=>c.charCodeAt(0))},oldKey,Uint8Array.from(atob(envelope.data),c=>c.charCodeAt(0)));
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode('new-test-password'),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:new TextEncoder().encode('one-page:v1:test-user'),iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain);
 localStorage.setItem('mock-cloud',JSON.stringify({v:1,iv:btoa(String.fromCharCode(...iv)),data:btoa(String.fromCharCode(...new Uint8Array(cipher)))}));
 localStorage.setItem('mock-valid-pass','new-test-password');
});
await page.reload();await reveal(page);await page.locator('#loginForm').waitFor();await page.getByRole('alert').filter({hasText:'密钥已过期'}).waitFor();assert.ok(await page.evaluate(()=>!!localStorage.getItem('one-page:v1')));
await page.locator('#password').fill('new-test-password');await page.locator('#login').click();await page.locator('#edit').waitFor();assert.ok(await page.locator('#recoveryField').isHidden());await page.locator('#edit').click();assert.equal(await page.locator('#title').inputValue(),'unsaved draft before other-device migration');
await page.reload();await reveal(page);await page.locator('#edit').waitFor();await page.locator('#edit').click();assert.equal(await page.locator('#title').inputValue(),'unsaved draft before other-device migration');assert.ok(await page.locator('#loginForm').isHidden());
console.log('PASS: stale cached key prompts re-login without logout/cache deletion; current password unlocks cloud; old-key draft re-encrypted once; next reload requires no old password');
} finally { await browser.close(); }
