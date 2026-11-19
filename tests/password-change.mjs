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
export const updatePassword=async(user,password)=>{if(localStorage.getItem('mock-needs-reauth'))throw Object.assign(Error('recent login needed'),{code:'auth/requires-recent-login'});localStorage.setItem('mock-valid-pass',password);if(localStorage.getItem('mock-update-fail')==='after'){localStorage.removeItem('mock-update-fail');throw Object.assign(Error('lost response'),{code:'auth/network-request-failed'});}};
export const EmailAuthProvider={credential:(email,password)=>({email,password})};
export const reauthenticateWithCredential=async(user,credential)=>{if(credential.password!==(localStorage.getItem('mock-valid-pass')||'test-password'))throw Object.assign(Error('wrong'),{code:'auth/invalid-credential'});localStorage.removeItem('mock-needs-reauth');};
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
const original=await page.evaluate(()=>localStorage.getItem('mock-cloud'));
await page.locator('#edit').click();await page.locator('#title').fill('draft stays through password change');await page.waitForTimeout(350);
await page.locator('#accountSettings').click();await page.locator('#newPassword').fill('changed-once-password');await page.locator('#confirmPassword').fill('does-not-match');await page.locator('#changePassword').click();await page.getByRole('alert').filter({hasText:'两次新密码不一致'}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('mock-valid-pass')),null);
await page.locator('#confirmPassword').fill('changed-once-password');await page.locator('#changePassword').click();await page.locator('#passwordDialog').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>localStorage.getItem('mock-cloud')),original);
await page.reload();await reveal(page);await page.locator('#edit').waitFor();await page.locator('#edit').click();assert.equal(await page.locator('#title').inputValue(),'draft stays through password change');await page.locator('#cancel').click();
async function logout(){await page.locator('#date').click();await page.locator('#loginForm').waitFor();}
async function login(password){await page.locator('#password').fill(password);await page.locator('#login').click();await page.locator('#edit').waitFor();assert.ok(await page.locator('#recoveryField').isHidden());}
await logout();await login('changed-once-password');await page.waitForFunction(()=>document.querySelector('#reading').textContent.includes('只有当前一页'));
// Recent-login checks ask for the current login password, never the original encryption password.
await page.evaluate(()=>localStorage.setItem('mock-needs-reauth','yes'));await page.locator('#accountSettings').click();await page.locator('#newPassword').fill('changed-twice-password');await page.locator('#confirmPassword').fill('changed-twice-password');await page.locator('#changePassword').click();await page.locator('#currentPasswordField').waitFor();
assert.equal(await page.evaluate(()=>localStorage.getItem('mock-valid-pass')),'changed-once-password');await page.locator('#currentPassword').fill('wrong-current-password');await page.locator('#changePassword').click();await page.getByRole('alert').filter({hasText:'当前登录密码不正确'}).waitFor();
await page.locator('#currentPassword').fill('changed-once-password');await page.locator('#changePassword').click();await page.locator('#passwordDialog').waitFor({state:'hidden'});await logout();await login('changed-twice-password');assert.equal(await page.evaluate(()=>localStorage.getItem('mock-cloud')),original);
// The new wrapper is durable BEFORE account update, so a lost response cannot strand the key.
await page.evaluate(()=>localStorage.setItem('mock-update-fail','after'));await page.locator('#accountSettings').click();await page.locator('#newPassword').fill('changed-third-password');await page.locator('#confirmPassword').fill('changed-third-password');await page.locator('#changePassword').click();await page.getByRole('alert').filter({hasText:'修改未完成'}).waitFor();await page.locator('#closePasswordDialog').click();await logout();await login('changed-third-password');assert.equal(await page.evaluate(()=>localStorage.getItem('mock-cloud')),original);
console.log('PASS: in-app password change; mismatched confirmation; stable content and drafts; new-password-only logins after repeated changes; recent-login/current-password verification; lost update response recovery without original password');
} finally { await browser.close(); }
