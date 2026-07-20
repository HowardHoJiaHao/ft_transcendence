# Monitoring Runbooks

This document explains, for each alert defined in `monitoring/prometheus/alert.rules.yml`,
what a human should check and do when it fires. This turns a scary red alarm into a
calm checklist.

---

## Alert: ServiceDown
**Meaning:** Prometheus could not reach a service (backend, frontend, ai, nginx, etc.)
for more than 1 minute.

**Steps:**
1. Check which service is down: look at the alert label `job` (e.g. `job="cadvisor"`
   means cAdvisor's container itself might be down, not necessarily your app).
2. Run `docker ps` — is the container listed and status "Up"?
3. If not running, check its logs: `docker logs transcendence-<service-name>`
4. Look for the actual error message (common causes: crashed on startup, wrong
   `.env` value, port already used, database not ready yet).
5. Try restarting just that service: `docker compose restart <service-name>`
6. If it keeps crashing, check `depends_on` in `docker-compose.yml` — maybe it started
   before the database was ready.

---

## Alert: PostgresDown
**Meaning:** postgres-exporter cannot reach the database.

**Steps:**
1. Run `docker ps` and confirm the `db` container is running and "healthy".
2. Check logs: `docker logs transcendence-postgres`
3. Common cause: wrong `DB_USER` / `DB_PASSWORD` / `DB_NAME` in `.env`, or the
   volume `postgres_data` got corrupted.
4. If data seems corrupted and you have a backup, restore it (see Backup section
   in `DEVOPS.md` if your team implements the Health check/backup module).

---

## Alert: HighContainerCPU
**Meaning:** One container has used more than 85% CPU for 5+ minutes straight.

**Steps:**
1. Check the Grafana "CPU Usage per Container" panel to confirm which container.
2. Ask: is this expected? (e.g., AI service doing a heavy request is normal for
   a short burst; the alert only fires after 5 minutes sustained, so it's likely real).
3. If it's the `ai` service: check if too many requests are coming in at once —
   may need request queueing or rate limiting.
4. If it's `backend` or `db`: check for an infinite loop, a bad query, or a bug
   introduced in a recent commit (`git log` to see recent changes).

---

## Alert: HighContainerMemory
**Meaning:** A container is using more than 500MB RAM for 5+ minutes.

**Steps:**
1. Check the Grafana "Memory Usage per Container" panel.
2. Common cause: a memory leak (the app keeps allocating memory and never
   releases it) — usually shows as a slowly, steadily climbing line, not a spike.
3. Short-term fix: `docker compose restart <service-name>` to free the memory.
4. Long-term fix: report to the developer of that service so they can investigate
   the code (this is why cross-team communication mentioned in the README matters!).

---

## General incident checklist (any alert)
1. Don't panic — check the dashboard first, not the code.
2. Identify: which container, since when, how severe.
3. Check logs for the real error message.
4. Try the safest fix first (restart) before changing code.
5. Write down what happened and how it was fixed — this becomes tomorrow's
   runbook improvement.
