(function(global){
'use strict';

const legacyShowPdfImportReview=global.showPdfImportReview;
const legacySavePdfInvoiceImport=global.savePdfInvoiceImport;
const legacyOpenPersistentDocumentReview=global.openPersistentDocumentReview;
const legacyAttentionRows=global.attentionRows;
const legacyPersistentDocumentReviewActionForFile=global.persistentDocumentReviewActionForFile;
const legacyApplyFinancialCorrectionProposal=global.applyFinancialCorrectionProposal;
const legacyConfirmSuggestedFinancialRate=global.confirmSuggestedFinancialRate;

const OPTIONAL_FIELDS=[
  'address','postal','city','email','phone','kvk','vatId','iban','dueDate','paymentReference',
  'orderNumber','paymentTermDays','description','paymentMethod','currency'
];
const REQUIREMENTS={
  receipt:{
    blocking:['party','issueDate','net','vatAmount','gross','vatRate'],
    attention:['party','category'],
    optional:['invoiceNumber',...OPTIONAL_FIELDS]
  },
  purchase_invoice:{
    blocking:['party','issueDate','invoiceNumber','net','vatAmount','gross','vatRate'],
    attention:['category'],
    optional:[...OPTIONAL_FIELDS]
  },
  sale_invoice:{
    blocking:['party','issueDate','invoiceNumber','net','vatAmount','gross','vatRate'],
    attention:[],
    optional:['category',...OPTIONAL_FIELDS]
  },
  sales_invoice:{
    blocking:['party','issueDate','invoiceNumber','net','vatAmount','gross','vatRate'],
    attention:[],
    optional:['category',...OPTIONAL_FIELDS]
  },
  credit_invoice:{
    blocking:['party','issueDate','invoiceNumber','net','vatAmount','gross','vatRate'],
    attention:['category'],
    optional:[...OPTIONAL_FIELDS]
  },
  invoice:{
    blocking:['party','issueDate','invoiceNumber','net','vatAmount','gross','vatRate'],
    attention:['category'],
    optional:[...OPTIONAL_FIELDS]
  },
  other:{
    blocking:['issueDate','gross'],
    attention:['party','category'],
    optional:['invoiceNumber','net','vatAmount','vatRate','vatLines',...OPTIONAL_FIELDS]
  }
};
const LABELS={
  party:'Leverancier',issueDate:'Datum',invoiceNumber:'Factuurnummer',category:'Categorie',
  net:'Bedrag excl. btw',vatAmount:'Btw-bedrag',gross:'Totaal',vatRate:'Btw-percentage',vatLines:'Btw-verdeling'
};
const NORMAL_RATES=[9,21];

function requirementsFor(type){
  const key=String(type||'other').toLowerCase();
  const src=REQUIREMENTS[key]||REQUIREMENTS.other;
  return {blocking:[...src.blocking],attention:[...src.attention],optional:[...new Set(src.optional)]};
}
function reviewDocumentType(d){
  return String(document.getElementById('pdfImportForm')?.elements.namedItem('documentType')?.value||d?.documentType||'other');
}
function cents(value){
  if(typeof financialReviewCentsFromInput==='function')return financialReviewCentsFromInput(value);
  const n=typeof parseSignedMoneyValue==='function'?parseSignedMoneyValue(value):Number(String(value).replace(',','.'));
  return typeof financialMoneyCents==='function'?financialMoneyCents(n):Number.isFinite(n)?Math.round(n*100):null;
}
function formatCents(value){return value==null?'':(value/100).toFixed(2)}
function safeDate(value,issue=''){
  const v=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return '';
  if(issue&&v<issue)return '';
  return v
}
function safeKvk(value){return typeof plausibleKvk==='function'&&plausibleKvk(value)?String(value||''):''}
function safeVatId(value){return typeof plausibleVat==='function'&&plausibleVat(value)?String(value||''):''}
function safeIban(value){return typeof ibanValid==='function'&&ibanValid(value)===true?String(value||'').replace(/\s/g,'').toUpperCase():''}
function selectOptions(values,current){
  return values.map(v=>'<option '+(String(current||'')===String(v)?'selected':'')+'>'+esc(v)+'</option>').join('')
}
function genericProvenance(d){
  if(!d.reviewFieldProvenance||typeof d.reviewFieldProvenance!=='object')d.reviewFieldProvenance={};
  return d.reviewFieldProvenance
}
function isUserConfirmed(d,key){
  const p=genericProvenance(d)[key]||d.fieldProvenance?.[key];
  return p?.source==='user'&&p?.confirmed===true
}
function isCalculated(d,key){return d.fieldProvenance?.[key]?.source==='calculated'}
function fieldConfidence(d,key){const n=Number(d?.fieldConfidence?.[key]);return Number.isFinite(n)?n:0}
function fieldUncertain(d,key,threshold=75){
  if(isUserConfirmed(d,key)||isCalculated(d,key))return false;
  const value=d?.[key];
  if(value===''||value==null)return true;
  const c=fieldConfidence(d,key);
  return c>0&&c<threshold
}
function provenanceBadge(d,key){
  if(isUserConfirmed(d,key))return '<span class="beginner-provenance good">Bevestigd</span>';
  if(isCalculated(d,key))return '<span class="beginner-provenance good">Berekend</span>';
  if(fieldUncertain(d,key,key==='gross'?85:75))return '<span class="beginner-provenance warn">Controleer dit even</span>';
  return '<span class="beginner-provenance">Herkend</span>'
}
function canDeferField(d,key){
  const type=reviewDocumentType(d);
  if(key==='category')return ['receipt','purchase_invoice','credit_invoice','invoice'].includes(type);
  if(key==='party')return type==='receipt'&&String(document.getElementById('pdfImportForm')?.elements.namedItem('party')?.value||d?.party||'').trim().length>0;
  return false
}
function attentionControls(d,key){
  if(!fieldUncertain(d,key,key==='party'?75:70))return '';
  const defer=canDeferField(d,key)?'<button type="button" class="link-btn" data-review-defer="'+key+'" onclick="deferDocumentReviewField(\''+key+'\')">Later controleren</button>':'';
  return '<div class="beginner-field-actions" data-review-actions="'+key+'"><button type="button" class="link-btn" onclick="confirmDocumentReviewField(\''+key+'\')">Dit klopt zo</button><button type="button" class="link-btn" onclick="focusDocumentReviewField(\''+key+'\')">Aanpassen</button>'+defer+'</div>'
}
function deferredFields(d){
  const x=Array.isArray(d?.reviewDeferredFields)?d.reviewDeferredFields:[];
  return [...new Set(x.filter(key=>canDeferField(d,key)))]
}
function setDeferredFields(d,fields){d.reviewDeferredFields=[...new Set(fields)]}
function deferDocumentReviewField(key){
  const d=pendingPdfImport?.parsed;if(!d||!canDeferField(d,key))return;
  setDeferredFields(d,[...deferredFields(d),key]);
  const row=document.querySelector('[data-review-actions="'+key+'"]');
  if(row)row.innerHTML='<span class="beginner-deferred">Later controleren</span><button type="button" class="link-btn" onclick="confirmDocumentReviewField(\''+key+'\')">Toch nu bevestigen</button>';
  updateBeginnerReviewState()
}
function confirmDocumentReviewField(key){
  const d=pendingPdfImport?.parsed,f=document.getElementById('pdfImportForm'),el=f?.elements.namedItem(key);if(!d||!el)return;
  const value=String(el.value||'').trim();if(!value){el.focus();return}
  genericProvenance(d)[key]={source:'user',confirmed:true,confirmedAt:new Date().toISOString()};
  setDeferredFields(d,deferredFields(d).filter(x=>x!==key));
  const badge=el.closest('.field')?.querySelector('.beginner-provenance');if(badge){badge.className='beginner-provenance good';badge.textContent='Bevestigd'}
  const actions=document.querySelector('[data-review-actions="'+key+'"]');if(actions)actions.innerHTML='<span class="beginner-confirmed">Dit klopt zo</span>';
  updateBeginnerReviewState()
}
function focusDocumentReviewField(key){
  const el=document.getElementById('pdfImportForm')?.elements.namedItem(key);el?.focus();el?.scrollIntoView?.({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})
}

function confirmFinancialReviewAnchor(key){
  const f=document.getElementById('pdfImportForm'),el=f?.elements.namedItem(key);
  if(!el||String(el.value||'').trim()===''){el?.focus();return}
  if(typeof global.confirmFinancialReviewField==='function')global.confirmFinancialReviewField(key);
  const actions=document.querySelector('[data-financial-anchor-actions="'+key+'"]');
  if(actions)actions.innerHTML='<span class="beginner-confirmed">Dit klopt zo</span>';
  updateBeginnerReviewState()
}

function rateSelectValue(d){return d?.mixedRates?'':(NORMAL_RATES.includes(Number(d?.vatRate))?String(Number(d.vatRate)):'')}
function specialRateSelected(d){return !d?.mixedRates&&Number(d?.vatRate)===0}
function mixedLineRow(line,index){
  const rate=Number(line?.rate);
  return '<div class="mixed-vat-row" data-vat-line-index="'+index+'">'+
    '<div class="field"><label>Btw</label><select data-vat-line-rate aria-label="Btw-percentage regel '+(index+1)+'"><option value="9" '+(rate===9?'selected':'')+'>9%</option><option value="21" '+(rate===21?'selected':'')+'>21%</option><option value="0" '+(rate===0?'selected':'')+'>0%</option></select></div>'+
    '<div class="field"><label>Bedrag excl.</label><input data-vat-line-net inputmode="decimal" autocomplete="off" value="'+esc(line?.taxableAmount!=null?Number(line.taxableAmount).toFixed(2):'')+'" aria-label="Bedrag excl. btw regel '+(index+1)+'"></div>'+
    '<div class="field"><label>Btw-bedrag</label><input data-vat-line-vat inputmode="decimal" autocomplete="off" value="'+esc(line?.vatAmount!=null?Number(line.vatAmount).toFixed(2):'')+'" aria-label="Btw-bedrag regel '+(index+1)+'"></div>'+
    '<button type="button" class="icon-btn mixed-vat-remove" aria-label="Btw-regel verwijderen" onclick="removeMixedVatLine('+index+')">×</button>'+
  '</div>'
}
function currentMixedLines(d){
  const lines=Array.isArray(d?.vatLines)?d.vatLines:[];
  if(lines.length)return lines.map(x=>({rate:Number(x.rate),taxableAmount:x.taxableAmount,vatAmount:x.vatAmount}));
  return [{rate:9,taxableAmount:'',vatAmount:''},{rate:21,taxableAmount:'',vatAmount:''}]
}
function renderMixedVatRows(){
  const d=pendingPdfImport?.parsed,root=document.getElementById('mixedVatRows');if(!d||!root)return;
  root.innerHTML=currentMixedLines(d).map(mixedLineRow).join('');
  root.querySelectorAll('input,select').forEach(el=>{el.addEventListener('input',syncMixedVatEditor);el.addEventListener('change',syncMixedVatEditor)});
}
function readMixedVatEditor(){
  const rows=[...document.querySelectorAll('.mixed-vat-row')];
  return rows.map(row=>{
    const rate=Number(row.querySelector('[data-vat-line-rate]')?.value);
    const netC=cents(row.querySelector('[data-vat-line-net]')?.value);
    const vatC=cents(row.querySelector('[data-vat-line-vat]')?.value);
    return {rate,netC,vatC,valid:Number.isFinite(rate)&&netC!=null&&vatC!=null}
  })
}
function syncMixedVatEditor(){
  const d=pendingPdfImport?.parsed;if(!d?.mixedRates)return;
  const lines=readMixedVatEditor();
  d.vatLines=lines.map(x=>({rate:x.rate,taxableAmount:x.netC==null?'':x.netC/100,vatAmount:x.vatC==null?'':x.vatC/100}));
  d.vatRate=null;
  if(!d.fieldProvenance||typeof d.fieldProvenance!=='object')d.fieldProvenance={};
  d.fieldProvenance.vatLines={source:'user',confirmed:true,confidence:null,confirmedAt:new Date().toISOString()};
  updateMixedVatStatus();updateBeginnerReviewState()
}
function addMixedVatLine(){
  const d=pendingPdfImport?.parsed;if(!d)return;
  const lines=currentMixedLines(d);lines.push({rate:21,taxableAmount:'',vatAmount:''});d.vatLines=lines;renderMixedVatRows();updateMixedVatStatus();updateBeginnerReviewState()
}
function removeMixedVatLine(index){
  const d=pendingPdfImport?.parsed;if(!d)return;
  const lines=currentMixedLines(d);if(lines.length<=2){toast('Een bon met meerdere btw-tarieven heeft minimaal twee regels.');return}
  lines.splice(index,1);d.vatLines=lines;renderMixedVatRows();syncMixedVatEditor()
}
function mixedVatValidation(){
  const d=pendingPdfImport?.parsed;if(!d?.mixedRates)return {ok:true,lines:[]};
  const rows=readMixedVatEditor();
  if(rows.length<2)return {ok:false,field:'vatLines',message:'Voeg minimaal twee btw-regels toe.'};
  if(rows.some(x=>!x.valid))return {ok:false,field:'vatLines',message:'Controleer de bedragen in de btw-verdeling.'};
  const netSum=rows.reduce((s,x)=>s+x.netC,0),vatSum=rows.reduce((s,x)=>s+x.vatC,0);
  const f=document.getElementById('pdfImportForm'),netC=cents(f?.elements.namedItem('net')?.value),vatC=cents(f?.elements.namedItem('vatAmount')?.value),grossC=cents(f?.elements.namedItem('gross')?.value);
  if(netC==null||vatC==null||grossC==null)return {ok:false,field:'vatLines',message:'Controleer eerst de totalen.'};
  if(netSum!==netC||vatSum!==vatC)return {ok:false,field:'vatLines',message:'De btw-verdeling telt nog niet op tot het totaal.',netSum,vatSum,netC,vatC,grossC};
  if(netC+vatC!==grossC)return {ok:false,field:'gross',message:'Bedrag excl. btw + btw klopt nog niet met het totaal.'};
  return {ok:true,lines:rows,netSum,vatSum,grossC}
}
function updateMixedVatStatus(){
  const d=pendingPdfImport?.parsed,el=document.getElementById('mixedVatStatus');if(!d?.mixedRates||!el)return;
  const x=mixedVatValidation();el.className='mixed-vat-status '+(x.ok?'good':'warn');el.textContent=x.ok?'✓ Btw-verdeling klopt':x.message
}
function useMixedVatTotals(){
  const d=pendingPdfImport?.parsed,f=document.getElementById('pdfImportForm');if(!d||!f)return;
  const rows=readMixedVatEditor();if(rows.length<2||rows.some(x=>!x.valid)){updateMixedVatStatus();return}
  const netC=rows.reduce((s,x)=>s+x.netC,0),vatC=rows.reduce((s,x)=>s+x.vatC,0),grossC=netC+vatC;
  for(const [key,value] of Object.entries({net:netC,vatAmount:vatC,gross:grossC})){const el=f.elements.namedItem(key);if(el)el.value=formatCents(value);d[key]=value/100}
  if(!d.fieldProvenance||typeof d.fieldProvenance!=='object')d.fieldProvenance={};
  for(const key of ['net','vatAmount','gross'])d.fieldProvenance[key]={source:'calculated',confirmed:false,confidence:null,derivedFrom:['vatLines'],calculatedAt:new Date().toISOString()};
  if(typeof financialReviewEvent==='function')financialReviewEvent('financial_recalculation_applied',['net','vatAmount','gross']);
  if(typeof updateFinancialReviewPanel==='function')updateFinancialReviewPanel();
  updateMixedVatStatus();updateBeginnerReviewState()
}

function specialVatPanel(open){
  const panel=document.getElementById('otherVatSituation');if(!panel)return;
  panel.hidden=!open;
  const button=document.getElementById('otherVatToggle');if(button)button.setAttribute('aria-expanded',String(open))
}
function toggleOtherVatSituation(){specialVatPanel(document.getElementById('otherVatSituation')?.hidden!==false)}
function chooseZeroVat(){
  const d=pendingPdfImport?.parsed,f=document.getElementById('pdfImportForm');if(!d||!f)return;
  const rate=f.elements.namedItem('vatRate');if(rate)rate.value='0';
  d.vatRate=0;
  const vat=f.elements.namedItem('vatAmount');if(vat&&!String(vat.value||'').trim())vat.value='0.00';
  if(typeof syncFinancialReviewStateFromForm==='function')syncFinancialReviewStateFromForm('vatRate');
  specialVatPanel(false);updateBeginnerReviewState();if(typeof updateFinancialReviewPanel==='function')updateFinancialReviewPanel()
}

function financialBlockingIssues(d){
  const f=document.getElementById('pdfImportForm');if(!f)return [{field:'form',message:'Het controlescherm is niet volledig geladen.'}];
  const type=reviewDocumentType(d),req=requirementsFor(type),issues=[],value=k=>String(f.elements.namedItem(k)?.value??'').trim();
  const required=new Set(req.blocking);
  if(d?.mixedRates){required.delete('vatRate');required.add('vatLines')}
  for(const key of required){
    if(['net','vatAmount','gross','vatRate','vatLines'].includes(key))continue;
    if(!value(key))issues.push({field:key,message:(LABELS[key]||key)+' ontbreekt.'})
  }
  const deferred=new Set(deferredFields(d));
  for(const key of req.attention||[]){
    const current=value(key);
    if(!current||deferred.has(key)||isUserConfirmed(d,key)||!fieldUncertain(d,key,key==='party'?75:70))continue;
    issues.push({field:key,message:(LABELS[key]||key)+': kies ‘Dit klopt zo’, pas aan of kies ‘Later controleren’.'})
  }
  const netC=cents(value('net')),vatC=cents(value('vatAmount')),grossC=cents(value('gross'));
  if(required.has('net')&&netC==null)issues.push({field:'net',message:'Controleer het bedrag excl. btw.'});
  if(required.has('vatAmount')&&vatC==null)issues.push({field:'vatAmount',message:'Controleer het btw-bedrag.'});
  if(required.has('gross')&&(grossC==null||grossC===0))issues.push({field:'gross',message:'Controleer het totaal.'});
  if(netC!=null&&vatC!=null&&grossC!=null&&netC+vatC!==grossC)issues.push({field:'gross',message:'Deze bedragen kloppen nog niet met elkaar.'});
  if(!d?.mixedRates&&required.has('vatRate')&&netC!=null&&vatC!=null&&grossC!=null){
    const rate=value('vatRate')===''?null:Number(value('vatRate'));
    if(rate==null||!Number.isFinite(rate))issues.push({field:'vatRate',message:'Kies het btw-percentage.'});
    else if(typeof BookunaFinancialCorrection!=='undefined'&&!BookunaFinancialCorrection.candidateFitsRate({net:netC,vatAmount:vatC,gross:grossC},rate,0))issues.push({field:'vatRate',message:'Het btw-percentage past niet bij deze bedragen.'});
  }
  if(d?.mixedRates){const mixed=mixedVatValidation();if(!mixed.ok)issues.push({field:mixed.field||'vatLines',message:mixed.message})}
  if(d?.duplicateCandidate&&!f.elements.namedItem('confirmDuplicate')?.checked)issues.push({field:'confirmDuplicate',message:'Controleer eerst of dit document echt nieuw is.'});
  return issues.filter((x,i,a)=>a.findIndex(y=>y.field===x.field&&y.message===x.message)===i)
}
function updateFinancialBadges(){
  const d=pendingPdfImport?.parsed,f=document.getElementById('pdfImportForm');if(!d||!f)return;
  for(const key of ['net','vatAmount','gross','vatRate']){
    const el=f.elements.namedItem(key),badge=el?.closest('.field')?.querySelector('.beginner-provenance');if(!badge)continue;
    const holder=document.createElement('div');holder.innerHTML=provenanceBadge(d,key);const next=holder.firstElementChild;if(next)badge.replaceWith(next)
  }
}
function updateBeginnerReviewState(){
  const d=pendingPdfImport?.parsed,box=document.getElementById('reviewBlockingState');if(!d||!box)return;
  if(d.mixedRates)syncMixedVatFromDomWithoutRender();
  const issues=financialBlockingIssues(d),deferred=deferredFields(d);
  box.className='beginner-review-state '+(issues.length?'bad':'good');
  if(issues.length){
    const n=issues.length;box.innerHTML='<strong>Controleer '+n+' '+(n===1?'ding':'dingen')+'</strong><div class="beginner-issue-list">'+issues.map(x=>'<button type="button" class="beginner-issue" onclick="focusDocumentReviewField(\''+esc(x.field)+'\')">'+esc(x.message)+'</button>').join('')+'</div>'
  }else{
    box.innerHTML='<strong>Klaar om op te slaan</strong><span>Bedragen kloppen'+(deferred.length?' · '+deferred.length+' punt'+(deferred.length===1?'':'en')+' later controleren':'')+'.</span>'
  }
  document.querySelectorAll('[data-review-save]').forEach(btn=>{btn.disabled=issues.length>0});
  updateFinancialBadges();if(d.mixedRates)updateMixedVatStatus()
}
function syncMixedVatFromDomWithoutRender(){
  const d=pendingPdfImport?.parsed;if(!d?.mixedRates||!document.querySelector('.mixed-vat-row'))return;
  const lines=readMixedVatEditor();d.vatLines=lines.map(x=>({rate:x.rate,taxableAmount:x.netC==null?'':x.netC/100,vatAmount:x.vatC==null?'':x.vatC/100}));d.vatRate=null
}
function firstBlockingFocus(){
  const d=pendingPdfImport?.parsed,issue=financialBlockingIssues(d)[0];if(!issue)return;
  if(issue.field==='vatLines'){document.querySelector('.mixed-vat-row input')?.focus();return}
  const el=document.getElementById('pdfImportForm')?.elements.namedItem(issue.field);const step=Number(el?.closest('[data-review-step]')?.dataset.reviewStep||2);setDocumentReviewStep(step);requestAnimationFrame(()=>el?.focus())
}
function onGenericReviewInput(event){
  const d=pendingPdfImport?.parsed,key=event?.target?.name;if(!d||!key)return;
  if(['party','category','issueDate','invoiceNumber'].includes(key)){
    genericProvenance(d)[key]={source:'user',confirmed:true,confirmedAt:new Date().toISOString()};
    setDeferredFields(d,deferredFields(d).filter(x=>x!==key))
  }
  if(['net','vatAmount','gross','vatRate'].includes(key)&&typeof syncFinancialReviewStateFromForm==='function')syncFinancialReviewStateFromForm(key);
  if(typeof updateFinancialReviewPanel==='function'&&['net','vatAmount','gross','vatRate'].includes(key))updateFinancialReviewPanel();
  updateBeginnerReviewState()
}
function bindBeginnerReview(){
  const f=document.getElementById('pdfImportForm'),d=pendingPdfImport?.parsed;if(!f||!d)return;
  f.querySelectorAll('input,select,textarea').forEach(el=>{if(el.closest('#mixedVatRows'))return;el.addEventListener('input',onGenericReviewInput);el.addEventListener('change',onGenericReviewInput)});
  if(d.mixedRates)renderMixedVatRows();
  const financialPanel=document.getElementById('financialCorrectionPanel');
  if(financialPanel){
    const observer=new MutationObserver(()=>queueMicrotask(()=>updateBeginnerReviewState()));
    observer.observe(financialPanel,{childList:true,subtree:true,characterData:true});
  }
  if(typeof updateFinancialReviewPanel==='function')updateFinancialReviewPanel();
  updateBeginnerReviewState()
}

function applyFinancialCorrectionProposal(){
  const result=typeof legacyApplyFinancialCorrectionProposal==='function'?legacyApplyFinancialCorrectionProposal():undefined;
  queueMicrotask(()=>updateBeginnerReviewState());
  return result
}
function confirmSuggestedFinancialRate(rate){
  const result=typeof legacyConfirmSuggestedFinancialRate==='function'?legacyConfirmSuggestedFinancialRate(rate):undefined;
  queueMicrotask(()=>updateBeginnerReviewState());
  return result
}

function setDocumentReviewStep(step){
  const flow=document.querySelector('.document-review-flow.beginner-review');if(!flow)return;
  const n=Math.max(1,Math.min(3,Number(step)||1));flow.dataset.step=String(n);
  flow.querySelectorAll('[data-review-step]').forEach(el=>el.classList.toggle('active',Number(el.dataset.reviewStep)===n));
  const labels=['Document','Controleren','Opslaan'],label=document.getElementById('mobileReviewStepLabel');
  if(label)label.textContent='Stap '+n+' van 3 · '+labels[n-1];
  const prev=document.getElementById('mobileReviewPrev'),next=document.getElementById('mobileReviewNext'),save=document.getElementById('mobileReviewSave');
  if(prev)prev.style.display=n===1?'none':'inline-flex';
  if(next)next.style.display=n===3?'none':'inline-flex';
  if(save)save.style.display=n===3?'inline-flex':'none';
  flow.closest('.modal')?.querySelector('.modal-body')?.scrollTo?.({top:0,behavior:'auto'})
}

function showPdfImportReview(d){
  if(!d||typeof legacyShowPdfImportReview!=='function')return legacyShowPdfImportReview?.(d);
  if(typeof ensureFinancialReviewProvenance==='function')ensureFinancialReviewProvenance(d);
  if(!d.reviewFieldProvenance)d.reviewFieldProvenance={};
  if(!Array.isArray(d.reviewDeferredFields))d.reviewDeferredFields=[];
  if(d.mixedRates)d.vatRate=null;

  const type=String(d.documentType||'purchase_invoice'),isSale=['sale_invoice','sales_invoice'].includes(type)||d.type==='sale';
  const partyLabel=isSale?'Klant / relatie':'Leverancier';
  const invoiceRequired=!['receipt','other'].includes(type);
  const categoryValue=String(d.category||'Inkoop');
  const due=safeDate(d.dueDate,d.issueDate);
  const currency=String(d.currency||'EUR').toUpperCase();
  const preview=pendingPdfImport?.previewUrl?(pendingPdfImport.file.type==='application/pdf'||/\.pdf$/i.test(pendingPdfImport.file.name)?'<iframe src="'+esc(pendingPdfImport.previewUrl)+'" title="Documentpreview" class="document-review-preview-frame"></iframe>':'<img src="'+esc(pendingPdfImport.previewUrl)+'" alt="Documentpreview" class="document-review-preview-image">'):'<div class="beginner-preview-empty"><strong>Document ontvangen</strong><span>Vergelijk de gegevens hieronder met je bon of factuur.</span></div>';
  const duplicate=d.duplicateCandidate?'<div class="notice warn review-important"><strong>Deze bon lijkt al verwerkt.</strong><br>'+esc(d.duplicateCandidate.label||'Er is een vergelijkbaar document gevonden.')+'<label class="review-checkbox warn"><input type="checkbox" name="confirmDuplicate"> <span>Dit is toch een nieuwe bon</span></label></div>':'';
  const mixed=d.mixedRates?'<section class="mixed-vat-editor" aria-labelledby="mixedVatTitle"><div class="mixed-vat-head"><div><h5 id="mixedVatTitle">Deze bon heeft meerdere btw-tarieven</h5><p>Controleer per tarief het bedrag excl. btw en het btw-bedrag.</p></div></div><div id="mixedVatRows"></div><div class="mixed-vat-actions"><button type="button" class="btn small" onclick="addMixedVatLine()">Regel toevoegen</button><button type="button" class="btn small" onclick="useMixedVatTotals()">Gebruik deze totalen</button></div><div id="mixedVatStatus" class="mixed-vat-status" role="status" aria-live="polite"></div></section>':'';
  const invoiceField=invoiceRequired||d.invoiceNumber?'<div class="field"><label>'+ (type==='receipt'?'Bonnummer / referentie':'Factuurnummer')+' '+provenanceBadge(d,'invoiceNumber')+'</label><input name="invoiceNumber" value="'+esc(d.invoiceNumber||'')+'" '+(invoiceRequired?'required':'')+' placeholder="'+(invoiceRequired?'Vul het factuurnummer in':'Optioneel')+'">'+attentionControls(d,'invoiceNumber')+'</div>':'<input type="hidden" name="invoiceNumber" value="">';
  const currencyField=currency!=='EUR'?'<div class="field"><label>Valuta</label><input name="currency" value="'+esc(currency)+'" maxlength="3"></div>':'<input type="hidden" name="currency" value="EUR">';
  const safeAddress=String(d.address||''),safePostal=String(d.postal||''),safeCity=String(d.city||''),safeEmail=String(d.email||''),safePhone=String(d.phone||''),kvk=safeKvk(d.kvk),vatId=safeVatId(d.vatId),iban=safeIban(d.iban);
  const adjustTotal=(d.adjustments||[]).reduce((sum,a)=>sum+Number(a.gross||0),0);

  const body='<div class="document-review-flow beginner-review" data-step="1">'+
   '<div class="mobile-review-progress"><span id="mobileReviewStepLabel">Stap 1 van 3 · Document</span><div><i></i><i></i><i></i></div></div>'+
   '<section class="review-step review-step-preview active" data-review-step="1"><div class="review-step-head"><div><span class="review-kicker">Document</span><h4>Bekijk je document</h4></div></div><div class="review-preview-shell">'+preview+'</div><div class="mobile-review-hint">Boekuna heeft het voorwerk gedaan. Controleer alleen wat hieronder nodig is.</div></section>'+
   '<div class="document-review-fields"><form id="pdfImportForm">'+
    '<section class="review-step" data-review-step="2"><div class="review-step-head"><div><span class="review-kicker">Controleren</span><h4>Controleer de belangrijkste gegevens</h4></div><button type="button" class="link-btn mobile-only-review" onclick="setDocumentReviewStep(1)">Bekijk document</button></div>'+
     duplicate+
     '<div class="form-grid beginner-core-grid">'+
      '<div class="field full"><label>'+partyLabel+' '+provenanceBadge(d,'party')+'</label><input name="party" value="'+esc(d.party||'')+'" required>'+attentionControls(d,'party')+'</div>'+
      '<div class="field"><label>Datum '+provenanceBadge(d,'issueDate')+'</label><input type="date" name="issueDate" value="'+esc(safeDate(d.issueDate))+'" required></div>'+
      invoiceField+
      (!isSale?'<div class="field"><label>Categorie '+provenanceBadge(d,'category')+'</label><select name="category">'+selectOptions(['Inkoop','Kantoor','Software','Reiskosten','Marketing','Representatie','Huisvesting','Bank- & factoringkosten','Overig'],categoryValue)+'</select>'+attentionControls(d,'category')+'</div>':'<input type="hidden" name="category" value="'+esc(categoryValue)+'">')+
      currencyField+
     '</div>'+
     '<div class="review-amount-card beginner-amount-card"><div class="review-amount-primary"><span>Excl. btw</span><strong>'+((d.net!==''&&d.net!=null)?money(d.net):'—')+'</strong></div><div class="review-amount-primary"><span>Btw</span><strong>'+((d.vatAmount!==''&&d.vatAmount!=null)?money(d.vatAmount):'—')+'</strong></div><div class="review-amount-primary emphasis"><span>Totaal</span><strong>'+((d.gross!==''&&d.gross!=null)?money(d.gross):'—')+'</strong></div></div>'+
     '<div class="form-grid beginner-money-grid">'+
      '<div class="field"><label>Bedrag excl. btw '+provenanceBadge(d,'net')+'</label><input id="pdfImportNet" name="net" inputmode="decimal" autocomplete="off" value="'+esc(d.net!==''&&d.net!=null?Number(d.net).toFixed(2):'')+'" required></div>'+
      '<div class="field"><label>Btw-bedrag '+provenanceBadge(d,'vatAmount')+'</label><input id="pdfImportVatAmount" name="vatAmount" inputmode="decimal" autocomplete="off" value="'+esc(d.vatAmount!==''&&d.vatAmount!=null?Number(d.vatAmount).toFixed(2):'')+'" required></div>'+
      '<div class="field"><label>Totaal '+provenanceBadge(d,'gross')+'</label><input id="pdfImportGross" name="gross" inputmode="decimal" autocomplete="off" value="'+esc(d.gross!==''&&d.gross!=null?Number(d.gross).toFixed(2):'')+'" required></div>'+
      '<div class="field"><label>Btw-percentage '+provenanceBadge(d,'vatRate')+'</label><select id="pdfImportVatRate" name="vatRate" '+(d.mixedRates?'disabled':'')+' aria-describedby="financialCorrectionPanel"><option value="">Kies</option><option value="21" '+(rateSelectValue(d)==='21'?'selected':'')+'>21%</option><option value="9" '+(rateSelectValue(d)==='9'?'selected':'')+'>9%</option><option value="0" hidden '+(specialRateSelected(d)?'selected':'')+'>Geen btw</option></select>'+(!d.mixedRates&&!isUserConfirmed(d,'vatRate')?'<div class="beginner-field-actions" data-financial-anchor-actions="vatRate"><button type="button" class="link-btn" data-financial-anchor-confirm="vatRate" onclick="confirmFinancialReviewAnchor(\'vatRate\')">Dit klopt zo</button></div>':'')+'<button id="otherVatToggle" type="button" class="link-btn other-vat-toggle" aria-expanded="'+(specialRateSelected(d)?'true':'false')+'" onclick="toggleOtherVatSituation()">Andere btw-situatie</button><div id="otherVatSituation" class="other-vat-situation" '+(specialRateSelected(d)?'':'hidden')+'><p>Alleen gebruiken als er op dit document geen btw-bedrag staat.</p><button type="button" class="btn small" onclick="chooseZeroVat()">0% / geen btw op document</button></div></div>'+
     '</div>'+
     mixed+
     '<div id="financialCorrectionPanel" class="financial-correction-panel" role="status" aria-live="polite"><h5>Financiële controle</h5><p>Controleer de bedragen op het document.</p></div>'+
     '<div id="reviewBlockingState" class="beginner-review-state" role="status" aria-live="polite"></div>'+
    '</section>'+
    '<section class="review-step" data-review-step="3"><div class="review-step-head"><div><span class="review-kicker">Opslaan</span><h4>Bijna klaar</h4></div></div>'+
     '<div class="review-save-summary"><span>'+esc(d.party||'Relatie controleren')+'</span><strong>'+((d.gross!==''&&d.gross!=null)?money(d.gross):'—')+'</strong><small>'+ (d.issueDate?dateNL(d.issueDate):'Datum controleren')+' · '+esc(type==='receipt'?'Bon':type==='credit_invoice'?'Creditfactuur':isSale?'Verkoopfactuur':'Inkoopfactuur')+'</small></div>'+
     '<details class="review-details"><summary>Meer gegevens</summary><div class="form-grid review-step-grid beginner-more-grid">'+
      '<div class="field full"><label>Adres</label><input name="address" value="'+esc(safeAddress)+'"></div><div class="field"><label>Postcode</label><input name="postal" value="'+esc(safePostal)+'"></div><div class="field"><label>Plaats</label><input name="city" value="'+esc(safeCity)+'"></div>'+
      '<div class="field"><label>E-mail</label><input name="email" type="email" value="'+esc(safeEmail)+'"></div><div class="field"><label>Telefoon</label><input name="phone" value="'+esc(safePhone)+'"></div><div class="field"><label>KVK</label><input name="kvk" value="'+esc(kvk)+'"></div><div class="field"><label>Btw-id</label><input name="vatId" value="'+esc(vatId)+'"></div><div class="field full"><label>IBAN</label><input name="iban" value="'+esc(iban)+'" autocomplete="off"></div>'+
      '<div class="field"><label>Vervaldatum</label><input type="date" name="dueDate" value="'+esc(due)+'"></div><div class="field"><label>Betaaltermijn</label><input type="number" min="0" max="365" name="paymentTermDays" value="'+esc(d.paymentTermDays??'')+'"></div><div class="field"><label>Ordernummer</label><input name="orderNumber" value="'+esc(d.orderNumber||'')+'"></div><div class="field"><label>Betalingskenmerk</label><input name="paymentReference" value="'+esc(d.paymentReference||'')+'"></div>'+
      '<div class="field full"><label>Omschrijving</label><input name="description" value="'+esc(d.description||'')+'"></div>'+
      '<div class="field"><label>Soort document</label><select name="documentType"><option value="purchase_invoice" '+(type==='purchase_invoice'?'selected':'')+'>Inkoopfactuur</option><option value="sale_invoice" '+(isSale?'selected':'')+'>Verkoopfactuur</option><option value="credit_invoice" '+(type==='credit_invoice'?'selected':'')+'>Creditfactuur</option><option value="receipt" '+(type==='receipt'?'selected':'')+'>Bon</option><option value="other" '+(type==='other'?'selected':'')+'>Overig</option></select></div>'+
      '<div class="field"><label>Boeking</label><select name="type"><option value="purchase" '+(d.type!=='sale'?'selected':'')+'>Kosten / inkoop</option><option value="sale" '+(d.type==='sale'?'selected':'')+'>Inkomsten / verkoop</option></select></div>'+
      '<div class="field"><label>Status</label><select name="status"><option value="sent" '+(!['draft','paid','cancelled','credit'].includes(String(d.status||''))?'selected':'')+'>Openstaand</option><option value="draft" '+(d.status==='draft'?'selected':'')+'>Concept</option><option value="paid" '+(d.status==='paid'?'selected':'')+'>Betaald</option><option value="cancelled" '+(d.status==='cancelled'?'selected':'')+'>Geannuleerd</option><option value="credit" '+(d.isCredit||d.status==='credit'?'selected':'')+'>Credit</option></select></div>'+
     '</div></details>'+
     (adjustTotal>0?'<label class="review-checkbox"><input type="checkbox" name="bookAdjustments" checked> <span>Boek gedetecteerde kosten ('+money(adjustTotal)+') apart</span></label>':'')+
     '<details class="review-details review-technical"><summary>Technische details</summary><div class="review-technical-body"><p>Bron: '+esc(d.sourceQuality?.startsWith('processor')?'Boekuna documentherkenning':'Documentherkenning')+'. Technische herkenningsscores zijn niet nodig om dit document te controleren.</p></div></details>'+
    '</section>'+
   '</form></div></div>';

  const foot='<div class="desktop-review-actions"><button class="btn" type="button" onclick="cancelDocumentReview()">Annuleren</button><button class="btn primary" type="button" data-review-save onclick="savePdfInvoiceImport()">Gecontroleerd & opslaan</button></div>'+
   '<div class="mobile-review-actions"><button class="btn" type="button" id="mobileReviewPrev" style="display:none" onclick="setDocumentReviewStep(Number(document.querySelector(\'.document-review-flow\')?.dataset.step||1)-1)">Vorige</button><button class="btn primary" type="button" id="mobileReviewNext" onclick="setDocumentReviewStep(Number(document.querySelector(\'.document-review-flow\')?.dataset.step||1)+1)">Volgende</button><button class="btn primary" type="button" id="mobileReviewSave" data-review-save style="display:none" onclick="savePdfInvoiceImport()">Gecontroleerd & opslaan</button></div>';
  modal('Document controleren',body,foot,true);
  requestAnimationFrame(()=>{setDocumentReviewStep(1);bindBeginnerReview()})
}

function captureReviewSnapshot(){
  const d=pendingPdfImport?.parsed,f=document.getElementById('pdfImportForm');if(!d||!f)return null;
  syncMixedVatFromDomWithoutRender();
  const fd=Object.fromEntries(new FormData(f).entries()),number=v=>{const n=typeof parseSignedMoneyValue==='function'?parseSignedMoneyValue(v):Number(v);return Number.isFinite(n)?n:null};
  return {
    version:2,reviewedAt:new Date().toISOString(),
    type:String(fd.type||d.type||'purchase'),documentType:String(fd.documentType||d.documentType||'other'),
    party:String(fd.party||''),issueDate:String(fd.issueDate||''),invoiceNumber:String(fd.invoiceNumber||''),category:String(fd.category||''),
    net:number(fd.net),vatAmount:number(fd.vatAmount),gross:number(fd.gross),
    vatRate:d.mixedRates?null:(fd.vatRate===''?null:Number(fd.vatRate)),mixedRates:!!d.mixedRates,
    vatLines:typeof canonicalFinancialVatLines==='function'?canonicalFinancialVatLines(d.vatLines):structuredClone(d.vatLines||[]),
    currency:String(fd.currency||'EUR'),description:String(fd.description||''),dueDate:String(fd.dueDate||''),
    paymentReference:String(fd.paymentReference||''),orderNumber:String(fd.orderNumber||''),paymentTermDays:fd.paymentTermDays===''?null:Number(fd.paymentTermDays),
    fieldProvenance:structuredClone(d.fieldProvenance||{}),reviewFieldProvenance:structuredClone(d.reviewFieldProvenance||{}),
    deferredFields:deferredFields(d)
  }
}
function findSavedDocumentAfter(beforeIds,sourceClientRef,fileName){
  if(sourceClientRef){const d=state.documents.find(x=>String(x.fileId||'')===String(sourceClientRef));if(d)return d}
  const fresh=state.documents.find(x=>!beforeIds.has(x.id));if(fresh)return fresh;
  return state.documents.find(x=>String(x.name||'')===String(fileName||'')&&x.linkedId)||null
}
async function savePdfInvoiceImport(){
  const d=pendingPdfImport?.parsed;if(!d)return legacySavePdfInvoiceImport?.();
  syncMixedVatFromDomWithoutRender();
  const issues=financialBlockingIssues(d);if(issues.length){updateBeginnerReviewState();firstBlockingFocus();toast('Controleer de gemarkeerde gegevens voordat je opslaat.');return}
  const snapshot=captureReviewSnapshot(),deferred=snapshot?.deferredFields||[],beforeIds=new Set(state.documents.map(x=>x.id)),beforeContactIds=new Set(state.contacts.map(x=>x.id)),sourceClientRef=String(pendingPdfImport?.sourceClientRef||''),fileName=pendingPdfImport?.file?.name||'';
  const result=await legacySavePdfInvoiceImport();
  if(pendingPdfImport)return result;
  const doc=findSavedDocumentAfter(beforeIds,sourceClientRef,fileName);if(!doc||!snapshot)return result;
  if(deferred.includes('party')&&doc.linkedType==='expense'){
    state.contacts=state.contacts.filter(c=>beforeContactIds.has(c.id)||c.type!=='supplier'||String(c.name||'').trim()!==String(snapshot.party||'').trim());
  }
  doc.reviewSnapshot=snapshot;doc.reviewAttentionFields=[...deferred];doc.reviewedAt=snapshot.reviewedAt;
  if(doc.verification?.method==='manual-review'){
    doc.verification.status='verified';doc.verification.method=deferred.length?'user-reviewed-with-attention':'user-reviewed';doc.verification.reasons=[];doc.verification.checkedAt=new Date().toISOString();doc.verification.differences=[];doc.verification.financialIssues=[]
  }
  save();if(page==='documents'||page==='control')render();
  return result
}

function savedReviewValue(snapshot,key){
  const value=snapshot?.[key];if(value==null||value==='')return '—';
  if(['net','vatAmount','gross'].includes(key))return money(Number(value));
  if(key==='vatRate')return value==null?'Meerdere tarieven':num(Number(value))+'%';
  if(key==='issueDate')return dateNL(value);
  return String(value)
}
function openSavedDocumentReview(id){
  const doc=state.documents.find(x=>x.id===id),s=doc?.reviewSnapshot;if(!doc||!s)return toast('De opgeslagen controle is niet beschikbaar.');
  const rows=[['Leverancier / relatie','party'],['Datum','issueDate'],['Factuurnummer','invoiceNumber'],['Bedrag excl. btw','net'],['Btw','vatAmount'],['Totaal','gross']];
  const vat=s.mixedRates?'<div class="saved-review-vat"><strong>Btw-verdeling</strong>'+((s.vatLines||[]).map(x=>'<span>'+esc(num(x.rate))+'% · excl. '+money(x.taxableAmount)+' · btw '+money(x.vatAmount)+'</span>').join('')||'<span>—</span>')+'</div>':'<div class="saved-review-row"><span>Btw-percentage</span><strong>'+esc(savedReviewValue(s,'vatRate'))+'</strong></div>';
  const attention=Array.isArray(doc.reviewAttentionFields)&&doc.reviewAttentionFields.length?'<div class="notice warn"><strong>Later controleren</strong><br>'+doc.reviewAttentionFields.map(x=>esc(LABELS[x]||x)).join(' · ')+'</div>':'';
  modal('Opgeslagen controle','<div class="saved-review-card">'+rows.map(([label,key])=>'<div class="saved-review-row"><span>'+esc(label)+'</span><strong>'+esc(savedReviewValue(s,key))+'</strong></div>').join('')+vat+'</div>'+attention,'<button class="btn" onclick="closeModal()">Sluiten</button>'+(doc.reviewAttentionFields?.length?'<button class="btn primary" onclick="openDeferredDocumentReview(\''+esc(doc.id)+'\')">Nu controleren</button>':''),true)
}
function openDeferredDocumentReview(id){
  const doc=state.documents.find(x=>x.id===id),s=doc?.reviewSnapshot,fields=Array.isArray(doc?.reviewAttentionFields)?doc.reviewAttentionFields:[];if(!doc||!s||!fields.length)return openSavedDocumentReview(id);
  const party=fields.includes('party')?'<div class="field"><label>Leverancier</label><input name="party" value="'+esc(s.party||'')+'" required></div>':'';
  const category=fields.includes('category')?'<div class="field"><label>Categorie</label><select name="category">'+selectOptions(['Inkoop','Kantoor','Software','Reiskosten','Marketing','Representatie','Huisvesting','Bank- & factoringkosten','Overig'],s.category||'Inkoop')+'</select></div>':'';
  modal('Later controleren','<p>Werk alleen het aandachtspunt bij. De eerder bevestigde bedragen blijven ongewijzigd.</p><form id="deferredReviewForm" class="form-grid">'+party+category+'</form>','<button class="btn" onclick="closeModal()">Annuleren</button><button class="btn primary" onclick="saveDeferredDocumentReview(\''+esc(id)+'\')">Opslaan</button>')
}
function saveDeferredDocumentReview(id){
  const doc=state.documents.find(x=>x.id===id),s=doc?.reviewSnapshot,f=document.getElementById('deferredReviewForm');if(!doc||!s||!f)return;
  if(!f.checkValidity()){f.reportValidity();return}
  const fd=Object.fromEntries(new FormData(f).entries()),expense=doc.linkedType==='expense'?state.expenses.find(x=>x.id===doc.linkedId):null,invoice=doc.linkedType==='invoice'?state.invoices.find(x=>x.id===doc.linkedId):null;
  for(const field of [...(doc.reviewAttentionFields||[])]){
    if(field==='party'&&fd.party){
      s.party=String(fd.party).trim();
      if(expense){
        expense.vendor=s.party;
        findOrCreateContact('supplier',{party:s.party,email:'',phone:'',vatId:'',kvk:'',address:'',postal:'',city:'',iban:''});
      }
      if(invoice){const c=findOrCreateContact('customer',{party:s.party,email:'',phone:'',vatId:'',kvk:'',address:'',postal:'',city:'',iban:''});invoice.customerId=c.id}
    }
    if(field==='category'&&fd.category){s.category=String(fd.category);if(expense)expense.category=s.category}
    if(!s.reviewFieldProvenance)s.reviewFieldProvenance={};s.reviewFieldProvenance[field]={source:'user',confirmed:true,confirmedAt:new Date().toISOString()}
  }
  doc.reviewAttentionFields=[];s.deferredFields=[];doc.reviewedAt=new Date().toISOString();
  logEvent('Documentaandacht opgelost',doc.name||id,'document',doc.id,null,{fields:Object.keys(fd)});save();closeModal();render();toast('Aandachtspunt bijgewerkt.')
}
async function openPersistentDocumentReview(jobId){
  const job=documentProcessingJobs.find(j=>String(j.id)===String(jobId)),saved=job?state.documents.find(d=>String(d.fileId||'')===String(job.client_ref||'')&&d.linkedId&&d.reviewSnapshot):null;
  if(saved)return openSavedDocumentReview(saved.id);
  return legacyOpenPersistentDocumentReview(jobId)
}
function attentionRows(){
  const rows=typeof legacyAttentionRows==='function'?legacyAttentionRows():[],keys=new Set(rows.map(x=>x.key));
  for(const d of state.documents||[]){
    const fields=Array.isArray(d.reviewAttentionFields)?d.reviewAttentionFields:[];
    if(!fields.length)continue;
    const key='document-review-'+d.id;if(keys.has(key))continue;
    rows.push({key,category:'documents',title:d.name||'Document',detail:'Later controleren · '+fields.map(x=>LABELS[x]||x).join(', '),action:()=>openDeferredDocumentReview(d.id),label:'Controleren'})
  }
  return rows
}
function persistentDocumentReviewActionForFile(d){
  const existing=typeof legacyPersistentDocumentReviewActionForFile==='function'?legacyPersistentDocumentReviewActionForFile(d):'';
  if(existing)return existing;
  return d?.reviewSnapshot?'<button class="link-btn" onclick="openSavedDocumentReview(\''+esc(d.id)+'\')">Bekijken</button> ':''
}

global.BookunaDocumentReviewV2=Object.freeze({requirementsFor,financialBlockingIssues,mixedVatValidation,captureReviewSnapshot});
global.requirementsForDocumentReview=requirementsFor;
global.setDocumentReviewStep=setDocumentReviewStep;
global.showPdfImportReview=showPdfImportReview;
global.savePdfInvoiceImport=savePdfInvoiceImport;
global.deferDocumentReviewField=deferDocumentReviewField;
global.confirmDocumentReviewField=confirmDocumentReviewField;
global.focusDocumentReviewField=focusDocumentReviewField;
global.confirmFinancialReviewAnchor=confirmFinancialReviewAnchor;
global.addMixedVatLine=addMixedVatLine;
global.removeMixedVatLine=removeMixedVatLine;
global.useMixedVatTotals=useMixedVatTotals;
global.toggleOtherVatSituation=toggleOtherVatSituation;
global.chooseZeroVat=chooseZeroVat;
global.updateBeginnerReviewState=updateBeginnerReviewState;
global.applyFinancialCorrectionProposal=applyFinancialCorrectionProposal;
global.confirmSuggestedFinancialRate=confirmSuggestedFinancialRate;
global.openSavedDocumentReview=openSavedDocumentReview;
global.openDeferredDocumentReview=openDeferredDocumentReview;
global.saveDeferredDocumentReview=saveDeferredDocumentReview;
global.openPersistentDocumentReview=openPersistentDocumentReview;
global.attentionRows=attentionRows;
global.persistentDocumentReviewActionForFile=persistentDocumentReviewActionForFile;
})(globalThis);
