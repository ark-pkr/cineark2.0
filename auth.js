window.authMixin = {
    data() {
        return { authView: null, authEmail: '', authPassword: '', authName: '', authConfirm: '',
            authBusy: false, authError: '', authMessage: '', authReady: false, showAdmin: false };
    },
    computed: {
        isAdmin() { return this.userSession?.user?.app_metadata?.role === 'admin'; },
        readerName() { return this.userSession?.user?.user_metadata?.display_name || this.userSession?.user?.email || 'Leitor'; }
    },
    methods: {
        authRedirectURL() {
            const configured = window.CINE_ARK_CONFIG?.authRedirectUrl;
            const url = new URL(configured || window.location.href);
            if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Sirva o site por HTTP ou HTTPS.');
            url.hash = ''; url.search = '';
            return url.href;
        },
        async removeCatalogItem(item) {
            if (!this.isAdmin || this.readerBusy || !confirm('Excluir esta obra, seus capítulos e todas as páginas online?')) return;
            const userId = this.userSession.user.id;
            const isCurrent = () => userId === this.userSession?.user?.id && this.isAdmin;
            this.readerBusy = true;
            try {
                const chapters = await this.cloudAPI().chapters(item.id);
                for (const chapter of chapters) await this.cloudAPI().deleteChapter(chapter.id, isCurrent);
                if (!isCurrent()) return;
                const { error } = await _supabase.from('itens_catalogo').delete().eq('id', item.id).select('id').single();
                if (error) throw error;
                if (isCurrent()) {
                    this.catalog = this.catalog.filter(entry => entry.id !== item.id);
                    delete this.readingProgress[item.id]; this.persistReadingProgress();
                }
            } catch (_) { if (isCurrent()) alert('A exclusão não terminou. Alguns capítulos podem ter sido removidos. Atualize a biblioteca e tente novamente.'); }
            finally { if (userId === this.userSession?.user?.id) this.readerBusy = false; }
        },
        openAuth(view = 'login') {
            this.authView = view; this.authError = ''; this.authMessage = '';
            this.authPassword = ''; this.authConfirm = '';
        },
        closeAuth() { if (!this.authBusy) { this.authView = null; this.authPassword = ''; this.authConfirm = ''; } },
        applySession(session) {
            const previousId = this.userSession?.user?.id;
            if (previousId !== session?.user?.id && this.activeChapter) this.closeReader();
            this.userSession = session;
            this.authReady = true;
            if (previousId !== session?.user?.id) {
                this.resetMangaDex?.(null);
                this._workRequest = (this._workRequest || 0) + 1;
                this._chapterRequest = (this._chapterRequest || 0) + 1;
                this._progressLoadRequest = (this._progressLoadRequest || 0) + 1;
                clearTimeout(this._progressTimer); clearTimeout(this._progressLoadTimer);
                clearTimeout(this._dexProgressTimer); this._dexProgressLoad = null;
                this.dexProgressSync = ''; this.dexProgressError = '';
                this.readingWork = null; this.showModal = false; this.showAdmin = false;
                this.chapters = []; this.localChapters = []; this.readerBusy = false;
                this.progressSync = ''; this.progressLoading = false; this._progressLoadingPromise = null;
                let saved = {};
                try { saved = JSON.parse(localStorage.getItem(this.progressStorageKey()) || '{}'); } catch (_) {}
                this.readingProgress = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
                // Avoid issuing Supabase requests inside its synchronous auth-state callback.
                if (session) this._progressLoadTimer = setTimeout(() => this.loadReadingProgress(), 0);
            }
            if (!this.isAdmin) { this.showAdmin = false; this.showModal = false; }
        },
        async submitAuth() {
            if (this.authBusy) return;
            this.authError = ''; this.authMessage = '';
            const email = this.authEmail.trim();
            if (!email || !this.authPassword) { this.authError = 'Preencha e-mail e senha.'; return; }
            if (this.authView === 'signup' && (this.authPassword.length < 8 || this.authPassword !== this.authConfirm || !this.authName.trim())) {
                this.authError = 'Informe seu nome e uma senha com pelo menos 8 caracteres. As senhas precisam ser iguais.'; return;
            }
            this.authBusy = true;
            try {
                const signup = this.authView === 'signup';
                const { data, error } = signup
                    ? await _supabase.auth.signUp({ email, password: this.authPassword,
                        options: { emailRedirectTo: this.authRedirectURL(), data: { display_name: this.authName.trim() } } })
                    : await _supabase.auth.signInWithPassword({ email, password: this.authPassword });
                if (error) throw error;
                this.authPassword = ''; this.authConfirm = '';
                if (data.session) { this.applySession(data.session); this.authView = null; }
                else this.authMessage = 'Confira seu e-mail para confirmar o cadastro. Depois, entre com sua senha.';
            } catch (error) {
                this.authError = error.code === 'invalid_credentials' ? 'E-mail ou senha incorretos.'
                    : error.code === 'email_not_confirmed' ? 'Confirme seu e-mail antes de entrar.'
                    : error.code === 'user_already_exists' ? 'Esta conta já existe. Use a opção Entrar.'
                    : 'Não foi possível concluir. Verifique os dados e tente novamente. Se persistir, confira a configuração de autenticação do Supabase.';
            } finally { this.authBusy = false; }
        },
        async signOutReader() {
            if (this.authBusy || this.readerBusy) return;
            this.authBusy = true;
            try {
                await this.flushReadingProgress();
                const { error } = await _supabase.auth.signOut();
                if (error) throw error;
                this.applySession(null);
            } catch (_) { this.openAuth(); this.authError = 'Não foi possível sair. Tente novamente.'; }
            finally { this.authBusy = false; }
        }
    },
    async mounted() {
        const { data } = _supabase.auth.onAuthStateChange((_event, session) => this.applySession(session));
        this._authSubscription = data.subscription;
        try {
            const { data: sessionData, error } = await _supabase.auth.getSession();
            if (error) throw error;
            if (!this.authReady) this.applySession(sessionData.session);
        } catch (_) { this.authReady = true; this.authError = 'Não foi possível recuperar sua sessão. Entre novamente.'; }
    },
    beforeUnmount() { this._authSubscription?.unsubscribe(); }
};
