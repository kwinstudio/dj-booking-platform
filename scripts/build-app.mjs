import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const target=path.join(root,'dist','app');
const appSource=path.join(root,'kwinest','index.html');
const manifestSource=path.join(root,'public','manifest.webmanifest');
const assetsSource=path.join(root,'public','assets');
const appFontCache=path.join(root,'.cache','app-fonts');
const SPACE_GROTESK_COMMIT='9710da1eacb3be272583c3224dcb70f9da6eadbb';
const SPACE_GROTESK_URL='https://raw.githubusercontent.com/google/fonts/'+SPACE_GROTESK_COMMIT+'/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf';

async function cacheAppFont(url,name){
  fs.mkdirSync(appFontCache,{recursive:true});
  const file=path.join(appFontCache,name);
  if(fs.existsSync(file)&&fs.statSync(file).size>1000)return file;
  const response=await fetch(url,{redirect:'follow'});
  if(!response.ok)throw new Error('Could not fetch pinned app font '+name+': HTTP '+response.status);
  fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));
  return file;
}
const appAssets=[
  'boekuna-app-icon-180.png',
  'boekuna-app-icon-192.png',
  'boekuna-app-icon-512.png',
  'boekuna-app-icon-maskable-512.png',
  'boekuna-app-icon.svg',
  'boekuna-favicon.svg',
  'boekuna-symbol-reversed.svg',
  'boekuna-symbol.svg',
  'brand-v2.css',
  'favicon-32.png',
  'financial-correction.js',
  'document-review-v2.js',
  'document-review-v2.css',
  'kvk-company-lookup.js',
  'kvk-company-lookup.css',
  'mobile-polish-round-2.css',
  'mobile-polish-round-2.js',
  'developer-mode.js'
];

for(const file of [appSource,manifestSource,assetsSource]){
  if(!fs.existsSync(file))throw new Error('Missing app build source: '+path.relative(root,file));
}

const spaceGroteskFont=await cacheAppFont(SPACE_GROTESK_URL,'SpaceGrotesk-Variable.ttf');
const interFontSource=path.join(assetsSource,'marketing-editorial','InterVariable.woff2');
if(!fs.existsSync(interFontSource))throw new Error('Missing app Inter font source');

let appHtml=fs.readFileSync(appSource,'utf8');

const devFlag=String(process.env.BOEKUNA_DEV_MODE||'').trim().toLowerCase();
const developerModeEnabled=['1','true','yes','on'].includes(devFlag);
const deploymentEnvironment=String(process.env.BOEKUNA_DEPLOYMENT_ENV||'production').trim().toLowerCase();
const developerAllowedOrigins=String(process.env.BOEKUNA_DEV_ALLOWED_ORIGINS||'').split(',').map(v=>v.trim().replace(/\/$/,'')).filter(Boolean);
const productionOrigins=new Set([
  'https://app.boekuna.nl',
  'https://boekuna.nl',
  'https://www.boekuna.nl',
  'https://boekuna-boekhouding.onrender.com',
  'https://kwinest-boekhouding.onrender.com'
]);
const kvkPreview=process.env.BOEKUNA_KVK_PREVIEW==='true';
if(kvkPreview){
  if(developerModeEnabled||!['preview','staging'].includes(deploymentEnvironment))throw new Error('KVK preview requires an isolated preview build without Developer Mode');
  const previewUrl=String(process.env.BOEKUNA_SUPABASE_URL||'').replace(/\/$/,'');
  const previewKey=String(process.env.BOEKUNA_SUPABASE_PUBLISHABLE_KEY||'');
  if(previewUrl!=='https://ozisiotrzeubwbffnxyr.supabase.co'||!previewKey)throw new Error('KVK preview requires the approved isolated Supabase project and publishable key');
  const marker='window.BOEKUNA_KVK_PREVIEW=false;';
  if(!appHtml.includes(marker))throw new Error('KVK preview marker missing');
  appHtml=appHtml.replace(marker,'window.BOEKUNA_KVK_PREVIEW=true;');
  appHtml=appHtml.replace("const SUPABASE_URL='https://vuwfyhtejsxhdfyvkkeq.supabase.co';",'const SUPABASE_URL='+JSON.stringify(previewUrl)+';');
  appHtml=appHtml.replace("const SUPABASE_PUBLISHABLE_KEY='sb_publishable_miAZ6CBZShVcmmNwlnEDgA_aGw1X4aP';",'const SUPABASE_PUBLISHABLE_KEY='+JSON.stringify(previewKey)+';');
}
if(developerModeEnabled){
  if(!['development','preview','staging'].includes(deploymentEnvironment)){
    throw new Error('Refusing Developer Mode for production or unknown environment: '+deploymentEnvironment);
  }
  if(!developerAllowedOrigins.length||developerAllowedOrigins.some(origin=>productionOrigins.has(origin))){
    throw new Error('Developer Mode requires an explicit non-production origin allowlist');
  }
  const devSupabaseUrl=String(process.env.BOEKUNA_SUPABASE_URL||'').trim().replace(/\/$/,'');
  const devSupabaseKey=String(process.env.BOEKUNA_SUPABASE_PUBLISHABLE_KEY||'').trim();
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(devSupabaseUrl)||devSupabaseUrl==='https://vuwfyhtejsxhdfyvkkeq.supabase.co'){
    throw new Error('Developer Mode requires an explicit non-production Supabase project');
  }
  if(!devSupabaseKey)throw new Error('Developer Mode requires BOEKUNA_SUPABASE_PUBLISHABLE_KEY');
  const defaultConfig="window.BOEKUNA_DEV_MODE_CONFIG=Object.freeze({enabled:false,environment:'production',allowedOrigins:[]});";
  if(!appHtml.includes(defaultConfig))throw new Error('Developer Mode source marker missing');
  appHtml=appHtml.replace(defaultConfig,
    "window.BOEKUNA_DEV_MODE_CONFIG=Object.freeze({enabled:true,environment:"+JSON.stringify(deploymentEnvironment)+",allowedOrigins:"+JSON.stringify(developerAllowedOrigins)+"});");
  const prodUrl="const SUPABASE_URL='https://vuwfyhtejsxhdfyvkkeq.supabase.co';";
  const prodKey="const SUPABASE_PUBLISHABLE_KEY='sb_publishable_miAZ6CBZShVcmmNwlnEDgA_aGw1X4aP';";
  if(!appHtml.includes(prodUrl)||!appHtml.includes(prodKey))throw new Error('Supabase source markers changed');
  appHtml=appHtml.replace(prodUrl,"const SUPABASE_URL="+JSON.stringify(devSupabaseUrl)+";");
  appHtml=appHtml.replace(prodKey,"const SUPABASE_PUBLISHABLE_KEY="+JSON.stringify(devSupabaseKey)+";");
}

// Strangler step: keep the legacy combined source available for rollback while
// producing an app-only deploy artifact. These markers are intentionally strict:
// if the legacy document changes, fail the build rather than silently ship a
// partially stripped surface.
const marketingStart="let lastMarketingPage='home';";
const authStart="function showAuth(mode='login',prefillEmail=''){";
const start=appHtml.indexOf(marketingStart);
const end=appHtml.indexOf(authStart,start);
if(start<0||end<0||end<=start)throw new Error('Legacy marketing/auth boundary markers changed');
appHtml=appHtml.slice(0,start)+appHtml.slice(end);

// Product-host auth must link back to the public site, never re-render marketing.
appHtml=appHtml.replaceAll(
  'onclick="goMarketingPage(lastMarketingPage||\'home\')"',
  'onclick="location.href=\'https://boekuna.nl/\'"'
);

// Public/legal/product-information links leave the app origin.
const publicLinkMap=new Map([
  ['/privacy/','https://boekuna.nl/privacy/'],
  ['/voorwaarden/','https://boekuna.nl/voorwaarden/'],
  ['/support/','https://boekuna.nl/support/'],
  ['/account-verwijderen/','https://boekuna.nl/account-verwijderen/'],
  ['/prijzen/','https://boekuna.nl/prijzen/'],
  ['/hoe-het-werkt/','https://boekuna.nl/hoe-het-werkt/']
]);
for(const [from,to] of publicLinkMap){
  appHtml=appHtml.replaceAll('href="'+from+'"','href="'+to+'"');
  appHtml=appHtml.replaceAll("location.href='"+from+"'","location.href='"+to+"'");
}

// Logged-out, logout and auth-failure states stay on the product host and render auth.
appHtml=appHtml.replace(
  "else if(wantsRegister)showAuth('register');else if(wantsLogin)showAuth('login');else showLanding();",
  "else if(wantsRegister)showAuth('register');else showAuth('login');"
);
appHtml=appHtml.replaceAll("closeModal();showLanding()","closeModal();showAuth('login')");
appHtml=appHtml.replaceAll(
  "state=structuredClone(DEFAULT);showLanding()",
  "state=structuredClone(DEFAULT);showAuth('login')"
);
appHtml=appHtml.replace(
  "else if(wantsLogin||wantsRegister){showAuth(wantsRegister?'register':'login');authError(mapAuthError(err,'auth'))}else showLanding()",
  "else {showAuth(wantsRegister?'register':'login');authError(mapAuthError(err,'auth'))}"
);
appHtml=appHtml.replace(
  "window.addEventListener('popstate',()=>{if(document.getElementById('mainApp').style.display==='none')showLanding()});",
  "window.addEventListener('popstate',()=>{if(document.getElementById('mainApp').style.display==='none'){const u=new URL(location.href);showAuth(u.searchParams.get('register')==='1'?'register':'login')}});"
);

// Product host is not an SEO landing surface.
if(!appHtml.includes('name="robots"')){
  appHtml=appHtml.replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n<meta name="robots" content="noindex,nofollow" />'
  );
}
appHtml=appHtml.replace(
  '<title>Boekuna — slim boekhouden voor ondernemers</title>',
  '<title>Boekuna — je administratie</title>'
);

for(const forbidden of ['showLanding(','function marketingNav','function showMarketingPage','goMarketingPage(','lastMarketingPage']){
  if(appHtml.includes(forbidden))throw new Error('App-only build still contains legacy marketing runtime: '+forbidden);
}
if(!appHtml.includes("else if(wantsRegister)showAuth('register');else showAuth('login');")){
  throw new Error('App-only auth fallback was not rewritten');
}

// App-only progressive document review layer. Keep the combined rollback source untouched.
// This legacy source contains literal </head> and </body> strings inside templates,
// so injection must target the final document closing tags, never the first match.
function injectBeforeLast(html,marker,content){
  const index=html.lastIndexOf(marker);
  if(index<0)throw new Error('Missing app document marker: '+marker);
  return html.slice(0,index)+content+html.slice(index);
}
appHtml=injectBeforeLast(appHtml,'</head>','<link rel="stylesheet" href="/assets/document-review-v2.css?v=20261003a">\n');
appHtml=injectBeforeLast(appHtml,'</body>','<script src="/assets/document-review-v2.js?v=20261003a"></script>\n');

fs.rmSync(target,{recursive:true,force:true});
fs.mkdirSync(target,{recursive:true});
fs.writeFileSync(path.join(target,'index.html'),appHtml,'utf8');
fs.copyFileSync(manifestSource,path.join(target,'manifest.webmanifest'));
const appAssetsTarget=path.join(target,'assets');
fs.mkdirSync(appAssetsTarget,{recursive:true});
for(const asset of appAssets){
  const sourceFile=path.join(assetsSource,asset);
  if(!fs.existsSync(sourceFile))throw new Error('Missing app asset: '+asset);
  fs.copyFileSync(sourceFile,path.join(appAssetsTarget,asset));
}
fs.copyFileSync(interFontSource,path.join(appAssetsTarget,'app-InterVariable.woff2'));
fs.copyFileSync(spaceGroteskFont,path.join(appAssetsTarget,'app-SpaceGrotesk-Variable.ttf'));

console.log('App build complete:',path.relative(root,target),'with self-hosted Inter + Space Grotesk');
