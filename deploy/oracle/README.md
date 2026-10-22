# Hosting CertBench on Oracle Cloud (free)

CertBench runs on one Oracle Cloud **Always Free** VM: Node runs the app as a `systemd` service,
Caddy sits in front and gets a free HTTPS certificate, and the SQLite database lives on the VM's
disk at `/var/lib/certbench/certbench.db`. Every push to `develop` deploys automatically through
GitHub Actions (`.github/workflows/deploy-oracle.yml`), the same way Railway did.

| File | What it does |
|---|---|
| `setup.sh` | Installs Node 22 and Caddy, opens ports 80/443, creates the service, env file and nightly backup. Safe to re-run; every deploy runs it. |
| `certbench.service` | The `systemd` service (runs as the `certbench` user, restarts on crash and reboot). |
| `Caddyfile` | HTTPS reverse proxy to the app on port 3000. |
| `backup.js` | Nightly backup at 02:30 IST to `/var/backups/certbench`, keeps the last 14. |
| `railway-export.js` | Copies the live database off Railway. |
| `restore-db.sh` | Puts a database copy (from Railway or a backup) in place. |

## 1. Oracle account

1. Sign up at https://www.oracle.com/cloud/free/. Oracle asks for a card to verify you;
   Always Free resources are not charged.
2. **Home region: India West (Mumbai) or India South (Hyderabad).** Free servers only run in the
   home region, and it can't be changed later.
3. Recommended: upgrade the account to **Pay As You Go** (Billing > Upgrade). Always Free resources
   stay free, and Oracle stops reclaiming free VMs it thinks are idle (a quiet week on the site
   could otherwise get the VM deleted). Add a budget alert of ₹1 under Billing > Budgets to be told
   if anything ever costs money.

## 2. The VM

1. Compute > Instances > **Create instance**.
2. Image: **Canonical Ubuntu 24.04**.
3. Shape: **Ampere (VM.Standard.A1.Flex)** with 1 OCPU / 6 GB. If Oracle says "out of capacity",
   pick **AMD VM.Standard.E2.1.Micro** instead (1 GB RAM is enough; setup adds swap).
4. SSH keys: **Generate a key pair for me** and **download the private key**. Keep it safe; it is
   the only way in.
5. Create, then copy the instance's **Public IP address**.
6. Open the web ports: on the instance page, click the subnet > Security Lists > Default Security
   List > **Add Ingress Rules**. Add two rules with source `0.0.0.0/0`, protocol TCP, destination
   port `80`, and the same for `443`.

## 3. A domain

Point a domain at the VM's public IP with an **A record**. Use your own domain, or a free
subdomain from https://www.duckdns.org (sign in, create a name, paste the IP). Without a domain
the site still works on `http://<ip>` for testing, but Razorpay and login need HTTPS for real use.

## 4. GitHub settings

In the repo: Settings > Secrets and variables > Actions.

**Variables** tab:
- `ORACLE_HOST`: the VM's public IP.
- `DOMAIN`: e.g. `certbench.duckdns.org` (leave unset to test on the plain IP first).

**Secrets** tab:
- `ORACLE_SSH_KEY`: the whole content of the private key file from step 2.4, including the
  `-----BEGIN` and `-----END` lines.
- `CERTBENCH_ENV`: the app's variables, one `KEY=value` per line. On Railway, open the service's
  **Variables** tab > **Raw Editor** and copy everything. Change `CORS_ORIGINS` (if set) to the
  new address, e.g. `https://certbench.duckdns.org`. `NODE_ENV`, `DB_PATH` and `PORT` are set by
  the server and can be left out.

Then Actions > **Deploy to Oracle** > **Run workflow**. In a few minutes the site is up with the
built-in exams and an empty user list. From now on every merge to `develop` deploys.

## 5. Copy the live data from Railway

Do this right before you send people to the new site: anything students do on Railway after the
copy is not carried over.

On your own computer, with the [Railway CLI](https://docs.railway.com/cli) installed, in this repo's
folder (on Windows use **Command Prompt**, not PowerShell):

```
railway login
railway link            # pick the CertBench project and service
railway ssh -- node < deploy/oracle/railway-export.js > certbench-railway.b64
```

Copy it to the VM and put it in place (replace the key path and IP):

```
scp -i path/to/oracle-key.key certbench-railway.b64 ubuntu@<ip>:~
ssh -i path/to/oracle-key.key ubuntu@<ip> "sudo bash /opt/certbench/deploy/oracle/restore-db.sh ~/certbench-railway.b64"
```

It prints the number of users, attempts and enrollments it found; check they match the admin
panel on the old site.

## 6. Switch over

1. Log in on the new site with an emailed code, and open `/admin`.
2. Do one Razorpay test purchase. If you use live Razorpay keys, add the new domain under the
   Razorpay dashboard's website/app settings first.
3. Share the new address. Then on Railway, remove the service (or disconnect its GitHub repo) so a
   later un-pause doesn't start a second copy of the site with old data.

## Day-to-day

- Logs: `sudo journalctl -u certbench -f`
- Restart: `sudo systemctl restart certbench`
- Change a variable: edit the `CERTBENCH_ENV` secret and re-run the workflow, or edit
  `/etc/certbench/certbench.env` on the VM and restart.
- Backups: `/var/backups/certbench/`. Restore one with
  `sudo bash /opt/certbench/deploy/oracle/restore-db.sh /var/backups/certbench/<file>.db.gz`.
  These live on the VM itself, so download one now and then (`scp`) to keep a copy elsewhere.
- Admin scripts run on the VM with the app's settings, for example:
  `sudo -u certbench bash -c 'set -a; . /etc/certbench/certbench.env; cd /opt/certbench; node src/make-admin.js yourusername'`
