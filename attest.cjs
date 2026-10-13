/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS runtime attestation entrypoint. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),files={},root=__dirname;
function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,f.name);if(f.isDirectory())walk(p);else files[path.relative(root,p).replaceAll('\\','/')]=hash(fs.readFileSync(p));}}
walk(path.join(root,'public'));
const info=JSON.parse(fs.readFileSync(path.join(root,'release-info.json'))),pkgs={};for(const k of ['next','react','react-dom'])pkgs[k]=require(k+'/package.json').version;
const nextfiles={};function nextwalk(d){for(const f of fs.readdirSync(d,{withFileTypes:true})){if(f.name==='cache')continue;const p=path.join(d,f.name);if(f.isDirectory())nextwalk(p);else nextfiles[path.relative(root,p).replaceAll('\\','/')]=hash(fs.readFileSync(p));}}nextwalk(path.join(root,'.next'));
console.log(JSON.stringify({...info,source_manifest_sha256:hash(fs.readFileSync(path.join(root,'source-manifest.json'))),node:process.versions.node,packages:pkgs,build_id:fs.readFileSync(path.join(root,'.next/BUILD_ID'),'utf8').trim(),next_files_manifest_sha256:hash(JSON.stringify(Object.entries(nextfiles).sort())),public_files:files}));
