const Charts = {
    charts: {},
    pollInterval: null,

    init() {
        this.createChartElements();
        this.loadChartJS().then(() => {
            this.initCharts();
            this.startPolling();
        }).catch(e => console.error('Charts init error:', e));
    },

    async loadChartJS() {
        if (window.Chart) return;
        
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
            script.onload = resolve;
            document.head.appendChild(script);
        });
    },

    createChartElements() {
        const contentArea = document.querySelector('.content-area');
        if (!contentArea) return;

        const chartsContainer = document.createElement('div');
        chartsContainer.className = 'charts-container';
        chartsContainer.innerHTML = '<div class="chart-card"><h3>Lines Over Time</h3><canvas id="lines-chart"></canvas></div><div class="chart-card"><h3>Languages</h3><canvas id="languages-chart"></canvas></div><div class="chart-card wide"><h3>Top Modified Files</h3><canvas id="top-files-chart"></canvas></div>';
        
        contentArea.parentNode.insertBefore(chartsContainer, contentArea.nextSibling);
    },

    initCharts() {
        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#888' }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#666' },
                    grid: { color: '#333' }
                },
                y: {
                    ticks: { color: '#666' },
                    grid: { color: '#333' }
                }
            }
        };

        this.charts.lines = new Chart(document.getElementById('lines-chart'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'Lines Added', data: [], borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.1)', fill: true },
                    { label: 'Lines Removed', data: [], borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.1)', fill: true }
                ]
            },
            options: chartOptions
        });

        this.charts.languages = new Chart(document.getElementById('languages-chart'), {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#f87171']
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom', labels: { color: '#888' } } }
            }
        });

        this.charts.topFiles = new Chart(document.getElementById('top-files-chart'), {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{ label: 'Modifications', data: [], backgroundColor: '#60a5fa' }]
            },
            options: {
                ...chartOptions,
                indexAxis: 'y'
            }
        });
    },

    async fetchStats() {
        try {
            const res = await fetch('/api/stats/advanced');
            return await res.json();
        } catch (e) {
            console.error('Failed to fetch stats:', e);
            return null;
        }
    },

    async updateCharts() {
        const stats = await this.fetchStats();
        if (!stats) return;

        if (stats.daily_stats) {
            this.charts.lines.data.labels = stats.daily_stats.map(d => d.date.slice(5));
            this.charts.lines.data.datasets[0].data = stats.daily_stats.map(d => d.lines_added || 0);
            this.charts.lines.data.datasets[1].data = stats.daily_stats.map(d => d.lines_removed || 0);
            this.charts.lines.update();
        }

        if (stats.language_breakdown) {
            const top5 = stats.language_breakdown.slice(0, 5);
            this.charts.languages.data.labels = top5.map(l => '.' + l.extension);
            this.charts.languages.data.datasets[0].data = top5.map(l => l.count);
            this.charts.languages.update();
        }

        if (stats.top_files) {
            const top5 = stats.top_files.slice(0, 5);
            this.charts.topFiles.data.labels = top5.map(f => f.path.split('/').pop());
            this.charts.topFiles.data.datasets[0].data = top5.map(f => f.count);
            this.charts.topFiles.update();
        }
    },

    startPolling() {
        this.updateCharts();
        this.pollInterval = setInterval(() => this.updateCharts(), 30000);
    },

    destroy() {
        if (this.pollInterval) clearInterval(this.pollInterval);
        Object.values(this.charts).forEach(chart => chart?.destroy());
    }
};

window.Charts = Charts;