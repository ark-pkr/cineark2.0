import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {createWorkPageHandler} from '../../scripts/work-page.mjs';
let handler;
export default async request=>{
    if(!handler) {
        const context={window:{}};vm.runInNewContext(await readFile(resolve(process.cwd(),'config.js'),'utf8'),context);
        handler=createWorkPageHandler({settings:context.window.CINE_ARK_CONFIG,loadTemplate:()=>readFile(resolve(process.cwd(),'dist/index.html'),'utf8')});
    }
    return handler(request);
};
export const config={path:['/obra/:slug','/sitemap.xml']};
