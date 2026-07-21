(() => {
  "use strict";
  const STORAGE_KEY = "equine-theme";
  function readTheme(){try{return localStorage.getItem(STORAGE_KEY)==="dark"?"dark":"light";}catch(_){return "light";}}
  function saveTheme(t){try{localStorage.setItem(STORAGE_KEY,t);}catch(_){}}
  function updateToggle(isDark){const b=document.getElementById("theme-toggle");if(!b)return;b.setAttribute("aria-pressed",String(isDark));b.setAttribute("aria-label",isDark?"Switch to light theme":"Switch to dark theme");const i=b.querySelector(".theme-toggle-icon");const l=b.querySelector(".theme-toggle-label");if(i)i.textContent=isDark?"☀":"☾";if(l)l.textContent=isDark?"Light":"Dark";}
  function applyTheme(theme,persist=false){const isDark=theme==="dark";document.body.classList.add("dark-keynote-v8");document.body.classList.toggle("theme-light-palette",!isDark);document.documentElement.classList.toggle("theme-dark",isDark);document.documentElement.classList.toggle("theme-light",!isDark);document.documentElement.style.colorScheme=isDark?"dark":"light";updateToggle(isDark);if(persist)saveTheme(theme);}
  function init(){applyTheme(readTheme());document.getElementById("theme-toggle")?.addEventListener("click",()=>{const isDark=document.documentElement.classList.contains("theme-dark");applyTheme(isDark?"light":"dark",true);});}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
