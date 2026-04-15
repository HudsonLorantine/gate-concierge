# Gate Concierge

**WhatsApp-based AI concierge for condo visitor management and plate validation.**

Residents pre-register visitors. Guards validate arriving vehicles by plate number. System matches plates against active passes and returns ALLOW / DENY / MANUAL CHECK.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────┐
│  WhatsApp    │────▶│  Gate Concierge  │────▶│  SQLite  │
│  (OpenClaw)  │◀────│  Node.js/Express │◀────│  DB      │
└─────────────┘     ├──────────────────┤     └─────────��┘
                    │  REST API        │
��─────────────┐     │  Admin Dashboard │
│  Admin UI   │────▶│  Plate OCR       │
└─────────────┘     │  Audit Logs      │
                    └──────────────────┘
```

**Architecture:** Self-contained Node.js service. Talks to WhatsApp directly
via [Baileys](https://github.com/WhiskeySockets/Baileys) (the WhatsApp Web
multi-device protocol) — no Meta Cloud API account, no OpenClaw middleman, no
third-party gateway. On first run it prints a QR code that you scan once from
your phone to pair the bot, the same way the WhatsApp Web browser tab works.

**Next:** Camera ANPR feed, gate relay automation.

---

## Quick Start (Docker — recommended)

```bash
# 1. Clone
git clone https://github.com/YOUR_USER/gate-concierge.git
cd gate-concierge

# 2. Configure
cp .env.example .env
# Edit .env if needed (defaults work for dev)

# 3. Build & run
docker compose up -d --build

# 4. Verify
curl http://localhost:3000/health

# 5. Seed sample data
docker exec gate-concierge node -e "
  require('./dist/database/db').initializeDatabase();
  const { v4 } = require('uuid');
  const db = require('./dist/database/db').getDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO residents (id, name, unit_number, phone_number) VALUES (?, ?, ?, ?)');
  stmt.run(v4(), 'Ahmad Razak', 'A-10-01', '60123456789');
  stmt.run(v4(), 'Sarah Tan', 'B-12-03', '60198765432');
  stmt.run(v4(), 'Raj Kumar', 'C-05-08', '60171234567');
  console.log('Seeded.');
"
```

---

## Pairing the Bot with WhatsApp (first run)

The bot uses the **WhatsApp Web multi-device protocol** — same as linking
WhatsApp to a laptop browser. You pair it once, and the credentials are
persisted to the `concierge-data` Docker volume so it survives restarts.

### Step 1 — start the container

```bash
docker compose up -d --build
```

### Step 2 — get the pairing QR

Pick whichever is easier:

**Option A — from container logs (ASCII QR)**

```bash
docker compose logs -f gate-concierge | grep -A 40 "pairing required"
```

You'll see an ASCII QR code in the logs. Scan it with your phone camera.

**Option B — from the admin dashboard (PNG QR)**

Open `http://<your-host>:<port>/admin` and go to the **WhatsApp** panel.
The QR refreshes automatically every few seconds until you pair.

**Option C — raw PNG endpoint**

```bash
curl -u admin:changeme http://localhost:3000/api/whatsapp/qr.png -o qr.png
open qr.png  # or xdg-open / display / etc.
```

### Step 3 — scan from your phone

On the phone that will be the bot:

1. Open **WhatsApp**
2. Settings → **Linked Devices** → **Link a Device**
3. Point the camera at the QR code
4. Wait ~3 seconds — the container logs will show `WhatsApp connected as <your-number>`

### Step 4 — verify

```bash
curl -u admin:changeme http://localhost:3000/api/whatsapp/status
# { "state": "open", "pairedNumber": "60123456789", ... }

curl http://localhost:3000/health
# { "status":"ok", "whatsapp":{ "state":"open", ... } }
```

Send yourself a message (self-chat) or DM the bot's number from another phone:

- **`help`** — list commands
- **`register`** — start a new visitor registration flow
- **`today`** — list today's passes

In group chats, prefix commands with `luna ` (or `/`), e.g.:
`luna register ABC1234 John tonight 7pm`

### Re-pairing

If the phone logs out, is lost, or you want to switch numbers:

```bash
curl -u admin:changeme -X POST http://localhost:3000/api/whatsapp/logout
# Wipes saved credentials and emits a fresh QR for re-pairing
```

---

## Quick Start (Local — requires Node.js 20+)

```bash
npm install
cp .env.example .env
npm run migrate
npm run seed
npm run dev
```

---

## API Reference

All `/api/*` endpoints require **Basic Auth** (`admin:changeme` by default).

### Health Check (public)

```bash
curl http://localhost:3000/health
```

### Residents

```bash
# List all residents
curl -u admin:changeme http://localhost:3000/api/residents

# Get one resident
curl -u admin:changeme http://localhost:3000/api/residents/RESIDENT_ID

# Add a resident
curl -u admin:changeme -X POST http://localhost:3000/api/residents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ahmad Razak",
    "unit_number": "A-10-01",
    "phone_number": "60123456789"
  }'

# Update resident
curl -u admin:changeme -X PUT http://localhost:3000/api/residents/RESIDENT_ID \
  -H "Content-Type: application/json" \
  -d '{"status": "inactive"}'
```

### Visitor Passes

```bash
# Create a visitor pass
curl -u admin:changeme -X POST http://localhost:3000/api/passes \
  -H "Content-Type: application/json" \
  -d '{
    "resident_id": "RESIDENT_ID",
    "visitor_name": "John Tan",
    "car_plate": "VEP1234",
    "expected_arrival": "2026-04-07T19:00:00.000Z",
    "notes": "Dinner guest"
  }'

# List today's passes
curl -u admin:changeme http://localhost:3000/api/passes/today

# List recent passes
curl -u admin:changeme http://localhost:3000/api/passes/recent

# Get one pass
curl -u admin:changeme http://localhost:3000/api/passes/PASS_ID

# Cancel a pass
curl -u admin:changeme -X POST http://localhost:3000/api/passes/PASS_ID/cancel
```

### Plate Validation

```bash
# Validate plate by text
curl -u admin:changeme -X POST http://localhost:3000/api/validate-plate \
  -H "Content-Type: application/json" \
  -d '{"plate": "VEP1234"}'

# Validate plate by image upload
curl -u admin:changeme -X POST http://localhost:3000/api/validate-plate \
  -F "image=@vehicle-photo.jpg"
```

### Plate Events & Audit

```bash
# Recent plate scan events
curl -u admin:changeme http://localhost:3000/api/plate-events

# Audit logs
curl -u admin:changeme http://localhost:3000/api/audit-logs

# Filter audit by entity type
curl -u admin:changeme "http://localhost:3000/api/audit-logs?entity_type=visitor_pass"
```

### Dashboard Stats

```bash
curl -u admin:changeme http://localhost:3000/api/stats
```

---

## Full Smoke Test Script

```bash
#!/bin/bash
BASE="http://localhost:3000"
AUTH="admin:changeme"

echo "=== Health ==="
curl -s $BASE/health | python3 -m json.tool

echo -e "\n=== Create Resident ==="
RES=$(curl -s -u $AUTH -X POST $BASE/api/residents \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","unit_number":"T-01-01","phone_number":"60100000001"}')
echo $RES | python3 -m json.tool
RES_ID=$(echo $RES | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo -e "\n=== Create Visitor Pass ==="
PASS=$(curl -s -u $AUTH -X POST $BASE/api/passes \
  -H "Content-Type: application/json" \
  -d "{\"resident_id\":\"$RES_ID\",\"visitor_name\":\"John Tan\",\"car_plate\":\"VEP1234\",\"expected_arrival\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}")
echo $PASS | python3 -m json.tool
PASS_ID=$(echo $PASS | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo -e "\n=== Validate Plate (should ALLOW) ==="
curl -s -u $AUTH -X POST $BASE/api/validate-plate \
  -H "Content-Type: application/json" \
  -d '{"plate":"VEP1234"}' | python3 -m json.tool

echo -e "\n=== Validate Unknown Plate (should DENY) ==="
curl -s -u $AUTH -X POST $BASE/api/validate-plate \
  -H "Content-Type: application/json" \
  -d '{"plate":"XYZ9999"}' | python3 -m json.tool

echo -e "\n=== Today's Passes ==="
curl -s -u $AUTH $BASE/api/passes/today | python3 -m json.tool

echo -e "\n=== Stats ==="
curl -s -u $AUTH $BASE/api/stats | python3 -m json.tool

echo -e "\n=== Audit Logs ==="
curl -s -u $AUTH $BASE/api/audit-logs | python3 -m json.tool

echo -e "\n✅ Smoke test complete."
```

---

## Admin Dashboard

Open in browser: `http://localhost:3000/admin`

Login with credentials from `.env` (default: `admin` / `changeme`).

Features:
- Stats overview (residents, passes, plate events)
- Today's visitor passes (with cancel)
- Resident management (add/deactivate)
- Manual plate validator (text or image)
- Plate event history
- Audit log viewer

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `residents` | Authorized residents (name, unit, phone) |
| `visitor_passes` | Registered visitor entries with validity window |
| `plate_events` | Every plate scan/validation result |
| `gate_actions` | Gate open/deny decisions (Phase 4) |
| `audit_logs` | Full audit trail of all actions |

---

## Docker Commands

```bash
make docker-build    # Build image
make docker-up       # Start containers
make docker-down     # Stop containers
make docker-logs     # Tail logs
make docker-restart  # Restart
make docker-shell    # Shell into container
make backup          # Backup SQLite to local file
make test-health     # Quick health check
make test-api        # API smoke test
```

---

## Deployment to VPS

```bash
# On your VPS:
git clone https://github.com/YOUR_USER/gate-concierge.git /opt/gate-concierge
cd /opt/gate-concierge
cp .env.example .env
nano .env              # Set ADMIN_PASSWORD to something strong
docker compose up -d --build
curl http://localhost:3000/health
```

---

## Project Roadmap

- [x] Phase 1 — Backend: residents, visitor passes, plate validation API
- [x] Admin dashboard
- [ ] Phase 2 — OpenClaw/WhatsApp integration
- [ ] Phase 3 — Camera/ANPR integration
- [ ] Phase 4 — Automatic gate control
