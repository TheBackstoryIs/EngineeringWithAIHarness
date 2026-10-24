import {createServer} from 'node:http';
import {timingSafeEqual,createHash} from 'node:crypto';
import {createCoordinationStore} from './store.mjs';
import {protocol,maximumBodyBytes,fail,fields,id,roles} from './contract.mjs';

const tokenHash=value=>createHash('sha256').update(value).digest();
export async function createCoordinationServer(options){
  const host=options.host??'127.0.0.1';
  if(!['127.0.0.1','::1','localhost'].includes(host)&&options.allowNetwork!==true)fail('network-bind-confirmation-required',400);
  if(!Array.isArray(options.credentials)||!options.credentials.length)fail('credentials-required',400);
  const credentials=options.credentials.map(credential=>{
    fields(credential,['actorId','role','projects','token']);id(credential.actorId,'actor-id');
    if(!roles.includes(credential.role)||!Array.isArray(credential.projects)||!credential.projects.length||typeof credential.token!=='string'||credential.token.length<32)fail('credential-invalid',400);
    credential.projects.forEach(project=>id(project,'project-id'));
    return {actor:{actorId:credential.actorId,role:credential.role,projects:credential.projects},hash:tokenHash(credential.token)};
  });
  if(new Set(credentials.map(item=>item.hash.toString('hex'))).size!==credentials.length)fail('credential-duplicate',400);
  const store=createCoordinationStore(options.dataRoot);
  const server=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
    const send=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value));};
    try{
      const url=new URL(req.url,'http://coordination.invalid');
      if(url.pathname==='/health'&&req.method==='GET'){send(200,{protocol,status:'ready',identity:store.identity,epoch:store.epoch});return;}
      const match=url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9][a-z0-9._-]{0,79})\/(actions|intents)$/);
      if(!match||url.search)fail('route-not-found',404);
      const header=req.headers.authorization??'',hash=tokenHash(header.startsWith('Bearer ')?header.slice(7):'');
      const credential=credentials.find(item=>timingSafeEqual(item.hash,hash));if(!credential)fail('authentication-required',401);
      let action,input;
      if(req.method==='GET'&&match[2]==='intents'){action='list-intents';input={};}
      else if(req.method==='POST'&&match[2]==='actions'){
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))fail('json-content-type-required',415);
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>maximumBodyBytes)fail('request-too-large',413);chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('json-invalid',400);}
        fields(body,['action','input']);action=body.action;input=body.input;
      }else fail('method-not-allowed',405);
      send(200,{protocol,identity:store.identity,epoch:store.epoch,result:store.execute(credential.actor,match[1],action,input)});
    }catch(error){if(!res.headersSent)send(error.statusCode??500,{error:error.statusCode?error.code:'internal-error',protocol});else res.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options.port??47747,host,resolve);});}
  catch(error){store.close();throw error;}
  const address=server.address(),url=`http://${host.includes(':')?'['+host+']':host}:${address.port}`;
  return {url,identity:store.identity,epoch:store.epoch,close:async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});store.close();}};
}
