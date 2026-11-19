import { firebaseConfig } from './config.js';
const $ = id => document.getElementById(id);
const storageKey = 'one-page:v1';
const enc = new TextEncoder(), dec = new TextDecoder();
let doc = {title:'',html:'',updated:0}, session, key, database, auth, ref, api, unsubscribe;
let connected = false, received = false, pendingReload = false;
let remoteQueue=Promise.resolve();
let revision = null, editing = false, conflict = false, busy = false, latest;
const b64 = bytes => { let result=''; for(let i=0;i<bytes.length;i+=8192) result+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(result); };
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const tell = message => { $('notice').textContent = message; };
const status = message => { $('status').textContent = message; };
function sanitize(html) {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const allowed = new Set(['P','BR','DIV','STRONG','B','EM','I','U','H2','UL','OL','LI','BLOCKQUOTE','IMG','INPUT','SPAN']);
  function clean(node) {
    if(node.nodeType === 3) return document.createTextNode(node.textContent);
    if(node.nodeType !== 1 || ['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH'].includes(node.tagName)) return document.createTextNode('');
    if(node.tagName === 'INPUT') {
      if(node.getAttribute('type')!=='checkbox') return document.createTextNode('');
      const input=document.createElement('input');input.type='checkbox';input.setAttribute('aria-label','完成待办');
      if(node.hasAttribute('checked')){input.checked=true;input.setAttribute('checked','');}return input;
    }
    if(node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if(!/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(src)) return document.createTextNode('');
      const img = document.createElement('img'); img.src=src; img.alt='给自己的图片'; return img;
    }
    const el = document.createElement(allowed.has(node.tagName) ? node.tagName : 'span');
    if(node.classList.contains('todo-row'))el.className='todo-row';
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
function syncStatus() {
  if(!connected)status('离线');
  else if(!received)status('同步中');
  else if(conflict)status('有冲突');
  else status(editing?'未保存':'已同步');
}
function flagConflict(value){
  latest=value;conflict=true;$('conflictActions').hidden=false;
  tell('另一端已更新，当前修改已保留。请选择保留哪一份。');syncStatus();
}
async function acceptRemote(value){
  latest=value;received=true;
  if(busy)return;
  if(editing){if((value?.data||null)!==revision)flagConflict(value);return;}
  const incoming=value?await decrypt(value):{title:'',html:'',updated:0};
  if(editing){if((value?.data||null)!==revision)flagConflict(value);return;}
  if((latest?.data||null)!==(value?.data||null))return;
  doc=incoming;revision=value?.data||null;session.payload=value;persist(session);render();syncStatus();
}
async function listen(user) {
  unsubscribe?.();received=false;
  ref=api.ref(database,'pages/'+user.uid+'/current');
  const stopPage=api.onValue(ref,snapshot=>{
    const value=snapshot.val();
    remoteQueue=remoteQueue.then(()=>acceptRemote(value)).catch(error=>tell('同步失败：'+error.message));
  },error=>{received=false;status('同步失败');tell('请检查网络或数据库规则。');});
  const stopConnection=api.onValue(api.ref(database,'.info/connected'),snapshot=>{connected=!!snapshot.val();syncStatus();});
  unsubscribe=()=>{stopPage();stopConnection();};
}
$('date').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
$('edit').onclick=()=>{
  if(busy)return;
  $('title').value=doc.title;$('editor').innerHTML=sanitize(doc.html);
  conflict=false;mode(true);syncStatus();$('title').focus();
};
async function savePage(next, expectedRevision=revision){
  if(busy)return false;
  busy=true;$('save').disabled=true;$('edit').disabled=true;
  try{
    if(!navigator.onLine||!connected||!received)throw Error('尚未连接，请联网后保存。');
    const payload=await encrypt(next);
    const result=await api.runTransaction(ref,current=>{
      if((current?.data||null)!==expectedRevision)return;
      return payload;
    },{applyLocally:false});
    if(!result.committed){flagConflict(result.snapshot.val());return false;}
    if((latest?.data||null)===expectedRevision)latest=payload;
    revision=payload.data;session.payload=payload;persist(session);
    doc=next;conflict=false;$('conflictActions').hidden=true;mode(false);render();tell('');if(pendingReload&&$('cover').hidden)location.reload();return true;
  }catch(error){tell(error.message);return false;}
  finally{
    busy=false;$('save').disabled=false;$('edit').disabled=false;syncStatus();
    // A newer server update may have arrived while encrypting or committing.
    if(received && (latest?.data||null)!==revision && !editing){
      const pending=latest;
      remoteQueue=remoteQueue.then(()=>acceptRemote(pending)).catch(error=>tell('同步失败：'+error.message));
    }
  }
}
function draft(){return {title:$('title').value.trim(),html:sanitize($('editor').innerHTML),updated:Date.now()};}
$('save').onclick=()=>{if(conflict){tell('请先选择保留哪一份。');return;}return savePage(draft());};
$('useRemote').onclick=async()=>{
  if(busy||!confirm('放弃当前修改，使用另一端的内容？'))return;
  try{
    const value=(await api.get(ref)).val();
    const incoming=value?await decrypt(value):{title:'',html:'',updated:0};
    doc=incoming;revision=value?.data||null;latest=value;session.payload=value;persist(session);
    conflict=false;$('conflictActions').hidden=true;mode(false);render();tell('');syncStatus();
  }catch(error){tell('读取失败：'+error.message);}
};
$('useMine').onclick=async()=>{
  if(busy||!confirm('用当前修改替换另一端的内容？'))return;
  await savePage(draft(),latest?.data||null);
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
if('serviceWorker'in navigator){
  let refreshing=false;const controlledOnLoad=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(!controlledOnLoad)return;
    if(editing||busy||!$('cover').hidden){pendingReload=true;return;}
    if(!refreshing){refreshing=true;location.reload();}
  });
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(registration=>{
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible')registration.update().catch(()=>{});
    });
  }).catch(()=>tell('离线资源未就绪，请保持联网使用。'));
}

// Todo rows remain editable; only checkbox clicks are saved automatically in reading mode.
$('addTodo').onclick=()=>{
  const row=document.createElement('div');row.className='todo-row';
  const box=document.createElement('input');box.type='checkbox';box.setAttribute('aria-label','完成待办');
  const text=document.createElement('span');text.textContent='待办事项';row.append(box,text);
  $('editor').append(row);text.focus();
  const selection=getSelection(),range=document.createRange();range.selectNodeContents(text);selection.removeAllRanges();selection.addRange(range);
};
function updateCheck(box){if(box.checked)box.setAttribute('checked','');else box.removeAttribute('checked');}
$('editor').addEventListener('change',event=>{if(event.target.matches('input[type=checkbox]'))updateCheck(event.target);});
$('reading').addEventListener('change',async event=>{
  const box=event.target;if(!box.matches('input[type=checkbox]'))return;
  if(busy){box.checked=!box.checked;return;}
  updateCheck(box);
  const next={...doc,html:sanitize($('reading').querySelector('.body').innerHTML),updated:Date.now()};
  // Retain the attempted checkbox change in the editor if a competing save wins.
  $('title').value=next.title;$('editor').innerHTML=next.html;mode(true);
  await savePage(next);
});
// Double tap without zoom. Ignore scrolling gestures and interactive controls.
let lastTap=null, startTap=null, lastToggle=0, savedScroll=0;
function toggleCover(){
  if(Date.now()-lastToggle<400)return;
  lastToggle=Date.now();
  const cover=$('cover'),show=cover.hidden;
  if(show){savedScroll=window.scrollY;document.activeElement?.blur();}
  cover.hidden=!show;document.body.classList.toggle('covered',show);
  document.title=show?'城市观察':'给自己的话';getSelection()?.removeAllRanges();
  if(show)cover.scrollTop=0;else{window.scrollTo(0,savedScroll);if(pendingReload&&!editing&&!busy)location.reload();}
}
function tapTarget(target){return target.closest('#cover')||target.closest('#reading')||target.closest('#editor');}
document.addEventListener('pointerdown',event=>{
  if(event.pointerType!=='touch'||!tapTarget(event.target)||event.target.closest('button,input'))return;
  startTap={x:event.clientX,y:event.clientY,time:Date.now(),scroll:$('cover').hidden?window.scrollY:$('cover').scrollTop};
});
document.addEventListener('pointercancel',()=>{startTap=null;lastTap=null;});
document.addEventListener('pointerup',event=>{
  if(event.pointerType!=='touch'||!startTap)return;
  const start=startTap;startTap=null;
  const scroll=$('cover').hidden?window.scrollY:$('cover').scrollTop;
  if(Date.now()-start.time>350||Math.hypot(event.clientX-start.x,event.clientY-start.y)>15||Math.abs(scroll-start.scroll)>5){lastTap=null;return;}
  const now=Date.now();
  if(lastTap&&now-lastTap.time<340&&Math.hypot(event.clientX-lastTap.x,event.clientY-lastTap.y)<25){event.preventDefault();lastTap=null;toggleCover();}
  else lastTap={x:event.clientX,y:event.clientY,time:now};
},{passive:false});
document.addEventListener('dblclick',event=>{if(tapTarget(event.target)&&!event.target.closest('input,button')){event.preventDefault();toggleCover();}});
