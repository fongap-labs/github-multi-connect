#!/usr/bin/env node
import {webcrypto as crypto} from 'node:crypto';
import {writeFileSync,existsSync} from 'node:fs';

if(existsSync('.secrets.json')||existsSync('.dev.vars')){
  console.error('Existing secrets found. Refusing to overwrite encryption keys.');
  process.exitCode=1;
}else{
  const random=(n=32)=>Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64url');
  const rsa=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  const privateJwk=await crypto.subtle.exportKey('jwk',rsa.privateKey);
  const keyRing={v1:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')};
  const secrets={
    MCP_ADMIN_KEY:random(48),
    MCP_APPROVAL_KEY:random(48),
    MCP_COOKIE_KEY:random(48),
    MCP_KEYRING_JSON:JSON.stringify(keyRing),
    MCP_INGEST_JWK:JSON.stringify(privateJwk)
  };
  writeFileSync('.secrets.json',JSON.stringify(secrets,null,2)+'\n',{mode:0o600,flag:'wx'});
  writeFileSync('.dev.vars',Object.entries({...secrets,MCP_ACTIVE_ID:'v1'}).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{mode:0o600,flag:'wx'});
  console.log('Generated .secrets.json (five secrets) and .dev.vars (includes MCP_ACTIVE_ID=v1), mode 0600.');
  console.log('No secret values were printed. Store a secure offline backup.');
  console.log('Use MCP_ADMIN_KEY and MCP_APPROVAL_KEY only in the browser, NEVER in agent messages.');
}
