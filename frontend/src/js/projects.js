const Projects = {
    initialized: false,
    
    init() {
        if (this.initialized) return;
        this.initialized = true;
        
        this.container = document.getElementById('projects-list');
        this.dashboardView = document.getElementById('dashboard-view');
        this.projectsPage = document.getElementById('projects-page');
        
        this.bindEvents();
        this.loadProjects();
    },

    bindEvents() { },

    async loadProjects() {
        try {
            const res = await fetch('/api/projects');
            const data = await res.json();
            this.render(data.projects || [], data.active_projects || []);
        } catch (e) {
            console.error('Failed to load projects:', e);
        }
    },

    async addProject(path) {
        try {
            const res = await fetch('/api/set-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            const data = await res.json();
            this.loadProjects();
            return data;
        } catch (e) {
            console.error('Failed to add project:', e);
            return { error: 'Failed to add project' };
        }
    },

    async removeProject(path, e) {
        e.stopPropagation();
        if (!confirm('Remove this project?')) return;
        
        try {
            await fetch('/api/projects/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            this.loadProjects();
        } catch (e) {
            console.error('Failed to remove project:', e);
        }
    },

    openProject(path) {
        window.App?.setCurrentProject(path);
    },

    render(projects, activeProjects) {
        if (!this.container) return;
        
        if (!projects.length) {
            this.container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 60px 40px; color: var(--text-muted); background: rgba(0,0,0,0.02); border-radius: var(--radius-lg); border: 2px dashed rgba(0,0,0,0.05);">' +
                '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.5; margin-bottom: 16px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>' +
                '<h3 style="font-size: 1.25rem; font-weight: 700; color: var(--text-main); margin-bottom: 8px;">No projects being monitored</h3>' +
                '<p style="max-width: 400px; margin: 0 auto;">Click "Add Project" below to start tracking your codebase activity, seeing real-time diffs, and generating statistics.</p>' +
                '</div>';
            return;
        }

        this.container.innerHTML = projects.map(path => {
            const name = path.split('/').pop();
            return '<div class="project-card" onclick="Projects.openProject(\'' + path.replace(/'/g, "\\'") + '\')">' +
                '<button class="project-card-remove" onclick="Projects.removeProject(\'' + path.replace(/'/g, "\\'") + '\', event)">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
                '</button>' +
                '<div class="project-card-name">' + name + '</div>' +
                '<div class="project-card-path">' + path + '</div>' +
                '</div>';
        }).join('');
    },

    showDashboard() {
        if (this.projectsPage) this.projectsPage.classList.add('hidden');
        if (this.dashboardView) this.dashboardView.classList.remove('hidden');
    },

    showProjectsPage() {
        if (this.projectsPage) this.projectsPage.classList.remove('hidden');
        if (this.dashboardView) this.dashboardView.classList.add('hidden');
    }
};

window.Projects = Projects;