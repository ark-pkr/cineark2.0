const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clean=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
export function renderWorkPage(template,work,origin) {
    const title=work.title+' | CINE ARK', description=clean(work.synopsis).slice(0,180)||'Conheça '+work.title+' e explore os capítulos disponíveis no CINE ARK.';
    const canonical=new URL('/obra/'+encodeURIComponent(work.slug),origin).href;
    let poster='';try{const url=new URL(work.poster);if(url.protocol==='https:')poster=url.href;}catch(_){}
    const tags='<link rel="canonical" href="'+escapeHTML(canonical)+'">\n'+
        '<meta name="description" content="'+escapeHTML(description)+'">\n<meta property="og:type" content="book">\n'+
        '<meta property="og:site_name" content="CINE ARK">\n<meta property="og:title" content="'+escapeHTML(title)+'">\n'+
        '<meta property="og:description" content="'+escapeHTML(description)+'">\n<meta property="og:url" content="'+escapeHTML(canonical)+'">\n'+
        (poster?'<meta property="og:image" content="'+escapeHTML(poster)+'">\n':'')+'<meta name="twitter:card" content="summary_large_image">\n';
    const json=JSON.stringify(work).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    const preview='<article id="ark-route-preview" class="ark-route-preview"><a href="/">← CINE ARK</a><h1>'+escapeHTML(work.title)+'</h1>'+
        (poster?'<img src="'+escapeHTML(poster)+'" alt="Capa de '+escapeHTML(work.title)+'" width="180" height="270">':'')+
        '<p>'+escapeHTML(work.type)+'</p><p>'+escapeHTML(clean(work.synopsis))+'</p>'+(work.author?'<p>Autor / arte: '+escapeHTML(work.author)+'</p>':'')+
        '<p>'+escapeHTML((work.genres||[]).join(' · '))+'</p></article>';
    return template.replace(/<head>/i,'<head>\n<base href="/">').replace(/<title>[\s\S]*?<\/title>/i,'<title>'+escapeHTML(title)+'</title>').replace('</head>',tags+'<script>window.CINE_ARK_INITIAL_WORK='+json+';</script>\n</head>').replace('<div id="app"',preview+'\n<div id="app"');
}
export function createWorkPageHandler({settings,loadTemplate,fetcher=fetch}) {
    return async request=>{
        const url=new URL(request.url),match=url.pathname.match(/^\/obra\/([a-z0-9-]{1,180})\/?$/);
        const headers={'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'};
        if(!['GET','HEAD'].includes(request.method))return new Response('Método não permitido.',{status:405,headers});
        if(url.pathname==='/sitemap.xml') {
            try {
                const entries=['<url><loc>'+escapeHTML(new URL('/',url.origin).href)+'</loc></url>'];
                for(let offset=0;offset<50000;offset+=500) {
                    const endpoint=new URL('/rest/v1/itens_catalogo',settings.supabaseUrl);
                    endpoint.searchParams.set('select','slug');endpoint.searchParams.set('order','slug.asc');endpoint.searchParams.set('limit','500');endpoint.searchParams.set('offset',String(offset));
                    const response=await fetcher(endpoint,{headers:{apikey:settings.supabaseAnonKey},signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('Unavailable');
                    const rows=await response.json();
                    for(const row of rows)entries.push('<url><loc>'+escapeHTML(new URL('/obra/'+encodeURIComponent(row.slug),url.origin).href)+'</loc></url>');
                    if(rows.length<500)break;
                }
                const xml='<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+entries.join('')+'</urlset>';
                return new Response(request.method==='HEAD'?null:xml,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=300, s-maxage=3600'}});
            }catch(_){return new Response('Sitemap temporariamente indisponível.',{status:503,headers});}
        }
        if(!match)return new Response('Obra não encontrada.',{status:404,headers});
        try {
            const endpoint=new URL('/rest/v1/itens_catalogo',settings.supabaseUrl);
            endpoint.searchParams.set('slug','eq.'+match[1]);endpoint.searchParams.set('limit','1');
            endpoint.searchParams.set('select','id,slug,title,type,poster,synopsis,author,genres,reaction_config,reading_language,totalcount,mal_id');
            // Public metadata only. Never forward reader cookies or authorization headers.
            const response=await fetcher(endpoint,{headers:{apikey:settings.supabaseAnonKey,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
            if(!response.ok)throw Error('Metadata unavailable');
            const rows=await response.json(),work=rows?.[0];
            if(!work)return new Response('<!doctype html><html lang="pt-br"><meta charset="utf-8"><title>Obra não encontrada | CINE ARK</title><h1>Obra não encontrada</h1><a href="/">Explorar biblioteca</a></html>',{status:404,headers});
            const html=renderWorkPage(await loadTemplate(),work,url.origin);
            return new Response(request.method==='HEAD'?null:html,{status:200,headers});
        } catch(_) {return new Response('Não foi possível consultar esta obra agora. Tente novamente.',{status:503,headers:{...headers,'Retry-After':'30'}});}
    };
}
