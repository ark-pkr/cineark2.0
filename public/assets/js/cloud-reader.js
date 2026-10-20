/* Uses the signed-in user's Supabase client; every operation remains subject to RLS. */
window.ArkCloudReader = class {
    constructor(client, bucket = 'ark-pages') { this.client = client; this.bucket = client.storage.from(bucket); }
    async rows(table, columns, filter, order) {
        const rows = [];
        for (let offset = 0; ; offset += 500) {
            const { data, error } = await this.client.from(table).select(columns).eq(...filter).order(order).range(offset, offset + 499);
            if (error) throw error;
            rows.push(...data);
            if (data.length < 500) return rows;
        }
    }
    async chapters(workId) {
        const rows = await this.rows('ark_chapters', 'id,work_id,number,title,published,content_revision,content_updated_at,ark_chapter_pages(count)', ['work_id', workId], 'number');
        return rows.map(row => ({ id: row.id, workId: String(row.work_id), number: Number(row.number),
            title: row.title, contentRevision:Number(row.content_revision || 1),contentUpdatedAt:row.content_updated_at, published: row.published, source: 'remote', pageCount: row.ark_chapter_pages?.[0]?.count || 0 }));
    }
    async pages(chapterId) {
        return this.rows('ark_chapter_pages', 'page_index,storage_path,width,height', ['chapter_id', chapterId], 'page_index');
    }
    async signedURLs(pages) {
        const urls = [];
        for (let offset = 0; offset < pages.length; offset += 100) {
            const batch = pages.slice(offset, offset + 100);
            const { data, error } = await this.bucket.createSignedUrls(batch.map(p => p.storage_path), 3600);
            if (error) throw error;
            const byPath = new Map(data.map(item => [item.path, item]));
            for (const page of batch) {
                const item = byPath.get(page.storage_path);
                if (!item?.signedUrl || item.error) throw new Error('Não foi possível autorizar uma página.');
                urls.push(item.signedUrl);
            }
        }
        return urls;
    }
    async upload({ workId, number, title, files, dimensions, onProgress = () => {}, isCurrent = () => true }) {
        const id = crypto.randomUUID();
        const paths = [];
        const guard = () => { if (!isCurrent()) throw new Error('A conta mudou durante o envio. Entre novamente para continuar.'); };
        try {
            guard();
            const created = await this.client.from('ark_chapters').insert({ id, work_id: workId, number, title, published: false });
            if (created.error) throw created.error;
            const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
            const records = [];
            for (let i = 0; i < files.length; i++) {
                guard();
                const path = `${id}/${String(i + 1).padStart(6, '0')}.${extensions[files[i].type]}`;
                // Include attempted paths too: a response can fail after the server has saved a file.
                paths.push(path);
                const uploaded = await this.bucket.upload(path, files[i], { contentType: files[i].type, upsert: false });
                if (uploaded.error) throw uploaded.error;
                records.push({ chapter_id: id, page_index: i, storage_path: path, ...dimensions[i] });
                onProgress(i + 1, files.length);
            }
            for (let offset = 0; offset < records.length; offset += 100) {
                guard();
                const result = await this.client.from('ark_chapter_pages').insert(records.slice(offset, offset + 100));
                if (result.error) throw result.error;
            }
            guard();
            const published = await this.client.from('ark_chapters').update({ published: true }).eq('id', id).select('id').single();
            if (published.error) throw published.error;
            guard();
            return { id, workId: String(workId), number, title, source: 'remote', published: true, pageCount: files.length };
        } catch (error) {
            let cleanupFailed = !isCurrent();
            if (isCurrent()) {
                // Unpublish first, including when publication succeeded but its response was lost.
                try {
                    const hidden = await this.client.from('ark_chapters').update({ published: false }).eq('id', id);
                    cleanupFailed = !!hidden.error;
                } catch (_) { cleanupFailed = true; }
                // If hiding failed, leave files intact: publication may have succeeded before a lost response.
                for (let offset = 0; !cleanupFailed && offset < paths.length && isCurrent(); offset += 100) {
                    try {
                        const removed = await this.bucket.remove(paths.slice(offset, offset + 100));
                        cleanupFailed ||= !!removed.error;
                    } catch (_) { cleanupFailed = true; }
                }
                if (!cleanupFailed && isCurrent()) {
                    try { const removed = await this.client.from('ark_chapters').delete().eq('id', id); cleanupFailed = !!removed.error; }
                    catch (_) { cleanupFailed = true; }
                }
            }
            const message = error.code === '23505' ? 'Já existe um capítulo com esse número. Confira também os rascunhos.'
                : error.message || 'O envio falhou.';
            throw new Error(message + (cleanupFailed ? ' Confira a lista antes de reenviar; pode ter restado um capítulo ou rascunho.' : ' Nenhum capítulo incompleto foi publicado.'));
        }
    }
    async deleteChapter(id, isCurrent = () => true) {
        const guard = () => { if (!isCurrent()) throw new Error('A conta mudou. Reabra a lista de capítulos.'); };
        // Keep metadata until all files are removed so a failed deletion can be retried.
        guard();
        const hidden = await this.client.from('ark_chapters').update({ published: false }).eq('id', id).select('id').single();
        if (hidden.error) throw hidden.error;
        const paths = [];
        for (let offset = 0; ; offset += 100) {
            guard();
            const listed = await this.bucket.list(id, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
            if (listed.error) throw listed.error;
            paths.push(...listed.data.map(file => `${id}/${file.name}`));
            if (listed.data.length < 100) break;
        }
        for (let offset = 0; offset < paths.length; offset += 100) {
            guard();
            const removed = await this.bucket.remove(paths.slice(offset, offset + 100));
            if (removed.error) throw removed.error;
        }
        guard();
        const removed = await this.client.from('ark_chapters').delete().eq('id', id).select('id').single();
        if (removed.error) throw removed.error;
    }
    progress(userId) { return this.rows('ark_reading_progress', '*', ['user_id', userId], 'work_id'); }
    dexProgress(userId) { return this.rows('ark_mangadex_progress', '*', ['user_id', userId], 'work_id'); }
    async saveDexProgress(row) {
        const { data, error } = await this.client.from('ark_mangadex_progress').upsert(row, { onConflict: 'user_id,work_id' }).select().single();
        if (error) throw error;
        return data;
    }
    async saveProgress(row) {
        const { error } = await this.client.from('ark_reading_progress').upsert(row, { onConflict: 'user_id,work_id' });
        if (error) throw error;
    }
};
