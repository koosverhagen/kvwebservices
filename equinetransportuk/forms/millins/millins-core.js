import {schema} from './schema.js';
export {schema};
export const VERSION = schema.version;
export const cleanLicence = v => String(v || '').replace(/\s+/g,'').toUpperCase();
export const lastEight = v => cleanLicence(v).slice(-8);
export const cleanCode = v => String(v || '').replace(/\s+/g,'');
export function ukDate(v) { const s=String(v||'');const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:s; }
export function parseDate(v) {const m=String(v||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!m)return null;const d=new Date(Date.UTC(+m[3],+m[2]-1,+m[1]));return d.getUTCFullYear()===+m[3]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[1]?d:null;}
export function valuesFromBooking(b,driver=1){
 const v={};if(driver===1){v['Hirer’s Name']=b.customerName||'';v.Email=b.customerEmail||'';v['Mobile Telephone']=b.customerMobile||'';v['Hirer’s Home Address']=b.customerAddress||'';v['Date of Birth']=ukDate(b.customerDob||b.dateOfBirth||'');}
 const fmt=(d,part)=>{if(!d)return '';const date=new Date(d);if(Number.isNaN(+date))return '';return part==='date'?date.toLocaleDateString('en-GB',{timeZone:'Europe/London'}):date.toLocaleTimeString('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit'});};
 v['Date From']=fmt(b.pickupAt,'date');v['Am/PM 1']=fmt(b.pickupAt,'time');v['Date To']=fmt(b.dropoffAt,'date');v['Am/PM 2']=fmt(b.dropoffAt,'time');return v;
}
export function submission(values, extra={}) {
 const parts=String(values['Hirer’s Name']||'').trim().split(/\s+/);const licence=cleanLicence(values['Driving Licence Number']||values['Driving Licence Number 2']);
 return {...extra,formType:'long',formVersion:VERSION,millinsValues:{...values,'Driving Licence Number':licence,'Driving Licence Number 2':licence,'DVLA Check Code':cleanCode(values['DVLA Check Code'])},firstName:parts.shift()||'',lastName:parts.join(' '),email:values.Email||'',mobile:values['Mobile Telephone']||'',address:[values['Hirer’s Home Address'],values['Hirer’s Home Address line 2'],values['Post code']].filter(Boolean).join(', '),dateOfBirth:parseDate(values['Date of Birth'])?.toISOString().slice(0,10)||'',drivingLicenceNumber:licence,dvlaCheckCode:cleanCode(values['DVLA Check Code']),dvlaCodeDate:values['Date Check Code Obtained']||'',signatureData:values.Signed||'',signedDate:values['Date Signed']||'',confirmTrue:values["Read T&C's"]==='Yes'?'yes':'',hireFrom:values['Date From']+' '+values['Am/PM 1'],hireUntil:values['Date To']+' '+values['Am/PM 2']};
}
export function validate(values,extra={}) {
 const errors=[];const add=(field,message)=>errors.push({field,message});
 const required=['Hirer’s Name','Hirer’s Home Address','Post code','Years','Months','Mobile Telephone','Email','Date of Birth','Job Role/Position','Industry','Nationality','Date From','Am/PM 1','Date To','Am/PM 2','Reason for Journey','Where are you travelling to','Country of Issue of Licence','Period of UK residency years','Driving Licence categories held','Dates Driving Tests passed','Driving Licence Number 2','How often do you drive a motor vehicle in the UK','How long have you been driving this regularly?','What experience do you have of driving a horsebox','Print Name','Date Signed'];
 for(const f of required)if(!String(values[f]||'').trim())add(f,`Please complete: ${f}.`);
 const radios=['Moving','Check Box33','Check Box35','Check Box39','Check Box45','Check Box51','Declined','Cancelled','Special Terms','Non Motor Convictions'];
 if(values['Check Box35']==='Yes')radios.push('Check Box37');
 if(values['Check Box39']==='Yes')radios.push('Check Box41','Check Box43');
 for(const f of radios)if(!['Yes','No'].includes(values[f]))add(f,`Please answer: ${schema.fields.find(x=>x.name===f)?.label||f}`);
 for(const f of ["T&C's 1","Read T&C's"])if(values[f]!=='Yes')add(f,'Please read and acknowledge the information on this page.');
 if(!values.Signed)add('Signed','Please provide your signature.');
 if(values.Email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.Email))add('Email','Please enter a valid email address.');
 for(const f of ['Date From','Date To','Date of Birth','Date Signed'])if(values[f]&&!parseDate(values[f]))add(f,'Please enter a valid date as DD/MM/YYYY.');
 for(const f of ['Years','Months','Period of UK residency years'])if(values[f]&&!/^\d+$/.test(values[f]))add(f,'Please enter a whole number, including 0 if applicable.');
 if(Number(values.Months)>11)add('Months','Please enter 0 to 11 months.');
 for(const f of ['Am/PM 1','Am/PM 2'])if(values[f]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(values[f]))add(f,'Please enter a time as HH:MM, for example 07:00.');
 const birth=parseDate(values['Date of Birth']);if(birth&&birth>new Date())add('Date of Birth','Please enter a date of birth that is not in the future.');
 const from=parseDate(values['Date From']),to=parseDate(values['Date To']);
 if(from&&to){const days=(to-from)/86400000;if(days<0||days>90||(days===0&&values['Am/PM 2']<=values['Am/PM 1']))add('Date To','Hire dates must be in order and no more than 90 days apart.');if(days>=1&&!String(values['overnight parking arrangements']||'').trim())add('overnight parking arrangements','Please provide the overnight parking address.');if(days>=1&&!['A third party yard','Your own premises','Parking on the road'].some(f=>values[f]))add('A third party yard','Please select the overnight parking arrangement.');}
 const licence=cleanLicence(values['Driving Licence Number']||values['Driving Licence Number 2']);if(licence.length<8)add('Driving Licence Number 2','Please enter your full driving licence number.');
 if(extra.licenceType!=='non-dvla') {if(cleanCode(values['DVLA Check Code']).length!==8)add('DVLA Check Code','Your DVLA check code must contain 8 characters.');if(!parseDate(values['Date Check Code Obtained']))add('Date Check Code Obtained','Please enter the date the DVLA code was obtained as DD/MM/YYYY.');}
 if(values['Check Box33']==='Yes'&&!values['Date of offence 1'])add('Date of offence 1','Please add the conviction or offence details.');
 if(values['Check Box39']==='Yes'&&!values['If yes to any of the above please provide further details below'])add('If yes to any of the above please provide further details below','Please provide the medical details requested on the form.');
 if(values['Check Box45']==='Yes'&&!values.Describe1)add('Describe1','Please add the claim or accident details.');
 if(values['Check Box51']==='Yes'&&!values['Describe 1'])add('Describe 1','Please add the theft details.');
 if(extra.additionalDriverRequired==='yes'){if(!String(extra.secondDriverName||'').trim())add('secondDriverName','Please enter the second driver’s name.');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extra.secondDriverEmail||''))add('secondDriverEmail','Please enter the second driver’s email.');}
 return errors;
}
function wrapText(text,font,size,width) {
 const lines=[];for(const paragraph of text.split(/\r?\n/)){let line='';for(const word of paragraph.split(/\s+/)){if(!word)continue;const test=line?line+' '+word:word;if(font.widthOfTextAtSize(test,size)<=width){line=test;continue;}if(line)lines.push(line);line='';for(const c of word){if(font.widthOfTextAtSize(line+c,size)>width&&line){lines.push(line);line='';}line+=c;}}lines.push(line);}return lines;
}
export async function generatePdf(values,{readAsset,PDFLib,fontkit}={}) {
 if(!readAsset||!PDFLib||!fontkit)throw Error('PDF export components are unavailable.');
 const pdf=await PDFLib.PDFDocument.load(await readAsset('millins-2025-original.pdf'));
 // Preserve the original artwork and blank field appearances, then add the submitted answers.
 for (const field of pdf.getForm().getFields()) {
  for (const widget of field.acroField.getWidgets()) {
   const rect=widget.dict.lookup(PDFLib.PDFName.of('Rect'));
   if(rect){const n=rect.asArray().map(v=>v.asNumber());widget.dict.set(PDFLib.PDFName.of('Rect'),pdf.context.obj([Math.min(n[0],n[2]),Math.min(n[1],n[3]),Math.max(n[0],n[2]),Math.max(n[1],n[3])]));}
  }
 }
 pdf.getForm().flatten({updateFieldAppearances:false});
 pdf.catalog.delete(PDFLib.PDFName.of('AcroForm'));
 for(const p of pdf.getPages())p.node.delete(PDFLib.PDFName.of('Annots'));
 pdf.registerFontkit(fontkit);const font=await pdf.embedFont(await readAsset('form-font.ttf'),{subset:true});
 const overflow=[];
 for(const f of schema.fields){const raw=values[f.name];if(raw===undefined||raw===null||raw==='')continue;const [x,y,x2,y2]=f.rect;const w=x2-x,h=y2-y,p=pdf.getPage(f.page);
  if(f.kind==='checkbox'){if(String(raw)!==f.state)continue;const inset=Math.min(w,h)*.24;p.drawLine({start:{x:x+inset,y:y+h*.49},end:{x:x+w*.43,y:y+inset},thickness:1.5});p.drawLine({start:{x:x+w*.43,y:y+inset},end:{x:x+w-inset,y:y+h-inset},thickness:1.5});continue;}
  if(f.kind==='signature'){if(!/^data:image\/png;base64,/.test(raw))throw Error('Invalid signature image.');const img=await pdf.embedPng(raw),scale=Math.min((w-4)/img.width,(h-4)/img.height);p.drawImage(img,{x:x+2,y:y+(h-img.height*scale)/2,width:img.width*scale,height:img.height*scale});continue;}
  const text=String(raw);let size=Math.min(10,h-4),lines=[];for(;size>=6;size-=.25){lines=f.multiline||h>24?wrapText(text,font,size,w-5):[text];if(lines.length*size*1.15<=h-3&&lines.every(l=>font.widthOfTextAtSize(l,size)<=w-5))break;}
  if(size<6){overflow.push(f.label);continue;}
  const top=lines.length===1?y+(h-size)/2+1:y+h-size-2;
  lines.forEach((line,i)=>p.drawText(line,{x:x+2.5,y:top-i*size*1.15,size,font,color:PDFLib.rgb(.04,.09,.18)}));
 }
 if(overflow.length)throw Error('These answers are too long for the original boxes: '+overflow.join(', ')+'. Please shorten them before exporting; no text has been discarded.');
 pdf.setTitle('Millins Hirer Proposal Form 2025');pdf.setSubject('Completed hirer proposal');
 return pdf.save();
}
