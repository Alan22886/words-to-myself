import { firebaseConfig } from './config.js';
const $ = id => document.getElementById(id);
const storageKey = 'one-page:v1';
const enc = new TextEncoder(), dec = new TextDecoder();
let doc = {title:'',html:'',updated:0}, session, key, database, auth, ref, api, unsubscribe;
let connected = false;
let revision = null, editing = false, conflict = false, busy = false, latest;
const b64 = bytes => { let result=''; for(let i=0;i<bytes.length;i+=8192) result+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(result); };
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const tell = message => { $('notice').textContent = message; };
const status = message => { $('status').textContent = message; };
function sanitize(html) {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const allowed = new Set(['P','BR','DIV','STRONG','B','EM','I','U','H2','UL','OL','LI','BLOCKQUOTE','IMG']);
  function clean(node) {
    if(node.nodeType === 3) return document.createTextNode(node.textContent);
    if(node.nodeType !== 1 || ['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH'].includes(node.tagName)) return document.createTextNode('');
    if(node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if(!/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(src)) return document.createTextNode('');
      const img = document.createElement('img'); img.src=src; img.alt='给自己的图片'; return img;
    }
    const el = document.createElement(allowed.has(node.tagName) ? node.tagName : 'span');
    for(const child of node.childNodes) el.append(clean(child));
    return el;
  }
  const out=document.createElement('div'); for(const child of source.body.childNodes) out.append(clean(child));
  return out.innerHTML;
}
function render() {
  const target=$('reading'); target.replaceChildren();
  if(!doc.title && !doc.html) {
    // Leave an empty page quiet until the user chooses to edit.
  } else {
    const title=document.createElement('h1');title.textContent=doc.title;
    const body=document.createElement('div');body.className='body';body.innerHTML=sanitize(doc.html);target.append(title,body);
  }
  $('edit').textContent='编辑';
}
function mode(value) { editing=value; $('clear').hidden=!value; $('editing').hidden=!value; $('reading').hidden=value; $('save').hidden=!value; $('edit').hidden=value; }
async function derive(password, uid) {
  const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:enc.encode('one-page:v1:'+uid),iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},true,['encrypt','decrypt']);
}
async function encrypt(value) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(value)));
  return {v:1,iv:b64(iv),data:b64(new Uint8Array(ciphertext))};
}
async function decrypt(value) {
  const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(value.iv)},key,bytes(value.data));
  const valueDoc=JSON.parse(dec.decode(decoded));
  if(typeof valueDoc.title!=='string'||typeof valueDoc.html!=='string') throw Error('内容格式不正确');
  return {...valueDoc,html:sanitize(valueDoc.html)};
}
function persist(value) {localStorage.setItem(storageKey,JSON.stringify(value));}
async function connect() {
  status('正在连接…');
  const base='https://www.gstatic.com/firebasejs/11.10.0/';
  const [appModule,authModule,dbModule]=await Promise.all([import(base+'firebase-app.js'),import(base+'firebase-auth.js'),import(base+'firebase-database.js')]);
  api={...authModule,...dbModule};
  const existing=appModule.getApps()[0];
  if(existing && (existing.options.apiKey!==session.config.apiKey || existing.options.databaseURL!==session.config.databaseURL)) await appModule.deleteApp(existing);
  const app=appModule.getApps()[0] || appModule.initializeApp(session.config);
  auth=api.getAuth(app);database=api.getDatabase(app);
  await api.setPersistence(auth,api.browserLocalPersistence);
  await auth.authStateReady();
}
async function listen(user) {
  if(unsubscribe) unsubscribe();
  ref=api.ref(database,'pages/'+user.uid+'/current');
  unsubscribe=api.onValue(ref,async snapshot=>{
    try {
      const value=snapshot.val(); latest=value;
      if(busy) return;
      if(editing && (value?.data||null)!==revision){conflict=true;$('save').textContent='读取另一端';tell('另一端已更新。当前草稿已保留在编辑框；请先复制想保留的内容，再点下方“读取另一端”。');return;}
      if(editing || busy) return;
      doc=value?await decrypt(value):{title:'',html:'',updated:0};revision=value?.data||null;
      session.payload=value;persist(session);render();status('已连接 · '+(doc.updated?new Date(doc.updated).toLocaleString('zh-CN'):'当前为空白'));
    }catch(error){tell('无法解密或缓存内容，请核对原密码。'+error.message);}
  },error=>{status('同步未连接');tell('同步失败，请检查数据库规则和网络：'+error.message);});
  api.onValue(api.ref(database,'.info/connected'),snapshot=>{connected=!!snapshot.val();if(!connected)status('离线 · 显示此设备已缓存内容');});
}
$('date').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
$('edit').onclick=()=>{$('title').value=doc.title;$('editor').innerHTML=sanitize(doc.html);conflict=false;mode(true);$('title').focus();};
$('save').onclick=async()=>{
  if(busy)return;
  if(conflict){
    if(!confirm('读取另一端会丢弃编辑框内尚未保存的修改，继续吗？'))return;
    doc=latest?await decrypt(latest):{title:'',html:'',updated:0}; revision=latest?.data||null; conflict=false;mode(false);render();$('save').textContent='保存';tell('已读取另一端。');return;
  }
  const next={title:$('title').value.trim(),html:sanitize($('editor').innerHTML),updated:Date.now()};
  busy=true;$('save').disabled=true;
  try {
    if(session?.config){
      if(!navigator.onLine || !connected)throw Error('当前离线，请联网后保存。草稿仍在编辑框内。');
      const payload=await encrypt(next);
      const result=await api.runTransaction(ref,current=>{
        if((current?.data||null)!==revision)return;
        return payload;
      },{applyLocally:false});
      if(!result.committed){latest=result.snapshot.val();conflict=true;$('save').textContent='读取另一端';throw Error('另一端已修改，未覆盖云端。先复制要保留的草稿，再读取另一端。');}
      revision=payload.data;session.payload=payload;persist(session);status('已加密同步 · '+new Date().toLocaleTimeString('zh-CN'));
    }else{persist({local:next});status('已保存在此设备 · 尚未连接同步');}
    doc=next;conflict=false;mode(false);render();tell('');
  }catch(error){tell(error.message);}finally{busy=false;$('save').disabled=false;}
};
$('clear').onclick=()=>{if(!confirm('清空这一页？保存后生效。'))return;if(!editing)$('edit').click();$('title').value='';$('editor').replaceChildren();tell('');};
document.querySelectorAll('[data-command]').forEach(button=>{button.onmousedown=e=>e.preventDefault();button.onclick=()=>{$('editor').focus();document.execCommand(button.dataset.command,false,button.dataset.value||null);};});
$('editor').addEventListener('paste',event=>{event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));});
$('editor').addEventListener('drop',event=>event.preventDefault());
$('image').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>15*1024*1024)throw Error('请选择 15 MB 以内的图片。');
    const bitmap=await createImageBitmap(file);const scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const img=document.createElement('img');img.src=canvas.toDataURL('image/jpeg',.8);img.alt='给自己的图片';
    if($('editor').innerHTML.length+img.src.length>1800000)throw Error('这一页图片已较多，请先删除一些图片再加入。');
    $('editor').append(img,document.createElement('p'));tell('');
  }catch(error){tell(error.message);}event.target.value='';
};
window.addEventListener('beforeunload',event=>{if(editing){event.preventDefault();event.returnValue='';}});
function showLogin() {
  $('loginForm').hidden=false;$('page').hidden=true;
  $('email').value=session?.email||'';
}
function showPage() {$('loginForm').hidden=true;$('page').hidden=false;}
$('loginForm').onsubmit=async event=>{
  event.preventDefault();$('login').disabled=true;tell('');
  const previous=session, previousKey=key;
  try {
    session={config:firebaseConfig,email:$('email').value.trim()};
    await connect();
    const credential=await api.signInWithEmailAndPassword(auth,session.email,$('password').value);
    key=await derive($('password').value,credential.user.uid);
    const snapshot=await api.get(api.ref(database,'pages/'+credential.user.uid+'/current'));
    const payload=snapshot.val();
    const cloudDoc=payload?await decrypt(payload):{title:'',html:'',updated:0};
    if((doc.title||doc.html) && !previous?.key && !confirm('登录后显示云端内容，本机内容将替换。继续？')) {
      await api.signOut(auth);session=previous;key=previousKey;return;
    }
    session.key=b64(new Uint8Array(await crypto.subtle.exportKey('raw',key)));
    session.payload=payload;persist(session);doc=cloudDoc;revision=payload?.data||null;
    $('password').value='';render();showPage();await listen(credential.user);
  }catch(error){
    session=previous;key=previousKey;
    const messages={
      'auth/invalid-credential':'邮箱或密码不正确。',
      'auth/operation-not-allowed':'请先在 Firebase 启用邮箱密码登录。',
      'auth/too-many-requests':'尝试过多，请稍后重试。',
      'auth/network-request-failed':'网络连接失败，请重试。',
      'auth/invalid-api-key':'Firebase 配置有误，请核对 API Key。',
      'PERMISSION_DENIED':'请先发布数据库访问规则。'
    };
    tell(messages[error.code] || (error.name==='OperationError'?'无法解密，请使用原密码。':'登录失败：'+error.message));
  }finally{$('login').disabled=false;}
};
async function boot(){
  try{
    const stored=JSON.parse(localStorage.getItem(storageKey)||'null');
    if(stored?.config && stored.key){
      session={...stored,config:firebaseConfig};
      key=await crypto.subtle.importKey('raw',bytes(stored.key),'AES-GCM',true,['encrypt','decrypt']);
      doc=stored.payload?await decrypt(stored.payload):doc;
      revision=stored.payload?.data||null;render();showPage();
      await connect();
      if(auth.currentUser)await listen(auth.currentUser);else showLogin();
    }else{
      if(stored?.local){doc=stored.local;render();}
      showLogin();
    }
  }catch(error){
    if(!session?.key)showLogin();
    tell('暂时无法连接：'+error.message);
  }
}
render();boot();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>tell('离线资源未就绪，请保持联网使用。'));
