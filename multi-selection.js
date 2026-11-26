// Keep extra text ranges outside the editable DOM. No markers are saved into content.
export function multiSelection(editor){
  let ranges=[],drag=null,applying=false;
  const selection=()=>getSelection();
  const valid=range=>!range.collapsed&&editor.contains(range.commonAncestorContainer);
  const inline=new Set(['bold','italic','foreColor','fontSize','removeFormat']);
  const controls=[...document.querySelectorAll('.toolbar button,.toolbar .image-button')];
  const overlay=document.createElement('div');overlay.className='multi-selection-overlay';overlay.setAttribute('aria-hidden','true');document.body.append(overlay);
  const hint=document.createElement('span');hint.className='multi-selection-hint';hint.setAttribute('role','status');document.querySelector('.toolbar').append(hint);
  function refresh(){
    ranges=ranges.filter(valid);overlay.replaceChildren();
    for(const range of ranges)for(const rect of range.getClientRects()){
      if(rect.width<=0||rect.height<=0)continue;
      const mark=document.createElement('i');Object.assign(mark.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});overlay.append(mark);
    }
    hint.textContent=ranges.length>1?`已选 ${ranges.length} 处 · Esc 取消`:'';
    for(const button of controls){const restricted=ranges.length>1&&!inline.has(button.dataset.command);if(button.tagName==='BUTTON')button.disabled=restricted;else button.classList.toggle('multi-disabled',restricted);}
  }
  function clear(){ranges=[];drag=null;refresh();}
  function normalize(){
    ranges=ranges.filter(valid).sort((a,b)=>a.compareBoundaryPoints(Range.START_TO_START,b));
    const merged=[];for(const range of ranges){const last=merged.at(-1);if(last&&last.comparePoint(range.startContainer,range.startOffset)<=0){if(last.comparePoint(range.endContainer,range.endOffset)>0)last.setEnd(range.endContainer,range.endOffset);}else merged.push(range.cloneRange());}ranges=merged;
  }
  function caret(x,y){
    const point=document.caretPositionFromPoint?.(x,y);
    let range;if(point){range=document.createRange();range.setStart(point.offsetNode,point.offset);range.collapse(true);}else range=document.caretRangeFromPoint?.(x,y);
    return range&&editor.contains(range.startContainer)?range:null;
  }
  editor.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    if(!event.metaKey&&!event.ctrlKey){clear();return;}
    const anchor=caret(event.clientX,event.clientY);if(!anchor)return;
    event.preventDefault();const current=selection();if(current?.rangeCount&&valid(current.getRangeAt(0)))ranges.push(current.getRangeAt(0).cloneRange());normalize();
    drag={anchor,base:ranges.map(range=>range.cloneRange()),pointer:event.pointerId};editor.setPointerCapture(event.pointerId);
  });
  editor.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.pointer)return;event.preventDefault();const end=caret(event.clientX,event.clientY);if(!end)return;
    const range=document.createRange(),forward=drag.anchor.compareBoundaryPoints(Range.START_TO_START,end)<=0;
    const from=forward?drag.anchor:end,to=forward?end:drag.anchor;range.setStart(from.startContainer,from.startOffset);range.setEnd(to.startContainer,to.startOffset);
    ranges=[...drag.base.map(range=>range.cloneRange()),range];normalize();refresh();
    const current=selection();current.removeAllRanges();current.addRange(range);
  });
  editor.addEventListener('pointerup',event=>{if(drag?.pointer!==event.pointerId)return;event.preventDefault();drag=null;normalize();refresh();if(editor.hasPointerCapture(event.pointerId))editor.releasePointerCapture(event.pointerId);});
  editor.addEventListener('pointercancel',()=>{drag=null;refresh();});
  editor.addEventListener('beforeinput',()=>{if(!applying)clear();});
  editor.addEventListener('keydown',event=>{if(event.key==='Escape'){clear();selection()?.removeAllRanges();event.preventDefault();}else if(!['Meta','Control','Alt','Shift'].includes(event.key)&&!event.metaKey&&!event.ctrlKey)clear();});
  document.addEventListener('pointerdown',event=>{if(!editor.contains(event.target)&&!event.target.closest('.toolbar'))clear();},{capture:true});
  addEventListener('scroll',()=>{if(ranges.length)refresh();},{passive:true});addEventListener('resize',()=>{if(ranges.length)refresh();});
  function offsets(range){
    const before=document.createRange();before.selectNodeContents(editor);before.setEnd(range.startContainer,range.startOffset);const start=before.toString().length;
    before.setEnd(range.endContainer,range.endOffset);return [start,before.toString().length];
  }
  function fromOffsets([start,end]){
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let node,total=0,a,b;
    while(node=walker.nextNode()){const next=total+node.length;if(!a&&next>start)a=[node,start-total];if(next>=end){b=[node,end-total];break;}total=next;}
    if(!a||!b)return null;const range=document.createRange();range.setStart(...a);range.setEnd(...b);return range;
  }
  function allStyled(command){
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let node,found=false;
    while(node=walker.nextNode()){if(!node.textContent||!ranges.some(range=>range.intersectsNode(node)))continue;found=true;const style=getComputedStyle(node.parentElement);if(command==='bold'?Number(style.fontWeight)<600:style.fontStyle!=='italic')return false;}return found;
  }
  return {clear,apply(command,value){
    normalize();if(ranges.length<2)return false;if(!inline.has(command))return true;
    applying=true;try{
      const desired=['bold','italic'].includes(command)?!allStyled(command):null,positions=ranges.map(offsets);
      editor.focus({preventScroll:true});
      for(const position of [...positions].reverse()){
        const range=fromOffsets(position);if(!range)continue;
        const current=selection();current.removeAllRanges();current.addRange(range);
        if(desired===null||document.queryCommandState(command)!==desired)document.execCommand(command,false,value||null);
      }
      ranges=positions.map(fromOffsets).filter(Boolean);refresh();return true;
    }finally{applying=false;}
  }};
}
