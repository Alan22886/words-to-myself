import { firebaseConfig } from './config.js';
const $ = id => document.getElementById(id);
const storageKey = 'one-page:v1';
const contentLimit=10*1024*1024;
const cipherToken=value=>value?.iv||null;
const enc = new TextEncoder(), dec = new TextDecoder();
const emptyPage=()=>({title:'',html:'',updated:0});
let book={pages:[emptyPage(),emptyPage(),emptyPage()]},pageIndex=0;
let doc=book.pages[0],session,key,database,auth,ref,api,unsubscribe;
const drafts=new Map();
const pageToken=page=>JSON.stringify([page.title,page.html,page.updated]);
function installBook(value){book=value;doc=book.pages[pageIndex];renderTabs();}

let connected = false, received = false, pendingReload = false;
let remoteQueue=Promise.resolve();
let revision = null, editing = false, conflict = false, busy = false, latest;
const b64 = bytes => { let result=''; for(let i=0;i<bytes.length;i+=8192) result+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(result); };
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const tell = message => { $('notice').textContent = message; };
const status = message => {
  const target=$('status');target.replaceChildren();target.title=message;target.setAttribute('aria-label',message);
  if(!message){target.dataset.state='';return;}
  const state=message==='已同步'?'synced':message==='未保存'?'dirty':message==='有冲突'?'conflict':/正在|同步中/.test(message)?'syncing':'offline';
  target.dataset.state=state;
  const paths={synced:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',syncing:'<path d="M20 9a8 8 0 1 0 0 6M20 4v5h-5"/>',dirty:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1"/>',conflict:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/>',offline:'<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'};
  target.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">'+paths[state]+'</svg>';
  const label=document.createElement('span');label.className='sr';label.textContent=message;target.append(label);
};
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
    const color=node.tagName==='FONT'?node.getAttribute('color'):node.style.color;
    if(color){
      const probe=document.createElement('span');probe.style.color=color;
      if(['rgb(239, 115, 115)','rgb(128, 184, 239)','rgb(232, 232, 232)'].includes(probe.style.color))el.style.color=probe.style.color;
    }
    if(node.classList.contains('todo-row'))el.className='todo-row';
    if(node.classList.contains('todo-text'))el.className='todo-text';
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
    const body=document.createElement('div');body.className='body';body.innerHTML=sanitize(doc.html);if(doc.title)target.append(title);target.append(body);
  }
  $('edit').textContent='编辑';renderTabs();renderDate();
}
function mode(value) { editing=value; $('clear').hidden=!value; $('editing').hidden=!value; $('reading').hidden=value; $('save').hidden=!value; $('edit').hidden=value; }
async function derive(password, uid) {
  const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:enc.encode('one-page:v1:'+uid),iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},true,['encrypt','decrypt']);
}
async function encrypt(value) {
  const plaintext=enc.encode(JSON.stringify(value));
  if(plaintext.byteLength>contentLimit)throw Error('三页内容合计超过 10 MB，请减少一些图片或文字。');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plaintext);
  const data=b64(new Uint8Array(ciphertext));
  // Keep small saves compatible with the original rules. Large saves use bounded chunks.
  if(data.length<=2700000)return {v:1,iv:b64(iv),data};
  const chunks=[];for(let offset=0;offset<data.length;offset+=1000000)chunks.push(data.slice(offset,offset+1000000));
  return {v:2,iv:b64(iv),data:chunks};
}
async function decrypt(value) {
  const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(value.iv)},key,bytes(Array.isArray(value.data)?value.data.join(''):value.data));
  const valueDoc=JSON.parse(dec.decode(decoded));
  const pages=Array.isArray(valueDoc.pages)?valueDoc.pages:[valueDoc];
  if(pages.length>3)throw Error('页面数量不正确');
  return {pages:Array.from({length:3},(_,index)=>{
    const page=pages[index]||emptyPage();
    if(typeof page.title!=='string'||typeof page.html!=='string')throw Error('内容格式不正确');
    return {title:page.title,html:sanitize(page.html),updated:Number(page.updated)||0};
  })};
}
let cacheDatabase;
function openCache(){
  if(!cacheDatabase)cacheDatabase=new Promise((resolve,reject)=>{
    const request=indexedDB.open('one-page-encrypted-cache',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('current');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  return cacheDatabase;
}
async function cachedPayload(action,value){
  const db=await openCache();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('current',action==='get'?'readonly':'readwrite');
    const store=transaction.objectStore('current');
    const request=action==='get'?store.get('payload'):action==='delete'?store.delete('payload'):store.put(value,'payload');
    transaction.oncomplete=()=>resolve(request.result);
    transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
  });
}
async function persist(value){
  const {payload,...metadata}=value;
  await cachedPayload('put',payload||null);
  localStorage.setItem(storageKey,JSON.stringify(metadata));
}
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
  if(busy)status('同步中');
  else if(!connected)status('离线');
  else if(!received)status('同步中');
  else if(conflict)status('有冲突');
  else status(editing?'未保存':'已同步');
}
function flagConflict(value){
  latest=value;conflict=true;$('conflictActions').hidden=false;
  tell('另一端已更新，当前修改已保留。请选择保留哪一份。');syncStatus();
}
async function acceptRemote(value){
  const activeSession=session;
  if(!activeSession)return;
  latest=value;received=true;
  if(busy)return;
  if(cipherToken(value)===revision){syncStatus();return;}
  const incoming=value?await decrypt(value):{pages:[emptyPage(),emptyPage(),emptyPage()]};
  if(session!==activeSession||cipherToken(latest)!==cipherToken(value))return;
  book=incoming;revision=cipherToken(value);session.payload=value;await persist(session);if(session!==activeSession)return;renderTabs();
  if(editing){
    if(pageToken(incoming.pages[pageIndex])!==pageToken(doc))flagConflict(value);
    syncStatus();return;
  }
  doc=book.pages[pageIndex];render();syncStatus();
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
function renderTabs(){
  document.querySelectorAll('[data-page]').forEach(button=>{
    const index=Number(button.dataset.page);button.disabled=busy;
    button.setAttribute('aria-current',index===pageIndex?'page':'false');
    button.classList.toggle('has-draft',drafts.has(index));
    button.title=book.pages[index].title||`第 ${index+1} 页`;
  });
}
function switchPage(index){
  if(busy||index===pageIndex)return;
  if(editing)drafts.set(pageIndex,{content:draft(),base:doc});
  pageIndex=index;conflict=false;$('conflictActions').hidden=true;tell('');
  const saved=drafts.get(index);
  if(saved){
    doc=saved.base;$('title').value=saved.content.title;$('editor').innerHTML=saved.content.html;mode(true);
    if(pageToken(book.pages[index])!==pageToken(doc))flagConflict(latest);
  }else{doc=book.pages[index];mode(false);render();}
  renderTabs();syncStatus();window.scrollTo(0,0);
}
document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>switchPage(Number(button.dataset.page)));
function renderDate(){
  $('date').textContent=doc.updated?'保存于 '+new Date(doc.updated).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'尚未保存';
}
renderDate();
$('edit').onclick=()=>{
  if(busy)return;
  $('title').value=doc.title;$('editor').innerHTML=sanitize(doc.html);
  conflict=false;mode(true);syncStatus();
};
async function savePage(next,expectedPage=pageToken(doc),inPlace=false){
  if(busy)return false;
  const target=pageIndex;
  busy=true;$('save').disabled=true;$('edit').disabled=true;renderTabs();syncStatus();
  try{
    if(!navigator.onLine||!connected||!received)throw Error('尚未连接，请联网后保存。');
    let committedPayload,merged;
    for(let attempt=0;attempt<4;attempt++){
      const current=(await api.get(ref)).val();
      const fresh=current?await decrypt(current):{pages:[emptyPage(),emptyPage(),emptyPage()]};
      if(pageToken(fresh.pages[target])!==expectedPage){flagConflict(current);return false;}
      merged={pages:fresh.pages.map((page,index)=>index===target?next:page)};
      const payload=await encrypt(merged);
      const expected=cipherToken(current);
      const result=await api.runTransaction(ref,value=>{
        if(cipherToken(value)!==expected)return;
        return payload;
      },{applyLocally:false});
      if(result.committed){committedPayload=payload;if(cipherToken(latest)===expected)latest=payload;break;}
    }
    if(!committedPayload)throw Error('另一端正在更新，请再点一次保存。');
    revision=cipherToken(committedPayload);session.payload=committedPayload;await persist(session);
    book=merged;doc=next;drafts.delete(target);conflict=false;$('conflictActions').hidden=true;
    if(!inPlace){mode(false);render();}else renderDate();tell('');
    if(pendingReload&&!drafts.size&&$('cover').hidden)location.reload();return true;
  }catch(error){tell(error.message);return false;}
  finally{
    busy=false;$('save').disabled=false;$('edit').disabled=false;syncStatus();renderTabs();
    if(received&&cipherToken(latest)!==revision&&!editing){
      const pending=latest;remoteQueue=remoteQueue.then(()=>acceptRemote(pending)).catch(error=>tell('同步失败：'+error.message));
    }
  }
}
function draft(){return {title:$('title').value.trim(),html:sanitize($('editor').innerHTML),updated:Date.now()};}
$('save').onclick=()=>{if(conflict){tell('请先选择保留哪一份。');return;}return savePage(draft());};
$('useRemote').onclick=async()=>{
  if(busy||!confirm('放弃当前修改，使用另一端的内容？'))return;
  try{
    const value=(await api.get(ref)).val();
    const incoming=value?await decrypt(value):{pages:[emptyPage(),emptyPage(),emptyPage()]};
    installBook(incoming);drafts.delete(pageIndex);revision=cipherToken(value);latest=value;session.payload=value;await persist(session);
    conflict=false;$('conflictActions').hidden=true;mode(false);render();tell('');syncStatus();
  }catch(error){tell('读取失败：'+error.message);}
};
$('useMine').onclick=async()=>{
  if(busy||!confirm('用当前修改替换另一端的内容？'))return;
  try{const remote=latest?await decrypt(latest):{pages:[emptyPage(),emptyPage(),emptyPage()]};await savePage(draft(),pageToken(remote.pages[pageIndex]));}catch(error){tell(error.message);}
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
    const total=book.pages.reduce((size,page,index)=>size+(index===pageIndex?0:enc.encode(page.html).byteLength),0)+enc.encode($('editor').innerHTML).byteLength+img.src.length;
    if(total>contentLimit-2048)throw Error('三页内容合计接近 10 MB，请先减少一些内容。');
    $('editor').append(img,document.createElement('p'));tell('');
  }catch(error){tell(error.message);}event.target.value='';
};
window.addEventListener('beforeunload',event=>{if(editing||drafts.size){event.preventDefault();event.returnValue='';}});
function showLogin() {
  $('date').disabled=true;$('date').textContent='未登录';
  $('loginForm').hidden=false;$('page').hidden=true;
  $('email').value=session?.email||'';
}
function showPage() {$('date').disabled=false;$('loginForm').hidden=true;$('page').hidden=false;}
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
    const cloudDoc=payload?await decrypt(payload):{pages:[emptyPage(),emptyPage(),emptyPage()]};
    if((doc.title||doc.html) && !previous?.key && !confirm('登录后显示云端内容，本机内容将替换。继续？')) {
      await api.signOut(auth);session=previous;key=previousKey;return;
    }
    session.key=b64(new Uint8Array(await crypto.subtle.exportKey('raw',key)));
    session.payload=payload;await persist(session);installBook(cloudDoc);revision=cipherToken(payload);
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
      if(!('payload' in stored))stored.payload=await cachedPayload('get');
      session={...stored,config:firebaseConfig};
      key=await crypto.subtle.importKey('raw',bytes(stored.key),'AES-GCM',true,['encrypt','decrypt']);
      if(stored.payload)installBook(await decrypt(stored.payload));
      revision=cipherToken(stored.payload);render();showPage();
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
    if(editing||drafts.size||busy||!$('cover').hidden){pendingReload=true;return;}
    if(!refreshing){refreshing=true;location.reload();}
  });
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(registration=>{
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible')registration.update().catch(()=>{});
    });
  }).catch(()=>tell('离线资源未就绪，请保持联网使用。'));
}

// Tasks use normal text flow and explicit newline handling, never editable flex cells.
function taskRow(content=''){
  const row=document.createElement('div');row.className='todo-row';
  const box=document.createElement('input');box.type='checkbox';box.setAttribute('aria-label','完成待办');box.contentEditable='false';
  const text=document.createElement('span');text.className='todo-text';
  if(typeof content==='string')text.textContent=content;else text.append(content);
  row.append(box,text);return row;
}
function caretIn(node,atEnd=false){
  $('editor').focus({preventScroll:true});const range=document.createRange();range.selectNodeContents(node);range.collapse(!atEnd);
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
}
function currentTask(){
  const node=getSelection()?.anchorNode;
  return (node?.nodeType===1?node:node?.parentElement)?.closest('#editor .todo-row');
}
$('addTodo').onmousedown=event=>event.preventDefault();
$('addTodo').onclick=()=>{
  const editor=$('editor'),selection=getSelection();
  const range=selection?.rangeCount?selection.getRangeAt(0):null;
  const inside=range&&editor.contains(range.commonAncestorContainer);
  if(inside&&!range.collapsed){
    const lines=selection.toString().split(/\r?\n/).filter(line=>line.trim());
    if(!lines.length)return;
    const fragment=document.createDocumentFragment();for(const line of lines)fragment.append(taskRow(line));
    const start=(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement).closest('#editor > *');
    const end=(range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement).closest('#editor > *');
    let suffix;
    if(start&&end&&!start.classList.contains('todo-row')&&!end.classList.contains('todo-row')){
      const prefixRange=document.createRange();prefixRange.setStart(start,0);prefixRange.setEnd(range.startContainer,range.startOffset);
      const suffixRange=document.createRange();suffixRange.setStart(range.endContainer,range.endOffset);suffixRange.setEnd(end,end.childNodes.length);
      const prefix=prefixRange.cloneContents();suffix=suffixRange.cloneContents();
      if(prefix.textContent||prefix.querySelector('img')){const block=document.createElement('div');block.append(prefix);fragment.prepend(block);}
      if(suffix.textContent||suffix.querySelector('img')){const block=document.createElement('div');block.append(suffix);fragment.append(block);}
      range.setStartBefore(start);range.setEndAfter(end);
    }
    range.deleteContents();const last=[...fragment.childNodes].filter(node=>node.classList?.contains('todo-row')).at(-1);range.insertNode(fragment);caretIn(last.querySelector('span'),true);return;
  }
  const fragment=document.createDocumentFragment();let last,pending=document.createDocumentFragment();
  function flush(){if(pending.textContent.trim()){last=taskRow(pending);fragment.append(last);}pending=document.createDocumentFragment();}
  for(const node of [...editor.childNodes]){
    if(node.nodeType===3){
      const lines=node.textContent.split(/\r?\n/);lines.forEach((line,index)=>{if(index)flush();pending.append(document.createTextNode(line));});continue;
    }
    if(node.nodeType!==1)continue;
    if(node.tagName==='BR'){flush();continue;}
    if((node.classList.contains('todo-row')&&node.querySelector('input[type=checkbox]')&&node.querySelector('span'))||node.querySelector('img')||node.tagName==='IMG'){flush();fragment.append(node);continue;}
    if(['DIV','P','H2','LI','UL','OL','BLOCKQUOTE'].includes(node.tagName)){
      flush();const lines=(node.innerText||'').split(/\r?\n/).filter(line=>line.trim());
      if(lines.length===1){
        const inline=document.createElement('span');if(node.style.color)inline.style.color=node.style.color;
        for(const child of node.childNodes)inline.append(child.cloneNode(true));pending.append(inline);flush();
      }else for(const line of lines){last=taskRow(line);fragment.append(last);}
    }else pending.append(node.cloneNode(true));
  }
  flush();
  if(!last){last=taskRow();fragment.append(last);}
  editor.replaceChildren(fragment);caretIn(last.querySelector('span'),true);
};
function enterTask(event){
  if(event.isComposing)return;
  const row=currentTask();if(!row)return;
  const text=row.querySelector('span');if(!text)return;event.preventDefault();
  if(!text.textContent.trim()){
    const paragraph=document.createElement('div');paragraph.append(document.createElement('br'));row.replaceWith(paragraph);caretIn(paragraph);return;
  }
  const selection=getSelection(),range=selection.getRangeAt(0);range.deleteContents();
  const tail=document.createRange();tail.setStart(range.startContainer,range.startOffset);tail.setEnd(text,text.childNodes.length);
  const next=taskRow(tail.extractContents());row.after(next);caretIn(next.querySelector('span'));
}
$('editor').addEventListener('keydown',event=>{if(event.key==='Enter')enterTask(event);});
$('editor').addEventListener('beforeinput',event=>{if(event.inputType==='insertParagraph')enterTask(event);});
function updateCheck(box){if(box.checked)box.setAttribute('checked','');else box.removeAttribute('checked');}
$('editor').addEventListener('change',event=>{if(event.target.matches('input[type=checkbox]'))updateCheck(event.target);});
$('reading').addEventListener('change',async event=>{
  const box=event.target;if(!box.matches('input[type=checkbox]'))return;
  if(busy){box.checked=!box.checked;return;}
  updateCheck(box);
  const next={...doc,html:sanitize($('reading').querySelector('.body').innerHTML),updated:Date.now()};
  const saved=await savePage(next,pageToken(doc),true);
  if(!saved){
    // The attempted change remains available for retry without swapping page layouts.
    $('title').value=next.title;$('editor').innerHTML=next.html;
    if(conflict){mode(true);syncStatus();}
    else{box.checked=!box.checked;updateCheck(box);}
  }
});
// Double tap without zoom. Ignore scrolling gestures and interactive controls.
let lastTap=null, startTap=null, lastToggle=0, savedScroll=0;
function toggleCover(){
  if(Date.now()-lastToggle<400)return;
  lastToggle=Date.now();
  const cover=$('cover'),show=cover.hidden;
  if(show){savedScroll=window.scrollY;document.activeElement?.blur();}
  cover.hidden=!show;document.body.classList.toggle('covered',show);
  document.title=show?'The Evening Times':'给自己的话';getSelection()?.removeAllRanges();
  if(show)cover.scrollTop=0;else{window.scrollTo(0,savedScroll);if(pendingReload&&!editing&&!drafts.size&&!busy)location.reload();}
}
function tapTarget(target){
  if(target.closest('#cover'))return true;
  if(editing||!$('loginForm').hidden||target.closest('#editing,button,input,label,[contenteditable],#conflictActions'))return false;
  return true;
}
document.addEventListener('pointerdown',event=>{
  startTap=null;
  if(event.pointerType!=='touch'||!tapTarget(event.target)||event.target.closest('button,input')){lastTap=null;return;}
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

$('editor').addEventListener('input',()=>{for(const row of $('editor').querySelectorAll('.todo-row')){if(!row.querySelector('input[type=checkbox]')||!row.querySelector('span'))row.classList.remove('todo-row');}});

$('date').onclick=async()=>{
  if(!session?.key||!auth)return;
  if(busy){tell('正在保存，请稍候。');return;}
  const warning=editing||drafts.size?'有未保存的修改。退出会丢弃草稿，云端内容保留。退出登录？':'退出此设备？云端内容保留。';
  if(!confirm(warning))return;
  try{
    const email=session.email;
    await api.signOut(auth);unsubscribe?.();unsubscribe=null;
    session=null;key=null;ref=null;revision=null;latest=null;received=false;connected=false;
    drafts.clear();book={pages:[emptyPage(),emptyPage(),emptyPage()]};pageIndex=0;doc=book.pages[0];
    localStorage.removeItem(storageKey);await cachedPayload('delete');conflict=false;$('conflictActions').hidden=true;
    $('title').value='';$('editor').replaceChildren();$('password').value='';
    mode(false);render();showLogin();$('email').value=email||'';status('');tell('');window.scrollTo(0,0);
  }catch(error){tell('退出失败：'+error.message);}
};

// Stop iOS rubber-band scrolling at the top/bottom without blocking ordinary vertical scroll.
let scrollTouchY=null;
document.addEventListener('touchstart',event=>{scrollTouchY=event.touches.length===1?event.touches[0].clientY:null;},{passive:true});
document.addEventListener('touchmove',event=>{
  if(scrollTouchY===null||event.touches.length!==1||!$('cover').hidden)return;
  const delta=event.touches[0].clientY-scrollTouchY;scrollTouchY=event.touches[0].clientY;
  const bottom=document.documentElement.scrollHeight-window.innerHeight;
  if((window.scrollY<=0&&delta>0)||(window.scrollY>=bottom-1&&delta<0))event.preventDefault();
},{passive:false});

$('clearTitle').onclick=()=>{$('title').value='';};
