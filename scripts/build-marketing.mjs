import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const source=path.join(root,'public');
const target=path.join(root,'dist','marketing');
const cacheDir=path.join(root,'.cache','marketing-fonts');

const SPACE_GROTESK_COMMIT='9710da1eacb3be272583c3224dcb70f9da6eadbb';
const SPACE_GROTESK_URL='https://raw.githubusercontent.com/google/fonts/'+SPACE_GROTESK_COMMIT+'/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf';
const SPACE_GROTESK_LICENSE_URL='https://raw.githubusercontent.com/google/fonts/'+SPACE_GROTESK_COMMIT+'/ofl/spacegrotesk/OFL.txt';

const required=[
  'index.html',
  'privacy/index.html',
  'voorwaarden/index.html',
  'support/index.html',
  'account-verwijderen/index.html',
  'assets/onepage.css',
  'assets/marketing.js',
  'assets/boekuna-marketing-favicon.svg',
  'assets/marketing-editorial/InterVariable.woff2',
  'assets/marketing-editorial/Inter-LICENSE.txt',
  'assets/product/boekuna-dashboard-desktop-960.webp',
  'assets/product/boekuna-document-review-desktop-960.webp'
].map(file=>path.join(source,file));
for(const file of required)if(!fs.existsSync(file))throw new Error('Missing marketing source: '+path.relative(root,file));

async function cacheRemote(url,name){
  fs.mkdirSync(cacheDir,{recursive:true});
  const file=path.join(cacheDir,name);
  if(fs.existsSync(file)&&fs.statSync(file).size>1000)return file;
  const response=await fetch(url,{redirect:'follow'});
  if(!response.ok)throw new Error('Could not fetch pinned marketing font asset '+name+': HTTP '+response.status);
  const buffer=Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(file,buffer);
  return file;
}

const [spaceGrotesk,spaceLicense]=await Promise.all([
  cacheRemote(SPACE_GROTESK_URL,'SpaceGrotesk-Variable.ttf'),
  cacheRemote(SPACE_GROTESK_LICENSE_URL,'SpaceGrotesk-LICENSE.txt')
]);

fs.rmSync(target,{recursive:true,force:true});
fs.mkdirSync(path.dirname(target),{recursive:true});
fs.cpSync(source,target,{recursive:true});

fs.rmSync(path.join(target,'manifest.webmanifest'),{force:true});
for(const asset of [
  'mobile-polish-round-2.css',
  'mobile-polish-round-2.js',
  'document-review-v2.css',
  'document-review-v2.js',
  'marketing.css',
  'marketing-editorial.css',
  'marketing-editorial.js'
])fs.rmSync(path.join(target,'assets',asset),{force:true});

const fontsDir=path.join(target,'assets','fonts');
fs.mkdirSync(fontsDir,{recursive:true});
fs.copyFileSync(spaceGrotesk,path.join(fontsDir,'SpaceGrotesk-Variable.ttf'));
fs.copyFileSync(spaceLicense,path.join(fontsDir,'SpaceGrotesk-LICENSE.txt'));
fs.copyFileSync(path.join(source,'assets','marketing-editorial','InterVariable.woff2'),path.join(fontsDir,'InterVariable.woff2'));
fs.copyFileSync(path.join(source,'assets','marketing-editorial','Inter-LICENSE.txt'),path.join(fontsDir,'Inter-LICENSE.txt'));
fs.rmSync(path.join(target,'assets','marketing-editorial'),{recursive:true,force:true});

const productDir=path.join(target,'assets','product');
const keepProducts=new Set([
  'boekuna-dashboard-desktop-960.webp',
  'boekuna-document-review-desktop-960.webp'
]);
for(const name of fs.readdirSync(productDir))if(!keepProducts.has(name))fs.rmSync(path.join(productDir,name),{recursive:true,force:true});

const retiredRedirects={
  'functies':'/#product',
  'facturen':'/#product',
  'scanner':'/#product',
  'btw-bank':'/#product',
  'rapportages':'/#product',
  'hoe-het-werkt':'/#hoe-het-werkt',
  'voor-ondernemers':'/#product',
  'prijzen':'/#prijzen',
  'faq':'/#faq',
  'over':'/#product',
  'contact':'/support/',
  'veiligheid':'/privacy/'
};
for(const [slug,destination] of Object.entries(retiredRedirects)){
  const dir=path.join(target,slug);
  fs.rmSync(dir,{recursive:true,force:true});
  fs.mkdirSync(dir,{recursive:true});
  const safeDestination=JSON.stringify(destination);
  const canonical=destination.startsWith('/#')?'https://boekuna.nl/':'https://boekuna.nl'+destination;
  const html='<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    +'<meta name="robots" content="noindex,follow"><link rel="canonical" href="'+canonical+'">'
    +'<meta http-equiv="refresh" content="0;url='+destination+'"><title>Doorsturen | Boekuna</title></head>'
    +'<body><main><p>Deze pagina is verplaatst. <a href="'+destination+'">Ga verder</a>.</p></main>'
    +'<script>location.replace('+safeDestination+');</script></body></html>';
  fs.writeFileSync(path.join(dir,'index.html'),html);
}

const home=fs.readFileSync(path.join(target,'index.html'),'utf8');
for(const legacy of ['/assets/homepage.','/assets/marketing-editorial.','€6,95','€14,95','Binnenkort beschikbaar']){
  if(home.includes(legacy))throw new Error('Stale marketing content/runtime remains: '+legacy);
}
for(const product of keepProducts){
  if(!home.includes('/assets/product/'+product))throw new Error('Required real product proof missing: '+product);
}
for(const font of ['SpaceGrotesk-Variable.ttf','InterVariable.woff2']){
  if(!fs.existsSync(path.join(fontsDir,font)))throw new Error('Built marketing font missing: '+font);
}

console.log('Marketing one-page build complete:',path.relative(root,target),'with',Object.keys(retiredRedirects).length,'retired-route redirects and local Space Grotesk + Inter fonts');
