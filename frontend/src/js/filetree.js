import { getFileIcon } from './icon-manager.js';

const FileTree = {
    state: {
        expanded: new Set(),
        selectedPath: null,
        data: [],
        filter: '',
        originalData: []
    },

    getIcon(node, isOpen) {
        return getFileIcon(node.name, node.type === 'directory', isOpen);
    },

    init() {
        this.container = document.getElementById('file-tree');
        this.createSearchBox();
        this.refresh();
    },

createSearchBox() {
    if (document.querySelector('.file-tree-search')) return;
    const searchDiv = document.createElement('div');
    searchDiv.className = 'file-tree-search';
    searchDiv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input type="text" id="file-search-input" placeholder="Filter files...">';
    this.container?.parentElement?.insertBefore(searchDiv, this.container);
    document.getElementById('file-search-input')?.addEventListener('input', (e) => { this.state.filter = e.target.value.toLowerCase(); this.render(); });
},
    async refresh() {
        try {
            const res = await fetch('/api/files');
            if (!res.ok) return;
            this.state.originalData = await res.json();
            this.render();
        } catch (e) { console.error('[FileTree] error:', e); }
    },

    toggleFolder(path) {
        if (this.state.expanded.has(path)) this.state.expanded.delete(path);
        else this.state.expanded.add(path);
        this.render();
    },

    selectFile(path, name) {
        this.state.selectedPath = path;
        this.render();
        window.DiffDrawer?.openFile(path, name);
    },

    filterData(nodes, filter) {
        if (!filter) return nodes;
        return nodes.reduce((r, node) => {
            if (node.name.toLowerCase().includes(filter)) r.push(node);
            else if (node.type === 'directory' && node.children) {
                const f = this.filterData(node.children, filter);
                if (f.length) r.push({...node, children: f});
            }
            return r;
        }, []);
    },

    render() {
        if (!this.container) return;
        const data = this.state.filter ? this.filterData(this.state.originalData, this.state.filter) : this.state.originalData;
        this.container.innerHTML = data.length ? this.renderNodes(data) : '<div class="empty-tree">No files found</div>';
    },

    renderNodes(nodes, level = 0) {
        return nodes.map(node => {
            const exp = this.state.expanded.has(node.path);
            const has = node.children?.length;
            
            let chev = '';
            if (node.type === 'directory') {
                const rot = exp ? 'rotate(90deg)' : '';
                chev = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="transform:${rot};transition:transform 0.2s"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
            }

            const safe = node.path.replace(/'/g, "\\'");
            const click = node.type === 'directory' ? `FileTree.toggleFolder('${safe}')` : `FileTree.selectFile('${safe}', '${node.name}')`;
            return `<div class="tree-node" style="padding-left:${level*12}px"><div class="tree-item ${this.state.selectedPath===node.path?'selected':''}" onclick="${click}"><span class="tree-chevron">${chev}</span><span class="tree-icon">${this.getIcon(node, exp)}</span><span class="tree-name">${node.name}</span></div>${node.type==='directory'&&exp&&has?this.renderNodes(node.children,level+1):''}</div>`;
        }).join('');
    }
};

window.FileTree = FileTree;

// File History Modal
const FileHistoryModal = {
    modal: null,

    init() {
        const div = document.createElement('div');
        div.id = 'file-history-modal';
        div.className = 'file-history-modal hidden';
        div.innerHTML = `
            <div class="history-backdrop"></div>
            <div class="history-container">
                <div class="history-header">
                    <h3>File History</h3>
                    <button class="history-close">&times;</button>
                </div>
                <div class="history-content"></div>
            </div>
        `;
        document.body.appendChild(div);
        this.modal = div;
        
        div.querySelector('.history-backdrop').addEventListener('click', () => this.close());
        div.querySelector('.history-close').addEventListener('click', () => this.close());
    },

    async open(filePath) {
        try {
            const res = await fetch(`/api/file/${encodeURIComponent(filePath)}/history`);
            const data = await res.json();
            this.render(data);
            this.modal.classList.remove('hidden');
        } catch (e) {
            console.error('File history error:', e);
        }
    },

    close() {
        this.modal.classList.add('hidden');
    },

    render(data) {
        const content = this.modal.querySelector('.history-content');
        if (!data.history?.length) {
            content.innerHTML = '<div class="history-empty">No history found</div>';
            return;
        }

        content.innerHTML = `
            <div class="history-file">${data.file}</div>
            <div class="history-list">
                ${data.history.map(h => `
                    <div class="history-item" data-id="${h.id}">
                        <span class="history-type ${h.type}">${h.type}</span>
                        <span class="history-time">${new Date(h.timestamp).toLocaleString()}</span>
                        <span class="history-lines">+${h.lines_added} -${h.lines_removed}</span>
                    </div>
                `).join('')}
            </div>
        `;

        content.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.id;
                window.Timeline?.selectEvent(id);
                this.close();
            });
        });
    }
};

window.FileHistoryModal = FileHistoryModal;
