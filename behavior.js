import { behaviorCopy as copy } from './behavior-copy.js';

export function readLearningEntries(html) {
  const parsed=new DOMParser().parseFromString(html,'text/html');
  return [...parsed.querySelectorAll('div.learning-entry[data-learning-id]')].map(node=>({
    id:node.dataset.learningId,at:Number(node.dataset.learningAt)||0,
    text:node.querySelector('.learning-content')?.textContent||'',original:node.outerHTML
  })).sort((a,b)=>b.at-a.at);
}
export function changeLearningEntry(html,change) {
  const parsed=new DOMParser().parseFromString(html,'text/html');
  const entries=[...parsed.querySelectorAll('div.learning-entry[data-learning-id]')];
  if(change.type==='add') {
    if(entries.length>=copy.recordLimit)throw Error('这里只保留最近 20 条。先删除一条旧记录，再添加新的。');
    const row=parsed.createElement('div');row.className='learning-entry';row.dataset.learningId=change.id;row.dataset.learningAt=String(change.at);
    const date=parsed.createElement('p');date.className='learning-date';date.textContent=new Date(change.at).toLocaleDateString('zh-CN');
    const content=parsed.createElement('p');content.className='learning-content';content.textContent=change.text;
    row.append(date,content);parsed.body.append(row);
  }else{
    const row=entries.find(node=>node.dataset.learningId===change.id);
    if(!row)throw Error('这条记录已被删除，请查看最新记录。');
    if(row.outerHTML!==change.original)throw Error('这条记录已在另一端修改，请重新选择后再改。');
    if(change.type==='delete')row.remove();
    else {let content=row.querySelector('.learning-content');if(!content){content=parsed.createElement('p');content.className='learning-content';row.append(content);}content.textContent=change.text;}
  }
  return parsed.body.innerHTML;
}

export function initBehaviorTools(bridge) {
  const $=id=>document.getElementById(id),panel=$('behaviorPanel');
  panel.innerHTML=`<div class="behavior-heading"><span id="behaviorHeading"></span><button id="behaviorBack" type="button">返回</button></div>
  <section id="behaviorMenu" hidden><div class="behavior-menu"><button data-tool="stuck">卡住了？</button><button data-tool="learning">今天学会了什么</button><button data-tool="motives">为什么要做</button><button data-tool="principle" id="principleTool" hidden>补一条长期原则</button></div></section>
  <section id="focusSetup" hidden><p class="behavior-muted">${copy.focusIntro}</p><label for="focusTask">准备做什么</label><textarea id="focusTask" rows="2" maxlength="1000" placeholder="只写眼前这一件事"></textarea><label for="focusStep">第一步 <span class="behavior-muted">（可选）</span></label><input id="focusStep" maxlength="400" placeholder="例如：打开题目，先独立读一遍"><div id="focusDurations" class="behavior-duration" role="group" aria-label="时长"></div><button id="focusBegin" type="button">开始 5 分钟</button></section>
  <section id="focusRunning" hidden><p id="focusAction" class="focus-action"></p><p id="focusFirstStep" class="behavior-muted"></p><div id="focusClock" class="focus-clock" role="timer" aria-live="off"></div><p id="focusEndMessage" class="behavior-muted"></p><div class="behavior-actions"><button id="focusContinue" type="button" hidden>再开始 5 分钟</button><button id="focusEnd" type="button">结束并返回</button></div></section>
  <section id="stuckChoices" hidden><p>现在卡在哪里？</p><div id="stuckOptions" class="behavior-menu"></div></section>
  <section id="stuckAdvice" hidden><h2 id="stuckSituation"></h2><p id="stuckSuggestion" class="behavior-advice"></p><div class="behavior-actions"><button id="stuckStart" type="button">先开始 5 分钟</button><button id="stuckOther" type="button">换一个原因</button></div></section>
  <section id="learningTool" hidden><label for="learningText">一句具体的学习证据</label><textarea id="learningText" rows="3" maxlength="600" placeholder="例如：不依赖 AI，独立写出了一个 JOIN 查询。"></textarea><div class="behavior-actions"><button id="learningSave" type="button">记下这一句</button><button id="learningCancel" type="button" hidden>取消修改</button></div><p class="behavior-muted">保存在第二页，和原有内容一起同步。只在需要时记录。</p><details id="learningRecent"><summary>最近记录</summary><div id="learningList"></div></details></section>
  <section id="motivesTool" hidden><p id="motiveContext" class="behavior-muted"></p><ol id="motiveQuestions"></ol><p class="behavior-muted">${copy.motiveNote}</p><label class="sr" for="motiveAnswer">自己的判断（可选）</label><textarea id="motiveAnswer" rows="3" maxlength="2000" placeholder="愿意的话，写一句自己的选择（可选）"></textarea><button id="motiveInsert" type="button">留在当前页</button></section><p id="behaviorNotice" role="alert"></p>`;
  const sections=['behaviorMenu','focusSetup','focusRunning','stuckChoices','stuckAdvice','learningTool','motivesTool'];
  let owner,restoreVersion=0,route='',returnScroll=0,saveQueue=Promise.resolve(),restoreDone=Promise.resolve(),saveTimer,ticker,selectedMinutes=5,contextText='',activeReason;
  let state={focus:null,learningDraft:{id:null,text:'',original:''}};
  const message=text=>{$('behaviorNotice').textContent=text;};
  function cacheSoon(){clearTimeout(saveTimer);saveTimer=setTimeout(cacheNow,200);}
  function cacheNow(){
    clearTimeout(saveTimer);const identity=bridge.owner(),snapshot=structuredClone(state);
    saveQueue=saveQueue.catch(()=>{}).then(()=>bridge.saveLocal(snapshot,identity)).catch(()=>{if(route)message('暂时无法缓存，请保持页面打开。');});return saveQueue;
  }
  function selectedText(){
    const selection=getSelection();if(selection?.rangeCount&&!selection.isCollapsed){const range=selection.getRangeAt(0);if((!$('reading').hidden&&$('reading').contains(range.commonAncestorContainer))||(!$('editing').hidden&&$('editor').contains(range.commonAncestorContainer)))return selection.toString().trim().slice(0,1000);}
    return bridge.selectedTask().slice(0,1000);
  }
  function show(name,title){
    if(!route)returnScroll=window.scrollY;
    route=name;sections.forEach(id=>$(id).hidden=id!==name);$('behaviorHeading').textContent=title;panel.hidden=false;document.body.classList.add('behavior-open');message('');window.scrollTo(0,0);
  }
  function close(){
    route='';panel.hidden=true;document.body.classList.remove('behavior-open');window.scrollTo(0,returnScroll);
  }
  function tick(){
    const focus=state.focus;if(!focus)return;
    const seconds=Math.max(0,Math.ceil((focus.endsAt-Date.now())/1000));
    $('focusClock').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    $('focusEndMessage').textContent=seconds?'':copy.focusEnd;$('focusContinue').hidden=seconds>0;
    if(!seconds){clearInterval(ticker);ticker=undefined;}
  }
  function updateStartLabel(){
    $('behaviorStart').textContent=state.focus?'继续这一段':'开始 5 分钟';
  }
  function running(){
    if(!state.focus)return;
    show('focusRunning','只做眼前这一件事');$('focusAction').textContent=state.focus.task;$('focusFirstStep').textContent=state.focus.step?('第一步：'+state.focus.step):'';
    clearInterval(ticker);tick();if(state.focus.endsAt>Date.now())ticker=setInterval(tick,1000);updateStartLabel();
  }
  function setup(task='',step=''){
    show('focusSetup','先开始一小段');$('focusTask').value=task;$('focusStep').value=step;selectedMinutes=5;renderDurations();
  }
  function renderDurations(){
    $('focusDurations').replaceChildren();for(const minutes of copy.durations){const button=document.createElement('button');button.type='button';button.textContent=minutes+' 分钟';button.setAttribute('aria-pressed',String(selectedMinutes===minutes));button.onclick=()=>{selectedMinutes=minutes;renderDurations();};$('focusDurations').append(button);}$('focusBegin').textContent='开始 '+selectedMinutes+' 分钟';
  }
  function begin(){
    const task=$('focusTask').value.trim();if(!task){message('写一句准备开始的事情就够了。');return;}
    state.focus={task,step:$('focusStep').value.trim(),minutes:selectedMinutes,endsAt:Date.now()+selectedMinutes*60000};cacheNow();running();
  }
  function end(){state.focus=null;clearInterval(ticker);ticker=undefined;cacheNow();updateStartLabel();close();}
  $('behaviorStart').onmousedown=event=>event.preventDefault();
  $('behaviorStart').onclick=async()=>{if(!bridge.ready())return;const text=selectedText();await restoreDone;if(!bridge.ready())return;if(state.focus&&!text)running();else setup(text);};
  $('behaviorMore').onmousedown=event=>event.preventDefault();
  $('behaviorMore').onclick=async()=>{if(!bridge.ready())return;contextText=selectedText();await restoreDone;if(!bridge.ready())return;$('principleTool').hidden=bridge.currentPage()!==2;show('behaviorMenu','需要时，用一下');};
  $('behaviorBack').onclick=()=>{if(route==='focusRunning')end();else close();};
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();if(route==='focusRunning')end();else close();}});
  $('focusBegin').onclick=begin;$('focusEnd').onclick=end;
  $('focusContinue').onclick=()=>{state.focus={...state.focus,minutes:5,endsAt:Date.now()+5*60000};cacheNow();running();};
  for(const reason of copy.stuck){const button=document.createElement('button');button.type='button';button.textContent=reason.label;button.onclick=()=>{activeReason=reason;show('stuckAdvice','卡住了？');$('stuckSituation').textContent=reason.label;$('stuckSuggestion').textContent=reason.advice;$('stuckStart').textContent=reason.id==='tired'?'先休息，返回原页':'先开始 5 分钟';};$('stuckOptions').append(button);}
  $('stuckOther').onclick=()=>show('stuckChoices','卡住了？');
  $('stuckStart').onclick=()=>{if(activeReason.id==='tired')close();else setup(contextText,activeReason.step);};
  for(const question of copy.motives){const li=document.createElement('li');li.textContent=question;$('motiveQuestions').append(li);}
  panel.querySelectorAll('[data-tool]').forEach(button=>button.onclick=()=>{
    switch(button.dataset.tool){
      case 'stuck':show('stuckChoices','卡住了？');break;
      case 'learning':show('learningTool','今天学会了什么');renderLearningDraft();refreshRecords();break;
      case 'motives':show('motivesTool','为什么要做');$('motiveContext').textContent=contextText;$('motiveAnswer').value='';break;
      case 'principle':try{bridge.insertPrinciple();close();}catch(error){message(error.message);}break;
    }
  });
  $('motiveInsert').onclick=()=>{
    const answer=$('motiveAnswer').value.trim();if(!answer){message('可以只读问题，不必留下答案。');return;}
    try{bridge.insertReflection(contextText,answer);close();}catch(error){message(error.message);}
  };
  function renderLearningDraft(){const draft=state.learningDraft||{id:null,text:'',original:''};$('learningText').value=draft.text;$('learningSave').textContent=draft.id?'保存修改':'记下这一句';$('learningCancel').hidden=!draft.id;}
  function refreshRecords(){
    if(route!=='learningTool')return;
    const list=$('learningList');list.replaceChildren();
    const entries=readLearningEntries(bridge.learningHtml());
    if(!entries.length){const empty=document.createElement('p');empty.className='behavior-muted';empty.textContent='还没有记录。想记时再记。';list.append(empty);return;}
    for(const entry of entries){
      const row=document.createElement('div');row.className='learning-preview';const date=document.createElement('small');date.textContent=new Date(entry.at).toLocaleDateString('zh-CN');const text=document.createElement('p');text.textContent=entry.text;const actions=document.createElement('div');actions.className='behavior-actions';
      const edit=document.createElement('button');edit.textContent='修改';edit.type='button';edit.onclick=()=>{if(state.learningDraft.text.trim()&&(state.learningDraft.id!==entry.id||state.learningDraft.text!==entry.text)&&!confirm('切换记录会替换尚未保存的输入，继续？'))return;state.learningDraft={id:entry.id,text:entry.text,original:entry.original};renderLearningDraft();cacheSoon();};
      const remove=document.createElement('button');remove.textContent='删除';remove.type='button';remove.onclick=async()=>{if(!confirm('删除这条学习记录？'))return;remove.disabled=true;try{await bridge.changeLearning({type:'delete',id:entry.id,original:entry.original});if(state.learningDraft.id===entry.id){state.learningDraft={id:null,text:'',original:''};renderLearningDraft();cacheNow();}refreshRecords();message('');}catch(error){message(error.message);}finally{remove.disabled=false;}};
      actions.append(edit,remove);row.append(date,text,actions);list.append(row);
    }
  }
  $('learningText').addEventListener('input',()=>{state.learningDraft={...state.learningDraft,text:$('learningText').value};cacheSoon();});
  $('learningCancel').onclick=()=>{state.learningDraft={id:null,text:'',original:''};renderLearningDraft();cacheNow();};
  $('learningSave').onclick=async()=>{
    const text=$('learningText').value.trim();if(!text){message('写一句具体学会的事情即可。');return;}
    const draft=state.learningDraft;const change=draft.id?{type:'edit',id:draft.id,text,original:draft.original}:{type:'add',id:crypto.randomUUID(),at:Date.now(),text};
    $('learningSave').disabled=true;
    try{await bridge.changeLearning(change);state.learningDraft={id:null,text:'',original:''};renderLearningDraft();await cacheNow();refreshRecords();message('');}
    catch(error){message(error.message);refreshRecords();}finally{$('learningSave').disabled=false;}
  };
  async function checkOwner(){
    const current=bridge.owner();
    if(!bridge.ready()){close();if(!current){owner=undefined;restoreVersion++;state={focus:null,learningDraft:{id:null,text:'',original:''}};clearInterval(ticker);updateStartLabel();}return;}
    if(current===owner)return restoreDone;
    owner=current;const generation=++restoreVersion;
    try{const loaded=await bridge.loadLocal(current);if(owner!==current||generation!==restoreVersion)return;
      state={focus:null,learningDraft:{id:null,text:'',original:''}};
      if(loaded?.focus&&typeof loaded.focus.task==='string'&&Number.isFinite(loaded.focus.endsAt)&&copy.durations.includes(loaded.focus.minutes))state.focus=loaded.focus;
      if(loaded?.learningDraft&&typeof loaded.learningDraft.text==='string')state.learningDraft=loaded.learningDraft;
      updateStartLabel();
    }catch{if(route)message('暂时无法恢复行动草稿，可以重新开始。');}
  }
  const syncOwner=()=>{restoreDone=checkOwner();};
  new MutationObserver(syncOwner).observe($('loginForm'),{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')cacheNow();else tick();});
  window.addEventListener('pagehide',cacheNow);
  document.addEventListener('pointerup',event=>{const row=event.target.closest?.('#reading .todo-row');if(row&&!event.target.matches('input'))bridge.chooseTask(row);});
  syncOwner();
  return {refreshRecords};
}
