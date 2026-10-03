import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chromium,webkit} from 'playwright';

const root=process.cwd();
const reviewJs=fs.readFileSync(path.join(root,'public','assets','document-review-v2.js'),'utf8');
const reviewCss=fs.readFileSync(path.join(root,'public','assets','document-review-v2.css'),'utf8');
const buildSource=fs.readFileSync(path.join(root,'scripts','build-app.mjs'),'utf8');

for(const phrase of ['Controleer dit even','Later controleren','Dit klopt zo','Meer gegevens','Andere btw-situatie']){
  assert.ok(reviewJs.includes(phrase),'beginner review copy missing: '+phrase);
}
assert.equal(/>\s*Negeren\s*</i.test(reviewJs),false,'generic Negeren action is forbidden');
assert.ok(reviewJs.includes('requirementsFor'),'contextual requirement matrix missing');
assert.ok(reviewJs.includes('reviewAttentionFields'),'deferred attention persistence missing');
assert.ok(reviewJs.includes('reviewSnapshot'),'saved review snapshot missing');
assert.ok(reviewJs.includes('mixed-vat-row'),'mixed VAT editor missing');
assert.ok(reviewJs.includes('netC+vatC!==grossC'),'financial core must compare cents exactly');
assert.ok(reviewCss.includes('min-height:44px'),'mobile review actions must keep 44px touch targets');
assert.ok(buildSource.includes("'document-review-v2.js'")&&buildSource.includes("'document-review-v2.css'"),'app build must copy review assets');
assert.ok(buildSource.includes('/assets/document-review-v2.js')&&buildSource.includes('/assets/document-review-v2.css'),'app build must inject review assets');

const build=spawnSync(process.execPath,['scripts/build-app.mjs'],{cwd:root,encoding:'utf8'});
assert.equal(build.status,0,'app build failed: '+(build.stderr||build.stdout));
const dist=path.join(root,'dist','app');
for(const file of ['assets/document-review-v2.js','assets/document-review-v2.css'])assert.ok(fs.existsSync(path.join(dist,file)),'built review asset missing: '+file);

let appHtml=fs.readFileSync(path.join(dist,'index.html'),'utf8');
assert.ok(appHtml.includes('/assets/document-review-v2.js'),'built app must load review runtime');
assert.ok(appHtml.includes('/assets/document-review-v2.css'),'built app must load review styles');
const inlineScripts=[...appHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
assert.ok(inlineScripts.length>=1,'built app must contain inline runtime');
for(const [index,script] of inlineScripts.entries())assert.doesNotThrow(()=>new Function(script),'built inline script '+(index+1)+' must parse');

function replaceLast(text,needle,replacement){
  const i=text.lastIndexOf(needle);
  if(i<0)throw new Error('Missing fixture bootstrap marker: '+needle);
  return text.slice(0,i)+replacement+text.slice(i+needle.length);
}
appHtml=appHtml.replace('const TEST_MODE_NO_AUTH=false;','const TEST_MODE_NO_AUTH=true;');
appHtml=replaceLast(appHtml,'initAuth();',[
  "currentUser={...TEST_USER,email:'review-qa@example.test'};",
  "state=structuredClone(DEFAULT);",
  "state.company={...state.company,name:'Review QA BV',kvk:'12345678',vat:'NL123456789B01',address:'Teststraat 1',postal:'3011AA',city:'Rotterdam',email:'review-qa@example.test'};",
  "state.contacts=[];state.expenses=[];state.invoices=[];state.documents=[];",
  "documentProcessingJobs=[];documentProcessingInitialized=true;documentProcessingConnectivityLost=false;documentProcessingFetchError=false;",
  "enterApp();"
].join('\n'));

const mime={'.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  if(pathname.startsWith('/assets/')){
    const file=path.join(dist,pathname);
    if(fs.existsSync(file)){res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});return fs.createReadStream(file).pipe(res)}
  }
  if(pathname==='/manifest.webmanifest'){res.writeHead(200,{'content-type':mime['.webmanifest']});return fs.createReadStream(path.join(dist,'manifest.webmanifest')).pipe(res)}
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  res.end(appHtml);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browserType=process.env.BOOKUNA_BROWSER==='webkit'?webkit:chromium;
const browserName=process.env.BOOKUNA_BROWSER==='webkit'?'webkit':'chromium';
const browser=await browserType.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));

async function openReview(overrides={}){
  await page.evaluate(overrides=>{
    const base={
      type:'purchase',documentType:'purchase_invoice',confidenceScore:82,sourceQuality:'processor-v2',
      party:'Voorbeeld Leverancier BV',invoiceNumber:'INK-2026-001',issueDate:'2026-10-03',dueDate:'',
      description:'Software',category:'Software',currency:'EUR',status:'sent',
      net:100,vatAmount:21,gross:121,vatRate:21,mixedRates:false,
      vatLines:[{rate:21,taxableAmount:100,vatAmount:21}],lineItems:[],adjustments:[],
      fieldConfidence:{party:95,invoiceNumber:95,issueDate:95,net:98,vatAmount:98,gross:98,vatRate:98,vatLines:98,category:80}
    };
    pendingPdfImport={
      file:new File(['qa'],'review.pdf',{type:'application/pdf'}),
      parsed:{...base,...overrides},previewUrl:null,sha256:'review-qa',
      sourceClientRef:'',sourceDocumentId:'',processingJobId:''
    };
    showPdfImportReview(pendingPdfImport.parsed);
  },overrides);
  await page.getByRole('heading',{name:'Document controleren'}).waitFor();
}
async function noOverflow(label){
  const x=await page.evaluate(()=>({vw:innerWidth,html:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  assert.ok(x.html<=x.vw+2&&x.body<=x.vw+2,label+' horizontal overflow '+JSON.stringify(x));
}

try{
  await page.goto(base+'/app',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!!window.BookunaDocumentReviewV2);

  const matrix=await page.evaluate(()=>({
    receipt:BookunaDocumentReviewV2.requirementsFor('receipt'),
    invoice:BookunaDocumentReviewV2.requirementsFor('purchase_invoice')
  }));
  assert.ok(matrix.receipt.optional.includes('invoiceNumber'),'receipt number should not be universally required');
  assert.ok(matrix.invoice.blocking.includes('invoiceNumber'),'purchase invoice number should be blocking');
  assert.ok(matrix.receipt.attention.includes('category'),'receipt category should be deferrable attention');
  assert.ok(matrix.invoice.optional.includes('iban'),'IBAN should stay optional');

  await openReview();
  assert.match(await page.locator('#mobileReviewStepLabel').innerText(),/Stap 1 van 3/);
  assert.equal(await page.getByRole('button',{name:'Negeren',exact:true}).count(),0);
  assert.equal(await page.locator('.review-confidence').count(),0,'primary beginner UI must not expose confidence badges');
  await page.evaluate(()=>setDocumentReviewStep(2));
  const visibleFieldNames=await page.locator('#pdfImportForm [name]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('name')));
  for(const [name,label] of [['party','Leverancier'],['issueDate','Datum'],['invoiceNumber','Factuurnummer'],['category','Categorie'],['net','Bedrag excl. btw'],['vatAmount','Btw-bedrag'],['gross','Totaal']]){
    assert.ok(visibleFieldNames.includes(name),'core field missing: '+label+'; available fields: '+visibleFieldNames.join(', '));
  }
  assert.equal(await page.locator('details.review-details').first().getAttribute('open'),null,'optional details must be collapsed');
  assert.doesNotMatch(await page.locator('#modalRoot').innerText(),/OCR\s*\d+%|confidence\s*\d+%/i,'primary review must not show confidence percentages');

  const net=page.locator('#pdfImportForm [name="net"]');
  const vat=page.locator('#pdfImportForm [name="vatAmount"]');
  const gross=page.locator('#pdfImportForm [name="gross"]');
  await net.fill('100,00');await vat.fill('20,00');await gross.fill('121,00');
  await page.locator('#reviewBlockingState').filter({hasText:/kloppen nog niet|Controleer/i}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Gecontroleerd & opslaan',exact:true}).first().isDisabled(),true,'financial mismatch must block save');
  await vat.fill('21,00');
  await page.locator('#reviewBlockingState').filter({hasText:/Klaar om op te slaan/}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Gecontroleerd & opslaan',exact:true}).first().isDisabled(),false,'valid core must re-enable save');

  const primaryRates=await page.locator('#pdfImportVatRate option').allTextContents();
  assert.ok(primaryRates.some(x=>x.includes('21%'))&&primaryRates.some(x=>x.includes('9%')),'normal VAT choices must expose 21% and 9%');
  assert.equal(primaryRates.some(x=>/^0%/.test(x.trim())),false,'0% must not be a normal primary VAT choice');
  assert.ok((await page.locator('#pdfImportForm').innerText()).includes('Andere btw-situatie'));
  await page.getByRole('button',{name:'Andere btw-situatie',exact:true}).click();
  await page.getByRole('button',{name:'0% / geen btw op document',exact:true}).click();
  assert.equal(await page.locator('#pdfImportVatRate').inputValue(),'0','special zero-VAT path must set a real value');
  await page.locator('#pdfImportVatRate').selectOption('21');
  await page.evaluate(()=>closeModal());

  await openReview({
    net:128.66,vatAmount:0,gross:128.66,vatRate:21,
    fieldConfidence:{party:95,invoiceNumber:95,issueDate:95,net:42,vatAmount:42,gross:99,vatRate:98,vatLines:42}
  });
  await page.evaluate(()=>setDocumentReviewStep(2));
  await page.locator('#pdfImportForm [name="gross"]').fill('128,66');
  await page.locator('[data-financial-anchor-confirm="vatRate"]').click();
  await page.getByRole('button',{name:'Gebruik deze bedragen',exact:true}).click();
  await page.waitForTimeout(50);
  const correctionState=await page.evaluate(()=>({
    net:document.querySelector('#pdfImportForm [name="net"]')?.value,
    vat:document.querySelector('#pdfImportForm [name="vatAmount"]')?.value,
    gross:document.querySelector('#pdfImportForm [name="gross"]')?.value,
    rate:document.querySelector('#pdfImportForm [name="vatRate"]')?.value,
    blocking:BookunaDocumentReviewV2.financialBlockingIssues(pendingPdfImport?.parsed),
    review:document.getElementById('reviewBlockingState')?.innerText,
    financial:document.getElementById('financialCorrectionPanel')?.innerText,
    provenance:pendingPdfImport?.parsed?.fieldProvenance
  }));
  assert.deepEqual(correctionState.blocking,[],'correction must clear blocking issues: '+JSON.stringify(correctionState));
  assert.match(correctionState.review||'',/Klaar om op te slaan/,'correction must revalidate the beginner save gate: '+JSON.stringify(correctionState));
  assert.equal(correctionState.net,'106.33');
  assert.equal(correctionState.vat,'22.33');
  await page.evaluate(()=>closeModal());

  await openReview({
    documentType:'receipt',invoiceNumber:'',party:'Onzekere winkel',category:'Overig',
    fieldConfidence:{party:55,issueDate:95,net:98,vatAmount:98,gross:98,vatRate:98,vatLines:98,category:45}
  });
  await page.evaluate(()=>setDocumentReviewStep(2));
  assert.ok(await page.getByRole('button',{name:'Dit klopt zo',exact:true}).first().isVisible(),'uncertain recognized value must be confirmable');
  assert.ok(await page.getByRole('button',{name:'Later controleren',exact:true}).first().isVisible(),'non-blocking attention must be deferrable');
  assert.equal(await page.getByRole('button',{name:'Gecontroleerd & opslaan',exact:true}).first().isDisabled(),true,'unresolved attention must require an explicit confirm/edit/defer choice');
  await page.getByRole('button',{name:'Later controleren',exact:true}).first().click();
  assert.match(await page.locator('#reviewBlockingState').innerText(),/later controleren/i);
  await page.evaluate(()=>closeModal());

  await openReview({
    mixedRates:true,vatRate:null,net:70,vatAmount:12.30,gross:82.30,
    vatLines:[{rate:9,taxableAmount:20,vatAmount:1.80},{rate:21,taxableAmount:50,vatAmount:10.50}],
    fieldConfidence:{party:95,invoiceNumber:95,issueDate:95,net:98,vatAmount:98,gross:98,vatLines:70}
  });
  await page.evaluate(()=>setDocumentReviewStep(2));
  assert.equal(await page.locator('.mixed-vat-row').count(),2,'mixed VAT must render editable rows');
  assert.equal(await page.locator('#pdfImportVatRate').isDisabled(),true,'single VAT rate must stay disabled for mixed VAT');
  await page.locator('#mixedVatStatus').filter({hasText:/Btw-verdeling klopt/}).waitFor();
  await page.locator('.mixed-vat-row').first().locator('[data-vat-line-vat]').fill('1,79');
  await page.locator('#mixedVatStatus').filter({hasText:/telt nog niet op|Controleer/i}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Gecontroleerd & opslaan',exact:true}).first().isDisabled(),true,'invalid mixed VAT must block save');
  await page.locator('.mixed-vat-row').first().locator('[data-vat-line-vat]').fill('1,80');
  await page.locator('#mixedVatStatus').filter({hasText:/Btw-verdeling klopt/}).waitFor();

  await openReview({
    documentType:'receipt',invoiceNumber:'',party:'Review Winkel',category:'Overig',
    net:10,vatAmount:2.10,gross:12.10,vatRate:21,
    fieldConfidence:{party:55,issueDate:95,net:98,vatAmount:98,gross:98,vatRate:98,vatLines:98,category:45}
  });
  await page.evaluate(()=>setDocumentReviewStep(2));
  await page.locator('[data-review-defer="party"]').click();
  await page.locator('[data-review-defer="category"]').click();
  await page.evaluate(()=>savePdfInvoiceImport());
  await page.waitForFunction(()=>state.documents.some(d=>d.reviewSnapshot));
  const savedReview=await page.evaluate(()=>{
    const d=state.documents.find(x=>x.reviewSnapshot);
    return {id:d?.id,attention:d?.reviewAttentionFields||[],snapshot:d?.reviewSnapshot,rows:attentionRows().filter(x=>x.key==='document-review-'+d?.id).length};
  });
  assert.ok(savedReview.id,'saved document must keep a review snapshot');
  assert.deepEqual(savedReview.attention,['party','category'],'deferred supplier and category must persist as attention');
  assert.equal(savedReview.rows,1,'deferred review must appear exactly once in Actie nodig');
  assert.equal(await page.evaluate(()=>state.contacts.filter(c=>c.type==='supplier'&&c.name==='Review Winkel').length),0,'deferred OCR supplier must not create a premature supplier relation');
  await page.evaluate(()=>{
    const raw=JSON.parse(localStorage.getItem(userDataKey())||'{}');
    state=normalizeState(raw);
  });
  const reloadedReview=await page.evaluate(id=>{
    const d=state.documents.find(x=>x.id===id);
    return {attention:d?.reviewAttentionFields||[],snapshot:d?.reviewSnapshot||null};
  },savedReview.id);
  assert.deepEqual(reloadedReview.attention,['party','category'],'deferred attention must survive persistence and normalization');
  assert.equal(reloadedReview.snapshot?.party,'Review Winkel','review snapshot must survive persistence and normalization');
  await page.evaluate(id=>openSavedDocumentReview(id),savedReview.id);
  await page.getByRole('heading',{name:'Opgeslagen controle'}).waitFor();
  assert.match(await page.locator('#modalRoot').innerText(),/Later controleren/);
  await page.getByRole('button',{name:'Nu controleren',exact:true}).click();
  await page.locator('#deferredReviewForm [name="party"]').fill('Nieuwe Leverancier BV');
  await page.locator('#deferredReviewForm [name="category"]').selectOption({label:'Software'});
  await page.getByRole('button',{name:'Opslaan',exact:true}).click();
  const resolved=await page.evaluate(id=>{
    const d=state.documents.find(x=>x.id===id),e=state.expenses.find(x=>x.id===d?.linkedId);
    return {
      attention:d?.reviewAttentionFields||[],
      vendor:e?.vendor||'',
      category:e?.category||'',
      suppliers:state.contacts.filter(c=>c.type==='supplier'&&c.name==='Nieuwe Leverancier BV').length,
      expenses:state.expenses.length,
      rows:attentionRows().filter(x=>x.key==='document-review-'+id).length
    };
  },savedReview.id);
  assert.deepEqual(resolved.attention,[],'resolved document attention must be cleared');
  assert.equal(resolved.vendor,'Nieuwe Leverancier BV');
  assert.equal(resolved.category,'Software');
  assert.equal(resolved.suppliers,1,'resolved supplier must exist in relations');
  assert.equal(resolved.expenses,1,'resolving attention must not create a duplicate booking');
  assert.equal(resolved.rows,0,'resolved attention must disappear from Actie nodig');

  await page.setViewportSize({width:390,height:844});
  await openReview();
  await page.evaluate(()=>setDocumentReviewStep(2));
  await noOverflow(browserName+' mobile review');
  const touch=await page.locator('.mobile-review-actions button').evaluateAll(nodes=>nodes.filter(el=>getComputedStyle(el).display!=='none').map(el=>el.getBoundingClientRect().height));
  assert.ok(touch.length&&touch.every(h=>h>=44),browserName+' review touch targets must be >=44px');

  assert.deepEqual(errors,[],browserName+' beginner review JavaScript errors');
  console.log('BOEKUNA document review beginner UX '+browserName+': PASS');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
