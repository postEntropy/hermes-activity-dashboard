"""
Hermes Activity Dashboard — Monitoramento independente de projetos.
Roda como servidor standalone, observando modificações em uma pasta.
Test change to verify dashboard is working.
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
import subprocess
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Body
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

import database

# ── Watchdog (observer de arquivos) ──────────────────────────────────────────
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler, FileModifiedEvent, FileCreatedEvent, FileDeletedEvent, FileMovedEvent
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False
    Observer = None  # type: ignore
    print("⚠️  watchdog não instalado. Instale com: pip install watchdog")

# ── Config ────────────────────────────────────────────────────────────────────
LOG_PATH = Path(__file__).parent / "activity.log"
SETTINGS_PATH = Path(__file__).parent / "settings.json"
MAX_FILE_SIZE = 500 * 1024  # 500KB limit for diffs and file previews

def save_settings(settings: dict):
    try:
        with open(SETTINGS_PATH, "w") as f:
            json.dump(settings, f, indent=2)
    except Exception:
        pass

def load_settings() -> dict:
    try:
        if SETTINGS_PATH.exists():
            with open(SETTINGS_PATH, "r") as f:
                return json.load(f)
    except Exception:
        pass
    return {"projects": [], "active_projects": []}

def add_project(path: str):
    settings = load_settings()
    if "projects" not in settings:
        settings["projects"] = []
    if path not in settings["projects"]:
        settings["projects"].append(path)
    if "active_projects" not in settings:
        settings["active_projects"] = []
    if path not in settings["active_projects"]:
        settings["active_projects"].append(path)
    save_settings(settings)
    return settings

def remove_project(path: str):
    settings = load_settings()
    if "projects" in settings and path in settings["projects"]:
        settings["projects"].remove(path)
    if "active_projects" in settings and path in settings["active_projects"]:
        settings["active_projects"].remove(path)
    save_settings(settings)
    return settings

def get_active_projects():
    settings = load_settings()
    return settings.get("active_projects", [])

def set_active_projects(paths: list):
    settings = load_settings()
    settings["active_projects"] = paths
    save_settings(settings)
    return settings

import difflib

# ── Estado Global ─────────────────────────────────────────────────────────────
_project_path: Optional[Path] = None
_observers: Dict[Path, Any] = {}  # Multiple observers for multiple projects
_connected_clients: List[WebSocket] = []
_activity_buffer: List[Dict[str, Any]] = []
_MAX_BUFFER = 5000
_loop: Optional[asyncio.AbstractEventLoop] = None
_file_cache: Dict[str, List[str]] = {} # Cache para calcular diffs

def _current_project_path() -> Optional[str]:
    return str(_project_path) if _project_path else None

def _infer_project_path(file_path: str, projects: List[str]) -> Optional[str]:
    best_match = None
    for project in projects:
        resolved = str(Path(project).expanduser().resolve())
        if file_path == resolved or file_path.startswith(resolved + os.sep):
            if not best_match or len(resolved) > len(best_match):
                best_match = resolved
    return best_match

def _event_matches_project(event: Dict[str, Any], project_path: str) -> bool:
    event_project = event.get("project_path")
    if event_project:
        return event_project == project_path
    event_path = event.get("path")
    if not event_path:
        return False
    return event_path == project_path or event_path.startswith(project_path + os.sep)

def _filter_events_for_current_project(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    current = _current_project_path()
    if not current:
        return []
    return [evt for evt in events if _event_matches_project(evt, current)]

def _path_within_project(abs_path: str, abs_project: str) -> bool:
    try:
        return os.path.commonpath([abs_path, abs_project]) == abs_project
    except ValueError:
        return False

def _cache_file_contents(path: str) -> int:
    try:
        if not os.path.exists(path):
            return 0

        size_bytes = os.path.getsize(path)
        if size_bytes > MAX_FILE_SIZE:
            return size_bytes

        with open(path, "r", encoding="utf-8", errors="replace") as f:
            _file_cache[path] = f.readlines()
        return size_bytes
    except Exception:
        return 0

def _prepopulate_cache(project_path: Path):
    try:
        ignore_dirs = {'.git', '__pycache__', 'node_modules', '.venv', 'venv', 'dist', 'build', '.next', '.cache'}
        code_exts = {'.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.scss', '.json', '.yaml', '.yml', '.md', '.txt', '.sh', '.bash', '.zsh', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt'}
        valid_names = {'Dockerfile', 'Makefile', 'docker-compose.yml', 'docker-compose.yaml'}
        
        for root, dirs, files in os.walk(project_path):
            dirs[:] = [d for d in dirs if d not in ignore_dirs]
            for file in files:
                p = Path(root) / file
                if p.suffix in code_exts or p.name in valid_names:
                    _cache_file_contents(str(p))
    except Exception as e:
        print(f"Error prepopulating cache for {project_path}: {e}")

def _get_cached_line_count(path: str) -> int:
    return len(_file_cache.get(path, []))

def _build_moved_diff(src_path: str, dest_path: Optional[str]) -> Dict[str, Any]:
    removed_lines = _get_cached_line_count(src_path)
    _file_cache.pop(src_path, None)
    size_bytes = 0
    added_lines = 0
    if dest_path:
        size_bytes = _cache_file_contents(dest_path)
        added_lines = _get_cached_line_count(dest_path)
    return {
        "lines_added": added_lines,
        "lines_removed": removed_lines,
        "diff": "File moved.",
        "size_bytes": size_bytes,
    }

# ── File Event Handler (só se watchdog disponível) ───────────────────────────
if WATCHDOG_AVAILABLE:
    class ProjectEventHandler(FileSystemEventHandler):
        """Captura modificações na pasta do projeto e gera eventos."""

        def __init__(self, project_path: Path):
            self.project_path = project_path.resolve()
            self._last_event_time = {}
            self._debounce_sec = 0.3

        def _is_relevant(self, path: str) -> bool:
            try:
                abs_path = os.path.abspath(path)
                abs_project = os.path.abspath(self.project_path)
                
                if not _path_within_project(abs_path, abs_project):
                    return False
                
                p = Path(abs_path)
                # Pastas comuns que geralmente não queremos monitorar
                ignore_dirs = {'.git', '__pycache__', 'node_modules', '.venv', 'venv', 'dist', 'build', '.next', '.cache'}
                if any(part in ignore_dirs for part in p.parts):
                    return False
                
                code_exts = {'.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.scss', '.json', '.yaml', '.yml', '.md', '.txt', '.sh', '.bash', '.zsh', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt'}
                return p.suffix in code_exts or p.name in {'Dockerfile', 'Makefile', 'docker-compose.yml', 'docker-compose.yaml'}
            except Exception as e:
                print(f"Error in _is_relevant: {e}")
                return False

        def _should_debounce(self, path: str) -> bool:
            now = time.time()
            last = self._last_event_time.get(path, 0)
            if now - last < self._debounce_sec:
                return True
            self._last_event_time[path] = now
            return False

        def _log_event(self, event_type: str, src_path: str, dest_path: Optional[str] = None, extra: Optional[Dict] = None):
            is_moved = event_type == "moved"
            relevant_src = self._is_relevant(src_path)
            relevant_dest = self._is_relevant(dest_path) if dest_path else False

            if is_moved:
                if not (relevant_src or relevant_dest):
                    return
            else:
                if not relevant_src:
                    return

            debounce_key = dest_path if is_moved and relevant_dest and not relevant_src else src_path
            if debounce_key and self._should_debounce(debounce_key):
                return

            print(f"🔔 Evento: {event_type} em {src_path}")
            
            abs_src = os.path.abspath(src_path)
            abs_dest = os.path.abspath(dest_path) if dest_path else None
            event_path = abs_dest if is_moved and relevant_dest and abs_dest else abs_src

            if is_moved:
                diff_info = _build_moved_diff(abs_src, abs_dest if relevant_dest else None)
            else:
                diff_info = calculate_diff(abs_src, event_type)
            
            event = {
                "id": str(uuid4()),
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "type": event_type,
                "path": event_path,
                "relative_path": os.path.relpath(event_path, self.project_path),
                "project_path": str(self.project_path),
                "lines_added": diff_info["lines_added"],
                "lines_removed": diff_info["lines_removed"],
                "size_bytes": diff_info["size_bytes"],
                "diff": diff_info["diff"],
            }
            if abs_dest:
                event["dest_path"] = abs_dest
                if relevant_dest:
                    event["dest_relative_path"] = os.path.relpath(abs_dest, self.project_path)
            if extra:
                event.update(extra)

            try:
                with open(LOG_PATH, "a", encoding="utf-8") as f:
                    f.write(json.dumps(event, ensure_ascii=False) + "\n")
            except Exception as e:
                print(f"Error writing to log: {e}")

            _activity_buffer.insert(0, event)
            if len(_activity_buffer) > _MAX_BUFFER:
                _activity_buffer.pop()

            try:
                database.save_event(event)
            except Exception as e:
                print(f"Error saving to DB: {e}")

            if _loop:
                asyncio.run_coroutine_threadsafe(broadcast_event(event), _loop)

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
    """Calcula diff real comparando com o estado anterior em memória."""
    global _file_cache
    
    lines_added = 0
    lines_removed = 0
    diff_text = ""
    size_bytes = 0
    
    if not os.path.exists(path) and event_type != "deleted":
        return {"lines_added": 0, "lines_removed": 0, "diff": "", "size_bytes": 0}

    try:
        # Check file size before reading for non-deleted events
        if event_type != "deleted":
            try:
                size_bytes = os.path.getsize(path)
            except Exception:
                size_bytes = 0
            
            if size_bytes > MAX_FILE_SIZE:
                return {
                    "lines_added": 0,
                    "lines_removed": 0,
                    "diff": f"File too large to diff (>500KB)",
                    "size_bytes": size_bytes,
                }

        new_content = []
        if event_type != "deleted":
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                new_content = f.readlines()

        old_content = _file_cache.get(path, [])
        
        if event_type == "created":
            diff_text = "".join([f"+{line}" for line in new_content[:100]])
            lines_added = len(new_content)
        elif event_type == "modified":
            # Lazy caching: if file not in cache, return special message and cache now
            if not old_content:
                diff_text = "Diff unavailable for first modification after startup."
            else:
                diff = list(difflib.unified_diff(old_content, new_content, n=3))
                diff_text = "".join(diff)
                for line in diff:
                    if line.startswith("+") and not line.startswith("+++"):
                        lines_added += 1
                    elif line.startswith("-") and not line.startswith("---"):
                        lines_removed += 1
        elif event_type == "deleted":
            lines_removed = len(old_content)
            diff_text = "File deleted."
            _file_cache.pop(path, None)
            return {"lines_added": 0, "lines_removed": lines_removed, "diff": diff_text, "size_bytes": 0}

        # Lazy caching: only populate when file is modified for the first time
        _file_cache[path] = new_content
        
        return {
            "lines_added": lines_added,
            "lines_removed": lines_removed,
            "diff": diff_text,
            "size_bytes": size_bytes,
        }
    except Exception as e:
        print(f"Diff error for {path}: {e}")
        return {"lines_added": 0, "lines_removed": 0, "diff": "", "size_bytes": 0}

# ── WebSocket Broadcast ────────────────────────────────────────────────────────
async def broadcast_event(event: Dict[str, Any]):
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
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _loop, _project_path, _observers
    _loop = asyncio.get_running_loop()
    
    # Initialize database and load events
    try:
        database.create_tables()
        print("Database initialized")
        events = database.load_events(5000)
        settings = load_settings()
        projects = settings.get("projects", [])
        for evt in events:
            if not evt.get("project_path") and evt.get("path"):
                evt["project_path"] = _infer_project_path(evt["path"], projects)
        if events:
            _activity_buffer.extend(events)
            print(f"Loaded {len(events)} events from database")
    except Exception as e:
        print(f"Database init error: {e}")
    
    # Start observing all active projects
    settings = load_settings()
    active_projects = settings.get("active_projects", [])
    
    for project_path in active_projects:
        p = Path(project_path).expanduser().resolve()
        if p.exists() and p not in _observers:
            if WATCHDOG_AVAILABLE and Observer is not None:
                try:
                    event_handler = ProjectEventHandler(p)
                    observer = Observer()
                    observer.schedule(event_handler, str(p), recursive=True)
                    observer.start()
                    _observers[p] = observer
                    _project_path = p
                    print(f"👀 Observando: {p}")
                except Exception as e:
                    print(f"❌ Erro ao iniciar observer para {p}: {e}")
             
    yield

app = FastAPI(title="Hermes Activity Dashboard", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ─────────────────────────────────────────────────────────────────────
# Frontend buildado - assets are in dist/assets/
DIST_PATH = os.path.join(os.path.dirname(__file__), "frontend", "dist", "assets")

@app.get("/")
async def index():
    index_path = os.path.join(os.path.dirname(__file__), "frontend", "dist", "index.html")
    if os.path.exists(index_path):
        return HTMLResponse(open(index_path).read())
    return HTMLResponse("<h1>Build frontend: cd frontend && npm run build</h1>")

@app.get("/assets/{file_path:path}")
async def serve_assets(file_path: str):
    file_path_abs = os.path.join(os.path.dirname(__file__), "frontend", "dist", "assets", file_path)
    if os.path.exists(file_path_abs):
        content = open(file_path_abs, 'rb').read()
        return Response(content)
    return HTMLResponse("Asset not found", status_code=404)

@app.get("/api/status")
async def api_status():
    return JSONResponse({
        "project_path": str(_project_path) if _project_path else None,
        "observers_running": len(_observers),
        "total_observers": len(_observers),
        "events_in_buffer": len(_filter_events_for_current_project(_activity_buffer)),
        "total_events": len(_filter_events_for_current_project(_activity_buffer)),
        "uptime_seconds": int(time.time() - _start_time) if '_start_time' in globals() else 0,
    })


@app.get("/api/files")
async def api_files():
    """Retorna árvore de arquivos do projeto atual."""
    if not _project_path:
        return JSONResponse([], status_code=200)

    root_path = os.path.abspath(_project_path)
    
    def get_tree(dir_path: str, max_depth: int = 4) -> List[dict]:
        if max_depth < 0: return []
        nodes = []
        try:
            with os.scandir(dir_path) as entries:
                # Sort: directories first
                item_list = list(entries)
                sorted_entries = sorted(item_list, key=lambda e: (not e.is_dir(), e.name.lower()))
                
                for entry in sorted_entries:
                    try:
                        if entry.name.startswith('.') or entry.name in {'__pycache__', 'node_modules', '.git', 'venv', 'dist', 'build'}:
                            continue
                        
                        # Usa realpath para evitar problemas com links simbólicos
                        abs_path = os.path.realpath(entry.path)
                        rel_path = os.path.relpath(abs_path, root_path)
                        
                        try:
                            stats = entry.stat()
                            size = stats.st_size
                        except Exception:
                            size = 0

                        node = {
                            "name": entry.name,
                            "path": rel_path,
                            "type": "directory" if entry.is_dir() else "file",
                            "size": size,
                            "children": get_tree(entry.path, max_depth - 1) if entry.is_dir() else []
                        }
                        nodes.append(node)
                    except Exception as e:
                        print(f"Skipping entry {entry.name}: {e}")
                        continue
        except Exception as e:
            print(f"Error scanning {dir_path}: {e}")
        return nodes

    tree = get_tree(root_path)
    return JSONResponse(tree)


@app.get("/api/activities")
async def api_activities(limit: int = 50, offset: int = 0, event_type: Optional[str] = None):
    events = _filter_events_for_current_project(_activity_buffer)
    if event_type and event_type != 'all':
        events = [e for e in events if e.get('type') == event_type]
    total = len(events)
    page = events[offset: offset + limit]
    return JSONResponse({"activities": page, "total": total, "limit": limit, "offset": offset})

@app.get("/api/stats")
async def api_stats():
    events = _filter_events_for_current_project(_activity_buffer)
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
    for evt in _filter_events_for_current_project(_activity_buffer):
        if evt.get("id") == event_id:
            return JSONResponse({
                "event": evt,
                "diff": evt.get("diff", ""),
                "lines_added": evt.get("lines_added", 0),
                "lines_removed": evt.get("lines_removed", 0),
                "size_bytes": evt.get("size_bytes", 0),
            })
    return JSONResponse({"error": "Evento não encontrado"}, status_code=404)

# ── New Enhanced APIs ─────────────────────────────────────────────────────────

@app.get("/api/stats/advanced")
async def api_stats_advanced():
    """Advanced statistics with analytics."""
    try:
        stats = database.get_advanced_stats(_current_project_path())
        return JSONResponse(stats)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/api/file/{path:path}/history")
async def api_file_history(path: str):
    """Get modification history for a specific file."""
    try:
        abs_path = os.path.abspath(path)
        history = database.get_file_history(abs_path)
        return JSONResponse({"file": abs_path, "history": history})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/api/search")
async def api_search(q: str = "", limit: int = 20):
    """Global search across files and events."""
    if not q:
        return JSONResponse({"events": [], "files": []})
    
    try:
        project_path = _current_project_path()
        events = database.search_events(q, limit, project_path)
        files = database.search_files(q, project_path)
        return JSONResponse({"events": events, "files": files})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/api/export")
async def api_export(format: str = "json"):
    """Export all events as JSON or CSV."""
    try:
        data = database.export_events(format)
        if format == "csv":
            return JSONResponse({"data": data}, media_type="text/csv")
        return JSONResponse(json.loads(data), media_type="application/json")
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/api/sessions")
async def api_sessions():
    """Get work sessions."""
    try:
        sessions = database.get_sessions()
        return JSONResponse({"sessions": sessions})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

DB_PATH = Path(__file__).parent / "hermes.db"

@app.get("/api/health")
async def api_health():
    """Server health check."""
    return JSONResponse({
        "status": "ok",
        "database": "connected" if DB_PATH.exists() else "not_found",
        "uptime": int(time.time() - _start_time) if '_start_time' in globals() else 0
    })

@app.get("/api/browse")
async def api_browse(path: str = None):
    """Retorna lista de diretórios para o navegador de arquivos."""
    try:
        if not path:
            path = str(Path.home())
        
        p = Path(path).expanduser().resolve()
        
        if not p.exists() or not p.is_dir():
            return JSONResponse({"error": "Directory not found"}, status_code=400)
            
        directories = [d.name for d in p.iterdir() if d.is_dir() and not d.name.startswith('.')]
        directories.sort()
        
        parent_path = str(p.parent) if p.parent != p else None
        
        return JSONResponse({
            "current_path": str(p),
            "parent_path": parent_path,
            "directories": directories
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/api/file")
async def api_file(path: str):
    """Retorna conteúdo de um arquivo."""
    try:
        p = Path(path).resolve()
        if not p.exists():
            return JSONResponse({"error": "File not found"}, status_code=404)
        
        size_bytes = p.stat().st_size
        if size_bytes > MAX_FILE_SIZE:
            return JSONResponse({"error": "File is too large to preview (>500KB)"}, status_code=413)
        
        content = p.read_text(encoding="utf-8", errors="replace")
        return JSONResponse({"path": str(p), "content": content, "size": len(content)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/api/set-project")
async def api_set_project(payload: dict = Body(...)):
    global _project_path, _activity_buffer, _file_cache, _start_time, _observers
    path = payload.get("path")
    if not path:
        return JSONResponse({"error": "Caminho não fornecido"}, status_code=400)

    p = Path(path).expanduser().resolve()
    if not p.exists() or not p.is_dir():
        return JSONResponse({"error": "Pasta não existe"}, status_code=400)

    print(f"📁 Adicionando projeto: {p}")
    
    # Add to projects list
    settings = add_project(str(p))
    settings["last_project"] = str(p)
    save_settings(settings)
    active_projects = settings.get("active_projects", [])
    
    # Start observing this project
    if WATCHDOG_AVAILABLE and Observer is not None:
        if p not in _observers:
            try:
                event_handler = ProjectEventHandler(p)
                observer = Observer()
                observer.schedule(event_handler, str(p), recursive=True)
                observer.start()
                _observers[p] = observer
                print(f"👀 Observando: {p}")
                # Prepopulate cache so diff works for first edit
                _prepopulate_cache(p)
            except Exception as e:
                print(f"❌ Erro ao iniciar observer: {e}")
    
    _project_path = p
    _start_time = time.time()
    
    return JSONResponse({
        "status": "ok", 
        "project_path": str(p), 
        "observer": WATCHDOG_AVAILABLE,
        "projects": settings.get("projects", []),
        "active_projects": settings.get("active_projects", [])
    })

@app.get("/api/projects")
async def api_projects():
    """List all tracked projects."""
    settings = load_settings()
    return JSONResponse({
        "projects": settings.get("projects", []),
        "active_projects": settings.get("active_projects", []),
        "last_project": settings.get("last_project")
    })

@app.post("/api/projects/remove")
async def api_remove_project(payload: dict = Body(...)):
    """Remove a project from tracking."""
    path = payload.get("path")
    if not path:
        return JSONResponse({"error": "Caminho não fornecido"}, status_code=400)
    
    settings = remove_project(path)
    
    # Stop observing if active
    p = Path(path).expanduser().resolve()
    if p in _observers:
        try:
            _observers[p].stop()
            _observers[p].join()
            del _observers[p]
        except Exception:
            pass

    if _project_path and _project_path == p:
        remaining = [Path(path).expanduser().resolve() for path in settings.get("active_projects", [])]
        _project_path = remaining[0] if remaining else None
    
    return JSONResponse({
        "status": "ok",
        "projects": settings.get("projects", []),
        "active_projects": settings.get("active_projects", [])
    })

@app.post("/api/reset")
async def api_reset():
    global _activity_buffer
    current = _current_project_path()
    if current:
        _activity_buffer = [evt for evt in _activity_buffer if not _event_matches_project(evt, current)]
        database.clear_events(current)
    else:
        try:
            if LOG_PATH.exists():
                LOG_PATH.unlink()
        except Exception:
            pass
        _activity_buffer.clear()
        database.clear_events()
    return JSONResponse({"status": "ok", "message": "Log resetado"})

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    _connected_clients.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        _connected_clients.remove(websocket)

# ── Server Management ─────────────────────────────────────────────────────────
_server: Optional[uvicorn.Server] = None
_server_thread: Optional[threading.Thread] = None
_start_time = time.time()

def start_server(host: str = "127.0.0.1", port: int = 8000, project_path: Optional[str] = None) -> Dict[str, Any]:
    global _server_thread, _start_time
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

    uvicorn.run(app, host=args.host, port=args.port, reload=args.reload)

if __name__ == "__main__":
    main()
