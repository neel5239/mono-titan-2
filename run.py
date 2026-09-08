"""Start the RetinaEdge server.  python run.py  →  http://127.0.0.1:8000  (use --host 0.0.0.0 to reach it from a phone on the same Wi-Fi)."""
import argparse, os, sys, uvicorn
ROOT = os.path.dirname(os.path.abspath(__file__)); os.chdir(ROOT); sys.path.insert(0, ROOT)

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--host', default='127.0.0.1'); p.add_argument('--port', type=int, default=8000); p.add_argument('--reload', action='store_true')
    a = p.parse_args()
    uvicorn.run('backend.app:app', host=a.host, port=a.port, reload=a.reload)
