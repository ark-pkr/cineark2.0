import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {createGeminiDiscovery} from '../../scripts/gemini-discovery.mjs';
let handler;
export default async(request,context)=>{
 if(!handler){
  const config={window:{}};vm.runInNewContext(await readFile(resolve(process.cwd(),'public/assets/js/config.js'),'utf8'),config);
  const settings=config.window.CINE_ARK_CONFIG;
  handler=createGeminiDiscovery({supabaseUrl:settings.supabaseUrl,anonKey:settings.supabaseAnonKey,apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMINI_DISCOVERY_MODEL || 'gemini-3.5-flash-lite'});
 }
 return handler(request,{clientId:context?.ip || 'shared'});
};
export const config={path:'/api/discover'};
