const Search = {
    modal: null,
    input: null,
    results: null,

    init() {
        this.createModal();
        this.bindShortcuts();
    },

createModal() {
        const modal = document.createElement('div');
        modal.id = 'search-modal';
        modal.className = 'search-modal hidden';
        
        const backdrop = document.createElement('div');
        backdrop.className = 'search-backdrop';
        
        const container = document.createElement('div');
        container.className = 'search-container';
        
        const header = document.createElement('div');
        header.className = 'search-header';
        header.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg><input type="text" id="search-input" placeholder="Search files and events..." autocomplete="off"><kbd>ESC</kbd>';
        
        const results = document.createElement('div');
        results.id = 'search-results';
        results.className = 'search-results';
        results.innerHTML = '<div class="search-empty">Type to search...</div>';
        
        container.appendChild(header);
        container.appendChild(results);
        modal.appendChild(backdrop);
        modal.appendChild(container);
        document.body.appendChild(modal);

        this.modal = modal;
        this.input = document.getElementById('search-input');
        this.results = results;
        this.backdrop = backdrop;

        this.bindEvents();
    },

    bindEvents() {
        this.input.addEventListener('input', (e) => this.handleSearch(e.target.value));
        this.backdrop.addEventListener('click', () => this.close());
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.close();
        });
    },

    bindShortcuts() {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.open();
            }
        });
    },

    open() {
        this.modal.classList.remove('hidden');
        this.input.focus();
    },

    close() {
        this.modal.classList.add('hidden');
        this.input.value = '';
        this.results.innerHTML = '<div class="search-empty">Type to search...</div>';
    },

    async handleSearch(query) {
        if (!query || query.length < 2) {
            this.results.innerHTML = '<div class="search-empty">Type at least 2 characters...</div>';
            return;
        }

        try {
            const url = '/api/search?q=' + encodeURIComponent(query) + '&limit=10';
            const res = await fetch(url);
            const data = await res.json();
            this.renderResults(data);
        } catch (e) {
            console.error('Search error:', e);
        }
    },

    renderResults(data) {
        let html = '';

        if (data.files?.length) {
            html += '<div class="search-group"><div class="search-group-title">Files</div>';
            data.files.forEach(f => {
                const name = f.path.split('/').pop();
                html += '<div class="search-item" data-path="' + f.path + '">';
                html += '<span class="search-icon">&#128196;</span>';
                html += '<span class="search-path">' + name + '</span>';
                html += '<span class="search-fullpath">' + f.path + '</span>';
                html += '</div>';
            });
            html += '</div>';
        }

        if (data.events?.length) {
            html += '<div class="search-group"><div class="search-group-title">Events</div>';
            data.events.forEach(e => {
                const time = this.formatTime(e.timestamp);
                const name = e.relative_path || e.path.split('/').pop();
                html += '<div class="search-item" data-id="' + e.id + '">';
                html += '<span class="search-icon">' + this.getTypeIcon(e.type) + '</span>';
                html += '<span class="search-path">' + name + '</span>';
                html += '<span class="search-time">' + time + '</span>';
                html += '</div>';
            });
            html += '</div>';
        }

        if (!html) {
            html = '<div class="search-empty">No results found</div>';
        }

        this.results.innerHTML = html;

        this.results.querySelectorAll('.search-item').forEach(item => {
            item.addEventListener('click', () => {
                if (item.dataset.id) {
                    this.selectEvent(item.dataset.id);
                } else if (item.dataset.path) {
                    this.selectFile(item.dataset.path);
                }
            });
        });
    },

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return date.toLocaleDateString();
    },

    getTypeIcon(type) {
        const icons = { created: '&#10024;', modified: '&#128221;', deleted: '&#128465;', moved: '&#10140;' };
        return icons[type] || '&#128196;';
    },

    selectEvent(id) {
        this.close();
        window.Timeline?.selectEvent(id);
    },

    selectFile(path) {
        this.close();
        window.FileTree?.selectFile(path);
    }
};

window.Search = Search;