#!/bin/zsh
set -euo pipefail

ROOT="/Users/danielklesse"
PROJECT_DIR="$ROOT/Desktop/neontrip"
PORT="${CUSTOMER_RECORDS_PORT:-3103}"
HOST="${CUSTOMER_RECORDS_HOST:-127.0.0.1}"
PUBLIC_HOST="${CUSTOMER_RECORDS_PUBLIC_HOST:-127.0.0.1}"
URL="http://${PUBLIC_HOST}:${PORT}/ops/customer-records"
PID_FILE="${CUSTOMER_RECORDS_PID_FILE:-/tmp/neontrip-customer-records.pid}"
SUPABASE_PROJECT_ID="klibiejfisijpagzkxls"
SUPABASE_URL_VALUE="https://${SUPABASE_PROJECT_ID}.supabase.co"

alert() {
  local message="$1"
  /usr/bin/osascript -e "display alert \"NEONTRIP Customer Records\" message \"$message\""
}

is_ready() {
  /usr/bin/curl -sS -I "$URL" >/dev/null 2>&1
}

open_dashboard() {
  /usr/bin/open "$URL"
}

if is_ready; then
  echo "Dashboard läuft bereits auf $URL"
  open_dashboard
  exit 0
fi

MANAGEMENT_TOKEN="$(/usr/bin/jq -r '.mcpServers.supabase.args[-1] // empty' "$ROOT/.claude/mcp.json" 2>/dev/null || true)"
if [[ -z "$MANAGEMENT_TOKEN" ]]; then
  alert "Supabase Management-Zugriff fehlt. Die Datei ~/.claude/mcp.json enthält keinen Token."
  exit 1
fi

TRELLO_API_KEY_VALUE="$(/usr/bin/jq -r '.mcpServers.trello.env.TRELLO_API_KEY // empty' "$ROOT/.claude/mcp.json" 2>/dev/null || true)"
TRELLO_TOKEN_VALUE="$(/usr/bin/jq -r '.mcpServers.trello.env.TRELLO_TOKEN // empty' "$ROOT/.claude/mcp.json" 2>/dev/null || true)"

if [[ -z "$TRELLO_API_KEY_VALUE" || -z "$TRELLO_TOKEN_VALUE" ]]; then
  alert "Trello-Zugriff fehlt. Die Datei ~/.claude/mcp.json enthält keine Trello-API-Daten."
  exit 1
fi

SERVICE_ROLE="$(/usr/bin/curl -sS "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/api-keys" \
  -H "Authorization: Bearer ${MANAGEMENT_TOKEN}" \
  | /usr/bin/jq -r '.[]? | select(.name=="service_role") | .api_key' \
  | /usr/bin/head -n 1)"

if [[ -z "$SERVICE_ROLE" ]]; then
  alert "Service-Role-Key konnte nicht geladen werden. Bitte prüfe den Supabase-Zugriff."
  exit 1
fi

cd "$PROJECT_DIR"
echo "Starte NEONTRIP Customer Records auf $URL"

SUPABASE_URL="$SUPABASE_URL_VALUE" \
NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL_VALUE" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE" \
TRELLO_API_KEY="$TRELLO_API_KEY_VALUE" \
TRELLO_TOKEN="$TRELLO_TOKEN_VALUE" \
OPS_PORTAL_TOKEN="${OPS_PORTAL_TOKEN:-}" \
npm run dev -- --hostname "$HOST" --port "$PORT" &
SERVER_PID="$!"
echo "$SERVER_PID" >"$PID_FILE"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && /bin/kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    /bin/kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  /bin/rm -f "$PID_FILE"
}

trap cleanup EXIT INT TERM

for _ in {1..45}; do
  if is_ready; then
    echo "Dashboard bereit. Öffne Browser..."
    open_dashboard
    wait "$SERVER_PID"
    exit $?
  fi
  /bin/sleep 1
done

alert "Der lokale Server wurde nicht rechtzeitig erreichbar."
exit 1
