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
export const signInWithEmailAndPassword=async(a,email,password)=>{if(password!=='test-password')throw Object.assign(Error('bad'),{code:'auth/invalid-credential'});localStorage.setItem('mock-auth','yes');auth.currentUser=user;return {user}};
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
await page.locator('#edit').click();await page.locator('#title').fill('记住这件事');await page.locator('#editor').fill('只有当前一页');await page.locator('#save').click();
await page.waitForFunction(()=>!document.querySelector('#reading').hidden);
const cloud=await page.evaluate(()=>localStorage.getItem('mock-cloud'));
assert.ok(cloud);assert.ok(!cloud.includes('只有当前一页'));
await page.reload();await page.waitForFunction(()=>document.querySelector('#reading').textContent.includes('只有当前一页'));
assert.ok(await page.locator('#loginForm').isHidden());
assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(0, 0, 0)');
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.screenshot({path:'/tmp/one-page-login-tested.png'});
console.log('PASS: login error, login, encrypted save, remembered login, decrypt after reload, black mobile layout (mock Firebase)');
} finally { await browser.close(); }
