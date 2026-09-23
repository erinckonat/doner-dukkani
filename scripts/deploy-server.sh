#!/bin/sh
# Build the game and deploy it with its account/save server to the VPS.
# Idempotent: the first run creates the user, folders, service and firewall rule.
# Player data in /opt/doner-dukkani/data is never touched by a deploy.
set -e
cd "$(dirname "$0")/.."
HOST="${DEPLOY_HOST:-root@185.22.186.62}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519}"
APP=/opt/doner-dukkani
PORT=8080
SSH="ssh -i $KEY -o ConnectTimeout=15 -o BatchMode=yes $HOST"

npm run build

$SSH "set -e
id doner >/dev/null 2>&1 || useradd --system --home $APP --shell /usr/sbin/nologin doner
mkdir -p $APP/server $APP/public $APP/data
chown doner:doner $APP/data && chmod 700 $APP/data"

rsync -az --delete -e "ssh -i $KEY" dist/ "$HOST:$APP/public/"
rsync -az -e "ssh -i $KEY" server/index.mjs server/admin.mjs "$HOST:$APP/server/"

$SSH "set -e
cat > /etc/systemd/system/doner-dukkani.service <<UNIT
[Unit]
Description=Döner Dükkanı oyun sunucusu
After=network.target

[Service]
Type=simple
User=doner
Group=doner
WorkingDirectory=$APP
Environment=PORT=$PORT
Environment=HOST=0.0.0.0
Environment=PUBLIC_DIR=$APP/public
Environment=DATA_DIR=$APP/data
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $APP/server/index.mjs
Restart=always
RestartSec=5
StandardOutput=append:/var/log/doner-dukkani.log
StandardError=append:/var/log/doner-dukkani.log

[Install]
WantedBy=multi-user.target
UNIT
chown -R root:root $APP/server $APP/public
systemctl daemon-reload
systemctl enable --now doner-dukkani.service >/dev/null
systemctl restart doner-dukkani.service
ufw status | grep -q '^$PORT/tcp' || ufw allow $PORT/tcp >/dev/null
sleep 1
systemctl is-active doner-dukkani.service"

echo "Deployed: http://${HOST#*@}:$PORT/"
