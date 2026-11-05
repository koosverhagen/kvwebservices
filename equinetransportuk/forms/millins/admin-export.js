import {generatePdf,VERSION} from './millins-core.js';
const root=new URL('.',import.meta.url);
let ready;
function script(file,globalName){if(window[globalName])return Promise.resolve();return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=new URL('assets/'+file,root);el.onload=resolve;el.onerror=()=>reject(Error('Could not load PDF export. Please try again.'));document.head.append(el);});}
export async function exportMillins(formData,print=false,printWindow=null){
 const target=print?(printWindow||window.open("", "_blank")):null;
 const payload=formData.payload||{};
 if(payload.formVersion!==VERSION||!payload.millinsValues)throw Error('This is an older form. Use its original print view; it must not be relabelled as the new signed declaration.');
 if(!ready)ready=Promise.all([script('pdf-lib.min.js','PDFLib'),script('fontkit.min.js','fontkit')]).catch(e=>{ready=null;throw e;});await ready;
 const values={...payload.millinsValues,Signed:formData.signatureData||payload.signatureData||payload.millinsValues.Signed};
 const bytes=await generatePdf(values,{readAsset:async name=>{const r=await fetch(new URL('assets/'+name,root));if(!r.ok)throw Error('The original PDF template could not be loaded.');return r.arrayBuffer();},PDFLib:window.PDFLib,fontkit:window.fontkit});
 const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;if(print&&target){target.opener=null;target.location.href=url;}else a.download=`Millins-${String(formData.bookingId||'booking').replace(/[^a-z0-9_-]/ig,'_')}-driver-${formData.driverNumber===2?2:1}.pdf`;if(!print||!target)a.click();setTimeout(()=>URL.revokeObjectURL(url),120000);
}
export function addMillinsExportControls(container,formData){
 if(formData.payload?.formVersion!==VERSION)return;
 const row=document.createElement('div');row.style.cssText='display:flex;gap:10px;flex-wrap:wrap;margin:16px 0';
 for(const [label,print]of [['Save original Millins PDF',false],['Print original Millins PDF',true]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='padding:10px 16px;border:1px solid #164d82;border-radius:8px;background:white;color:#164d82;cursor:pointer';b.onclick=async()=>{b.disabled=true;try{await exportMillins(formData,print);}catch(e){alert(e.message);}finally{b.disabled=false;}};row.append(b);}container.append(row);
}
