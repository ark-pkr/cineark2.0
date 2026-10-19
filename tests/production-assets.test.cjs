const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('initial runtime and styles load exclusively from local public files',()=>{
    const html=fs.readFileSync('public/index.html','utf8');
    for(const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
        const url=match[1];if(url==='manifest.json')continue;
        assert.equal(/^https?:\/\//.test(url),false,'External startup dependency: '+url);
        assert.equal(fs.existsSync(path.join('public',url)),true,url);
    }
    assert.match(html,/mobile-web-app-capable/);
    assert.doesNotMatch(html,/name="apple-mobile-web-app-capable"/);
});
test('production Vue is pinned and can compile the actual application template locally',()=>{
    const c={};vm.createContext(c);vm.runInContext(fs.readFileSync('public/assets/vendor/vue/vue.global.prod.js','utf8'),c);
    assert.equal(c.Vue.version,require('../node_modules/vue/package.json').version);
    const html=fs.readFileSync('public/index.html','utf8'),start=html.indexOf('<div id="app"');
    assert.ok(start>=0);
    // Full runtime build keeps the compiler required by the current in-DOM template.
    assert.equal(typeof c.Vue.compile,'function');
    const render=c.Vue.compile(html.slice(start,html.indexOf('<script>',start)),{decodeEntities:s=>s});
    assert.equal(typeof render,'function');assert.ok(render.toString().includes('readingWork'));
});
test('dependency failure has a recovery message independent of the application runtime',()=>{
    const html=fs.readFileSync('public/index.html','utf8');
    assert.ok(html.indexOf('class="ark-runtime-error"')<html.indexOf('<div id="app"'));
    assert.match(html,/runtimeError='true'/);assert.match(html,/onclick="location.reload\(\)"/);
});
test('all icon and font stylesheet URLs resolve locally and production utilities are generated',()=>{
    for(const file of ['public/assets/vendor/fonts/fonts.css','public/assets/vendor/fontawesome/css/all.min.css']){
        const css=fs.readFileSync(file,'utf8');
        for(const match of css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)){
            assert.equal(/^https?:/.test(match[1]),false);
            assert.ok(fs.existsSync(path.resolve(path.dirname(file),match[1])),match[1]);
        }
    }
    const css=fs.readFileSync('public/assets/css/utilities.css','utf8');
    assert.match(css,/\.hidden\{/);assert.match(css,/\.flex\{/);assert.match(css,/\.fixed\{/);
    const sw=fs.readFileSync('public/sw.js','utf8');
    assert.ok(sw.includes('./assets/vendor/vue/vue.global.prod.js'));assert.ok(sw.includes('./assets/css/utilities.css'));
});
