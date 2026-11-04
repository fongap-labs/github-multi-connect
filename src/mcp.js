import {BRAND_NAME,BRAND_SOURCE,BRAND_VERSION} from './brand.js';
import {json,validOwner,randomId,now} from './util.js';
import {githubPath,getOwnerToken,apiFetch,summarize,redact,PublicError} from './github.js';

const S={type:'string'};const N={type:'integer',minimum:1};
function spec(name,description,props,required=['owner','repo']){
  return {name,description,inputSchema:{type:'object',properties:props,required,additionalProperties:false}};
}
function availableTools(env,scopes){
  const tools=[
    spec('github_available_owners','List GitHub usernames/organizations configured in this MCP; NEVER reveals tokens.',{},[]),
    spec('github_get_repository','Read GitHub repository metadata using the token mapped to owner.',{owner:S,repo:S}),
    spec('github_list_issues','List issues, excluding pull requests.',{owner:S,repo:S,state:{type:'string',enum:['open','closed','all']},per_page:{type:'integer',minimum:1,maximum:50}}),
    spec('github_get_issue','Read one issue.',{owner:S,repo:S,number:N},['owner','repo','number']),
    spec('github_list_pull_requests','List pull requests.',{owner:S,repo:S,state:{type:'string',enum:['open','closed','all']},per_page:{type:'integer',minimum:1,maximum:50}}),
    spec('github_get_pull_request','Read one pull request.',{owner:S,repo:S,number:N},['owner','repo','number'])
  ];
  if(env.GITHUB_MULTI_CONNECT_CAN_READ_FILE_CONTENT==='true')tools.push(spec('github_read_file','Read a repository file; CONTENT MAY CONTAIN SECRETS. Disabled by default.',{owner:S,repo:S,path:S,ref:S},['owner','repo','path']));
  if(env.GITHUB_MULTI_CONNECT_IS_WRITE_ENABLED==='true'&&scopes.includes('mcp:write'))tools.push(spec('github_create_issue','Request creating a GitHub issue; executes ONLY after independent administrator approval.',{owner:S,repo:S,title:S,body:S},['owner','repo','title']));
  tools.push(spec('github_operation_status','Check the status of a write request submitted by this MCP client.',{request_id:S},['request_id']));
  return tools;
}
function rpcResult(id,result){return {jsonrpc:'2.0',id,result};}
function rpcError(id,code,message){return {jsonrpc:'2.0',id,error:{code,message}};}
function resultText(data){return {content:[{type:'text',text:redact(JSON.stringify(data))}]};}
function toolError(message){return {isError:true,content:[{type:'text',text:redact(message)}]};}

async function callTool(name,args,env,auth) {
  const scopes=auth.scopes;
  if(!args||typeof args!=='object'||Array.isArray(args))throw new PublicError('Invalid arguments');
  if(name==='github_available_owners'){
    const {results=[]}=await env.GITHUB_DB.prepare('SELECT owner,owner_kind FROM github_connections WHERE enabled=1 ORDER BY owner LIMIT 100').all();
    return results.filter(x=>auth.allowedOwners.includes(x.owner.toLowerCase())).map(({owner,owner_kind})=>({owner,kind:owner_kind}));
  }
  if(name==='github_operation_status') {
    if(typeof args.request_id!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(args.request_id))throw new PublicError('Invalid request id');
    const row=await env.GITHUB_DB.prepare('SELECT owner,repo,title,status,result_json,expires_at FROM approval_requests WHERE id=? AND client_id=?').bind(args.request_id,auth.clientId).first();
    if(!row||!auth.allowedOwners.includes(row.owner)||row.expires_at<=now()&&row.status==='pending')throw new PublicError('Operation not available');
    return {owner:row.owner,repo:row.repo,title:row.title,status:row.status,result:row.result_json?JSON.parse(row.result_json):null};
  }
  const types={github_get_repository:'repo',github_list_issues:'issues',github_get_issue:'issue',github_list_pull_requests:'pulls',github_get_pull_request:'pull',github_read_file:'file'};
  const kind=types[name];
  if(kind==='file'&&env.GITHUB_MULTI_CONNECT_CAN_READ_FILE_CONTENT!=='true')throw new PublicError('File reading is disabled');
  if(!kind&&name!=='github_create_issue')throw new PublicError('Unknown tool');
  if(name==='github_create_issue'&&!(env.GITHUB_MULTI_CONNECT_IS_WRITE_ENABLED==='true'&&scopes.includes('mcp:write')))throw new PublicError('Write access is disabled');
  if(!validOwner(args.owner)||!auth.allowedOwners.includes(args.owner.toLowerCase()))throw new PublicError('Owner not authorized for this MCP client');
  const path=githubPath({...args,kind:kind||'repo'});
  if(name==='github_create_issue'){
    if(typeof args.title!=='string'||args.title.length<1||args.title.length>256||typeof (args.body??'')!=='string'||(args.body??'').length>10000)throw new PublicError('Invalid issue title or body');
    const requestId=randomId();
    await env.GITHUB_DB.prepare('INSERT INTO approval_requests(id,client_id,owner,repo,title,body,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?, ?,?)').bind(requestId,auth.clientId,args.owner.toLowerCase(),args.repo,args.title,args.body||'','pending',now(),now()+600).run();
    return {status:'pending',request_id:requestId,message:'Administrator approval is required. Use github_operation_status to check later.'};
  }
  const token=await getOwnerToken(env,args.owner);
  const data=await apiFetch(token,path);
  return summarize(kind,data);
}
export async function processMcp(request,env,auth){
  if(request.method==='GET'||request.method==='DELETE')return new Response(null,{status:405,headers:{'Allow':'POST','Cache-Control':'no-store'}});
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().includes('application/json'))return json({error:'Content type must be application/json'},415);
  const len=Number(request.headers.get('Content-Length')||'0');if(len>65536)return json({error:'Request too large'},413);
  let rpc;try {const raw=await request.text();if(raw.length>65536)throw Error();rpc=JSON.parse(raw);}catch{return json(rpcError(null,-32700,'Parse error'));}
  if(!rpc||Array.isArray(rpc)||typeof rpc!=='object'||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string')return json(rpcError(null,-32600,'Invalid request'));
  const id=Object.hasOwn(rpc,'id')?rpc.id:undefined;
  if(id!==undefined&&typeof id!=='number'&&typeof id!=='string')return json(rpcError(null,-32600,'Invalid request'));
  if(id===undefined)return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
  if(!auth.scopes.includes('mcp:read'))return json(rpcError(id,-32001,'Insufficient scope'),403);
  if(rpc.method==='initialize'){
    const p=rpc.params||{};
    const supported=['2026-07-28','2025-11-25','2025-06-18','2025-03-26'];
    const version=supported.includes(p.protocolVersion)?p.protocolVersion:'2025-11-25';
    return json(rpcResult(id,{protocolVersion:version,capabilities:{tools:{listChanged:false}},serverInfo:{name:'github-multi-connect',title:`${BRAND_NAME} · ${BRAND_SOURCE} (Independent)`,version:BRAND_VERSION.slice(1)},instructions:`Independent third-party multi-account gateway by ${BRAND_SOURCE}, NOT the official GitHub MCP Server. GitHub owner selects the matching server-held credential. Tokens cannot be read or returned by tools. GitHub writes and raw file contents are disabled by default.`}));
  }
  if(rpc.method==='ping')return json(rpcResult(id,{}));
  if(rpc.method==='tools/list')return json(rpcResult(id,{tools:availableTools(env,auth.scopes)}));
  if(rpc.method==='tools/call'){
    const name=rpc.params?.name;
    if(!availableTools(env,auth.scopes).some(t=>t.name===name))return json(rpcError(id,-32602,'Unknown or unauthorized tool'));
    try {
      const result=await callTool(name,rpc.params?.arguments||{},env,auth);
      return json(rpcResult(id,resultText(result)));
    }catch(error){
      // No upstream error bodies, request headers, Token or stack are ever returned.
      return json(rpcResult(id,toolError(error instanceof PublicError?error.message:'Operation failed')));
    }
  }
  return json(rpcError(id,-32601,'Method not found'));
}
