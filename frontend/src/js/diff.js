import { getFileIcon } from './icon-manager.js';

window.DiffDrawer = {
    state: {
        currentEventId: null
    },

    languageMap: {
        js: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        py: 'python',
        html: 'xml',
        css: 'css',
        scss: 'scss',
        json: 'json',
        md: 'markdown',
        sh: 'bash',
        bash: 'bash',
        zsh: 'bash',
        rs: 'rust',
        go: 'go',
        java: 'java',
        c: 'c',
        h: 'c',
        cpp: 'cpp',
        hpp: 'cpp',
        kt: 'kotlin',
        swift: 'swift',
        php: 'php',
        rb: 'ruby',
        yml: 'yaml',
        yaml: 'yaml'
    },

    getIcon(path) {
        const name = path.split('/').pop();
        return getFileIcon(name, false, false);
    },

    async open(eventId) {
        console.log('[DiffDrawer] open() called with id:', eventId);
        if (this.state.currentEventId === eventId) {
            console.log('[DiffDrawer] Already open, skipping');
            return;
        }
        this.state.currentEventId = eventId;

        document.querySelectorAll('.timeline-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === eventId);
        });

        try {
            const res = await fetch(`/api/event/${eventId}`);
            if (!res.ok) {
                console.error('[DiffDrawer] Fetch failed:', res.status);
                return;
            }
            const data = await res.json();
            if (data.error) {
                console.error('[DiffDrawer] API error:', data.error);
                return;
            }

            this.render(data);
        } catch (e) {
            console.error('[DiffDrawer] Error:', e);
        }
    },

    close() {
        this.state.currentEventId = null;
    },

    render(data) {
        const evt = data.event;
        const path = evt.relative_path || evt.path;
        const language = this.getLanguageFromPath(evt.path || path);

        const pathEl = document.getElementById('diff-path');
        if (pathEl) pathEl.textContent = path;

        const badge = document.getElementById('diff-type-badge');
        if (badge) {
            badge.textContent = evt.type.toUpperCase();
            badge.className = `badge badge-${evt.type}`;
        }

        const diffContent = document.getElementById('diff-content');
        if (!diffContent) return;

        diffContent.classList.add('flash');
        setTimeout(() => diffContent.classList.remove('flash'), 300);

        const diffText = data.diff || '(No changes detected)';
        const lines = diffText.split('\n');

        let html = '<table class="diff-table">';
        let oldLine = 1;
        let newLine = 1;

        for (const line of lines) {
            if (line.startsWith('@@')) {
                const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
                if (match) {
                    oldLine = parseInt(match[1]);
                    newLine = parseInt(match[2]);
                }
                html += `<tr class="diff-hunk"><td class="line-num"></td><td class="line-num"></td><td class="diff-line">${this.escapeHtml(line)}</td></tr>`;
            } else if (line.startsWith('+++') || line.startsWith('---')) {
                html += `<tr class="diff-file"><td class="line-num"></td><td class="line-num"></td><td class="diff-line">${this.escapeHtml(line)}</td></tr>`;
            } else if (line.startsWith('+') && !line.startsWith('+++')) {
                const content = this.highlightCode(line.slice(1), language);
                html += `<tr class="diff-added"><td class="line-num">${newLine}</td><td class="line-num sign">+</td><td class="diff-line"><span class="hljs">${content}</span></td></tr>`;
                newLine++;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                const content = this.highlightCode(line.slice(1), language);
                html += `<tr class="diff-deleted"><td class="line-num sign">-</td><td class="line-num">${oldLine}</td><td class="diff-line"><span class="hljs">${content}</span></td></tr>`;
                oldLine++;
            } else if (line.startsWith(' ')) {
                const content = this.highlightCode(line.slice(1), language);
                html += `<tr class="diff-context"><td class="line-num">${oldLine}</td><td class="line-num">${newLine}</td><td class="diff-line"><span class="hljs">${content}</span></td></tr>`;
                oldLine++;
                newLine++;
            } else if (line.length > 0) {
                const content = this.highlightCode(line, language);
                html += `<tr class="diff-context"><td class="line-num">${oldLine}</td><td class="line-num">${newLine}</td><td class="diff-line"><span class="hljs">${content}</span></td></tr>`;
                oldLine++;
                newLine++;
            }
        }
        html += '</table>';

        diffContent.innerHTML = html;
    },

    escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },

    getLanguageFromPath(path) {
        if (!path) return null;
        const clean = path.split('?')[0];
        const ext = clean.split('.').pop();
        if (!ext) return null;
        return this.languageMap[ext.toLowerCase()] || null;
    },

    highlightCode(code, language) {
        if (!code) return '';
        if (!window.hljs) {
            return this.escapeHtml(code);
        }

        if (language && window.hljs.getLanguage(language)) {
            return window.hljs.highlight(code, { language }).value;
        }

        return window.hljs.highlightAuto(code).value;
    },

    async openFile(filePath, fileName) {
        console.log('[DiffDrawer] openFile:', filePath);
        this.state.currentEventId = filePath;

        const pathEl = document.getElementById('diff-path');
        if (pathEl) pathEl.textContent = fileName;

        const badge = document.getElementById('diff-type-badge');
        if (badge) {
            badge.textContent = 'FILE';
            badge.className = 'badge badge-file';
        }

        const diffContent = document.getElementById('diff-content');
        if (!diffContent) return;

        try {
            const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
            if (!res.ok) {
                diffContent.innerHTML = '<div class="empty-state"><p>Could not load file</p></div>';
                return;
            }
            const data = await res.json();
            this.renderFile(data.content, fileName);
        } catch (e) {
            diffContent.innerHTML = '<div class="empty-state"><p>Error loading file</p></div>';
        }
    },

    renderFile(content, fileName) {
        const diffContent = document.getElementById('diff-content');
        if (!diffContent) return;

        diffContent.classList.add('flash');
        setTimeout(() => diffContent.classList.remove('flash'), 300);

        const language = this.getLanguageFromPath(fileName);
        const lines = this.highlightCode(content, language).split('\n');
        let html = '<table class="diff-table">';

        lines.forEach((line, idx) => {
            html += `<tr class="diff-context">
                <td class="line-num">${idx + 1}</td>
                <td class="line-num"></td>
                <td class="diff-line"><span class="hljs">${line}</span></td>
            </tr>`;
        });

        html += '</table>';
        diffContent.innerHTML = html;
    }
};
