.PHONY: help dev build start migrate seed docker-build docker-up docker-down docker-logs docker-restart test-health test-api clean

DOCKER_TAG ?= gate-concierge
PORT ?= 3000

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Local Development ─────────────────────────────────────────

dev: ## Start dev server with hot reload
	npm run dev

build: ## Compile TypeScript
	npm run build

start: ## Run production build locally
	npm run start

migrate: ## Initialize / migrate database
	npm run migrate

seed: ## Seed sample residents
	npm run seed

# ── Docker ────────────────────────────────────────────────────

docker-build: ## Build Docker image
	docker build -t $(DOCKER_TAG) .

docker-up: ## Start with docker-compose
	docker compose up -d --build

docker-down: ## Stop containers
	docker compose down

docker-logs: ## Tail container logs
	docker compose logs -f gate-concierge

docker-restart: ## Restart containers
	docker compose restart

docker-shell: ## Shell into running container
	docker exec -it gate-concierge /bin/bash

# ── Testing ───────────────────────────────────────────────────

test-health: ## Curl health endpoint
	@curl -s http://localhost:$(PORT)/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:$(PORT)/health

test-api: ## Run full API smoke test
	@echo "── Health ──"
	@curl -s http://localhost:$(PORT)/health | python3 -m json.tool
	@echo "\n── List residents ──"
	@curl -s -u admin:changeme http://localhost:$(PORT)/api/residents | python3 -m json.tool
	@echo "\n── Stats ──"
	@curl -s -u admin:changeme http://localhost:$(PORT)/api/stats | python3 -m json.tool

# ── Maintenance ───────────────────────────────────────────────

backup: ## Backup SQLite database from container
	docker cp gate-concierge:/app/data/gate-concierge.db ./backup-$$(date +%Y%m%d-%H%M%S).db
	@echo "Backup saved."

clean: ## Remove build artifacts
	rm -rf dist/ node_modules/ data/*.db logs/*.log
