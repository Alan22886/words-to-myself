import assert from 'node:assert/strict';
import { deployPages } from '../scripts/deploy-pages.mjs';
const env={GITHUB_TOKEN:'test-token',GITHUB_REPOSITORY:'test/site',GITHUB_SHA:'test-sha',PAGES_ARTIFACT_ID:'123',ACTIONS_ID_TOKEN_REQUEST_URL:'https://identity.test',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'test-identity'};
const response=value=>({ok:true,json:async()=>value});let calls=[];
const url=await deployPages(env,async(url,options)=>{calls.push({url,options});if(url==='https://identity.test')return response({value:'test-oidc'});if(options.method==='POST')return response({id:'deployment-id',status_url:'https://api.github.com/repositories/123/pages/deployments/deployment-id/status',page_url:'https://test.github.io/site/'});return response({status:calls.length===3?'deployment_in_progress':'succeed'});},async()=>{});
assert.equal(url,'https://test.github.io/site/');assert.equal(JSON.parse(calls[1].options.body).artifact_id,123);assert.ok(!calls.some(call=>call.url.includes('/artifacts')));assert.equal(calls[2].url,'https://api.github.com/repositories/123/pages/deployments/deployment-id/status');
await assert.rejects(deployPages(env,async(url,options)=>url==='https://identity.test'?response({value:'test-oidc'}):options.method==='POST'?response({id:'id'}):response({status:'deployment_failed'}),async()=>{}),/deployment_failed/);
console.log('PASS: uploaded artifact ID used directly; in-progress then success; failed deployment rejects');
