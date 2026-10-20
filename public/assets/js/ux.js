/* Local accessibility, cover recovery and performance diagnostics. No analytics uploads. */
window.ArkUX=(()=>{
    const metrics={fcpMs:null,lcpMs:null,cls:0,chapterOpenMs:null,chapterFirstImageMs:null};
    let chapterStart=null,chapterToken=0,shiftStart=-1,lastShift=-1,shiftScore=0;
    const now=()=>performance.now();
    const visible=node=>node.isConnected && node.getClientRects().length>0 && !node.closest('[inert],[aria-hidden="true"]');
    const focusable=dialog=>Array.from(dialog.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex]')).filter(node=>visible(node) && !node.matches(':disabled') && node.tabIndex>=0);
    const tabTarget=(items,active,backward)=>!items.length?null:backward?(active===items[0] || !items.includes(active)?items.at(-1):null):(active===items.at(-1) || !items.includes(active)?items[0]:null);
    function init(){
        const stack=[],recoveries=new Set();
        const rank=node=>{let score=0,depth=0;for(let parent=node;parent;parent=parent.parentElement){const z=Number.parseInt(getComputedStyle(parent).zIndex,10);if(Number.isFinite(z))score=Math.max(score,z);depth++;}return score+depth/1000;};
        const sync=()=>{
            for(const recovery of recoveries)if(!recovery.img.isConnected){recovery.observer?.disconnect();recovery.fallback.remove();recoveries.delete(recovery);}
            const dialogs=Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).filter(visible).sort((a,b)=>rank(a)-rank(b));
            const top=dialogs.at(-1);
            while(stack.length && !dialogs.includes(stack.at(-1).node)){const removed=stack.pop();if(removed.returnTo?.isConnected)removed.returnTo.focus({preventScroll:true});}
            if(top && stack.at(-1)?.node!==top){
                const existing=stack.findIndex(entry=>entry.node===top);
                if(existing>=0)stack.splice(existing+1);
                else stack.push({node:top,returnTo:document.activeElement});
                if(!top.contains(document.activeElement)){const first=focusable(top)[0];if(first)first.focus({preventScroll:true});else{top.tabIndex=-1;top.focus({preventScroll:true});}}
            }
        };
        new MutationObserver(sync).observe(document.body,{childList:true,subtree:true});
        document.addEventListener('keydown',event=>{
            const dialog=stack.at(-1)?.node;if(!dialog || !visible(dialog))return;
            if(event.key==='Tab'){
                const items=focusable(dialog),target=tabTarget(items,document.activeElement,event.shiftKey);
                if(target){event.preventDefault();target.focus();}else if(!items.length){event.preventDefault();dialog.focus();}
            }
            if(event.key==='Escape'){
                const details=document.activeElement?.closest('details[open]') || dialog.querySelector('.ark-reader-more[open]');
                if(details && dialog.contains(details)){event.preventDefault();event.stopImmediatePropagation();details.open=false;details.querySelector('summary')?.focus();return;}
                if(dialog.classList.contains('ark-reader'))return;
                const close=dialog.querySelector('[data-dialog-close]');
                if(close){event.preventDefault();event.stopImmediatePropagation();if(!close.disabled)close.click();}
            }
        },true);
        document.addEventListener('focusin',event=>{const dialog=stack.at(-1)?.node;if(dialog && visible(dialog) && !dialog.contains(event.target))focusable(dialog)[0]?.focus({preventScroll:true});});
        const placeholders=new WeakMap();
        const recoverCover=img=>{
            if(img.tagName!=='IMG' || !img.hasAttribute('data-ark-cover') || placeholders.has(img))return;
            img.style.visibility='hidden';
            if(getComputedStyle(img.parentElement).position==='static')img.parentElement.style.position='relative';
            const fallback=document.createElement('span');fallback.className='ark-cover-fallback';fallback.textContent=img.dataset.coverTitle || img.alt || 'CINE ARK';img.after(fallback);
            const size=()=>Object.assign(fallback.style,{inset:'auto',left:img.offsetLeft+'px',top:img.offsetTop+'px',width:img.offsetWidth+'px',height:img.offsetHeight+'px'});
            size();const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(size):null;observer?.observe(img);const recovery={img,fallback,observer};placeholders.set(img,recovery);recoveries.add(recovery);
        };
        document.addEventListener('error',event=>recoverCover(event.target),true);
        document.addEventListener('load',event=>{const img=event.target;if(img.tagName==='IMG' && placeholders.has(img)){img.style.visibility='';const recovery=placeholders.get(img);recovery.observer?.disconnect();recovery.fallback.remove();recoveries.delete(recovery);placeholders.delete(img);}},true);
        document.querySelectorAll('img[data-ark-cover]').forEach(img=>{if(img.complete && !img.naturalWidth)recoverCover(img);});
        sync();
    }
    if(typeof PerformanceObserver!=='undefined'){
        for(const type of ['paint','largest-contentful-paint','layout-shift'])try{new PerformanceObserver(list=>{
            for(const entry of list.getEntries()){
                if(entry.name==='first-contentful-paint')metrics.fcpMs=Math.round(entry.startTime);
                if(entry.entryType==='largest-contentful-paint')metrics.lcpMs=Math.round(entry.startTime);
                if(entry.entryType==='layout-shift' && !entry.hadRecentInput){if(shiftStart<0 || entry.startTime-lastShift>1000 || entry.startTime-shiftStart>5000){shiftStart=entry.startTime;shiftScore=0;}lastShift=entry.startTime;shiftScore+=entry.value;metrics.cls=Math.max(metrics.cls,shiftScore);}
            }
        }).observe({type,buffered:true});}catch(_){}
    }
    document.addEventListener('DOMContentLoaded',init,{once:true});
    return {focusable,tabTarget,
        chapterStarted(){chapterStart=now();metrics.chapterOpenMs=null;metrics.chapterFirstImageMs=null;return ++chapterToken;},
        chapterOpened(token){if(token===chapterToken && chapterStart!==null)metrics.chapterOpenMs=Math.round(now()-chapterStart);},
        chapterPainted(){if(chapterStart!==null && metrics.chapterFirstImageMs===null)metrics.chapterFirstImageMs=Math.round(now()-chapterStart);},
        performance(){const nav=performance.getEntriesByType('navigation')[0];return {...metrics,domReadyMs:nav?Math.round(nav.domContentLoadedEventEnd):null,loadMs:nav?Math.round(nav.loadEventEnd):null};}
    };
})();
