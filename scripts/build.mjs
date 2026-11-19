import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const paths=['index.html','app.js','config.js','style.css','sw.js','manifest.webmanifest','icon.svg'];
const contents=await Promise.all(paths.map(path=>readFile(path,'utf8')));
const hash=createHash('sha256').update(contents.join('\0')).digest('hex').slice(0,8);
const run=process.env.GITHUB_RUN_NUMBER;
const version=run?`beta.${run}.${process.env.GITHUB_RUN_ATTEMPT||1}`:`beta.${hash}`;
await mkdir('dist',{recursive:true});
for(let i=0;i<paths.length;i++){
  let content=contents[i];
  if(paths[i]==='index.html')content=content.replaceAll('beta.dev',version);
  if(paths[i]==='sw.js')content=content.replace('one-page-shell-dev',`one-page-shell-${version}-${hash}`);
  await writeFile('dist/'+paths[i],content);
}
console.log('Built '+version);
