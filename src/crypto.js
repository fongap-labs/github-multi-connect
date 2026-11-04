import {b64,unb64,encoder,decoder} from './util.js';

// DB encryption is independent from TLS and RSA-OAEP browser ingestion.
// KEYRING_JSON secret: {"v1":"base64-32-byte-key", "v2":"..."}.
async function aesKey(env,keyId,usage) {
  const ring=JSON.parse(env.KEYRING_JSON);
  if(!Object.hasOwn(ring,keyId)) throw new Error('Encryption key unavailable');
  const raw=unb64(ring[keyId]); if(raw.byteLength!==32) throw new Error('Invalid key length');
  return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,[usage]);
}
export async function seal(env, owner, token) {
  const keyId=env.ACTIVE_KEY_ID; if(!/^[\w-]{1,32}$/.test(keyId||'')) throw new Error('Invalid active key id');
  const key=await aesKey(env,keyId,'encrypt'); const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('github-owner:'+owner.toLowerCase())},key,encoder.encode(token));
  return {key_id:keyId,iv:b64(iv),ciphertext:b64(new Uint8Array(bytes))};
}
export async function unseal(env, row) {
  const key=await aesKey(env,row.key_id,'decrypt');
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(row.iv),additionalData:encoder.encode('github-owner:'+row.owner.toLowerCase())},key,unb64(row.ciphertext));
  return decoder.decode(bytes);
}
export function ingestionPublicJwk(env) {
  const key=JSON.parse(env.INGEST_PRIVATE_JWK);
  if(key.kty!=='RSA'||key.alg && key.alg!=='RSA-OAEP-256'||!key.n||!key.e||!key.d) throw new Error('Invalid ingestion key');
  return {kty:'RSA',n:key.n,e:key.e,alg:'RSA-OAEP-256',ext:true,key_ops:['encrypt']};
}
export async function decryptIngested(env, payload) {
  if(!payload || typeof payload!=='object') throw new Error('Invalid encrypted payload');
  const {wrappedKey,iv,ciphertext}=payload;
  if([wrappedKey,iv,ciphertext].some(x=>typeof x!=='string')) throw new Error('Invalid encrypted payload');
  if(wrappedKey.length>2048 || ciphertext.length>8192) throw new Error('Encrypted token too large');
  const privateJwk=JSON.parse(env.INGEST_PRIVATE_JWK);
  const priv=await crypto.subtle.importKey('jwk',privateJwk,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
  const raw=await crypto.subtle.decrypt({name:'RSA-OAEP'},priv,unb64(wrappedKey));
  if(raw.byteLength!==32) throw new Error('Invalid wrapped key');
  const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);
  const nonce=unb64(iv); if(nonce.byteLength!==12) throw new Error('Invalid IV');
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},key,unb64(ciphertext));
  const token=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!token || token.length>4096 || /[\r\n\0\t ]/.test(token)) throw new Error('Invalid token format');
  return token;
}
