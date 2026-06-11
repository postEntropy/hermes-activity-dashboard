const Stats = {
    elements: {},
    
    init() {
        const statEls = document.querySelectorAll('[data-stat]');
        statEls.forEach(el => {
            this.elements[el.dataset.stat] = el;
        });
        this.poll();
        setInterval(() => this.poll(), 2000);
    },

    async poll() {
        try {
            const res = await fetch('/api/stats');
            if (!res.ok) return;
            const data = await res.json();
            this.update(data);
        } catch (e) {
            console.error('Stats poll error:', e);
        }
    },

    update(data) {
        Object.keys(data).forEach(key => {
            const el = this.elements[key];
            if (el) {
                const newVal = key === 'duration_seconds' ? this.formatDuration(data[key]) : data[key];
                if (el.textContent !== String(newVal)) {
                    el.textContent = newVal;
                    this.animateValue(el);
                }
            }
        });
    },

    formatDuration(seconds) {
        if (seconds < 60) return seconds + 's';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    },

    animateValue(el) {
        // Simple highlight without layout shift
        el.style.transition = 'none';
        el.style.opacity = '0.7';
        setTimeout(() => {
            el.style.transition = 'opacity 0.3s ease';
            el.style.opacity = '1';
        }, 30);
    }
};

window.Stats = Stats;
