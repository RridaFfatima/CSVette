"""CSVette development server.

Serves the project root over HTTP (required for ES modules) with caching
disabled, so edits show up on every reload.

Usage:  python serve.py [port]      (default port: 8000)
"""

import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"CSVette running at http://127.0.0.1:{PORT}  (Ctrl+C to stop)")
        httpd.serve_forever()
