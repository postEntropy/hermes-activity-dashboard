// Hermes Activity Dashboard — Main Application
const App = {
    currentProject: null,
    
    init() {
        console.log('App init');
        Projects.init();
        this.checkProjects();
        this.bindEvents();
    },

    async checkProjects() {
        try {
            const res = await fetch('/api/projects');
            const data = await res.json();
            const preferred = data.last_project || data.projects?.[0];
            if (preferred) {
                this.showDashboard(preferred);
            }
        } catch (e) {}
    },

    showDashboard(projectPath) {
        this.currentProject = projectPath;
        if (window.Projects) window.Projects.showDashboard();
        
        if (window.FileTree) window.FileTree.init();
        if (window.Stats) window.Stats.init();
        if (window.Timeline) window.Timeline.init();
        if (window.Search) window.Search.init();
        
        this.updateProjectUI(projectPath);
    },

    bindEvents() {
        // Theme toggle
        const themeBtns = document.querySelectorAll('.theme-toggle-btn');
        const sunIcons = document.querySelectorAll('.sun-icon');
        const moonIcons = document.querySelectorAll('.moon-icon');
        
        const setTheme = (isLight) => {
            if (isLight) {
                document.body.setAttribute('data-theme', 'light');
                sunIcons.forEach(icon => icon.style.display = 'block');
                moonIcons.forEach(icon => icon.style.display = 'none');
                localStorage.setItem('theme', 'light');
            } else {
                document.body.removeAttribute('data-theme');
                sunIcons.forEach(icon => icon.style.display = 'none');
                moonIcons.forEach(icon => icon.style.display = 'block');
                localStorage.setItem('theme', 'dark');
            }
        };
        
        if (localStorage.getItem('theme') === 'light') {
            setTheme(true);
        }
        
        themeBtns.forEach(btn => {
            btn.onclick = () => {
                const isLight = document.body.getAttribute('data-theme') === 'light';
                setTheme(!isLight);
            };
        });

        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
                this.closeBrowserModal();
            }
        });

        const input = document.getElementById('project-path-input');
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.setProject();
            });
        }
        
        const addProjectBtn = document.getElementById('add-project-btn');
        if (addProjectBtn) addProjectBtn.onclick = () => this.openProjectModal();

        const browseBtn = document.getElementById('browse-project-btn');
        if (browseBtn) browseBtn.onclick = () => this.openBrowserModal();

        const cancelBtn = document.getElementById('cancel-project-btn');
        if (cancelBtn) cancelBtn.onclick = () => this.closeModal();

        const confirmBtn = document.getElementById('confirm-project-btn');
        if (confirmBtn) confirmBtn.onclick = () => this.setProject();

        // Back to projects
        const sidebarLogo = document.querySelector('.sidebar .logo');
        if (sidebarLogo) {
            sidebarLogo.style.cursor = 'pointer';
            sidebarLogo.title = 'Back to Projects';
            sidebarLogo.onclick = () => {
                if (window.Projects) window.Projects.showProjectsPage();
            };
        }
    },

    openProjectModal() {
        console.log('[App] Opening modal');
        const modal = document.getElementById('project-modal');
        const error = document.getElementById('project-error');
        if (modal) modal.classList.add('open');
        if (error) error.textContent = '';
        
        const input = document.getElementById('project-path-input');
        if (input) {
            input.value = '';
            input.focus();
        }
    },

    closeModal() {
        const modal = document.getElementById('project-modal');
        if (modal) modal.classList.remove('open');
    },

    async browseDirectory(path = '') {
        try {
            const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.error) {
                console.error('Browse error:', data.error);
                return;
            }
            
            this.currentBrowserPath = data.current_path;
            const pathEl = document.getElementById('fs-current-path');
            if (pathEl) pathEl.textContent = data.current_path;
            
            const listEl = document.getElementById('fs-browser-list');
            if (!listEl) return;
            
            let html = '';
            if (data.parent_path) {
                html += `<div class="fs-item" onclick="window.App.browseDirectory('${data.parent_path.replace(/\\/g, '\\\\')}')" style="padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid rgba(0,0,0,0.05); font-family: var(--font-mono); font-size: 0.85rem;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    .. (Parent Directory)
                </div>`;
            }
            
            if (data.directories && data.directories.length) {
                data.directories.forEach(dir => {
                    const fullPath = data.current_path === '/' ? `/${dir}` : `${data.current_path}/${dir}`;
                    html += `<div class="fs-item" onclick="window.App.browseDirectory('${fullPath.replace(/\\/g, '\\\\')}')" onmouseover="this.style.background='rgba(99,102,241,0.05)'" onmouseout="this.style.background='transparent'" style="padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid rgba(0,0,0,0.05); font-family: var(--font-mono); font-size: 0.85rem; transition: background 0.1s;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                        ${dir}
                    </div>`;
                });
            } else {
                html += `<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No folders found</div>`;
            }
            
            listEl.innerHTML = html;
            
        } catch (e) {
            console.error('Failed to browse', e);
        }
    },

    openBrowserModal() {
        const modal = document.getElementById('fs-browser-modal');
        if (modal) modal.style.display = 'block';
        this.browseDirectory(''); // Root/Home
    },

    closeBrowserModal() {
        const modal = document.getElementById('fs-browser-modal');
        if (modal) modal.style.display = 'none';
    },
    
    confirmBrowserSelection() {
        const modal = document.getElementById('fs-browser-modal');
        if (modal) modal.style.display = 'none';
        const input = document.getElementById('project-path-input');
        if (input && this.currentBrowserPath) {
            input.value = this.currentBrowserPath;
            input.focus();
        }
    },

    async setProject() {
        const path = document.getElementById('project-path-input').value.trim();
        if (!path) return;

        const btn = document.getElementById('confirm-project-btn');
        const error = document.getElementById('project-error');
        
        btn.textContent = 'Adding...';
        btn.disabled = true;
        if (error) error.textContent = '';

        try {
            const res = await fetch('/api/set-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            const data = await res.json();
            
            if (res.ok) {
                this.closeModal();
                if (window.Projects) window.Projects.loadProjects();
                this.showDashboard(path);
            } else {
                if (error) error.textContent = data.error || 'Invalid path';
            }
        } catch (e) {
            if (error) error.textContent = 'Connection error';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Add Project';
        }
    },

    updateProjectUI(path) {
        const name = path.split('/').pop() || path;
        const el = document.getElementById('project-name');
        if (el) el.textContent = name;
    },

    async setCurrentProject(path) {
        try {
            await fetch('/api/set-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            this.showDashboard(path);
        } catch (e) {
            console.error('Failed to switch project on backend', e);
        }
    }
};

window.App = App;

// Auto init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}