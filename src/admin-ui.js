export const ADMIN_CSS=`.brand{display:flex;gap:.9rem;align-items:center}.brand-icon{width:44px;height:44px;flex:none}.brand h1{font-size:1.4rem;margin:0}.brand-subtitle{font-size:.8rem;margin:.25rem 0 0;color:GrayText;line-height:1.4}a{color:#286F78}:root{color-scheme:light dark;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}body{margin:0;background:Canvas;color:CanvasText}main{width:min(940px,92vw);margin:5vh auto}h1{font-size:1.8rem}h2{margin-top:2rem}p{line-height:1.6;color:GrayText}header{display:flex;align-items:center;justify-content:space-between}form#add{display:grid;gap:1rem;max-width:580px}label{display:grid;gap:.4rem;margin:.7rem 0}input,select{padding:.7rem;border:1px solid GrayText;border-radius:.4rem;background:Field;color:FieldText;font:inherit}input[type=checkbox]{width:auto}button{cursor:pointer;border:1px solid #286F78;background:#286F78;color:white;border-radius:.4rem;padding:.55rem 1rem;font:inherit}.secondary{background:transparent;color:CanvasText}.danger{background:transparent;border-color:#b3261e;color:#b3261e}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid GrayText;padding:.65rem;text-align:left;word-break:break-word}.muted{font-size:.9rem}#result{white-space:pre-wrap}code{word-break:break-all}`;
export const ADMIN_SCRIPT=`'use strict';
(async()=>{
  const meta=document.querySelector('meta[name="csrf-token"]');if(!meta)return;
  const csrf=meta.content;const result=document.getElementById('result');
  const enc=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
  async function encryptToken(token){
    const pub=await(await fetch('/admin/api/public-key',{credentials:'same-origin'})).json();
    if(!pub.n||!pub.e)throw new Error('无法取得加密公钥');
    const rsa=await crypto.subtle.importKey('jwk',pub,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    const aes=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
    const raw=await crypto.subtle.exportKey('raw',aes);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},aes,new TextEncoder().encode(token));
    const wrappedKey=await crypto.subtle.encrypt({name:'RSA-OAEP'},rsa,raw);
    return {wrappedKey:enc(wrappedKey),iv:enc(iv),ciphertext:enc(ciphertext)};
  }
  async function api(path,body){
    const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},credentials:'same-origin',body:JSON.stringify(body)});
    const out=await r.json();if(!r.ok)throw new Error(out.error||'操作失败');return out;
  }
  document.getElementById('add').addEventListener('submit',async ev=>{
    ev.preventDefault();const f=ev.currentTarget;const btn=f.querySelector('button');btn.disabled=true;
    try{const token=f.elements.token.value;const encrypted=await encryptToken(token);
      const out=await api('/admin/api/connections',{owner:f.elements.owner.value.trim(),kind:f.elements.kind.value,encrypted});
      f.elements.token.value='';result.textContent='已保存 '+out.owner;location.reload();
    }catch(e){f.elements.token.value='';result.textContent=e.message}finally{btn.disabled=false}
  });
  document.querySelectorAll('.toggle').forEach(b=>b.addEventListener('click',async()=>{
    try{await api('/admin/api/status',{owner:b.dataset.owner,enabled:b.dataset.enabled==='1'});location.reload()}
    catch(e){result.textContent=e.message}
  }));
  document.querySelectorAll('.delete').forEach(b=>b.addEventListener('click',async()=>{
    if(!confirm('确定删除 '+b.dataset.owner+' 的连接？此操作无法撤销。'))return;
    try{await api('/admin/api/delete',{owner:b.dataset.owner});location.reload()}
    catch(e){result.textContent=e.message}
  }));
  document.querySelectorAll('.approve-client').forEach(b=>b.addEventListener('click',async()=>{
    const owners=prompt('允许访问的 GitHub Owner（多个用英文逗号分隔）：');if(owners===null)return;
    const allowedOwners=owners.split(',').map(x=>x.trim()).filter(Boolean);
    if(!allowedOwners.length){result.textContent='至少需要指定一个 Owner';return}
    const allowWrite=confirm('是否为该客户端开启写操作授权？默认推荐选择“取消”，仅授予读取权限。');
    try{await api('/admin/api/client-approval',{clientId:b.dataset.client,approved:true,allowedOwners,allowWrite});location.reload()}
    catch(e){result.textContent=e.message}
  }));
  document.querySelectorAll('.revoke-client').forEach(b=>b.addEventListener('click',async()=>{
    if(!confirm('立即撤销该客户端全部权限？'))return;
    try{await api('/admin/api/client-approval',{clientId:b.dataset.client,approved:false});location.reload()}
    catch(e){result.textContent=e.message}
  }));
  document.querySelectorAll('.approve-operation').forEach(b=>b.addEventListener('click',async()=>{
    if(!confirm('确认人工审批并立即在 GitHub 执行该写操作？请先核对仓库和内容。'))return;
    try{const response=await api('/admin/api/operation',{id:b.dataset.operation,action:'approve'});result.textContent=JSON.stringify(response);location.reload()}
    catch(e){result.textContent=e.message}
  }));
  document.querySelectorAll('.deny-operation').forEach(b=>b.addEventListener('click',async()=>{
    try{await api('/admin/api/operation',{id:b.dataset.operation,action:'deny'});location.reload()}
    catch(e){result.textContent=e.message}
  }));
  document.getElementById('rekey').addEventListener('click',async()=>{
    if(!confirm('确认已同时配置旧密钥和新密钥？'))return;
    try{const out=await api('/admin/api/rekey',{});result.textContent='已迁移 '+out.processed+' 条，剩余 '+out.remaining+' 条'}
    catch(e){result.textContent=e.message}
  });
})();`;
