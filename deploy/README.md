# Deployment runbook

Production: **https://daily5.tradertrix.com**, on the DigitalOcean droplet `chaihouse-blr`
(139.59.74.146, Bangalore), which also runs ChaiHouse. Merging to `main` deploys automatically.

```
merge to main ─► GitHub Actions: checks ─► build image ─► push ghcr.io/ash-1202/daily-loop:<sha>
                                         ─► ssh deploy@droplet "deploy <sha>"   (forced command)
                                                └─► /usr/local/bin/deploy-daily-loop <sha>
                                                      pull → migrate → seed → generate → restart app → health
                                                      (fails? → previous version restarted)
                                         ─► check https://daily5.tradertrix.com/api/health = <sha>

Internet ─► ChaiHouse's Caddy (:80/:443, HTTPS) ─► daily-loop-app:3000 ─► daily-loop db
            (shared "chaihouse_default" network)    (/opt/daily-loop, compose project "daily-loop")
```

## Files

| In this folder | On the droplet | What it is |
|---|---|---|
| `docker-compose.prod.yml` | `/opt/daily-loop/docker-compose.prod.yml` | App + Postgres, memory caps, loopback-only port 3200 |
| `deploy-daily-loop.sh` | `/usr/local/bin/deploy-daily-loop` | Deploy one commit; automatic rollback |
| `daily-loop-ssh-gate.sh` | `/usr/local/bin/daily-loop-ssh-gate` | The only command the CI key may run |
| `backup-daily-loop.sh` | `/opt/daily-loop/backup.sh` | Nightly `pg_dump`, keeps 14 days |
| `generate-daily-loop.sh` | `/opt/daily-loop/generate.sh` | Daily chart cards + challenges for the next 7 days (log: `generate.log`) |
| `Caddyfile.daily5` | appended to `/opt/chaihouse/Caddyfile` | HTTPS site block for daily5.tradertrix.com |
| — | `/opt/daily-loop/.env` | `POSTGRES_PASSWORD=…` (root-only, never in git) |
| — | `/opt/daily-loop/current_tag`, `previous_tag` | Which commit is live, and the one before |

## Sharing the server with ChaiHouse

- **Separate compose project** `daily-loop`; deploys never restart ChaiHouse containers.
- **Memory:** app ≤ 256 MB, db ≤ 200 MB, `oom_score_adj: 800` (ChaiHouse: 500), so under memory
  pressure the kernel stops daily-loop first.
- **No public ports:** only ChaiHouse's Caddy listens on 80/443. The app is reachable from Caddy as
  `daily-loop-app`. Postgres is on daily-loop's private network only.
- **Unique service names** (`daily-loop-app`, `daily-loop-db`): the app is also on ChaiHouse's network,
  and Docker DNS answers a name from every network a container is on. A service called `db` resolved
  to ChaiHouse's Postgres on the first deploy; `app` would have split ChaiHouse's traffic. Never add a
  service with a generic name to this file.
- **Infrastructure files are copied by hand.** The pipeline deploys new *images*; changes to this
  folder (compose file, scripts, Caddy block) are applied to the server manually, like a migration of
  the server itself, and noted in the build log.
- **Images:** the deploy keeps the 3 newest daily-loop images and removes older ones; ChaiHouse
  images are never touched.

## One-time server setup (done once, as root)

```bash
# 1. Directory, compose file, secret
mkdir -p /opt/daily-loop && cd /opt/daily-loop
# copy deploy/docker-compose.prod.yml here, then:
umask 077 && echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env

# 2. Scripts (root-owned, not writable by anyone else)
install -m 755 -o root -g root deploy-daily-loop.sh   /usr/local/bin/deploy-daily-loop
install -m 755 -o root -g root daily-loop-ssh-gate.sh /usr/local/bin/daily-loop-ssh-gate

# 3. Restricted deploy user: can only run the gate, which can only run the deploy script
useradd --create-home --shell /bin/sh deploy && passwd -l deploy
echo 'deploy ALL=(root) NOPASSWD: /usr/local/bin/deploy-daily-loop' > /etc/sudoers.d/daily-loop-deploy
chmod 440 /etc/sudoers.d/daily-loop-deploy && visudo -cf /etc/sudoers.d/daily-loop-deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo 'restrict,command="/usr/local/bin/daily-loop-ssh-gate" ssh-ed25519 AAAA... github-actions-daily-loop' \
  > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys

# 4. HTTPS: append the site block in place (the Caddyfile is bind-mounted as a single file, so
#    tools that replace the file would leave Caddy reading the old one), validate, reload.
cp /opt/chaihouse/Caddyfile /opt/chaihouse/Caddyfile.bak-$(date +%Y%m%d)
cat Caddyfile.daily5 >> /opt/chaihouse/Caddyfile
docker exec chaihouse-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec chaihouse-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

# 5. Nightly backup at 03:15 UTC (ChaiHouse's runs at 03:00)
install -m 700 backup-daily-loop.sh /opt/daily-loop/backup.sh
( crontab -l; echo '15 3 * * * /opt/daily-loop/backup.sh' ) | crontab -

# 6. Daily chart cards + challenges at 13:00 UTC = 18:30 IST (after market close)
install -m 700 generate-daily-loop.sh /opt/daily-loop/generate.sh
( crontab -l; echo '0 13 * * * /opt/daily-loop/generate.sh' ) | crontab -
```

`restrict` turns off port forwarding, agent forwarding, X11 and terminals for that key;
`command=` replaces whatever the client asks to run with the gate.

## One-time GitHub setup

1. **Deploy key**, generated on your own machine (the private half never touches the server):
   `ssh-keygen -t ed25519 -N '' -C github-actions-daily-loop -f daily-loop-deploy`
   The public half (`daily-loop-deploy.pub`) goes in `authorized_keys` above.
2. Repository → **Settings → Environments → New environment `production`**, then add:
   - Secret `DEPLOY_SSH_KEY`: the private key file's full contents
   - Secret `DEPLOY_KNOWN_HOSTS`: output of `ssh-keyscan -t ed25519 139.59.74.146`
   - Variable `DEPLOY_HOST`: `139.59.74.146`
3. After the first image is pushed: **Packages → daily-loop → Package settings → Change visibility
   → Public**, so the droplet can pull without credentials (the repository is public anyway).

## Everyday operations (on the droplet)

```bash
cd /opt/daily-loop
cat current_tag previous_tag                                  # what's live, what was before
IMAGE_TAG=$(cat current_tag) docker compose -f docker-compose.prod.yml ps
IMAGE_TAG=$(cat current_tag) docker compose -f docker-compose.prod.yml logs --tail 100 daily-loop-app
curl -s 127.0.0.1:3200/api/health                              # from the droplet itself
/opt/daily-loop/generate.sh && tail -8 generate.log             # build the next 7 days now

deploy-daily-loop $(cat previous_tag)                          # manual rollback to the previous version
```

A rollback restores the **app**; migrations are additive only (new tables and columns), so the
previous version keeps working with the newer schema.

**Restore a backup** (overwrites the current data):

```bash
gunzip -c backups/daily-loop-YYYYMMDD-HHMMSS.sql.gz \
  | IMAGE_TAG=$(cat current_tag) docker compose -f docker-compose.prod.yml exec -T daily-loop-db psql -U daily_loop -d daily_loop
```
