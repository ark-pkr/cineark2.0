const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(auth = {}) {
    const storage = new Map();
    const context = { window: { location: { href: 'http://localhost:8080/index.html?test=1#session' } }, indexedDB: { open: () => ({}) },
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        document: { body: { style: {} } }, URL: class extends URL { static revokeObjectURL() {} },
        setTimeout: () => 0, clearTimeout: () => {}, _supabase: { auth } };
    vm.createContext(context);
    for (const file of ['reader.js', 'auth.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
    const app = { userSession: null, ...context.window.readerMixin.data(), ...context.window.authMixin.data(),
        ...context.window.readerMixin.methods, ...context.window.authMixin.methods };
    Object.defineProperty(app, 'isAdmin', { get: () => context.window.authMixin.computed.isAdmin.call(app) });
    return { app, storage };
}

test('reader metadata cannot grant administrative access', () => {
    const { app } = setup();
    app.applySession({ user: { id: 'reader', app_metadata: {}, user_metadata: { role: 'admin' } } });
    assert.equal(app.isAdmin, false);
    app.applySession({ user: { id: 'admin', app_metadata: { role: 'admin' } } });
    assert.equal(app.isAdmin, true);
    app.applySession(null);
    assert.equal(app.isAdmin, false);
});

test('switching accounts restores their own progress and closes administrative views', () => {
    const { app, storage } = setup();
    storage.set('ark-reading:reader-b', JSON.stringify({ work: { chapterId: 'chapter-b', page: 8 } }));
    app.applySession({ user: { id: 'reader-a' } });
    app.readingWork = { id: 'work' };
    app.activeChapter = { id: 'chapter-a' };
    app.readerPage = 2;
    app.saveReadingProgress();
    // Session change while the reader is open must save to the old account.
    app.showAdmin = true;
    app.applySession({ user: { id: 'reader-b' } });
    assert.equal(app.readingProgress.work.page, 8);
    assert.equal(JSON.parse(storage.get('ark-reading:reader-a')).work.page, 2);
    assert.equal(app.showAdmin, false);
    assert.equal(app.readingWork, null);
});

test('registration only submits display name and handles email confirmation', async () => {
    let payload;
    const { app } = setup({ signUp: async value => { payload = value; return { data: { session: null }, error: null }; } });
    app.openAuth('signup');
    Object.assign(app, { authEmail: ' reader@example.com ', authPassword: 'strong-password', authConfirm: 'strong-password', authName: 'Reader' });
    await app.submitAuth();
    assert.equal(payload.email, 'reader@example.com');
    assert.equal(payload.options.emailRedirectTo, 'http://localhost:8080/index.html');
    assert.deepEqual(Object.keys(payload.options.data), ['display_name']);
    assert.equal(app.userSession, null);
    assert.match(app.authMessage, /e-mail/);
    assert.equal(app.authPassword, '');
    assert.equal(app.authBusy, false);
});

test('invalid password confirmation makes no authentication request', async () => {
    const { app } = setup({ signUp: () => { throw Error('must not be called'); } });
    app.openAuth('signup');
    Object.assign(app, { authEmail: 'reader@example.com', authPassword: 'strong-password', authConfirm: 'different', authName: 'Reader' });
    await app.submitAuth();
    assert.ok(app.authError);
});

test('failed login keeps form open and permits retry', async () => {
    const { app } = setup({ signInWithPassword: async () => ({ data: {}, error: { code: 'invalid_credentials' } }) });
    app.openAuth(); app.authEmail = 'reader@example.com'; app.authPassword = 'wrong';
    await app.submitAuth();
    assert.equal(app.authView, 'login');
    assert.match(app.authError, /incorretos/);
    assert.equal(app.authBusy, false);
});

test('confirmation redirect preserves deployment subdirectories and removes session parameters', () => {
    const { app } = setup();
    assert.equal(app.authRedirectURL(), 'http://localhost:8080/index.html');
    const context = { window: { location: { href: 'https://example.com/cineark2.0/?code=private#access_token=private' } } };
    vm.createContext(context);
    context.URL = URL;
    vm.runInContext(fs.readFileSync('auth.js', 'utf8'), context);
    const redirect = context.window.authMixin.methods.authRedirectURL;
    assert.equal(redirect(), 'https://example.com/cineark2.0/');
    context.window.CINE_ARK_CONFIG = { authRedirectUrl: 'https://example.com/reader/' };
    assert.equal(redirect(), 'https://example.com/reader/');
    context.window.CINE_ARK_CONFIG.authRedirectUrl = 'file:///private';
    assert.throws(() => redirect(), /HTTP/);
});

test('visitors can view work details but must sign in to read chapters', async () => {
    const { app } = setup();
    await app.addChapter();
    await app.deleteChapter({ id: 'chapter' });
    await app.openWork({ id: 'work' });
    assert.equal(app.readingWork.id, 'work');
    await app.openChapter({id:'chapter',source:'remote',published:true});
    assert.equal(app.authView, 'login');
    assert.equal(app.activeChapter, null);
});

test('inline application JavaScript parses', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
    assert.equal(/Arconte|secretClickCount|loginRitual/.test(html), false);
});
