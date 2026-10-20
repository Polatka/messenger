'use strict';
// Local preferences affect presentation only; the peer's theme stays independent.
window.PolatkaAppearance=(()=>{
 const initial={theme:'forest',density:'comfortable',font:'system',fontSize:14,roundness:22,glass:true,motion:true};
 const controls={theme:'appearanceTheme',density:'appearanceDensity',font:'appearanceFont',fontSize:'appearanceFontSize',roundness:'appearanceRoundness',glass:'appearanceGlass',motion:'appearanceMotion'};
 function normalize(value){
  const p={...initial,...(value&&typeof value==='object'?value:{})};
  for(const [key,allowed] of Object.entries({theme:['forest','graphite','midnight'],density:['comfortable','compact'],font:['system','rounded','mono']}))if(!allowed.includes(p[key]))p[key]=initial[key];
  for(const [key,min,max] of [['fontSize',12,18],['roundness',8,28]])p[key]=Number.isFinite(Number(p[key]))?Math.max(min,Math.min(max,Number(p[key]))):initial[key];
  p.glass=p.glass!==false;p.motion=p.motion!==false;
  return p;
 }
 function apply(){
  const p=settings.appearance=normalize(settings.appearance),root=document.documentElement;
  root.dataset.theme=p.theme;root.dataset.density=p.density;root.dataset.glass=String(p.glass);root.dataset.motion=String(p.motion);root.dataset.chatFont=p.font;
  root.style.setProperty('--message-font-size',p.fontSize+'px');root.style.setProperty('--panel-radius',p.roundness+'px');
  for(const [key,id] of Object.entries(controls)){const e=$(id);if(typeof initial[key]==='boolean')e.checked=p[key];else e.value=String(p[key])}
  $('appearanceFontSizeValue').textContent=p.fontSize+' px';$('appearanceRoundnessValue').textContent=p.roundness+' px';
  if(!p.motion)$('launchSplash')?.remove();
 }
 for(const [key,id] of Object.entries(controls))$(id).addEventListener('input',()=>{settings.appearance={...normalize(settings.appearance),[key]:typeof initial[key]==='boolean'?$(id).checked:$(id).value};apply();persist()});
 $('resetAppearance').addEventListener('click',()=>{settings.appearance={...initial};apply();applyTheme(defaults.color);persist();toast('Оформление сброшено')});
 apply();
 return {apply};
})();
