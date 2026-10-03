import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,webkit} from 'playwright';

// Exercise the production build. Only replace authentication/startup with deterministic data;
// rendering, event wiring, accounting, deletion guards and built assets are production code.
execFileSync(process.execPath,['scripts/build-app.mjs'],{stdio:'pipe'});
const builtRoot=path.resolve('dist/app');
let html=fs.readFileSync(path.join(builtRoot,'index.html'),'utf8').replace('const TEST_MODE_NO_AUTH=false;','const TEST_MODE_NO_AUTH=true;');
const fixture=`
currentUser={...TEST_USER,email:'presentation@example.test',supabaseUser:{user_metadata:{first_name:'Kwin'}}};
state=structuredClone(DEFAULT);
state.company={...state.company,name:'QA Test BV',contactName:'Kwin',email:'qa@example.test',address:'Teststraat 1',postal:'3011AA',city:'Rotterdam',country:'Nederland',kvk:'12345678',vat:'NL123456789B01',iban:'NL91ABNA0417164300',kor:false};
const qaDate='2026-10-03',qaAmounts=[5,999.99,12500.50,100000.55,1250000,-100000.55],qaPaymentMethods=['Creditcard','Privé voorgeschoten','iDEAL','Bankoverschrijving','Pin'];
state.contacts=qaAmounts.map((_,i)=>({id:'c'+i,type:'customer',name:i%2?'Een zeer lange klantnaam met meerdere woorden en SupercalifragilisticexpialidociousZonderAfbreekpunten':'Kort',email:'klant@example.test'}));
state.invoices=qaAmounts.map((gross,i)=>({id:'i'+i,number:'2026-'+String(i+1).padStart(4,'0'),customerId:'c'+i,status:i===1?'paid':'sent',kind:gross<0?'credit':'invoice',issueDate:qaDate,dueDate:qaDate,taxTreatment:'standard',payments:i===2?[{id:'p2',amount:100,date:qaDate}]:i===1?[{id:'p1',amount:999.99,date:qaDate}]:[],importedTotals:{net:Math.abs(gross)/1.21,vat:Math.abs(gross)-Math.abs(gross)/1.21,gross:Math.abs(gross)}}));
state.expenses=qaAmounts.slice(0,5).map((v,i)=>({id:'e'+i,date:qaDate,vendor:state.contacts[i].name,invoiceNumber:'INK-'+i,category:'Kantoor',paymentMethod:qaPaymentMethods[i],exVat:v/1.21,vatRate:i===1?9:21,notes:'Aanschaf voor project'}));
state.transactions=qaAmounts.map((amount,i)=>({id:'t'+i,date:qaDate,description:state.contacts[i].name,amount,status:i%2?'matched':'unmatched',matchId:i%2?'i'+i:null,matchType:i%2?'invoice':null}));
state.plannedCash=qaAmounts.map((amount,i)=>({id:'pc'+i,date:qaDate,description:state.contacts[i].name,type:amount<0?'out':'in',amount:Math.abs(amount)}));
state.documents=[{id:'d1',fileId:'f1',name:'Een zeer lange documentnaam met meerdere woorden voor veilige opslag.pdf',type:'Upload',date:qaDate,processingState:'ready'},{id:'d2',fileId:'f2',name:'Gekoppelde factuur.pdf',type:'Factuur',date:qaDate,linkedId:'i0',linkedType:'invoice',processingState:'ready'}];
state.hours=[{id:'h1',date:qaDate,project:state.contacts[1].name,desc:'Overleg over de uitvoering van het project',hours:12.5}];
state.mileage=[{id:'m1',date:qaDate,from:'Rotterdam',to:'Amsterdam Centrum',purpose:'Klantbezoek bij een lange klantnaam',km:123.5}];
documentProcessingJobs=[];documentProcessingInitialized=true;documentProcessingConnectivityLost=false;documentProcessingFetchError=false;
window.__presentationInitialState=JSON.stringify(state);enterApp();`;
const marker=html.lastIndexOf('initAuth();');assert.ok(marker>0);html=html.slice(0,marker)+fixture+html.slice(marker+'initAuth();'.length);
const baseSHA='5fc860e9a6964b63d579239be7bf54bad00805fc';
let baseHtml=execFileSync('git',['show',baseSHA+':kwinest/index.html'],{encoding:'utf8'}).replace('const TEST_MODE_NO_AUTH=false;','const TEST_MODE_NO_AUTH=true;');
const baseMarker=baseHtml.lastIndexOf('initAuth();');assert.ok(baseMarker>0);baseHtml=baseHtml.slice(0,baseMarker)+fixture+baseHtml.slice(baseMarker+'initAuth();'.length);
const financialSnapshot=()=>{const invoices=state.invoices.filter(i=>i.status!=='draft'),sales=invoices.reduce((s,i)=>s+invoiceNet(i),0),costs=state.expenses.reduce((s,e)=>s+Number(e.exVat),0);return {sales,costs,profit:sales-costs,vat:invoices.reduce((s,i)=>s+invoiceVat(i),0)-state.expenses.reduce((s,e)=>s+expenseVat(e),0),invoices:state.invoices.map(i=>[invoiceNet(i),invoiceVat(i),invoiceGross(i),invoiceOutstanding(i),invoicePaidAmount(i),invoiceEffectiveStatus(i)]),expenses:state.expenses.map(e=>[expenseVat(e),expenseGross(e)]),journal:generatedJournal(),ledger:ledgerAccountSummary(journalFlatRows()),cash:cashBalance(),forecast:[forecastAt(30),forecastAt(60),forecastAt(90)]}};
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(pathname==='/baseline'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(baseHtml)}
 if(pathname==='/'||pathname==='/app'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(html)}
 const file=path.join(builtRoot,pathname.replace(/^\//,''));
 if(file.startsWith(builtRoot+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.writeHead(200,{'content-type':{'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[path.extname(file)]||'application/octet-stream'});return fs.createReadStream(file).pipe(res)}
 res.writeHead(404);res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browserName=process.env.BOOKUNA_BROWSER==='webkit'?'webkit':'chromium';
const browser=await ({chromium,webkit}[browserName]).launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:900},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const artifactRoot='tests/artifacts/financial-presentation';fs.mkdirSync(artifactRoot,{recursive:true});
const viewports=[[320,568],[360,800],[375,812],[390,844],[393,852],[430,932],[768,1024],[1024,768],[1280,800],[1366,768],[1440,900],[1920,1080]],routes=['dashboard','invoices','expenses','bank','documents','control','vat','reports','cashflow','ledger','hours','settings'];
const checks=[];
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/baseline');
 await page.locator('.dashboard-chart-card').waitFor();
 const baseFinancial=await page.evaluate(financialSnapshot);
 await page.goto('http://127.0.0.1:'+server.address().port+'/app');
 await page.locator('.dashboard-chart-card').waitFor();
 const initial=await page.evaluate(()=>JSON.stringify(state));
 const baseline=await page.evaluate(financialSnapshot);
 assert.deepEqual(baseline,baseFinancial,'Existing financial values and oneoff forecasts equal exact main for the same representative dataset');

 // RED contract for the focused table/report/sidebar polish round.
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(()=>navigate('dashboard'));
 assert.ok(await page.locator('#sidebar .nav-group').evaluateAll(nodes=>nodes.every(el=>getComputedStyle(el).display==='none')),'Desktop sidebar group labels should be visually removed');
 await page.evaluate(()=>navigate('expenses'));
 const expenseTable=page.locator('.mobile-expenses');
 assert.equal(await expenseTable.locator('tbody tr[onclick]').count(),0,'Expense rows must stay non-clickable');
 const expenseStaticCell=expenseTable.locator('tbody tr').first().locator('td').nth(3);
 assert.notEqual(await expenseStaticCell.evaluate(el=>getComputedStyle(el).cursor),'pointer','Static expense cells must not advertise click');
 const modalCountBefore=await page.locator('#modalRoot .modal').count();
 await expenseStaticCell.click();
 assert.equal(await page.locator('#modalRoot .modal').count(),modalCountBefore,'Clicking a static expense cell must not open anything');
 for(const text of ['Betaalwijze','Creditcard','Privé voorgeschoten','21%','9%','€ 12.345,67','03-10-2026']){
  const locator=page.getByText(text,{exact:true}).first();
  if(await locator.count())assert.equal(await locator.evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap','Short financial metadata must not wrap: '+text);
 }
 const longVendor=expenseTable.locator('tbody tr').nth(1).locator('td').nth(1).locator('strong');
 assert.equal(await longVendor.evaluate(el=>getComputedStyle(el).textOverflow),'ellipsis','Long supplier names need desktop ellipsis');
 assert.equal(await longVendor.evaluate(el=>el.getAttribute('title')||''),await longVendor.innerText(),'Ellipsized supplier name must expose the full value');

 await page.evaluate(()=>navigate('bank'));
 const desktopUnlink=page.locator('.mobile-bank .bank-unlink-action').first();
 assert.ok(await desktopUnlink.count(),'Matched bank rows need a compact unlink action');
 assert.equal(await desktopUnlink.getAttribute('aria-label'),'Ontkoppelen');
 assert.equal(await desktopUnlink.getAttribute('title'),'Ontkoppelen');
 assert.ok(await desktopUnlink.locator('svg').isVisible(),'Desktop unlink action should use the icon system');
 assert.equal(await desktopUnlink.locator('.bank-unlink-text').evaluate(el=>getComputedStyle(el).display),'none','Desktop unlink text should be compacted');

 await page.evaluate(()=>navigate('reports'));
 const reportBars=page.locator('.report-result-chart [data-chart-values]'),reportTip=page.locator('#reportChartValues');
 assert.ok(await reportBars.count()>0,'Report chart needs inspectable data points');
 await reportBars.first().hover();assert.equal(await reportTip.isVisible(),true,'Report hover opens exact-value tooltip');
 for(const label of ['Omzet','Kosten','Winst'])assert.match(await reportTip.innerText(),new RegExp(label));
 const reportTipStyle=await reportTip.evaluate(el=>{const s=getComputedStyle(el);return {color:s.color,background:s.backgroundColor}});
 assert.notEqual(reportTipStyle.color,reportTipStyle.background,'Report tooltip text must visibly contrast with its background');
 assert.match(await reportTip.innerText(),/€/,'Report tooltip must expose exact formatted amounts visually');
 await page.mouse.move(1,1);assert.equal(await reportTip.isVisible(),false,'Report hover tooltip dismisses');
 await reportBars.last().focus();assert.equal(await reportTip.isVisible(),true,'Report keyboard focus opens tooltip');await page.keyboard.press('Escape');assert.equal(await reportTip.isVisible(),false,'Escape closes report tooltip');
 const reportPageBefore=await page.evaluate(()=>page),reportModalBefore=await page.locator('#modalRoot .modal').count();
 await reportBars.first().click();assert.equal(await page.evaluate(()=>page),reportPageBefore,'Chart inspection must not navigate');assert.equal(await page.locator('#modalRoot .modal').count(),reportModalBefore,'Chart inspection must not open a modal');

 for(const [width,height] of viewports){
  await page.setViewportSize({width,height});
  for(const route of routes){
   await page.evaluate(async route=>{await navigate(route)},route);
   if(route==='vat')await page.evaluate(()=>{sessionStorage.setItem('vatYear','all');render()});
   const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,clipped:[...document.querySelectorAll('#content .money,#content .metric-value,#content .total-line strong,#content .mini-kpi strong')].filter(el=>getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().width>2&&el.scrollWidth>el.clientWidth+2).map(el=>({text:el.textContent,scroll:el.scrollWidth,client:el.clientWidth})),overflow:[...document.querySelectorAll('#content .table-wrap')].filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>({class:el.className,scroll:el.scrollWidth,client:el.clientWidth}))}));
   assert.ok(layout.scroll<=width+2,route+' global overflow '+width+': '+JSON.stringify(layout));
   assert.deepEqual(layout.clipped,[],route+' money cannot wrap or clip '+width+': '+JSON.stringify(layout));
   assert.deepEqual(layout.overflow,[],route+' financial table cannot require horizontal scroll '+width+': '+JSON.stringify(layout));
   if(['invoices','dashboard','expenses','documents'].includes(route)){
    const positions=await page.locator('#content .financial-actions .icon-btn').evaluateAll(els=>els.map(el=>Math.round(el.getBoundingClientRect().right)));
    assert.ok(new Set(positions).size<=1,route+' action anchors must share right edge '+width+': '+positions);
    if(width<=1100){const offsets=await page.locator('#content .financial-actions').evaluateAll(els=>els.map(el=>Math.round(el.getBoundingClientRect().top-el.closest('tr').getBoundingClientRect().top)));assert.ok(new Set(offsets).size<=1,route+' actions must share vertical row anchor '+width+': '+offsets);}
   }
   const semantics=await page.locator('#content table').evaluateAll(tables=>tables.every(table=>[...table.querySelectorAll('th')].every(th=>th.scope==='col'&&getComputedStyle(th).display!=='none')&&[...table.querySelectorAll('tbody td:not([colspan])')].every(td=>td.hasAttribute('headers'))));
   assert.ok(semantics,route+' accessible table relationships '+width);
   if([320,390,1366,1440].includes(width)){
    if(route==='dashboard'){
     const bars=page.locator('[data-chart-values]');await bars.last().scrollIntoViewIfNeeded();await bars.last().click();
     const card=await page.locator('.dashboard-chart-card').boundingBox(),tooltip=await page.locator('#dashboardChartValues').boundingBox();
     assert.ok(tooltip.x>=card.x&&tooltip.x+tooltip.width<=card.x+card.width+1,'Tooltip clamps horizontally to chart');
     assert.ok(tooltip.y>=card.y&&tooltip.y+tooltip.height<=card.y+card.height+1,'Tooltip floats inside chart card');
     assert.equal(await page.locator('#dashboardChartValues').evaluate(el=>getComputedStyle(el).position),'absolute');
     const header=await page.locator('.dashboard-chart-card .section-head').boundingBox();assert.ok(tooltip.y>=header.y+header.height,'Tooltip leaves chart navigation uncovered');
    }
    await page.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';scrollTo(0,0)});await page.waitForFunction(()=>scrollY===0);
    if(['dashboard','expenses','bank','reports'].includes(route)||width===320)await page.screenshot({path:artifactRoot+'/'+route+'-'+browserName+'-'+width+'x'+height+'.png',fullPage:true});
   }
   checks.push({route,width,height});
  }
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{page='bank';render()});
 const mobileUnlink=page.locator('.mobile-bank .bank-unlink-action').first();
 assert.notEqual(await mobileUnlink.locator('.bank-unlink-text').evaluate(el=>getComputedStyle(el).display),'none','Mobile bank action must keep Ontkoppelen as visible text');
 assert.equal(await mobileUnlink.locator('svg').evaluate(el=>getComputedStyle(el).display),'none','Mobile bank action should favor text over icon-only meaning');
 await page.evaluate(()=>{page='expenses';render()});
 const mobileExpenseRow=page.locator('.mobile-expenses tbody tr').first();
 assert.equal(await mobileExpenseRow.getAttribute('onclick'),null,'Mobile expense row remains non-clickable');
 const scrollBefore=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,420);await page.waitForTimeout(40);const scrollAfter=await page.evaluate(()=>scrollY);assert.ok(scrollAfter>=scrollBefore,'Mobile page scroll remains available over table content');
 await page.evaluate(()=>{page='reports';render()});
 const mobileReportBars=page.locator('.report-result-chart [data-chart-values]'),mobileReportTip=page.locator('#reportChartValues');
 await mobileReportBars.last().tap();assert.equal(await mobileReportTip.isVisible(),true,'Mobile report tap opens tooltip');
 await page.locator('.report-result-card h2').tap();assert.equal(await mobileReportTip.isVisible(),false,'Tap outside report chart closes tooltip');

 await page.setViewportSize({width:320,height:900});await page.evaluate(()=>{page='dashboard';render()});
 const bars=page.locator('[data-chart-values]'),tip=page.locator('#dashboardChartValues');
 await bars.first().scrollIntoViewIfNeeded();await bars.first().hover();assert.equal(await tip.isVisible(),true,'Hover opens floating tooltip');
 await page.mouse.move(1,800);assert.equal(await tip.isVisible(),false,'Pointer leave dismisses unpinned tooltip');
 await bars.last().focus();assert.equal(await tip.isVisible(),true,'Keyboard focus opens tooltip');await page.keyboard.press('Escape');assert.equal(await tip.isVisible(),false,'Escape dismisses tooltip');
 await bars.last().tap();assert.equal(await tip.isVisible(),true,'Touch tap pins tooltip');await page.locator('.dashboard-chart-card h2').click();assert.equal(await tip.isVisible(),false,'Outside chart dismisses tooltip');await bars.last().tap();assert.equal(await tip.isVisible(),true);await page.locator('.dashboard-summary-card .dashboard-summary-title').first().click();assert.equal(await tip.isVisible(),false,'Outside card dismisses tooltip');
 await page.evaluate(()=>{page='documents';render()});
 assert.equal(await page.locator('.page-actions .primary').count(),1);assert.equal(await page.getByRole('button',{name:'Uploaden',exact:true}).count(),1);assert.equal(await page.getByText('Archiveren zonder verwerking',{exact:true}).count(),0);assert.equal(await page.locator('.documents-secondary-menu').count(),0);assert.equal(await page.getByRole('heading',{name:'Bestanden · 2',exact:true}).count(),1);
  assert.equal(await page.locator('table.mobile-documents .row-action-trigger').count(),2,'Documents use one stable action anchor per row');
  const unlinkedRow=page.locator('table.mobile-documents tbody tr',{hasText:'Een zeer lange documentnaam'}),linkedRow=page.locator('table.mobile-documents tbody tr',{hasText:'Gekoppelde factuur.pdf'});
  await unlinkedRow.locator('.row-action-trigger').click();const unlinkedDelete=page.locator('.row-action-menu').getByRole('menuitem',{name:'Verwijderen',exact:true});assert.equal(await unlinkedDelete.isDisabled(),false);await unlinkedDelete.click();await page.getByRole('heading',{name:'Wil je dit verwijderen?',exact:true}).waitFor();assert.equal(await page.evaluate(()=>state.documents.length),2,'First delete action only opens confirmation');await page.getByRole('button',{name:'Annuleren',exact:true}).click();assert.equal(await page.evaluate(()=>state.documents.length),2,'Cancel retains documents');
  await linkedRow.locator('.row-action-trigger').click();const linkedDelete=page.locator('.row-action-menu').getByRole('menuitem',{name:'Verwijderen',exact:true});assert.equal(await linkedDelete.isDisabled(),true,'Linked document stays protected');await page.keyboard.press('Escape');
 const after=await page.evaluate(financialSnapshot);
 assert.deepEqual(after,baseline,'Presentation leaves financial truth unchanged');assert.equal(await page.evaluate(()=>JSON.stringify(state)),initial,'Rendering and cancelled deletion preserve state byte for byte');assert.deepEqual(errors,[]);
 fs.writeFileSync(artifactRoot+'/results-'+browserName+'.json',JSON.stringify({browser:browserName,checks,financialIntegrity:'PASS',baseSHA,baseFinancial,after,errors},null,2));
 console.log('financial presentation production-build regression: PASS ('+browserName+', '+checks.length+' layouts)');
}finally{await browser.close();await new Promise(r=>server.close(r))}
