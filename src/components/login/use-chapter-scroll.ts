"use client";
import { useCallback, useEffect, useRef } from "react";

/** One deliberate wheel / swipe / key gesture advances one chapter, with no fractional resting state. */
export function useChapterScroll(enabled:boolean,reducedMotion:boolean){
  const controller=useRef<((index:number)=>void)|null>(null);
  const savedAnchor=useRef(0);
  const goTo=useCallback((index:number)=>controller.current?.(index),[]);
  useEffect(()=>{
    if(!enabled)return;
    const root=document.documentElement;
    const previousSnap=root.style.scrollSnapType;
    let frame=0,settleTimer=0,resizeTimer=0,animating=false;
    let anchor=Math.max(0,Math.min(2,Math.round(window.scrollY/window.innerHeight)));
    let lastWheel=0,wheelSum=0,consumed=false;
    let startX=0,startY=0,touchConsumed=false,touchActive=false;
    const clamp=(n:number)=>Math.max(0,Math.min(2,n));
    function clearSettle(){window.clearTimeout(settleTimer);}
    function scrollToChapter(index:number){
      anchor=clamp(index);savedAnchor.current=anchor;clearSettle();cancelAnimationFrame(frame);
      const from=window.scrollY,to=anchor*window.innerHeight,start=performance.now();
      root.style.scrollSnapType="none";animating=true;root.dataset.chapterMoving="true";
      const duration=reducedMotion?0:1800;
      function tick(now:number){
        const t=duration===0?1:Math.min(1,(now-start)/duration);
        // Smooth velocity and acceleration at both ends, without a sharp midpoint.
        const eased=t*t*t*(t*(t*6-15)+10);
        window.scrollTo({top:from+(to-from)*eased,behavior:"instant"});
        if(t<1)frame=requestAnimationFrame(tick);
        else{
          window.scrollTo({top:anchor*window.innerHeight,behavior:"instant"});
          // Let scroll events from the last frame flush before enabling manual-scroll recovery.
          frame=requestAnimationFrame(()=>{animating=false;root.style.scrollSnapType="y mandatory";root.dataset.chapterMoving="false";});
        }
      }
      frame=requestAnimationFrame(tick);
    }
    const onWheel=(event:WheelEvent)=>{
      if(event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
      event.preventDefault();
      const now=performance.now();
      if(now-lastWheel>210){wheelSum=0;consumed=false;}
      lastWheel=now;
      if(animating||consumed)return;
      const factor=event.deltaMode===1?16:event.deltaMode===2?window.innerHeight:1;
      wheelSum+=event.deltaY*factor;
      if(Math.abs(wheelSum)<14)return;
      consumed=true;scrollToChapter(anchor+Math.sign(wheelSum));
    };
    const onKey=(event:KeyboardEvent)=>{
      const element=event.target;
      if(element instanceof HTMLElement&&(element.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)))return;
      if((event.key===" "||event.key==="Enter")&&element instanceof HTMLElement&&element.closest("button,a"))return;
      let next:number|undefined;
      if(["ArrowDown","PageDown"].includes(event.key)||(event.key===" "&&!event.shiftKey))next=anchor+1;
      if(["ArrowUp","PageUp"].includes(event.key)||(event.key===" "&&event.shiftKey))next=anchor-1;
      if(event.key==="Home")next=0;if(event.key==="End")next=2;
      if(next===undefined)return;event.preventDefault();if(!animating&&!event.repeat)scrollToChapter(next);
    };
    const onTouchStart=(event:TouchEvent)=>{
      if(event.touches.length!==1)return;
      const el=event.target;
      if(el instanceof HTMLElement&&el.closest("input,textarea,select,button,a"))return;
      startY=event.touches[0].clientY;startX=event.touches[0].clientX;touchConsumed=false;touchActive=true;
    };
    const onTouchMove=(event:TouchEvent)=>{
      if(!touchActive||event.touches.length!==1)return;
      const dy=startY-event.touches[0].clientY,dx=startX-event.touches[0].clientX;
      if(Math.abs(dy)<=Math.abs(dx))return;
      event.preventDefault();
      if(!animating&&!touchConsumed&&Math.abs(dy)>35){touchConsumed=true;scrollToChapter(anchor+Math.sign(dy));}
    };
    const onTouchEnd=()=>{touchActive=false;};
    const recoverScroll=()=>{
      if(animating)return;clearSettle();
      settleTimer=window.setTimeout(()=>{
        if(animating||touchActive)return;
        const nearest=clamp(Math.round(window.scrollY/window.innerHeight));
        if(Math.abs(window.scrollY-nearest*window.innerHeight)>1)scrollToChapter(nearest);
        else {anchor=nearest;savedAnchor.current=nearest;}
      },150);
    };
    const resize=()=>{window.clearTimeout(resizeTimer);resizeTimer=window.setTimeout(()=>scrollToChapter(anchor),140);};
    controller.current=scrollToChapter;
    root.style.scrollSnapType="y mandatory";
    window.addEventListener("wheel",onWheel,{passive:false});window.addEventListener("keydown",onKey);
    window.addEventListener("touchstart",onTouchStart,{passive:true});window.addEventListener("touchmove",onTouchMove,{passive:false});window.addEventListener("touchend",onTouchEnd);
    window.addEventListener("scroll",recoverScroll,{passive:true});window.addEventListener("resize",resize);
    recoverScroll();
    return()=>{
      controller.current=null;cancelAnimationFrame(frame);clearSettle();window.clearTimeout(resizeTimer);
      root.style.scrollSnapType=previousSnap;delete root.dataset.chapterMoving;
      window.removeEventListener("wheel",onWheel);window.removeEventListener("keydown",onKey);
      window.removeEventListener("touchstart",onTouchStart);window.removeEventListener("touchmove",onTouchMove);window.removeEventListener("touchend",onTouchEnd);
      window.removeEventListener("scroll",recoverScroll);window.removeEventListener("resize",resize);
    };
  },[enabled,reducedMotion]);
  return {goTo};
}
