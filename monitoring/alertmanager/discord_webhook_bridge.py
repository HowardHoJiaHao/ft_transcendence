import json
import logging
from logging.handlers import TimedRotatingFileHandler
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib import request


def _read_secret_file(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
if not DISCORD_WEBHOOK_URL:
    # fallback to Docker secrets file if available
    DISCORD_WEBHOOK_URL = _read_secret_file("/run/secrets/discord_webhook").strip()

if not DISCORD_WEBHOOK_URL:
    raise RuntimeError("DISCORD_WEBHOOK_URL is required")

# Optional inbound auth: Alertmanager can send a bearer token (Authorization: Bearer <token>)
# We accept the token from env or from a secret file. If set, incoming requests must include it.
RELAY_BEARER_TOKEN = os.environ.get("RELAY_BEARER_TOKEN", "").strip()
if not RELAY_BEARER_TOKEN:
    RELAY_BEARER_TOKEN = _read_secret_file("/run/secrets/relay_bearer_token").strip()


LOG_DIR = Path(os.environ.get("RELAY_LOG_DIR", "/var/log/alertmanager-relay"))
LOG_FILE = LOG_DIR / "relay.log"


def _build_logger() -> logging.Logger:
    logger = logging.getLogger("alertmanager_relay")
    logger.setLevel(logging.INFO)
    logger.propagate = False

    if logger.handlers:
        return logger

    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    file_handler = TimedRotatingFileHandler(
        LOG_FILE,
        when="D",
        interval=1,
        backupCount=5,
        encoding="utf-8",
        utc=True,
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


LOGGER = _build_logger()


class AlertHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        # If a bearer token is configured, validate Authorization header
        if RELAY_BEARER_TOKEN:
            auth = self.headers.get("Authorization", "")
            expected = f"Bearer {RELAY_BEARER_TOKEN}"
            if auth != expected:
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b"unauthorized")
                LOGGER.warning("unauthorized request from %s", self.client_address[0])
                return

        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length).decode("utf-8", "replace")

        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"invalid json")
            LOGGER.warning("invalid json from %s", self.client_address[0])
            return

        LOGGER.info("received alertmanager payload")

        alerts = payload.get("alerts", [])
        lines = []

        if alerts:
            for i, alert in enumerate(alerts):
                labels = alert.get("labels", {})
                annotations = alert.get("annotations", {})
                name = labels.get("alertname") or "Alert"
                summary = annotations.get("summary") or name
                description = annotations.get("description") or ""
                # Header then summary and description
                lines.append("**Alertmanager notification**")
                lines.append(summary)
                if description:
                    lines.append(description)
                # separate multiple alerts with a blank line
                if i != len(alerts) - 1:
                    lines.append("")
        else:
            lines.append("**Alertmanager notification**")
            lines.append("No alert details provided")

        # Ensure message ends with a single newline for readability in Discord
        message = "\n".join(lines) + "\n"
        data = json.dumps({"content": message}).encode("utf-8")
        req = request.Request(
            DISCORD_WEBHOOK_URL,
            data=data,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0",
            },
            method="POST",
        )

        try:
            with request.urlopen(req, timeout=10) as response:
                LOGGER.info("discord webhook accepted status=%s", response.status)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
        except Exception as exc:
            LOGGER.exception("discord webhook failed: %s", exc)
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(exc)}).encode("utf-8"))

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 5001), AlertHandler)
    LOGGER.info("discord webhook bridge listening on 0.0.0.0:5001")
    server.serve_forever()
