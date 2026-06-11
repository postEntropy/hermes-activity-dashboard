import { getFileIcon } from './icon-manager.js';

const Timeline = {
    state: {
        filter: 'all',
        events: [],
        renderedEventIds: new Set()
    },

    init() {
        this.container = document.getElementById('timeline');
        this.bindFilters();
        this.refresh();
        this.connectWebSocket();
        setInterval(() => this.refresh(), 5000);
    },

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        console.log('[WS] Connecting to:', wsUrl);
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => console.log('[WS] Connected!');
        ws.onerror = (e) => console.error('[WS] Error:', e);

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log('[WS] Received:', data.type, data.relative_path);

            if (!this.isEventForCurrentProject(data)) {
                return;
            }

            if (this.state.filter === 'all' || data.type === this.state.filter) {
                // Add new event to beginning
                this.state.events.unshift(data);
                if (this.state.events.length > 100) this.state.events.pop();

                // Only prepend the new item instead of full re-render
                this.prependEvent(data);

                const isAutoFollow = document.getElementById('auto-follow-check')?.checked;
                if (isAutoFollow && window.DiffDrawer) {
                    window.DiffDrawer.open(data.id);
                }

                // Auto-refresh FileTree on structural changes
                if (['created', 'deleted', 'moved'].includes(data.type) && window.FileTree) {
                    window.FileTree.refresh();
                }
            }
            if (window.Stats) window.Stats.poll();
        };

        ws.onclose = () => setTimeout(() => this.connectWebSocket(), 5000);
    },

    isEventForCurrentProject(event) {
        const current = window.App?.currentProject;
        if (!current) return false;

        if (event.project_path) {
            return event.project_path === current;
        }

        if (event.path) {
            return event.path === current || event.path.startsWith(`${current}/`);
        }

        return false;
    },

    bindFilters() {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.filter = btn.dataset.filter;
                this.refresh();
            });
        });
    },

    async refresh() {
        try {
            const filterParam = this.state.filter === 'all' ? '' : `&event_type=${this.state.filter}`;
            const res = await fetch(`/api/activities?limit=50${filterParam}`);
            if (!res.ok) return;
            const data = await res.json();

            const newEvents = data.activities || [];
            const newIds = new Set(newEvents.map(e => e.id));

            // Only re-render if the data actually changed
            const hasChanged = newEvents.length !== this.state.events.length ||
                newEvents.some((e, i) => !this.state.events[i] || e.id !== this.state.events[i].id);

            if (hasChanged) {
                this.state.events = newEvents;
                this.render();
            }
        } catch (e) {
            console.error('Timeline refresh error:', e);
        }
    },

    prependEvent(event) {
        if (!this.container) return;

        // Remove empty state if present
        const emptyState = this.container.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }

        // Check if event already exists
        if (this.state.renderedEventIds.has(event.id)) return;

        const html = this.renderItem(event);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const newItem = tempDiv.firstElementChild;

        if (newItem) {
            newItem.style.opacity = '0';
            newItem.style.transform = 'translateX(-10px)';
            this.container.insertBefore(newItem, this.container.firstChild);

            // Trigger animation
            requestAnimationFrame(() => {
                newItem.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                newItem.style.opacity = '1';
                newItem.style.transform = 'translateX(0)';
            });

            this.state.renderedEventIds.add(event.id);

            // Keep rendered IDs in sync with current events
            const currentIds = new Set(this.state.events.map(e => e.id));
            this.state.renderedEventIds = new Set(
                [...this.state.renderedEventIds].filter(id => currentIds.has(id))
            );

            // Remove excess DOM elements (keep max 50 visible)
            while (this.container.children.length > 50) {
                this.container.removeChild(this.container.lastChild);
            }
        }
    },

    render() {
        if (!this.container) return;

        this.state.renderedEventIds = new Set(this.state.events.map(e => e.id));

        if (this.state.events.length === 0) {
            this.container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    </div>
                    <h3>Waiting for Activity</h3>
                    <p>Start editing files in your project to see real-time updates appearing here.</p>
                </div>
            `;
            return;
        }

        const fragment = document.createDocumentFragment();
        this.state.events.forEach(evt => {
            const div = document.createElement('div');
            div.innerHTML = this.renderItem(evt);
            const item = div.firstElementChild;
            if (item) fragment.appendChild(item);
        });

        this.container.innerHTML = '';
        this.container.appendChild(fragment);
    },

    renderItem(evt) {
        const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const path = evt.relative_path || (evt.path ? evt.path.split('/').pop() : 'unknown');
        const isActive = window.DiffDrawer && window.DiffDrawer.state.currentEventId === evt.id;
        const added = evt.lines_added ? `<span style="color:#00ff88;font-weight:600;font-size:0.75rem">+${evt.lines_added}</span>` : '';
        const removed = evt.lines_removed ? `<span style="color:#ff3355;font-weight:600;font-size:0.75rem">-${evt.lines_removed}</span>` : '';

        const actionIcons = {
            modified: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`,
            created: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
            deleted: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`
        };

        return `
            <div class="timeline-item ${isActive ? 'active' : ''}" data-id="${evt.id}" onclick="window.DiffDrawer?.open('${evt.id}')" style="cursor:pointer">
                <div class="item-time mono">${time}</div>
                <div class="item-content">
                    <span class="badge badge-${evt.type}" style="margin-right:8px; display:flex; align-items:center; gap:4px">
                        ${actionIcons[evt.type] || ''}
                        ${evt.type}
                    </span>
                    <span class="item-path mono">${path}</span>
                    ${added || removed ? `<span style="margin-left:8px">${added}${added && removed ? ' ' : ''}${removed}</span>` : ''}
                </div>
            </div>
        `;
    }
};

window.Timeline = Timeline;
