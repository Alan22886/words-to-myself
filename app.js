import { multiSelection } from './multi-selection.js';
import { marked } from './vendor/marked.js';
import { mountReader } from './reader.js';
import { initBehaviorTools, changeLearningEntry } from './behavior.js';
import { firebaseConfig } from './config.js';
let markdownEditing=false,markdownBase,markdownIndex,markdownInitial,markdownPriorDraft;
let behaviorTools,multipleText;
let privacyHeld=false,versionPress=null,versionHoldTimer,suppressVersionClickUntil=0;
let positionReader=()=>{};
const $ = id => document.getElementById(id);
const storageKey = 'one-page:v1';
const agentEntry=(()=>{try{const stored=JSON.parse(localStorage.getItem(storageKey)||'null');return new URLSearchParams(location.search).get('mode')==='agent'&&(!stored?.key||stored.mode==='agent');}catch{return false;}})();
const privacyDisabled=()=>isAgent()||(!session?.key&&agentEntry);
const readingSteps=[.85,1,1.15,1.3,1.5,1.75,2];
const contentLimit=10*1024*1024;
const cipherToken=value=>value?.iv||null;
const enc = new TextEncoder(), dec = new TextDecoder();
const emptyPage=()=>({title:'',html:'',updated:0});
const emptyBook=()=>({pages:Array.from({length:4},emptyPage)});
const isAgent=()=>session?.mode==='agent';
const canEdit=index=>!!session?.key&&(!isAgent()||index===3);
function markdownHTML(source){
  const parsed=new DOMParser().parseFromString(marked.parse(source,{async:false,gfm:true,breaks:false}),'text/html');
  // Use the existing task structure so Markdown tasks have the same Enter/Backspace behavior.
  for(const item of [...parsed.querySelectorAll('li')].reverse()){
    const checkbox=item.querySelector(':scope > input[type=checkbox],:scope > p > input[type=checkbox]');if(!checkbox)continue;
    const row=parsed.createElement('div');row.className='todo-row';const text=parsed.createElement('span');text.className='todo-text';
    checkbox.remove();if(item.children.length===1&&item.firstElementChild.tagName==='P')text.append(...item.firstElementChild.childNodes);else text.append(...item.childNodes);
    row.append(checkbox,text);item.replaceWith(row);
  }
  for(const list of [...parsed.querySelectorAll('ul,ol')].reverse()){
    if(!list.querySelector(':scope > div.todo-row'))continue;
    const fragment=parsed.createDocumentFragment();let ordinary;
    for(const child of [...list.childNodes]){
      if(child.nodeType===1&&child.classList.contains('todo-row')){ordinary=undefined;fragment.append(child);}
      else if(child.nodeType===1){if(!ordinary){ordinary=list.cloneNode(false);fragment.append(ordinary);}ordinary.append(child);}
    }
    list.replaceWith(fragment);
  }
  return sanitize(parsed.body.innerHTML);
}
let book=emptyBook(),pageIndex=0;
let doc=book.pages[0],session,key,database,auth,ref,api,unsubscribe;
const drafts=new Map();
const readingPositions=[0,0,0,0];
let draftTimer,draftQueue=Promise.resolve();
const pageToken=page=>JSON.stringify([page.title,page.html,page.updated,page.markdown??null]);
function installBook(value){book=value;doc=book.pages[pageIndex];renderTabs();}

let connected = false, received = false, pendingReload = false, quietSaving = false;
let remoteQueue=Promise.resolve();
let revision = null, editing = false, conflict = false, busy = false, latest;
const b64 = bytes => { let result=''; for(let i=0;i<bytes.length;i+=8192) result+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(result); };
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const tell = message => { $('notice').textContent = message; };
const status = message => {
  const target=$('status');if(target.getAttribute('aria-label')===message)return;target.replaceChildren();target.title=message;target.setAttribute('aria-label',message);
  if(!message){target.dataset.state='';return;}
  const state=message==='已同步'?'synced':message==='未保存'?'dirty':message==='有冲突'?'conflict':/正在|同步中/.test(message)?'syncing':'offline';
  target.dataset.state=state;
  const paths={synced:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',syncing:'<path d="M20 9a8 8 0 1 0 0 6M20 4v5h-5"/>',dirty:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1"/>',conflict:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/>',offline:'<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'};
  target.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">'+paths[state]+'</svg>';
  const label=document.createElement('span');label.className='sr';label.textContent=message;target.append(label);
};
function sanitize(html) {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const allowed = new Set(['P','BR','DIV','STRONG','B','EM','I','U','H2','UL','OL','LI','BLOCKQUOTE','IMG','INPUT','SPAN','H1','H3','H4','H5','H6','PRE','CODE','HR','DEL','A','TABLE','THEAD','TBODY','TR','TH','TD']);
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
    const fontSize=node.style.fontSize||({2:'16px',3:'19px',5:'26px'}[node.getAttribute('size')]);
    if(['16px','19px','26px'].includes(fontSize))el.style.fontSize=fontSize;
    if(['bold','normal','400','700'].includes(node.style.fontWeight))el.style.fontWeight=node.style.fontWeight;
    if(node.tagName==='A'){const href=node.getAttribute('href')||'';if(/^(https?:\/\/|mailto:)/i.test(href)){el.setAttribute('href',href);el.setAttribute('rel','noopener noreferrer');el.setAttribute('target','_blank');}}
    if(node.tagName==='LI'&&node.querySelector(':scope > input[type=checkbox]'))el.classList.add('todo-row');
    if(['italic','normal'].includes(node.style.fontStyle))el.style.fontStyle=node.style.fontStyle;
    if(node.classList.contains('todo-row'))el.className='todo-row';
    if(node.classList.contains('todo-text'))el.className='todo-text';
    for(const name of ['learning-entry','learning-date','learning-content'])if(node.classList.contains(name))el.classList.add(name);
    if(el.classList.contains('learning-entry')){
      const id=node.getAttribute('data-learning-id'),at=node.getAttribute('data-learning-at');
      if(id&&/^[a-zA-Z0-9-]{1,64}$/.test(id))el.dataset.learningId=id;
      if(at&&/^\d{1,16}$/.test(at))el.dataset.learningAt=at;
    }
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
  applyReadingSize();$('edit').textContent='编辑';renderTabs();renderDate();applyAccess();
}
function mode(value) { multipleText?.clear();editing=value; $('clear').hidden=!value; $('editing').hidden=!value; $('reading').hidden=value; $('save').hidden=!value; $('edit').hidden=value; $('cancel').hidden=!value;applyAccess();resetPrivacyIdle(); }
async function derive(password, uid) {
  const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:enc.encode('one-page:v1:'+uid),iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},true,['encrypt','decrypt']);
}
async function encrypt(value,cryptoKey=key,maxBytes=contentLimit) {
  const plaintext=enc.encode(JSON.stringify(value));
  if(plaintext.byteLength>maxBytes)throw Error('四页内容合计超过 10 MB，请减少一些图片或文字。');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},cryptoKey,plaintext);
  const data=b64(new Uint8Array(ciphertext));
  // Keep small saves compatible with the original rules. Large saves use bounded chunks.
  if(data.length<=2700000)return {v:1,iv:b64(iv),data};
  const chunks=[];for(let offset=0;offset<data.length;offset+=1000000)chunks.push(data.slice(offset,offset+1000000));
  return {v:2,iv:b64(iv),data:chunks};
}
async function decryptRaw(value,cryptoKey=key){
  const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(value.iv)},cryptoKey,bytes(Array.isArray(value.data)?value.data.join(''):value.data));
  return JSON.parse(dec.decode(decoded));
}
async function decrypt(value,cryptoKey=key) {
  const valueDoc=await decryptRaw(value,cryptoKey);
  const pages=Array.isArray(valueDoc.pages)?valueDoc.pages:[valueDoc];
  if(pages.length>4)throw Error('页面数量不正确');
  return {pages:Array.from({length:4},(_,index)=>{
    const page=pages[index]||emptyPage();
    if(typeof page.title!=='string'||typeof page.html!=='string')throw Error('内容格式不正确');
    return {title:page.title,html:sanitize(page.html),updated:Number(page.updated)||0,...(typeof page.markdown==='string'?{markdown:page.markdown}:{})};
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
async function cachedPayload(action,value,cacheKey='payload'){
  const db=await openCache();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('current',action==='get'?'readonly':'readwrite');
    const store=transaction.objectStore('current');
    const request=action==='get'?store.get(cacheKey):action==='delete'?store.delete(cacheKey):store.put(value,cacheKey);
    transaction.oncomplete=()=>resolve(request.result);
    transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
  });
}
async function persist(value){
  const {payload,...metadata}=value;
  await cachedPayload('put',payload||null);
  localStorage.setItem(storageKey,JSON.stringify(metadata));
}
function contentChanged(content,base){return content.title!==base.title||content.html!==base.html;}
function rememberCurrentDraft(){
  if(markdownEditing){
    if(!canEdit(markdownIndex))return;
    const markdown=$('markdownText').value,content={title:$('markdownTitle').value.trim(),html:markdownHTML(markdown),markdown,updated:Date.now()};
    if(markdownDirty())drafts.set(markdownIndex,{content,base:markdownBase});else if(markdownPriorDraft)drafts.set(markdownIndex,markdownPriorDraft);else drafts.delete(markdownIndex);
    renderTabs();return;
  }
  if(!editing)return;
  const content=draft();
  if(contentChanged(content,doc))drafts.set(pageIndex,{content,base:doc});else drafts.delete(pageIndex);
  renderTabs();
}
function scheduleDraftCache(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>flushDraftCache(),250);}
function flushDraftCache(){
  clearTimeout(draftTimer);const owner=session,cryptoKey=key;
  if(!owner?.key||!cryptoKey)return Promise.resolve();
  const snapshot=[...drafts].map(([index,value])=>({index,...value}));
  draftQueue=draftQueue.catch(()=>{}).then(async()=>{
    if(session!==owner)return;
    const payload=snapshot.length?await encrypt({drafts:snapshot},cryptoKey,contentLimit*6):null;
    if(session!==owner)return;
    await cachedPayload(payload?'put':'delete',payload,'drafts');
  }).catch(error=>tell('草稿暂时无法缓存，请保存后再关闭：'+error.message));
  return draftQueue;
}
async function restoreDraftCache(alternateKey){
  const payload=await cachedPayload('get',undefined,'drafts');if(!payload)return;
  let recovered;
  try{recovered=await decryptRaw(payload);}catch(error){if(!alternateKey)throw error;recovered=await decryptRaw(payload,alternateKey);}
  drafts.clear();
  for(const entry of recovered.drafts||[]){
    if(!Number.isInteger(entry.index)||entry.index<0||entry.index>3)continue;
    if(!entry.content||!entry.base)continue;
    for(const page of [entry.content,entry.base]){if(typeof page.title!=='string'||typeof page.html!=='string')throw Error('草稿格式不正确');page.html=sanitize(page.html);}
    drafts.set(entry.index,{content:entry.content,base:entry.base});
  }
  renderTabs();
}
$('editor').addEventListener('input',()=>{rememberCurrentDraft();scheduleDraftCache();});
$('title').addEventListener('input',()=>{rememberCurrentDraft();scheduleDraftCache();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){rememberCurrentDraft();flushDraftCache();}});
window.addEventListener('pagehide',()=>{rememberCurrentDraft();flushDraftCache();});
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
async function wrappingId(passwordKey){
  const raw=await crypto.subtle.exportKey('raw',passwordKey);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function unlockContent(payload,passwordKey,uid){
  if(!payload)return {key:passwordKey,doc:emptyBook()};
  try{return {key:passwordKey,doc:await decrypt(payload,passwordKey)};}catch(error){if(error.name!=='OperationError')throw error;}
  const box=(await api.get(api.ref(database,'pages/'+uid+'/keyWraps/'+await wrappingId(passwordKey)))).val();
  if(box){
    const raw=await decryptRaw(box,passwordKey);
    if(raw.kind!=='data-key'||typeof raw.key!=='string')throw Error('密钥格式不正确');
    const dataKey=await crypto.subtle.importKey('raw',bytes(raw.key),'AES-GCM',true,['encrypt','decrypt']);
    return {key:dataKey,doc:await decrypt(payload,dataKey)};
  }
  throw new DOMException('The encryption key does not match.','OperationError');
}
async function savePasswordWrap(passwordKey,dataKey,uid){
  const id=await wrappingId(passwordKey),target=api.ref(database,'pages/'+uid+'/keyWraps/'+id);
  const raw=b64(new Uint8Array(await crypto.subtle.exportKey('raw',dataKey)));
  await api.set(target,await encrypt({kind:'data-key',key:raw},passwordKey));return id;
}
function handleSyncFailure(error){
  received=false;status('同步失败');
  if(error.name==='OperationError'||error.code==='PERMISSION_DENIED'||error.code==='permission-denied'){
    unsubscribe?.();unsubscribe=null;rememberCurrentDraft();flushDraftCache();
    showLogin();tell(error.name==='OperationError'?'此设备的密钥已过期。请用当前登录密码重新登录，缓存和草稿已保留；需要恢复时只填写一次原加密密码。':'登录权限已失效，请重新登录；本机缓存和草稿已保留，无需修改数据库规则。');
  }else if(error.code==='PERMISSION_DENIED'||error.code==='permission-denied')tell('登录权限已失效，请重新登录；无需修改公开读写规则。');
  else tell('同步失败：'+(error.message||'请检查网络连接。'));
}
function syncStatus() {
  if(busy)status('同步中');
  else if(!connected)status('离线');
  else if(!received)status('同步中');
  else if(conflict)status('有冲突');
  else status(editing?'未保存':'已同步');
}
function flagConflict(value){
  latest=value;conflict=true;$('conflictActions').hidden=markdownEditing||isAgent();
  tell('另一端已更新，当前修改已保留。请选择保留哪一份。');syncStatus();
}
async function acceptRemote(value){
  const activeSession=session;
  if(!activeSession)return;
  latest=value;received=true;
  if(busy)return;
  if(cipherToken(value)===revision){syncStatus();return;}
  const incoming=value?await decrypt(value):emptyBook();
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
    remoteQueue=remoteQueue.then(()=>acceptRemote(value)).catch(handleSyncFailure);
  },handleSyncFailure);
  const stopConnection=api.onValue(api.ref(database,'.info/connected'),snapshot=>{connected=!!snapshot.val();syncStatus();});
  unsubscribe=()=>{stopPage();stopConnection();};
}
function renderTabs(){
  document.querySelectorAll('[data-page]').forEach(button=>{
    const index=Number(button.dataset.page);button.disabled=busy&&!quietSaving;
    button.setAttribute('aria-current',index===pageIndex?'page':'false');
    button.classList.toggle('has-draft',drafts.has(index));
    button.title=book.pages[index].title||`第 ${index+1} 页`;
  });
  behaviorTools?.refreshRecords();applyAccess();
}
function switchPage(index){
  if(!Number.isInteger(index)||index<0||index>3||markdownEditing)return;
  if(busy||index===pageIndex)return;
  if(!editing)readingPositions[pageIndex]=window.scrollY;
  else{rememberCurrentDraft();flushDraftCache();}
  pageIndex=index;conflict=false;$('conflictActions').hidden=true;tell('');
  const saved=drafts.get(index);
  if(saved&&canEdit(index)&&!isAgent()){
    doc=saved.base;$('title').value=saved.content.title;$('editor').innerHTML=saved.content.html;mode(true);
    if(pageToken(book.pages[index])!==pageToken(doc))flagConflict(latest);
  }else{doc=book.pages[index];mode(false);render();}
  renderTabs();renderDate();syncStatus();window.scrollTo(0,editing?0:readingPositions[index]);
}
document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>switchPage(Number(button.dataset.page)));
function renderDate(){
  $('date').textContent=doc.updated?'保存于 '+new Date(doc.updated).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'尚未保存';
}
renderDate();
$('edit').onclick=()=>{
  if(busy||isAgent()||!canEdit(pageIndex))return;
  readingPositions[pageIndex]=window.scrollY;
  const saved=drafts.get(pageIndex);doc=saved?.base||book.pages[pageIndex];
  $('title').value=(saved?.content||doc).title;$('editor').innerHTML=sanitize((saved?.content||doc).html);
  conflict=false;mode(true);syncStatus();
  if(saved&&pageToken(doc)!==pageToken(book.pages[pageIndex]))flagConflict(latest);
};
$('cancel').onclick=()=>{
  if(busy)return;
  if(contentChanged(draft(),doc)&&!confirm('放弃本页未保存的修改？'))return;
  drafts.delete(pageIndex);flushDraftCache();doc=book.pages[pageIndex];conflict=false;$('conflictActions').hidden=true;
  mode(false);render();syncStatus();tell('');window.scrollTo(0,readingPositions[pageIndex]);
};
async function savePage(next,expectedPage=pageToken(doc),inPlace=false,target=pageIndex){
  if(!canEdit(target)){tell('AI 模式只能修改 Agent 页。');return false;}
  if(busy)return false;
  busy=true;quietSaving=inPlace;
  let quietProgress;
  if(inPlace)quietProgress=setTimeout(()=>{if(busy)status('同步中');},500);
  else{$('save').disabled=true;$('edit').disabled=true;renderTabs();syncStatus();}
  try{
    if(!navigator.onLine||!connected||!received)throw Error('尚未连接，请联网后保存。');
    let committedPayload,merged;
    for(let attempt=0;attempt<4;attempt++){
      const current=(await api.get(ref)).val();
      const fresh=current?await decrypt(current):emptyBook();
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
    book=merged;doc=book.pages[pageIndex];drafts.delete(target);await flushDraftCache();conflict=false;$('conflictActions').hidden=true;
    if(!inPlace){mode(false);render();}else renderDate();tell('');
    if(pendingReload&&!privacyHeld&&!markdownEditing&&!drafts.size&&$('cover').hidden)location.reload();return true;
  }catch(error){tell(error.message);return false;}
  finally{
    clearTimeout(quietProgress);busy=false;quietSaving=false;
    if(!inPlace){$('save').disabled=false;$('edit').disabled=false;renderTabs();}
    syncStatus();
    if(received&&cipherToken(latest)!==revision&&!editing){
      const pending=latest;remoteQueue=remoteQueue.then(()=>acceptRemote(pending)).catch(handleSyncFailure);
    }
  }
}
function draft(){return {title:$('title').value.trim(),html:sanitize($('editor').innerHTML),updated:Date.now()};}
$('save').onclick=()=>{if(conflict){tell('请先选择保留哪一份。');return;}return savePage(draft());};
$('useRemote').onclick=async()=>{
  if(busy||!confirm('放弃当前修改，使用另一端的内容？'))return;
  try{
    const value=(await api.get(ref)).val();
    const incoming=value?await decrypt(value):emptyBook();
    installBook(incoming);drafts.delete(pageIndex);flushDraftCache();revision=cipherToken(value);latest=value;session.payload=value;await persist(session);
    conflict=false;$('conflictActions').hidden=true;mode(false);render();tell('');syncStatus();
  }catch(error){tell('读取失败：'+error.message);}
};
$('useMine').onclick=async()=>{
  if(busy||!confirm('用当前修改替换另一端的内容？'))return;
  try{const remote=latest?await decrypt(latest):emptyBook();await savePage(draft(),pageToken(remote.pages[pageIndex]));}catch(error){tell(error.message);}
};
$('clear').onclick=()=>{if(!canEdit(pageIndex))return;if(!confirm('清空这一页？保存后生效。'))return;if(!editing)$('edit').click();$('title').value='';$('editor').replaceChildren();rememberCurrentDraft();scheduleDraftCache();tell('');};
function normalizeFontSizes(){for(const font of $('editor').querySelectorAll('font[size]')){font.style.fontSize={2:'16px',3:'19px',5:'26px'}[font.getAttribute('size')]||'19px';font.removeAttribute('size');}}
document.querySelectorAll('[data-command]').forEach(button=>{
  button.onmousedown=event=>event.preventDefault();
  button.onclick=()=>{
    const editor=$('editor'),selection=getSelection();
    if(multipleText.apply(button.dataset.command,button.dataset.value)){normalizeFontSizes();rememberCurrentDraft();scheduleDraftCache();return;}
    const selected=selection?.rangeCount&&!selection.isCollapsed&&editor.contains(selection.getRangeAt(0).commonAncestorContainer);
    editor.focus({preventScroll:true});
    if(button.dataset.command==='removeFormat'&&!selected){
      const range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
    }
    document.execCommand(button.dataset.command,false,button.dataset.value||null);
    if(button.dataset.command==='fontSize'){
      for(const font of editor.querySelectorAll('font[size]')){
        font.style.fontSize={2:'16px',3:'19px',5:'26px'}[font.getAttribute('size')]||'19px';font.removeAttribute('size');
      }
    }
    if(button.dataset.command==='removeFormat'&&!selected)selection.collapseToEnd();
    rememberCurrentDraft();scheduleDraftCache();
  };
});
multipleText=multiSelection($('editor'));
$('editor').addEventListener('keydown',event=>{const command={b:'bold',i:'italic'}[event.key.toLowerCase()];if(command&&(event.metaKey||event.ctrlKey)&&multipleText.apply(command)){event.preventDefault();normalizeFontSizes();rememberCurrentDraft();scheduleDraftCache();}});
let plainPasteUntil=0;
$('editor').addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.shiftKey&&event.key.toLowerCase()==='v')plainPasteUntil=Date.now()+1000;});
function looksLikeMarkdown(text){
  const block=new Set(['heading','list','blockquote','code','table','hr']);
  const inline=new Set(['strong','em','del','link','codespan']);
  return marked.lexer(text).some(token=>block.has(token.type)||token.tokens?.some(part=>inline.has(part.type)));
}
$('editor').addEventListener('paste',event=>{
  event.preventDefault();multipleText.clear();const editor=$('editor'),text=event.clipboardData?.getData('text/plain')||'',rich=event.clipboardData?.getData('text/html')||'';
  let html=null;
  if(Date.now()>=plainPasteUntil&&looksLikeMarkdown(text))html=markdownHTML(text);
  else if(Date.now()>=plainPasteUntil&&/<(?:h[1-6]|strong|b|em|i|ul|ol|li|blockquote|pre|code|table|a)\b/i.test(rich))html=sanitize(rich);
  const range=getSelection()?.rangeCount?getSelection().getRangeAt(0):null;
  const special='img,input,hr,table';
  const replaceAll=range&&!range.collapsed&&editor.contains(range.commonAncestorContainer)&&range.toString()===editor.textContent&&range.cloneContents().querySelectorAll(special).length===editor.querySelectorAll(special).length;
  if(replaceAll){
    // Drop the old enclosing heading/list using native editing operations before inserting blocks.
    document.execCommand('formatBlock',false,'div');
  }
  document.execCommand(html===null?'insertText':'insertHTML',false,html===null?text:html);
  plainPasteUntil=0;rememberCurrentDraft();scheduleDraftCache();
});
$('editor').addEventListener('drop',event=>event.preventDefault());
$('image').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>15*1024*1024)throw Error('请选择 15 MB 以内的图片。');
    const bitmap=await createImageBitmap(file);const scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const img=document.createElement('img');img.src=canvas.toDataURL('image/jpeg',.8);img.alt='给自己的图片';
    const total=book.pages.reduce((size,page,index)=>size+(index===pageIndex?0:enc.encode(page.html).byteLength),0)+enc.encode($('editor').innerHTML).byteLength+img.src.length;
    if(total>contentLimit-2048)throw Error('四页内容合计接近 10 MB，请先减少一些内容。');
    $('editor').append(img,document.createElement('p'));rememberCurrentDraft();scheduleDraftCache();tell('');
  }catch(error){tell(error.message);}event.target.value='';
};
window.addEventListener('beforeunload',event=>{if(markdownDirty()||(editing&&contentChanged(draft(),doc))||drafts.size){event.preventDefault();event.returnValue='';}});
function showLogin() {
  $('loginMode').value=isAgent()||agentEntry?'agent':'human';
  if(isAgent())setCover(false);
  $('date').disabled=true;$('accountSettings').disabled=true;$('date').textContent='未登录';
  $('loginForm').hidden=false;$('page').hidden=true;applyAccess();
  $('email').value=session?.email||'';
}
function showPage() {applyAccess();if(isAgent()){pageIndex=3;doc=book.pages[3];render();setCover(false);}$('date').disabled=false;$('accountSettings').disabled=false;$('loginForm').hidden=true;$('page').hidden=false;applyAccess();}
$('loginForm').onsubmit=async event=>{
  event.preventDefault();$('login').disabled=true;tell('');
  rememberCurrentDraft();await flushDraftCache();
  const previous=session, previousKey=key;
  unsubscribe?.();unsubscribe=null;
  let migrated=false,draftRecoveryKey=previousKey;
  try {
    session={config:firebaseConfig,email:$('email').value.trim(),mode:$('loginMode').value==='agent'?'agent':'human'};
    await connect();
    const credential=await api.signInWithEmailAndPassword(auth,session.email,$('password').value);
    const passwordKey=await derive($('password').value,credential.user.uid);key=passwordKey;
    const target=api.ref(database,'pages/'+credential.user.uid+'/current');
    let payload=(await api.get(target)).val(),cloudDoc;
    try{const unlocked=await unlockContent(payload,passwordKey,credential.user.uid);key=unlocked.key;cloudDoc=unlocked.doc;}
    catch(error){
      if(error.name!=='OperationError')throw error;
      let recoveryKey,recovered;
      if(previousKey){try{recovered=await decrypt(payload,previousKey);recoveryKey=previousKey;}catch{}}
      if(!recovered&&$('recoveryPassword').value){
        recoveryKey=await derive($('recoveryPassword').value,credential.user.uid);
        try{const unlocked=await unlockContent(payload,recoveryKey,credential.user.uid);recoveryKey=unlocked.key;recovered=unlocked.doc;}catch{throw Object.assign(Error('原加密密码不正确，请核对重置前的密码。'),{code:'recovery/incorrect'});}
      }
      if(!recovered){
        $('recoveryField').hidden=false;$('recoveryPassword').required=true;
        throw Object.assign(Error('登录密码已验证。请填写重置前的原加密密码以恢复内容。'),{code:'recovery/required'});
      }
      draftRecoveryKey=recoveryKey;key=recoveryKey;cloudDoc=recovered;
      session.wrapId=await savePasswordWrap(passwordKey,key,credential.user.uid);migrated=true;

    }
    if((doc.title||doc.html) && !previous?.key && !confirm('登录后显示云端内容，本机内容将替换。继续？')) {
      await api.signOut(auth);session=previous;key=previousKey;return;
    }
    session.wrapId=await wrappingId(passwordKey);
    session.key=b64(new Uint8Array(await crypto.subtle.exportKey('raw',key)));
    session.payload=payload;await persist(session);installBook(cloudDoc);await restoreDraftCache(draftRecoveryKey);await flushDraftCache();revision=cipherToken(payload);
    $('password').value='';$('recoveryPassword').value='';$('recoveryPassword').required=false;$('recoveryField').hidden=true;render();showPage();await listen(credential.user);if(migrated)tell('内容已恢复。以后只需当前密码登录，不用再填原加密密码。');
  }catch(error){
    session=previous;key=previousKey;
    const messages={
      'auth/invalid-credential':'邮箱或密码不正确。',
      'auth/operation-not-allowed':'请先在 Firebase 启用邮箱密码登录。',
      'auth/too-many-requests':'尝试过多，请稍后重试。',
      'auth/network-request-failed':'网络连接失败，请重试。',
      'auth/invalid-api-key':'Firebase 配置有误，请核对 API Key。',
      'PERMISSION_DENIED':'数据库未授权本次请求，请重新登录后重试。'
    };
    tell(messages[error.code] || (error.code?.startsWith('recovery/')?error.message:(error.name==='OperationError'?'无法解密，请检查原加密密码。':'登录失败：'+error.message)));
  }finally{$('login').disabled=false;}
};
async function boot(){
  try{
    const stored=JSON.parse(localStorage.getItem(storageKey)||'null');
    if(stored?.config && stored.key){
      if(!('payload' in stored))stored.payload=await cachedPayload('get');
      session={...stored,config:firebaseConfig,mode:stored.mode==='agent'?'agent':'human'};
      key=await crypto.subtle.importKey('raw',bytes(stored.key),'AES-GCM',true,['encrypt','decrypt']);
      if(stored.payload)installBook(await decrypt(stored.payload));
      await restoreDraftCache();
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
render();queueMicrotask(boot);
if('serviceWorker'in navigator){
  let refreshing=false;const controlledOnLoad=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(!controlledOnLoad)return;
    if(privacyHeld||markdownEditing||editing||drafts.size||busy||!$('loginForm').hidden||$('passwordDialog').open||!getSelection()?.isCollapsed||!$('cover').hidden){pendingReload=true;return;}
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
$('editor').addEventListener('keydown',event=>{if(event.key==='Enter')enterTask(event);else if(event.key==='Backspace'&&!event.isComposing){const row=currentTask();if(row&&!row.textContent.trim()){event.preventDefault();const block=document.createElement('div');block.append(document.createElement('br'));row.replaceWith(block);caretIn(block);}}});
$('editor').addEventListener('beforeinput',event=>{if(event.inputType==='insertParagraph')enterTask(event);});
function updateCheck(box){if(box.checked)box.setAttribute('checked','');else box.removeAttribute('checked');}
$('editor').addEventListener('change',event=>{if(event.target.matches('input[type=checkbox]')){updateCheck(event.target);rememberCurrentDraft();scheduleDraftCache();}});
$('reading').addEventListener('change',async event=>{
  const box=event.target;if(!box.matches('input[type=checkbox]'))return;
  if(busy||!canEdit(pageIndex)){box.checked=!box.checked;return;}
  updateCheck(box);
  const next={...doc,html:sanitize($('reading').querySelector('.body').innerHTML),updated:Date.now()};delete next.markdown;
  const saved=await savePage(next,pageToken(doc),true);
  if(!saved){
    // The attempted change remains available for retry without swapping page layouts.
    $('title').value=next.title;$('editor').innerHTML=next.html;
    if(conflict){mode(true);syncStatus();}
    else{box.checked=!box.checked;updateCheck(box);}
  }
});
// Triple tap without zoom. Ignore scrolling gestures and interactive controls.
let lastTap=null, startTap=null, lastToggle=0, savedScroll=0;
const idleDuration=2*60*1000;
let idleTimer,lastActivity=Date.now();
function armIdle(){
  clearTimeout(idleTimer);
  if(privacyDisabled()||automaticCoverPaused())return;
  if(!$('cover').hidden)return;
  idleTimer=setTimeout(automaticCover,Math.max(0,idleDuration-(Date.now()-lastActivity)));
}
function automaticCoverPaused(){return editing||markdownEditing||privacyHeld;}
function automaticCover(){if(automaticCoverPaused()){clearTimeout(idleTimer);return;}setCover(true);}
function resetPrivacyIdle(){lastActivity=Date.now();armIdle();}
function setCover(show){
  const cover=$('cover'),main=document.querySelector('main');
  if(show&&privacyDisabled())return;
  if(show===!cover.hidden){if(show){clearTimeout(idleTimer);positionReader();}return;}
  if(show){
    savedScroll=window.scrollY;document.activeElement?.blur();
    if($('passwordDialog').open)$('passwordDialog').close();
    rememberCurrentDraft();flushDraftCache();
  }
  cover.hidden=!show;main.inert=show;main.setAttribute('aria-hidden',String(show));document.body.classList.toggle('covered',show);
  document.title=show?'The Evening Times':'word 2 myself';getSelection()?.removeAllRanges();
  if(show){positionReader();clearTimeout(idleTimer);}
  else{lastActivity=Date.now();armIdle();window.scrollTo(0,savedScroll);if(pendingReload&&!privacyHeld&&!markdownEditing&&!editing&&!drafts.size&&!busy)location.reload();}
}
function toggleCover(){
  if(Date.now()-lastToggle<400)return;
  lastToggle=Date.now();setCover($('cover').hidden);
}
function noteActivity(event){
  if(privacyDisabled()||automaticCoverPaused())return;
  if(!$('cover').hidden)return;
  if(Date.now()-lastActivity>=idleDuration){automaticCover();event?.stopImmediatePropagation();return;}
  lastActivity=Date.now();armIdle();
}
for(const name of ['pointerdown','keydown','input','wheel','touchstart','scroll'])document.addEventListener(name,noteActivity,{capture:true,passive:true});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')automaticCover();});
window.addEventListener('pagehide',automaticCover);
window.addEventListener('pageshow',automaticCover);
function tapTarget(target){
  if(privacyDisabled())return false;
  if(target.closest('#cover'))return true;
  if(markdownEditing||editing||!$('loginForm').hidden||target.closest('#editing,button,input,label,[contenteditable],#conflictActions'))return false;
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
  if(lastTap&&now-lastTap.time<340&&Math.hypot(event.clientX-lastTap.x,event.clientY-lastTap.y)<25){
    const count=lastTap.count+1;
    if(count===3){event.preventDefault();lastTap=null;toggleCover();}
    else lastTap={x:event.clientX,y:event.clientY,time:now,count};
  }else lastTap={x:event.clientX,y:event.clientY,time:now,count:1};
},{passive:false});
document.addEventListener('click',event=>{if(event.detail===3&&tapTarget(event.target)&&!event.target.closest('input,button')){event.preventDefault();toggleCover();}});

$('editor').addEventListener('input',()=>{normalizeFontSizes();for(const row of $('editor').querySelectorAll('.todo-row')){if(!row.querySelector('input[type=checkbox]')||!row.querySelector('span'))row.classList.remove('todo-row');}});

$('date').onclick=async()=>{
  if(!session?.key||!auth)return;
  if(busy){tell('正在保存，请稍候。');return;}
  const warning=markdownDirty()||editing||drafts.size?'有未保存的修改。退出会丢弃草稿，云端内容保留。退出登录？':'退出此设备？云端内容保留。';
  if(!confirm(warning))return;
  try{
    const email=session.email;
    await api.signOut(auth);unsubscribe?.();unsubscribe=null;
    privacyHeld=false;session=null;key=null;ref=null;revision=null;latest=null;received=false;connected=false;
    drafts.clear();book=emptyBook();pageIndex=0;doc=book.pages[0];
    clearTimeout(draftTimer);await draftQueue;localStorage.removeItem(storageKey);await cachedPayload('delete');await cachedPayload('delete',undefined,'drafts');await cachedPayload('delete',undefined,'behavior');conflict=false;$('conflictActions').hidden=true;
    $('title').value='';$('editor').replaceChildren();$('password').value='';
    closeMarkdown();mode(false);render();showLogin();$('email').value=email||'';status('');tell('');window.scrollTo(0,0);
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

$('clearTitle').onclick=()=>{if(!canEdit(pageIndex))return;$('title').value='';rememberCurrentDraft();scheduleDraftCache();};

document.addEventListener('selectionchange',()=>{if(pendingReload&&!privacyHeld&&!markdownEditing&&!editing&&!drafts.size&&!busy&&$('loginForm').hidden&&!$('passwordDialog').open&&getSelection()?.isCollapsed&&$('cover').hidden)location.reload();});

$('addTodo').addEventListener('click',()=>{rememberCurrentDraft();scheduleDraftCache();});
$('editor').addEventListener('keydown',event=>{if(['Enter','Backspace'].includes(event.key))queueMicrotask(()=>{rememberCurrentDraft();scheduleDraftCache();});});

$('accountSettings').onclick=()=>{
  if(Date.now()<suppressVersionClickUntil)return;
  if(!session?.key||!auth?.currentUser){tell('请先登录。');return;}
  if(busy||isAgent())return;
  $('passwordChangeForm').reset();$('currentPasswordField').hidden=true;$('currentPassword').required=false;$('passwordChangeNotice').textContent='';$('passwordDialog').showModal();
};
$('closePasswordDialog').onclick=()=>{if(!$('changePassword').disabled)$('passwordDialog').close();};
$('passwordChangeForm').onsubmit=async event=>{
  event.preventDefault();const feedback=$('passwordChangeNotice');feedback.textContent='';
  if($('newPassword').value!==$('confirmPassword').value){feedback.textContent='两次新密码不一致。';return;}
  if(busy||!connected){feedback.textContent='请连接网络后再修改。';return;}
  const user=auth.currentUser;if(!user){feedback.textContent='请先重新登录。';return;}
  busy=true;$('changePassword').disabled=true;renderTabs();syncStatus();
  let prepared,previousBox,passwordChanged=false,wrapperReady=false;
  try{
    rememberCurrentDraft();await flushDraftCache();
    const payload=(await api.get(api.ref(database,'pages/'+user.uid+'/current'))).val();if(payload)await decrypt(payload);
    if(!$('currentPasswordField').hidden){await api.reauthenticateWithCredential(user,api.EmailAuthProvider.credential(user.email||session.email,$('currentPassword').value));}
    const passwordKey=await derive($('newPassword').value,user.uid),id=await wrappingId(passwordKey);
    prepared=api.ref(database,'pages/'+user.uid+'/keyWraps/'+id);previousBox=(await api.get(prepared)).val();
    await savePasswordWrap(passwordKey,key,user.uid);wrapperReady=true;
    await api.updatePassword(user,$('newPassword').value);passwordChanged=true;
    const previousId=session.wrapId;session.wrapId=id;await persist(session);
    // Remove only the known previous wrapper; never remove another device's staged change.
    if(previousId&&previousId!==id)api.remove(api.ref(database,'pages/'+user.uid+'/keyWraps/'+previousId)).catch(()=>{});
    $('passwordChangeForm').reset();$('passwordDialog').close();tell('密码已修改，内容和草稿保留。其他设备下次登录使用新密码。');
  }catch(error){
    if(!passwordChanged&&prepared&&['auth/requires-recent-login','auth/weak-password','auth/invalid-credential','auth/wrong-password','auth/too-many-requests'].includes(error.code)){
      try{if(previousBox)await api.set(prepared,previousBox);else await api.remove(prepared);}catch{}
    }
    if(error.code==='auth/requires-recent-login'){$('currentPasswordField').hidden=false;$('currentPassword').required=true;feedback.textContent='为确认是你本人，请补充当前登录密码后再提交。';}
    else if(error.code==='auth/invalid-credential'||error.code==='auth/wrong-password')feedback.textContent='当前登录密码不正确。';
    else feedback.textContent=passwordChanged?'密码已更新，但本机缓存未完成；请用新密码重新登录。':wrapperReady?'修改未完成：'+error.message+'。密钥保护已预先保存，请尝试用新密码登录。':'修改未完成，登录密码未更改：'+error.message;
  }finally{busy=false;$('changePassword').disabled=false;renderTabs();syncStatus();}
};

$('passwordDialog').addEventListener('cancel',event=>{if($('changePassword').disabled)event.preventDefault();});

// Small action tools live outside the editor/sync/cover implementation.
let chosenBehaviorTask;
function insertBehaviorNodes(nodes){
  if(!canEdit(pageIndex))throw Error('AI 模式只能修改 Agent 页。');
  if(busy)throw Error('正在保存，请稍后再试。');
  if(!editing)$('edit').click();
  $('editor').append(...nodes);rememberCurrentDraft();scheduleDraftCache();
}
async function changeLearningPage(change){
  if(isAgent())throw Error('AI 模式不能修改前三页或学习记录。');
  if(busy)throw Error('正在保存，请稍后再试。');
  if(!session?.key||!navigator.onLine||!connected||!received)throw Error('请联网并登录后再保存记录；输入会留在本机。');
  if(drafts.has(1)||(editing&&pageIndex===1&&contentChanged(draft(),doc)))throw Error('第二页有未保存修改，请先保存或取消，再记这一句。');
  busy=true;$('save').disabled=true;$('edit').disabled=true;renderTabs();syncStatus();
  try{
    let payload,merged;
    for(let attempt=0;attempt<4;attempt++){
      const current=(await api.get(ref)).val(),fresh=current?await decrypt(current):emptyBook();
      const changed={...fresh.pages[1],html:sanitize(changeLearningEntry(fresh.pages[1].html,change)),updated:Date.now()};
      merged={pages:fresh.pages.map((page,index)=>index===1?changed:page)};
      const next=await encrypt(merged),expected=cipherToken(current);
      const result=await api.runTransaction(ref,value=>cipherToken(value)===expected?next:undefined,{applyLocally:false});
      if(result.committed){payload=next;if(cipherToken(latest)===expected)latest=next;break;}
    }
    if(!payload)throw Error('另一端正在更新，请再点一次保存。');
    book=merged;revision=cipherToken(payload);session.payload=payload;await persist(session);
    if(editing){if(pageToken(book.pages[pageIndex])!==pageToken(doc))flagConflict(payload);}
    else{doc=book.pages[pageIndex];render();}
    renderTabs();return true;
  }finally{
    busy=false;$('save').disabled=false;$('edit').disabled=false;renderTabs();syncStatus();
    if(received&&cipherToken(latest)!==revision){const pending=latest;remoteQueue=remoteQueue.then(()=>acceptRemote(pending)).catch(handleSyncFailure);}
  }
}
behaviorTools=initBehaviorTools({
  ready:()=>!!session?.key&&!isAgent()&&$('loginForm').hidden,
  owner:()=>session?.key?session:undefined,
  currentPage:()=>pageIndex,
  chooseTask:row=>{chosenBehaviorTask=row;},
  selectedTask:()=>{const row=(editing?currentTask():null)||(chosenBehaviorTask?.isConnected?chosenBehaviorTask:null);chosenBehaviorTask=null;return row?.querySelector('span')?.textContent?.trim()||'';},
  learningHtml:()=>book.pages[1].html,
  changeLearning:changeLearningPage,
  async loadLocal(owner){
    if(owner!==session||!key)return null;const record=await cachedPayload('get',undefined,'behavior');return record?decryptRaw(record):null;
  },
  async saveLocal(value,owner){
    if(!owner||owner!==session||!key)return;const cryptoKey=key,payload=await encrypt(value,cryptoKey);
    if(owner!==session)return;await cachedPayload('put',payload,'behavior');
  },
  insertReflection(context,answer){
    const block=document.createElement('blockquote');if(context){const title=document.createElement('p');title.textContent=context;block.append(title);}const text=document.createElement('p');text.textContent=answer;block.append(text);insertBehaviorNodes([block]);
  },
  insertPrinciple(){
    const title=document.createElement('h2');title.textContent='关于……';const body=document.createElement('p');body.textContent='我愿意记住：';insertBehaviorNodes([title,body]);caretIn(title,true);
  }
});

positionReader=mountReader($('cover'));positionReader();

function applyAccess(){
  const allowed=canEdit(pageIndex);
  $('readingSize').hidden=!session?.key||!$('loginForm').hidden||editing||markdownEditing;
  $('edit').hidden=isAgent()||editing||markdownEditing||!allowed;
  $('markdownButton').hidden=editing||markdownEditing||!session?.key;
  $('behaviorStart').hidden=isAgent();$('behaviorMore').hidden=isAgent();
  $('accountSettings').disabled=isAgent()||!session?.key;
  $('accountSettings').title=isAgent()?'AI 模式 · 退出后可重新选择':editing||markdownEditing?'编辑时已暂停自动遮挡；单击修改密码':privacyHeld?'自动遮挡已暂停；长按恢复，单击修改密码':'长按暂停自动遮挡；单击修改密码';
  $('accountSettings').dataset.privacyHeld=String(privacyHeld);
  $('accountSettings').setAttribute('aria-pressed',String(privacyHeld));
  $('reading').querySelectorAll('input[type=checkbox]').forEach(box=>box.disabled=!allowed||isAgent());
}
function markdownDirty(){return markdownEditing&&($('markdownText').value!==markdownInitial.markdown||$('markdownTitle').value!==markdownInitial.title);}
function closeMarkdown(){markdownEditing=false;$('markdownText').value='';$('markdownTitle').value='';markdownBase=undefined;markdownPriorDraft=undefined;$('markdownPanel').hidden=true;$('page').hidden=!session?.key;applyAccess();resetPrivacyIdle();}
$('markdownButton').onclick=()=>{
  if(busy||editing||markdownEditing)return;
  markdownIndex=pageIndex;markdownBase=doc;markdownEditing=true;
  markdownPriorDraft=drafts.get(pageIndex);const local=markdownPriorDraft?.content;
  markdownInitial={title:(local||doc).title,markdown:local?.markdown??local?.html??doc.markdown??doc.html};
  $('markdownTitle').value=markdownInitial.title;$('markdownText').value=markdownInitial.markdown;
  const allowed=canEdit(pageIndex);$('markdownTitle').readOnly=!allowed;$('markdownText').readOnly=!allowed;$('markdownSave').hidden=!allowed;
  $('markdownHint').textContent=allowed?'Markdown · 保存后替换当前页；原有富文本可保留为 HTML。':'只读 · AI 只能修改 Agent 页。';
  $('markdownNotice').textContent='';$('markdownReload').hidden=true;$('page').hidden=true;$('markdownPanel').hidden=false;applyAccess();resetPrivacyIdle();
};
$('markdownCancel').onclick=()=>{if(markdownDirty()&&!confirm('放弃尚未保存的 Markdown 修改？'))return;if(markdownPriorDraft)drafts.set(markdownIndex,markdownPriorDraft);else drafts.delete(markdownIndex);flushDraftCache();closeMarkdown();renderTabs();};
for(const id of ['markdownText','markdownTitle'])$(id).addEventListener('input',()=>{rememberCurrentDraft();scheduleDraftCache();});
$('markdownSave').onclick=async()=>{
  if(!canEdit(markdownIndex)||busy)return;
  $('markdownSave').disabled=true;
  try{
    const markdown=$('markdownText').value,next={title:$('markdownTitle').value.trim(),html:markdownHTML(markdown),markdown,updated:Date.now()};
    const saved=await savePage(next,pageToken(markdownBase),false,markdownIndex);
    if(saved)closeMarkdown();else{ $('conflictActions').hidden=true;$('markdownNotice').textContent=$('notice').textContent||'保存未完成，输入已保留。';$('markdownReload').hidden=!conflict;}
  }catch(error){$('markdownNotice').textContent=error.message;}finally{$('markdownSave').disabled=false;}
};
const contentRevision=async page=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(pageToken(page))))].map(x=>x.toString(16).padStart(2,'0')).join('');
function requireAgentReady(){if(!session?.key||!isAgent()||!$('loginForm').hidden)throw Error('请先使用 AI Agent 模式登录。');if(!received||!connected||!navigator.onLine)throw Error('同步未就绪，请联网后重试。');}
Object.defineProperty(window,'word2myself',{value:Object.freeze({
  version:1,
  status:()=>({ready:!!session?.key&&$('loginForm').hidden&&received&&connected,mode:session?.mode||null,writablePages:isAgent()?['Agent']:[],busy}),
  async read(){
    requireAgentReady();const owner=session,value=(await api.get(ref)).val(),snapshot=value?await decrypt(value):emptyBook();
    if(owner!==session)throw Error('登录已改变。');
    return {pages:await Promise.all(snapshot.pages.map(async(page,index)=>({id:index===3?'Agent':String(index+1).padStart(2,'0'),title:page.title,html:page.html,markdown:page.markdown??page.html,updated:page.updated,revision:await contentRevision(page),writable:index===3}))) };
  },
  async write({page='Agent',title,markdown,expectedRevision}={}){
    requireAgentReady();if(page!=='Agent')throw Error('AI 只能修改 Agent 页。');
    if(typeof markdown!=='string'||typeof title!=='string'||title.length>100||typeof expectedRevision!=='string')throw Error('需要 title、markdown 和读取时的 expectedRevision。');
    if(busy||editing||markdownEditing||drafts.has(3))throw Error('存在编辑或保存，请先完成当前操作。');
    const owner=session,current=(await api.get(ref)).val(),fresh=current?await decrypt(current):emptyBook();
    if(owner!==session)throw Error('登录已改变。');
    if(await contentRevision(fresh.pages[3])!==expectedRevision)throw Error('Agent 页已更新，请重新读取并合并后再写。');
    const next={title,html:markdownHTML(markdown),markdown,updated:Date.now()};
    if(!await savePage(next,pageToken(fresh.pages[3]),false,3))throw Error($('notice').textContent||'保存失败，请重新读取。');
    return {saved:true,page:'Agent',revision:await contentRevision(next)};
  }
}),writable:false,configurable:false});
if(agentEntry){
  $('loginMode').value='agent';if(!session?.key){$('cover').hidden=true;document.querySelector('main').inert=false;document.querySelector('main').setAttribute('aria-hidden','false');document.body.classList.remove('covered');document.title='word 2 myself';}
}

$('markdownReload').onclick=async()=>{
  if(busy||!confirm('用最新云端内容替换当前 Markdown 输入？未保存输入会丢弃。'))return;
  try{
    const owner=session,payload=(await api.get(ref)).val(),fresh=payload?await decrypt(payload):emptyBook();
    if(owner!==session)throw Error('登录已改变。');
    const page=fresh.pages[markdownIndex];markdownBase=page;markdownPriorDraft=undefined;
    markdownInitial={title:page.title,markdown:page.markdown??page.html};$('markdownTitle').value=markdownInitial.title;$('markdownText').value=markdownInitial.markdown;
    drafts.delete(markdownIndex);await flushDraftCache();conflict=false;$('conflictActions').hidden=true;$('markdownReload').hidden=true;$('markdownNotice').textContent='';tell('');renderTabs();syncStatus();
  }catch(error){$('markdownNotice').textContent=error.message;}
};


function readingScale(){try{const saved=Number(localStorage.getItem('one-page:reading-size'));return readingSteps.includes(saved)?saved:1;}catch{return 1;}}
function applyReadingSize(){
  const root=$('reading'),scale=readingScale();
  const fresh=[...root.querySelectorAll('*:not([data-read-sized])')].map(node=>[node,getComputedStyle(node).fontSize]);
  for(const [node,size] of fresh){node.style.setProperty('--read-base',size);node.setAttribute('data-read-sized','');}
  root.style.setProperty('--read-scale',scale);
  $('readingSmaller').disabled=scale===readingSteps[0];$('readingLarger').disabled=scale===readingSteps.at(-1);
  $('readingSize').title='阅读字号 '+Math.round(scale*100)+'%';
}
for(const [id,delta] of [['readingSmaller',-1],['readingLarger',1]])$(id).onclick=()=>{
  const index=readingSteps.indexOf(readingScale()),next=readingSteps[Math.max(0,Math.min(readingSteps.length-1,index+delta))];
  try{localStorage.setItem('one-page:reading-size',String(next));}catch{}
  applyReadingSize();
};

// A short click keeps password settings; a deliberate hold toggles the temporary privacy pause.

function cancelVersionPress(){clearTimeout(versionHoldTimer);versionPress=null;}
function canHoldVersion(){return !!session?.key&&!isAgent()&&!editing&&!markdownEditing&&!busy&&!$('passwordDialog').open&&$('loginForm').hidden&&$('cover').hidden;}
function beginVersionPress(x,y,pointer){
  cancelVersionPress();versionPress={x,y,pointer,at:Date.now(),fired:false};
  if(!canHoldVersion())return;
  versionHoldTimer=setTimeout(()=>{
    if(!versionPress||!canHoldVersion())return;
    versionPress.fired=true;privacyHeld=!privacyHeld;suppressVersionClickUntil=Date.now()+1200;applyAccess();resetPrivacyIdle();
  },650);
}
$('accountSettings').addEventListener('pointerdown',event=>{if(event.button===0)beginVersionPress(event.clientX,event.clientY,event.pointerId);});
$('accountSettings').addEventListener('pointermove',event=>{if(versionPress&&Math.hypot(event.clientX-versionPress.x,event.clientY-versionPress.y)>12)cancelVersionPress();});
$('accountSettings').addEventListener('pointerup',()=>{if(versionPress&&(versionPress.fired||Date.now()-versionPress.at>=650))suppressVersionClickUntil=Date.now()+800;cancelVersionPress();});
for(const event of ['pointercancel','pointerleave'])$('accountSettings').addEventListener(event,cancelVersionPress);
$('accountSettings').addEventListener('contextmenu',event=>event.preventDefault());
$('accountSettings').addEventListener('keydown',event=>{if(event.key===' '&&!event.repeat)beginVersionPress(0,0,'keyboard');});
$('accountSettings').addEventListener('keyup',event=>{if(event.key===' '){if(versionPress&&(versionPress.fired||Date.now()-versionPress.at>=650)){event.preventDefault();suppressVersionClickUntil=Date.now()+800;}cancelVersionPress();}});
addEventListener('blur',cancelVersionPress);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')cancelVersionPress();});
