# Deploying QuickDash on a free Google Cloud VM

QuickDash keeps its data in a local JSON file (`data/db.json`) and pushes
live updates over long-lived Server-Sent Events connections, so it needs a
real always-on server with a persistent disk — not a serverless/edge
platform. Google Cloud's **Always Free** tier gives you exactly that at no
cost: one `e2-micro` VM (in `us-west1`, `us-central1`, or `us-east1`) with a
30GB disk, forever, as long as you stay within the free limits.

This gets you: a systemd service that restarts QuickDash if it crashes or
the VM reboots, and Caddy in front of it for automatic, free HTTPS (logins
travel over the network, so this matters).

## 1. Create a Google Cloud account

[console.cloud.google.com](https://console.cloud.google.com) → sign up.
Requires a credit card for identity verification, but Always Free resources
used within their limits are never charged.

## 2. Create the VM

**Console (no CLI install needed):**

1. Compute Engine → VM instances → **Create instance**.
2. Name: `quickdash`. Region: `us-west1` (or `us-central1`/`us-east1` —
   these are the Always Free-eligible regions).
3. Machine type: `e2-micro`.
4. Boot disk: Ubuntu 22.04 LTS, 30GB standard persistent disk (change
   boot disk → OS: Ubuntu, size: 30).
5. Firewall: check **Allow HTTP traffic** and **Allow HTTPS traffic**.
6. Create.

**Or via `gcloud` CLI**, if you have it installed:

```bash
gcloud compute instances create quickdash \
  --zone=us-west1-b \
  --machine-type=e2-micro \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --tags=http-server,https-server
```

## 3. Reserve a static external IP

Without this, the VM's IP changes on restart and your HTTPS cert (tied to
the IP-based hostname below) breaks. Reserving one and attaching it to a
running instance is also free.

Console: VPC network → IP addresses → **Reserve external static address** →
attach to the `quickdash` instance.

```bash
gcloud compute addresses create quickdash-ip --region=us-west1
gcloud compute instances delete-access-config quickdash --zone=us-west1-b \
  --access-config-name="External NAT"
gcloud compute instances add-access-config quickdash --zone=us-west1-b \
  --access-config-name="External NAT" --address=quickdash-ip
```

Note the resulting IP — you'll need it in steps 5 and 6.

## 4. SSH in

Console: click the **SSH** button next to the instance (opens a
browser terminal, no setup needed). Or:

```bash
gcloud compute ssh quickdash --zone=us-west1-b
```

## 5. Run the bootstrap script

This installs Node.js and Caddy, clones the repo to `/opt/quickdash` under
a dedicated `quickdash` user, and installs the systemd service (without
starting it yet):

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/TrainerBlu3/QuickDash.git /tmp/quickdash-setup
sudo bash /tmp/quickdash-setup/deploy/setup.sh
```

The script prints next steps when it finishes — follow them:

```bash
# optional: set a known admin password instead of a random generated one
sudo nano /opt/quickdash/.env    # set ADMIN_PASSWORD=...

sudo systemctl enable --now quickdash
sudo systemctl status quickdash   # should show "active (running)"
```

## 6. Point Caddy at your domain and enable HTTPS

Take the static IP from step 3, e.g. `34.123.45.67`, and rewrite it with
dashes: `34-123-45-67.sslip.io`. That's a free hostname
([sslip.io](https://sslip.io)) that resolves straight back to your IP with
no DNS setup — which is what lets Caddy get you a real Let's Encrypt
certificate (a bare IP can't get one).

```bash
sudo sed -i 's/34-123-45-67.sslip.io/YOUR-IP-WITH-DASHES.sslip.io/' \
  /opt/quickdash/deploy/Caddyfile
sudo cp /opt/quickdash/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Visit `https://YOUR-IP-WITH-DASHES.sslip.io` — you should hit the QuickDash
login page. Log in as `admin` with the password from `.env` (or from
`sudo journalctl -u quickdash -n 50 --no-pager | grep -A2 password` if you
left it randomly generated), then create real accounts and change the
admin password from the Admin page.

## Updating after future code changes

**Manually:**

```bash
sudo -u quickdash git -C /opt/quickdash pull
sudo -u quickdash npm ci --omit=dev --prefix /opt/quickdash
sudo systemctl restart quickdash
```

**Automatically:** `setup.sh` also installs (but doesn't enable) a systemd
timer that checks for new commits every few minutes and deploys them —
pulls, reinstalls dependencies only if `package-lock.json` changed, and
restarts the service, all as the unprivileged `quickdash` user except the
restart itself. No GitHub-side credentials or webhook needed since it
polls from the VM using the repo access it already has.

```bash
sudo systemctl enable --now quickdash-autoupdate.timer
sudo systemctl list-timers quickdash-autoupdate.timer   # confirm it's scheduled
sudo journalctl -u quickdash-autoupdate -n 20 --no-pager  # see recent update runs
```

To change how often it checks, edit `OnUnitActiveSec=` in
`/etc/systemd/system/quickdash-autoupdate.timer`, then
`sudo systemctl daemon-reload && sudo systemctl restart quickdash-autoupdate.timer`.
To stop auto-updating: `sudo systemctl disable --now quickdash-autoupdate.timer`.

## Backups

`data/db.json` on the VM holds all accounts and activity history. It's on
the persistent disk, so it survives restarts and redeploys, but not a
deleted VM. Periodically copy it off, e.g.:

```bash
gcloud compute scp quickdash:/opt/quickdash/data/db.json ./db-backup.json --zone=us-west1-b
```
