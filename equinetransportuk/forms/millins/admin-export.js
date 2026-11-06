import {generatePdf,VERSION} from './millins-core.js';
const root=new URL('.',import.meta.url);
let ready;
const pdfCache=new WeakMap();
function script(file,globalName){if(window[globalName])return Promise.resolve();return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=new URL('assets/'+file,root);el.onload=resolve;el.onerror=()=>reject(Error('Could not load PDF export. Please try again.'));document.head.append(el);});}
export async function completedMillinsPdf(formData){
 if(pdfCache.has(formData))return pdfCache.get(formData);
 const pending=buildCompletedPdf(formData).catch(error=>{pdfCache.delete(formData);throw error;});
 pdfCache.set(formData,pending);return pending;
}
async function buildCompletedPdf(formData){
 const payload=formData.payload||{};
 if(payload.formVersion!==VERSION||!payload.millinsValues)throw Error('This is an older form. Use its original print view; it must not be relabelled as the new signed declaration.');
 if(!ready)ready=Promise.all([script('pdf-lib.min.js','PDFLib'),script('fontkit.min.js','fontkit')]).catch(e=>{ready=null;throw e;});await ready;
 const values={...payload.millinsValues,Signed:formData.signatureData||payload.signatureData||payload.millinsValues.Signed};
 return generatePdf(values,{readAsset:async name=>{const r=await fetch(new URL('assets/'+name,root));if(!r.ok)throw Error('The original PDF template could not be loaded.');return r.arrayBuffer();},PDFLib:window.PDFLib,fontkit:window.fontkit});
}
export async function exportMillins(formData,print=false,printWindow=null){
 const target=print?(printWindow||window.open("", "_blank")):null;
 const bytes=await completedMillinsPdf(formData);
 const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;if(print&&target){target.opener=null;target.location.href=url;}else a.download=`Millins-${String(formData.bookingId||'booking').replace(/[^a-z0-9_-]/ig,'_')}-driver-${formData.driverNumber===2?2:1}.pdf`;if(!print||!target)a.click();setTimeout(()=>URL.revokeObjectURL(url),120000);
}

export function renderMillinsPreview(container,formData){
 let disposed=false,loadingTask=null;const renders=new Set();
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Preparing the completed form…';
 const toolbar=document.createElement('div');toolbar.className='millins-view-toolbar';
 const label=document.createElement('label');label.textContent='Page size ';
 const zoom=document.createElement('select');zoom.setAttribute('aria-label','Form page size');
 for(const [value,text] of [['fit','Fit to width'],['100','100%'],['150','150%']]){const option=document.createElement('option');option.value=value;option.textContent=text;zoom.append(option);}
 label.append(zoom);toolbar.append(label);
 const pages=document.createElement('div');pages.className='millins-view-pages';
 zoom.onchange=()=>{pages.style.setProperty('--millins-page-width',zoom.value==='fit'?'100%':`${850*Number(zoom.value)/100}px`);};
 container.replaceChildren(toolbar,status,pages);
 const finished=(async()=>{
  const [bytes,pdfjs]=await Promise.all([completedMillinsPdf(formData),import('./assets/pdfjs/pdf.min.mjs')]);
  if(disposed)return;
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('assets/pdfjs/pdf.worker.min.mjs',root).href;
  loadingTask=pdfjs.getDocument({data:bytes.slice(),standardFontDataUrl:new URL('assets/pdfjs/standard_fonts/',root).href,isEvalSupported:false});
  const doc=await loadingTask.promise;
  for(let number=1;number<=doc.numPages;number++){
   if(disposed)return;
   status.textContent=`Loading page ${number} of ${doc.numPages}…`;
   const page=await doc.getPage(number);if(disposed)return;
   const viewport=page.getViewport({scale:1.75});
   const figure=document.createElement('figure');figure.className='millins-view-page';
   const caption=document.createElement('figcaption');caption.textContent=`Page ${number} of ${doc.numPages}`;
   const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`Completed Millins form, driver ${formData.driverNumber===2?2:1}, page ${number} of ${doc.numPages}`);
   figure.append(caption,canvas);pages.append(figure);
   const task=page.render({canvasContext:canvas.getContext('2d'),viewport});renders.add(task);
   try{await task.promise;}finally{renders.delete(task);}
   if(disposed)return;
   canvas.dataset.rendered='true';
   const content=await page.getTextContent();if(disposed)return;
   const details=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');summary.textContent='Read page text';text.textContent=content.items.map(item=>item.str||'').join(' ');details.append(summary,text);figure.append(details);
   page.cleanup();
  }
  if(!disposed)status.textContent=`${doc.numPages} pages — the same completed form as Save and Print.`;
 })().catch(error=>{if(!disposed){status.textContent='The form preview could not be displayed. You can still use Save or Print above, or close and reopen the form.';console.error('Millins form preview:',error);}});
 return {ready:finished,dispose(){disposed=true;for(const task of renders)task.cancel();loadingTask?.destroy().catch(()=>{});container.replaceChildren();}};
}
export function addMillinsExportControls(container,formData){
 if(formData.payload?.formVersion!==VERSION)return;
 const row=document.createElement('div');row.style.cssText='display:flex;gap:10px;flex-wrap:wrap;margin:16px 0';
 for(const [label,print]of [['Save original Millins PDF',false],['Print original Millins PDF',true]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='padding:10px 16px;border:1px solid #164d82;border-radius:8px;background:white;color:#164d82;cursor:pointer';b.onclick=async()=>{b.disabled=true;try{await exportMillins(formData,print);}catch(e){alert(e.message);}finally{b.disabled=false;}};row.append(b);}container.append(row);
}
