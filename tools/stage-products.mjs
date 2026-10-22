import {mkdirSync,readFileSync,writeFileSync,cpSync,existsSync,copyFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {createRequire} from 'node:module';
const root=resolve(import.meta.dirname,'..'),product=process.argv[2];
const products=['pos','restaurant','accounting','inventory','manufacturing','workshop','service-center','clinic','laboratory','pharmacy','hr','crm','education','gym','salon','hotel','real-estate'];
if(!products.includes(product))throw Error('Unknown product');
const sourceApp=join(root,'apps',product),target=join(root,'.planning/commercial-full/staged',product),seen=new Set();
mkdirSync(target,{recursive:true});
for(const file of ['package.json','electron-builder.yml','main.cjs','license-public-key.pem','licensing.json','THIRD_PARTY_NOTICES.txt'])copyFileSync(join(sourceApp,file),join(target,file));
for(const [source,name]of [['tools/desktop-main.cjs','desktop-main.cjs'],['tools/desktop-preload.cjs','preload.cjs'],['tools/windows-identity.cjs','windows-identity.cjs']])copyFileSync(join(root,source),join(target,name));
for(const folder of ['dist','build'])cpSync(join(sourceApp,folder),join(target,folder),{recursive:true,dereference:true});
function locate(from,name){const require=createRequire(join(from,'package.json'));let p=dirname(require.resolve(name));while(p!==dirname(p)){const f=join(p,'package.json');if(existsSync(f)&&JSON.parse(readFileSync(f,'utf8')).name===name)return realpathSync(p);p=dirname(p);}throw Error('Missing dependency '+name);}
function stage(from,name){if(seen.has(name))return;seen.add(name);const workspace=name.startsWith('@xzare/'),source=workspace?join(root,'packages',name.split('/')[1]):locate(from,name),meta=JSON.parse(readFileSync(join(source,'package.json'),'utf8')),dest=join(target,'node_modules',name);mkdirSync(dest,{recursive:true});
  if(workspace){writeFileSync(join(dest,'package.json'),JSON.stringify(meta,null,2));cpSync(join(source,'dist'),join(dest,'dist'),{recursive:true,dereference:true});}
  else cpSync(source,dest,{recursive:true,dereference:true,filter:p=>relative(source,p).split(sep)[0]!=='node_modules'});
  for(const dep of Object.keys(meta.dependencies??{}))stage(source,dep);
  if(name==='@node-rs/argon2')stage(source,'@node-rs/argon2-win32-x64-msvc');
}
for(const name of Object.keys(JSON.parse(readFileSync(join(sourceApp,'package.json'),'utf8')).dependencies??{}))stage(sourceApp,name);
console.log(product+': staged '+seen.size+' real dependencies in isolated release directory.');
