import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Use the ID returned by the official upload action instead of re-listing an
// eventually consistent artifact index. Keep GitHub/OIDC tokens in memory only.
export async function deployPages(env, request=fetch, pause=ms=>new Promise(r=>setTimeout(r,ms))) {
  for(const name of ['GITHUB_TOKEN','GITHUB_REPOSITORY','GITHUB_SHA','PAGES_ARTIFACT_ID','ACTIONS_ID_TOKEN_REQUEST_URL','ACTIONS_ID_TOKEN_REQUEST_TOKEN'])if(!env[name])throw Error('Missing '+name);
  const oidc=await request(env.ACTIONS_ID_TOKEN_REQUEST_URL,{headers:{Authorization:'Bearer '+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});
  if(!oidc.ok)throw Error('GitHub identity request failed: '+oidc.status);
  const {value:idToken}=await oidc.json();if(!idToken)throw Error('GitHub identity token missing');
  const api=(env.GITHUB_API_URL||'https://api.github.com')+'/repos/'+env.GITHUB_REPOSITORY+'/pages/deployments';
  const headers={Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};
  const artifactId=Number(env.PAGES_ARTIFACT_ID);if(!Number.isSafeInteger(artifactId)||artifactId<=0)throw Error('Invalid artifact ID');
  const response=await request(api,{method:'POST',headers,body:JSON.stringify({artifact_id:artifactId,pages_build_version:env.GITHUB_SHA,oidc_token:idToken})});
  if(!response.ok){const detail=await response.json().catch(()=>({}));const fields=(detail.errors||[]).map(error=>error.field+':'+error.code).join(',');throw Error('Pages deployment request failed: '+response.status+' '+fields);}
  const deployment=await response.json();const id=deployment.id||env.GITHUB_SHA;
  const statusURL=deployment.status_url||api+'/'+encodeURIComponent(id);
  if(new URL(statusURL).origin!==new URL(api).origin)throw Error('Unexpected Pages status URL');
  const terminal=new Set(['deployment_failed','deployment_perms_error','deployment_content_failed','deployment_cancelled','deployment_lost']);
  for(let attempt=0;attempt<60;attempt++){
    await pause(5000);
    const statusResponse=await request(statusURL,{headers});
    if(!statusResponse.ok)continue;
    const status=(await statusResponse.json()).status;
    if(status==='succeed')return deployment.page_url||'https://'+env.GITHUB_REPOSITORY.split('/')[0]+'.github.io/'+env.GITHUB_REPOSITORY.split('/')[1]+'/';
    if(terminal.has(status))throw Error('Pages deployment ended: '+status);
  }
  await request(api+'/'+encodeURIComponent(id)+'/cancel',{method:'POST',headers}).catch(()=>{});
  throw Error('Pages deployment timed out');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const url=await deployPages(process.env);
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'page_url='+url+'\n');
  console.log('Published '+url);
}
