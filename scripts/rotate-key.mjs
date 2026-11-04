#!/usr/bin/env node
import {webcrypto as crypto} from 'node:crypto';
import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
const path='.secrets.json';
const secrets=JSON.parse(readFileSync(path,'utf8'));
const keyRing=JSON.parse(secrets.GMC_KEYRING_JSON);
const ids=Object.keys(keyRing).map(id=>Number(id.replace(/^v/,''))).filter(Number.isSafeInteger);
const next='v'+(Math.max(0,...ids)+1);
keyRing[next]=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
secrets.GMC_KEYRING_JSON=JSON.stringify(keyRing);
writeFileSync(path,JSON.stringify(secrets,null,2)+'\n',{mode:0o600});
writeFileSync('.dev.vars',Object.entries({...secrets,GMC_ACTIVE_ID:next}).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{mode:0o600});
chmodSync(path,0o600);chmodSync('.dev.vars',0o600);
console.log('Added '+next+'. Old keys retained for decrypting existing ciphertext.');
console.log('Upload GMC_KEYRING_JSON to Cloudflare Secrets and update GMC_ACTIVE_ID in Action Worker Variables before re-encrypting.');
