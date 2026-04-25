"""
Hermes Activity Dashboard — Monitoramento independente de projetos.
Roda como servidor standalone, observando modificações em uma pasta.
"""

import argparse
import asyncio
import json
import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi import BackgroundTasks
from starlette.middleware.cors import CORSMiddleware

# ── Watchdog (observer de arquivos) ──────────────────────────────────────────
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler, FileModifiedEvent, FileCreatedEvent, FileDeletedEvent, FileMovedEvent
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False
    print("⚠️  watchdog não instalado. Instale com: pip install watchdog")

# ── Config ────────────────────────────────────────────────────────────────────
LOG_PATH = Path.home() / ".hermes" / "activity-dashboard" / "activity.log"
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

# ── Estado Global ─────────────────────────────────────────────────────────────
_project_path: Optional[Path] = None
_observer: Optional[Observer] = None
_connected_clients: List[WebSocket] = []
_activity_buffer: List[Dict[str, Any]] = []  # buffer de eventos recentes (em memória)
_MAX_BUFFER = 5000  # mantém últimos 5000 eventos

# ── File Event Handler ─────────────────────────────────────────────────────────
class ProjectEventHandler(FileSystemEventHandler):
    """Captura modificações na pasta do projeto e gera eventos."""

    def __init__(self, project_path: Path):
        self.project_path = project_path.resolve()
        self._last_event_time = {}
        self._debounce_sec = 0.3

    def _is_relevant(self, path: str) -> bool:
        """Filtra arquivos que devem ser monitorados."""
        p = Path(path)
        if not p.is_relative_to(self.project_path):
            return False
        # Ignora pastas comuns que não são código
        ignore_dirs = {'.git', '__pycache__', 'node_modules', '.venv', 'venv', 'dist', 'build', '.next', '.cache', 'temp', 'tmp'}
        if any(part in ignore_dirs for part in p.parts):
            return False
        # Extensões de código
        code_exts = {'.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.scss', '.json', '.yaml', '.yml', '.md', '.txt', '.sh', '.bash', '.zsh', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt'}
        return p.suffix in code_exts or p.name in {'Dockerfile', 'Makefile', 'docker-compose.yml', 'docker-compose.yaml'}

    def _should_debounce(self, path: str) -> bool:
        now = time.time()
        last = self._last_event_time.get(path, 0)
        if now - last < self._debounce_sec:
            return True
        self._last_event_time[path] = now
        return False

    def _log_event(self, event_type: str, src_path: str, dest_path: Optional[str] = None, extra: Optional[Dict] = None):
        if not self._is_relevant(src_path):
            return
        if self._should_debounce(src_path):
            return

        abs_src = os.path.abspath(src_path)
        event = {
            "id": str(uuid4()),
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "type": event_type,
            "path": abs_src,
            "relative_path": os.path.relpath(abs_src, self.project_path),
        }
        if dest_path:
            event["dest_path"] = os.path.abspath(dest_path)
        if extra:
            event.update(extra)

        # Salva no log
        try:
            LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(LOG_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps(event, ensure_ascii=False) + "\n")
        except Exception:
            pass

        # Adiciona ao buffer
        _activity_buffer.insert(0, event)
        if len(_activity_buffer) > _MAX_BUFFER:
            _activity_buffer.pop()

        # Notifica clientes WebSocket
        asyncio.create_task(broadcast_event(event))

    def on_modified(self, event):
        if not event.is_directory:
            self._log_event("modified", event.src_path)

    def on_created(self, event):
        if not event.is_directory:
            self._log_event("created", event.src_path)

    def on_deleted(self, event):
        if not event.is_directory:
            self._log_event("deleted", event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self._log_event("moved", event.src_path, dest_path=event.dest_path)


# ── Diff Calculation ───────────────────────────────────────────────────────────
def calculate_diff(path: str, event_type: str) -> Dict[str, Any]:
    """Calcula diff para arquivos modificados/criados."""
    if event_type not in ("modified", "created", "moved"):
        return {"lines_added": 0, "lines_removed": 0, "diff": "", "size_bytes": 0}

    if not os.path.exists(path):
        return {"lines_added": 0, "lines_removed": 0, "diff": "", "size_bytes": 0}

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        lines = content.splitlines()
        return {
            "lines_added": len(lines),
            "lines_removed": 0,
            "diff": content[:3000],  # preview do conteúdo
            "size_bytes": len(content.encode("utf-8")),
        }
    except Exception:
        return {"lines_added": 0, "lines_removed": 0, "diff": "", "size_bytes": 0}


# ── WebSocket Broadcast ────────────────────────────────────────────────────────
async def broadcast_event(event: Dict[str, Any]):
    """Envia evento para todos os clientes conectados."""
    message = json.dumps(event)
    dead_clients = []
    for ws in _connected_clients:
        try:
            await ws.send_text(message)
        except Exception:
            dead_clients.append(ws)
    for ws in dead_clients:
        _connected_clients.remove(ws)


# ── FastAPI App ────────────────────────────────────────────────────────────────
app = FastAPI(title="Hermes Activity Dashboard", docs_url="/docs", redoc_url="/redoc")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

templates = Jinja2Templates(directory=str(Path(__file__).parent / "frontend"))


# ── Routes ─────────────────────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/status")
async def api_status():
    """Status do observer e informações da sessão."""
    return JSONResponse({
        "project_path": str(_project_path) if _project_path else None,
        "observer_running": _observer is not None and _observer.is_alive(),
        "events_in_buffer": len(_activity_buffer),
        "total_events": len(_activity_buffer),
        "uptime_seconds": int(time.time() - _start_time) if '_start_time' in globals() else 0,
    })


@app.get("/api/activities")
async def api_activities(limit: int = 50, offset: int = 0, event_type: Optional[str] = None):
    """Lista de atividades."""
    events = _activity_buffer.copy()
    if event_type and event_type != 'all':
        events = [e for e in events if e.get('type') == event_type]
    total = len(events)
    page = events[offset: offset + limit]
    # Já estamos em ordem decrescente (novo primeiro)
    return JSONResponse({"activities": page, "total": total, "limit": limit, "offset": offset})


@app.get("/api/stats")
async def api_stats():
    """Estatísticas agregadas."""
    events = _activity_buffer
    if not events:
        return JSONResponse({
            "total_events": 0, "files_modified": 0, "lines_added": 0, "lines_removed": 0,
            "net_lines": 0, "duration_seconds": 0, "event_breakdown": {}
        })

    first_ts = datetime.fromisoformat(events[-1]["timestamp"])
    last_ts = datetime.fromisoformat(events[0]["timestamp"])
    duration = (last_ts - first_ts).total_seconds()

    files_modified = set()
    total_added = 0
    total_removed = 0
    event_counts = {}

    for evt in events:
        if evt.get("path"):
            files_modified.add(evt["path"])
        total_added += evt.get("lines_added", 0)
        total_removed += evt.get("lines_removed", 0)
        event_counts[evt["type"]] = event_counts.get(evt["type"], 0) + 1

    return JSONResponse({
        "total_events": len(events),
        "files_modified": len(files_modified),
        "lines_added": total_added,
        "lines_removed": total_removed,
        "net_lines": total_added - total_removed,
        "duration_seconds": round(duration, 1),
        "event_breakdown": event_counts,
    })


@app.get("/api/event/{event_id}")
async def api_event_detail(event_id: str):
    """Detalhes de um evento específico (com diff)."""
    for evt in _activity_buffer:
        if evt.get("id") == event_id:
            diff_info = calculate_diff(evt["path"], evt["type"])
            return JSONResponse({
                "event": evt,
                "diff": diff_info["diff"],
                "lines_added": diff_info["lines_added"],
                "lines_removed": diff_info["lines_removed"],
                "size_bytes": diff_info["size_bytes"],
            })
    return JSONResponse({"error": "Evento não encontrado"}, status_code=404)


@app.post("/api/set-project")
async def api_set_project(path: str):
    """Define a pasta do projeto a ser monitorada."""
    global _project_path, _observer
    p = Path(path).expanduser().resolve()
    if not p.exists() or not p.is_dir():
        return JSONResponse({"error": "Pasta não existe"}, status_code=400)

    # Para observer anterior
    if _observer:
        _observer.stop()
        _observer.join()
        _observer = None

    # Inicia novo observer
    _project_path = p
    if WATCHDOG_AVAILABLE:
        event_handler = ProjectEventHandler(p)
        _observer = Observer()
        _observer.schedule(event_handler, str(p), recursive=True)
        _observer.start()
        print(f"👀 Observando: {p}")
    else:
        print("⚠️  watchdog não disponível — observer não iniciado")

    return JSONResponse({"status": "ok", "project_path": str(p), "observer": WATCHDOG_AVAILABLE})


@app.post("/api/reset")
async def api_reset():
    """Reseta o log e buffer."""
    global _activity_buffer
    try:
        if LOG_PATH.exists():
            LOG_PATH.unlink()
    except Exception:
        pass
    _activity_buffer.clear()
    return JSONResponse({"status": "ok", "message": "Log resetado"})


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket para eventos em tempo real."""
    await websocket.accept()
    _connected_clients.append(websocket)
    try:
        while True:
            # Mantém conexão viva
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        _connected_clients.remove(websocket)


# ── Server Management ─────────────────────────────────────────────────────────
_server: Optional[uvicorn.Server] = None
_server_thread: Optional[threading.Thread] = None
_start_time = time.time()


def start_server(host: str = "127.0.0.1", port: int = 8000, project_path: Optional[str] = None) -> Dict[str, Any]:
    """Inicia servidor em background."""
    global _server_thread, _start_time

    # Configura projeto se fornecido
    if project_path:
        asyncio.run(api_set_project(project_path))

    _start_time = time.time()
    config = uvicorn.Config(app=app, host=host, port=port, log_level="warning")
    _server = uvicorn.Server(config)
    _server_thread = threading.Thread(target=lambda: asyncio.run(_server.serve()), daemon=True)
    _server_thread.start()
    time.sleep(1)
    return {"status": "started", "url": f"http://{host}:{port}", "project": project_path}


def stop_server() -> Dict[str, Any]:
    global _observer, _server_thread
    if _observer:
        _observer.stop()
        _observer.join()
        _observer = None
    # O servidor uvicorn será finalizado ao encerrar o processo
    _server_thread = None
    return {"status": "stopped"}


def is_running() -> bool:
    return _server_thread is not None and _server_thread.is_alive()


# ── CLI ─────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Hermes Activity Dashboard — Monitoramento de projetos")
    parser.add_argument("--project", "-p", type=str, help="Caminho da pasta do projeto")
    parser.add_argument("--host", default="127.0.0.1", help="Host (padrão: 127.0.0.1)")
    parser.add_argument("--port", "-P", type=int, default=8000, help="Porta (padrão: 8000)")
    parser.add_argument("--reload", action="store_true", help="Auto-reload (desenvolvimento)")
    args = parser.parse_args()

    print("🚀 Hermes Activity Dashboard")
    print(f"   URL: http://{args.host}:{args.port}")
    if args.project:
        print(f"   Projeto: {args.project}")
    print("   Pressione Ctrl+C para parar\n")

    # Inicia observer se projeto fornecido
    if args.project:
        p = Path(args.project).expanduser().resolve()
        if p.exists():
            asyncio.run(api_set_project(str(p)))

    uvicorn.run(app, host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
