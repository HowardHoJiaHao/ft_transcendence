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

## Alert: WebEndpointDown
**Meaning:** blackbox-exporter could not get a successful HTTP response from
nginx, frontend, or the backend `/health` route.

**Steps:**
1. Check `http://localhost:9090/targets` (Prometheus) → find the `blackbox` job
   → see which specific target is failing.
2. If it's `backend:8080/health`: check `docker logs transcendence-backend`.
   Since this route now actually pings the database (see main.go), a 503
   response here specifically means "backend is up, but can't reach the DB" —
   check `PostgresDown` too, they may be firing together.
3. If it's nginx: check `docker logs transcendence-nginx` for SSL/proxy errors.
4. Cross-check with the **Logs** dashboard in Grafana (Loki) — search
   `{container="transcendence-backend"}` around the time the alert fired to
   see the actual error text, not just "it's down."

---

## Alert: BackupStale
**Meaning:** No successful backup has been reported in over 12 hours (2x the
normal 6-hour interval). This is measured via a timestamp the backup script
itself writes after each success — not by checking if the container "looks"
running, since container name/ID matching turned out to be unreliable on some
Docker setups (see note below).

**Steps:**
1. `docker ps -a | grep db-backup` — is it running at all?
2. `docker logs transcendence-db-backup --tail 30` — look for the actual error
   (most common: wrong DB credentials, or the database itself was down during
   the scheduled backup time — check for a matching `PostgresDown` alert
   around the same time).
3. `docker compose up -d db-backup` to restart it if it crashed.
4. Manually confirm: `ls -lh backups/` — is there a recent file?
5. If everything looks fine but the alert persists, check the metric directly
   in Prometheus: query `backup_last_success_timestamp_seconds` and compare
   to the current time.
6. See `monitoring/DISASTER_RECOVERY.md` for the full backup/restore process.

> **Why not just check if the container is running via cAdvisor?** We tried
> that first, but discovered cAdvisor (at least on Docker Desktop for Mac)
> doesn't reliably expose a stable container `name` label — only a container
> ID hash that changes every rebuild. Checking the backup's own reported
> timestamp is more robust and is the standard Prometheus pattern for
> monitoring scheduled/batch jobs (called a "textfile collector").

---

## Where to find historical logs (not just live metrics)

Metrics (Prometheus/Grafana graphs) only show numbers — they don't explain
*why* something happened. For actual error text and event history:

1. Grafana → left sidebar → **Dashboards** → **ft_transcendence - Logs**
   (or **Explore** → switch data source to **Loki**)
2. Filter by container using the dropdown, or query directly, e.g.:
   `{container="transcendence-backend"} |= "error"`
3. Logs are kept for 15 days (matches Prometheus's metric retention), after
   which old ones are automatically deleted to save disk space.

---

## General incident checklist (any alert)
1. Don't panic — check the dashboard first, not the code.
2. Identify: which container, since when, how severe.
3. Check logs for the real error message.
4. Try the safest fix first (restart) before changing code.
5. Write down what happened and how it was fixed — this becomes tomorrow's
   runbook improvement.
