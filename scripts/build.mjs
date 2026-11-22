import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const paths=['index.html','app.js','behavior.js','behavior-copy.js','reader.js','vendor/marked.js','vendor/marked.LICENSE','AGENT_GUIDE.md','config.js','style.css','sw.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png'];
const contents=await Promise.all(paths.map(path=>readFile(path)));
const digest=createHash('sha256');for(let i=0;i<paths.length;i++)digest.update(paths[i]).update(contents[i]);
const hash=digest.digest('hex').slice(0,8);
const run=process.env.GITHUB_RUN_NUMBER;
const version=run?`beta.${run}.${process.env.GITHUB_RUN_ATTEMPT||1}`:`beta.${hash}`;
await mkdir('dist/vendor',{recursive:true});
for(let i=0;i<paths.length;i++){
  let content=contents[i];
  if(['index.html','sw.js'].includes(paths[i]))content=content.toString('utf8');
  if(paths[i]==='index.html')content=content.replaceAll('beta.dev',version);
  if(paths[i]==='sw.js')content=content.replace('one-page-shell-dev',`one-page-shell-${version}-${hash}`);
  await writeFile('dist/'+paths[i],content);
}
console.log('Built '+version);
