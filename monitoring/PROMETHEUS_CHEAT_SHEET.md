# Prometheus Handoff Cheat Sheet

This is the short version for person A who owns Prometheus and the monitoring flow.

## What changed

- Prometheus now scrapes `prometheus`, `node-exporter`, `cadvisor`, `postgres-exporter`, and the blackbox probe targets.
- Blackbox probes are configured for:
  - `https://nginx`
  - `http://frontend:3000`
  - `http://backend:8080/health`
- Blackbox HTTP checks follow redirects and skip TLS verification for the local nginx cert.
- Alertmanager routes alerts to the Discord relay at `http://discord-webhook-relay:5001/alertmanager`.
- The Discord relay now writes a rotating file log and keeps 5 days of history.

## Files to know

- [monitoring/prometheus/prometheus.yml](prometheus/prometheus.yml)
- [monitoring/prometheus/alert.rules.yml](prometheus/alert.rules.yml)
- [monitoring/blackbox.yml](blackbox.yml)
- [monitoring/alertmanager/alertmanager.yml](alertmanager/alertmanager.yml)
- [monitoring/alertmanager/discord_webhook_bridge.py](alertmanager/discord_webhook_bridge.py)
- [docker-compose.yml](../docker-compose.yml)

## Main alert rules

- `ServiceDown`: a service is unreachable for 1 minute.
- `PostgresDown`: postgres-exporter cannot reach the database.
- `HighContainerCPU`: a container stays above the CPU threshold for 5 minutes.
- `HighContainerMemory`: a container stays above the memory threshold for 5 minutes.
- `WebEndpointDown`: blackbox probe failed for nginx, frontend, or backend health.

## Daily commands

```bash
make up
make ps
make logs
make logs-backend
make logs-frontend
make logs-db
make health-check
```

## Useful monitoring checks

```bash
curl 'http://127.0.0.1:9090/api/v1/query?query=probe_success' | jq .
curl 'http://127.0.0.1:9090/api/v1/targets' | jq '.data.activeTargets[] | select(.labels.job=="blackbox")'
curl 'http://127.0.0.1:9115/probe?module=http_2xx&target=https://nginx'
curl 'http://127.0.0.1:9093/api/v2/alerts'
```

## Log locations

- Prometheus / Alertmanager / blackbox / Grafana still log to container stdout.
- Relay file log lives at `./monitoring/alertmanager/logs/relay.log` on the host.
- The relay keeps 5 rotated files and removes the oldest automatically.

## If you add a new target or alert

1. Add or update the scrape target in `monitoring/prometheus/prometheus.yml`.
2. Add or update the rule in `monitoring/prometheus/alert.rules.yml`.
3. If it is a web endpoint, update blackbox settings in `monitoring/blackbox.yml`.
4. Restart the affected containers.
5. Confirm the metric appears in Prometheus and the alert routes to Alertmanager.

## Secrets to keep out of git

- `DISCORD_WEBHOOK_URL`
- `RELAY_BEARER_TOKEN` if used
- `JWT_SECRET`
- `DB_PASSWORD`
- `DB_ROOT_PASSWORD`
- `DEEPSEEK_API_KEY`
- `OPENROUTER_API_KEY`
- `BREVO_API_KEY`
- `BREVO_SMTP_KEY`

## Quick mental model

Prometheus scrapes metrics and evaluates rules. Alertmanager receives fired alerts and forwards them to the Discord relay. The relay formats the message, writes logs, and posts to Discord.