window.aiDiscoveryMixin = {
    data() {
        return {
            intentQuery: '',
            intentBusy: false,
            intentError: '',
            intentResult: null,
            intentSubmitted: '',
            showIntentSearch: false,
            intentPrioritizeAvailable: true,
            editorialThemePresets: [
                'Regressão',
                'Vingança',
                'Necromancia',
                'Protagonista estrategista',
                'Evolução de poderes',
                'Sistema',
                'Artes marciais',
                'Romance',
                'Romance leve',
                'Comédia',
                'Terror',
                'Vida escolar',
                'Construção de reino',
                'Viagem no tempo'
            ]
        };
    },
    computed: {
        intentMatches() {
            return (this.intentResult?.matches || [])
                .map(row => ({ ...row, work: this.catalog.find(work => work.id === row.id) }))
                .filter(row => row.work);
        }
    },
    watch: {
        userSession(next, previous) {
            if (next?.user?.id !== previous?.user?.id) this.clearIntentSearch();
        }
    },
    methods: {
        normalizeEditorialThemes(value) {
            const result = [],
                seen = new Set();
            for (const item of Array.isArray(value) ? value : []) {
                if (typeof item !== 'string') continue;
                const theme = item.replace(/\s+/g, ' ').trim().slice(0, 60),
                    key = theme
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .toLowerCase();
                if (theme && !seen.has(key)) {
                    result.push(theme);
                    seen.add(key);
                }
                if (result.length === 24) break;
            }
            return result;
        },
        hasEditorialTheme(theme) {
            const normalize = value =>
                value
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .toLowerCase();
            return this.normalizeEditorialThemes(this.newItem?.editorial_themes).some(
                value => normalize(value) === normalize(theme)
            );
        },
        toggleEditorialTheme(theme) {
            if (!this.isAdmin || this.catalogSaving) return;
            const themes = this.normalizeEditorialThemes(this.newItem.editorial_themes);
            this.newItem.editorial_themes = this.hasEditorialTheme(theme)
                ? themes.filter(
                      value =>
                          value
                              .normalize('NFD')
                              .replace(/[\u0300-\u036f]/g, '')
                              .toLowerCase() !==
                          theme
                              .normalize('NFD')
                              .replace(/[\u0300-\u036f]/g, '')
                              .toLowerCase()
                  )
                : this.normalizeEditorialThemes([...themes, theme]);
        },
        setEditorialThemes(event) {
            if (!this.isAdmin || this.catalogSaving) return;
            this.newItem.editorial_themes = this.normalizeEditorialThemes(event.target.value.split(','));
        },
        cancelIntentSearch() {
            this._intentRequest = (this._intentRequest || 0) + 1;
            this._intentController?.abort();
            this.intentBusy = false;
        },
        clearIntentSearch() {
            this.cancelIntentSearch();
            this.intentQuery = '';
            this.intentSubmitted = '';
            this.intentError = '';
            this.intentResult = null;
            this.intentPrioritizeAvailable = true;
        },
        async searchReadingIntent() {
            const query = this.intentQuery.trim();
            if (this.intentBusy) return;
            if (query.length < 8 || query.length > 500) {
                this.intentError = 'Descreva sua próxima leitura usando de 8 a 500 caracteres.';
                return;
            }
            this.cancelIntentSearch();
            const request = this._intentRequest;
            this.intentBusy = true;
            this.intentError = '';
            this.intentResult = null;
            this.intentSubmitted = query;
            const controller = (this._intentController = new AbortController()),
                timer = setTimeout(() => controller.abort(), 40000);
            try {
                const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
                const response = await fetch(local ? 'http://127.0.0.1:8787/api/discover' : '/api/discover', {
                    method: 'POST',
                    credentials: 'omit',
                    signal: controller.signal,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query, prioritizeAvailable: this.intentPrioritizeAvailable })
                });
                let result;
                try {
                    result = await response.json();
                } catch (cause) {
                    throw Error(
                        response.status === 404
                            ? 'A busca com IA ainda não foi publicada neste servidor.'
                            : 'O servidor de busca está indisponível. Use a busca por título.',
                        { cause }
                    );
                }
                if (!response.ok) {
                    if (local && result.code === 'AI_NOT_CONFIGURED')
                        throw Error(
                            'O servidor local está conectado. Configure GEMINI_API_KEY no arquivo .env.local e reinicie npm start. A chave da hospedagem não é carregada no Live Server.'
                        );
                    throw Error(result.error || 'Não foi possível buscar com Gemini.');
                }
                if (
                    !Array.isArray(result.matches) ||
                    result.matches.length > 6 ||
                    !result.matches.every(
                        row =>
                            typeof row.id === 'string' &&
                            typeof row.reason === 'string' &&
                            ['partial', 'supported'].includes(row.fit) &&
                            typeof row.uncertainty === 'string' &&
                            (row.publishedChapters === undefined ||
                                (Number.isInteger(row.publishedChapters) && row.publishedChapters >= 0)) &&
                            Array.isArray(row.evidence) &&
                            row.evidence.every(item => typeof item.quote === 'string')
                    )
                )
                    throw Error('A busca retornou uma resposta inválida. Tente novamente.');
                if (request === this._intentRequest) this.intentResult = result;
            } catch (error) {
                if (request === this._intentRequest) {
                    const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
                    this.intentError =
                        error.name === 'AbortError'
                            ? 'A busca demorou demais. Tente novamente.'
                            : error.name === 'TypeError' ||
                                /failed to fetch|fetch failed|networkerror|load failed/i.test(error.message || '')
                              ? local
                                  ? 'O Live Server abre a tela, mas a busca com IA precisa do servidor do projeto. Execute npm start e tente novamente.'
                                  : 'Não foi possível conectar à busca com IA. Verifique sua conexão e tente novamente.'
                              : error.message || 'Não foi possível concluir a busca.';
                }
            } finally {
                clearTimeout(timer);
                if (request === this._intentRequest) this.intentBusy = false;
            }
        }
    },
    beforeUnmount() {
        this.cancelIntentSearch();
    }
};
