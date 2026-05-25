.DEFAULT_GOAL := help

BACKEND_DIR := backend
FRONTEND_DIR := frontend
UV := uv
NPM := npm
COMPOSE_FILE ?= compose.yaml
PROD_COMPOSE_FILE ?= docker-compose.prod.yml
DOCKER_COMPOSE := docker compose -f $(COMPOSE_FILE)
DOCKER_COMPOSE_PROD := docker compose -f $(PROD_COMPOSE_FILE)

.PHONY: help \
	backend-sync backend-sync-dev backend-migrate backend-dev backend-gunicorn \
	backend-docker-build nginx-docker-build docker-build docker-config docker-up docker-rebuild docker-down docker-logs docker-ps \
	docker-prod-config docker-prod-up docker-prod-down docker-prod-logs docker-prod-ps docker-prod-deploy \
	caddy-export-local-ca caddy-trust-local-ca caddy-trust-browser-ca \
	backend-lint backend-lint-fix backend-format \
	backend-test backend-test-unit backend-test-integration backend-test-cov \
	frontend-install frontend-dev frontend-dev-go frontend-android frontend-android-device frontend-ios frontend-web \
	frontend-lint frontend-typecheck

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_.-]+:.*## / {printf "%-24s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

backend-sync: ## Install backend dependencies
	cd $(BACKEND_DIR) && $(UV) sync

backend-sync-dev: ## Install backend dependencies with dev tools
	cd $(BACKEND_DIR) && $(UV) sync --group dev

backend-migrate: ## Apply database schema updates (create tables + incremental fixes)
	cd $(BACKEND_DIR) && $(UV) run python migrate.py

backend-dev: ## Run backend with auto-migrate on start and when schema files change
	cd $(BACKEND_DIR) && $(UV) run python scripts/dev.py

backend-gunicorn: ## Run the backend with Gunicorn
	cd $(BACKEND_DIR) && $(UV) run python -m gunicorn main:app --bind 0.0.0.0:$${PORT:-8000} --worker-class uvicorn_worker.UvicornWorker --workers $${WEB_CONCURRENCY:-$$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)} --timeout $${GUNICORN_TIMEOUT:-60} --graceful-timeout $${GUNICORN_GRACEFUL_TIMEOUT:-30} --keep-alive $${GUNICORN_KEEPALIVE:-5} --access-logfile - --error-logfile - --log-level $${LOG_LEVEL:-info} --capture-output

backend-docker-build: ## Build the backend Docker image
	docker build -f $(BACKEND_DIR)/Dockerfile -t billing-backend:latest $(BACKEND_DIR)

nginx-docker-build: ## Build the nginx reverse-proxy image
	docker build -f nginx/Dockerfile -t billing-nginx:latest nginx

docker-build: ## Build services from the selected Compose file; use COMPOSE_FILE=...
	$(DOCKER_COMPOSE) build

docker-config: ## Validate the selected Compose file; use COMPOSE_FILE=...
	$(DOCKER_COMPOSE) config

docker-up: ## Start services from the selected Compose file; remove orphaned old services
	$(DOCKER_COMPOSE) up --build --remove-orphans

docker-rebuild: ## Rebuild and recreate services from the selected Compose file; remove orphaned old services
	$(DOCKER_COMPOSE) up --build --force-recreate --remove-orphans

docker-down: ## Stop services from the selected Compose file; remove orphaned old services
	$(DOCKER_COMPOSE) down --remove-orphans

docker-logs: ## Tail logs from the selected Compose file; use COMPOSE_FILE=...
	$(DOCKER_COMPOSE) logs -f

docker-ps: ## Show service status from the selected Compose file; use COMPOSE_FILE=...
	$(DOCKER_COMPOSE) ps

docker-prod-config: ## Validate production Compose file
	$(DOCKER_COMPOSE_PROD) --env-file .env.prod.example config

docker-prod-up: ## Start full production stack (requires .env on VM)
	COMPOSE_PROFILES=infra $(DOCKER_COMPOSE_PROD) up -d --remove-orphans

docker-prod-down: ## Stop production stack
	$(DOCKER_COMPOSE_PROD) down --remove-orphans

docker-prod-logs: ## Tail production stack logs
	$(DOCKER_COMPOSE_PROD) logs -f

docker-prod-ps: ## Show production service status
	$(DOCKER_COMPOSE_PROD) ps

docker-prod-deploy: ## Run production deploy script (pull app images, rollback on failure)
	bash scripts/deploy-prod.sh

caddy-export-local-ca: ## Copy Caddy's local root CA to caddy/certs/caddy-local-root.crt
	mkdir -p caddy/certs
	$(DOCKER_COMPOSE) cp caddy:/data/caddy/pki/authorities/local/root.crt caddy/certs/caddy-local-root.crt

caddy-trust-local-ca: caddy-export-local-ca ## Trust Caddy's local root CA on Debian/Ubuntu hosts
	sudo install -m 0644 caddy/certs/caddy-local-root.crt /usr/local/share/ca-certificates/caddy-local-root.crt
	sudo update-ca-certificates

caddy-trust-browser-ca: caddy-export-local-ca ## Import Caddy's local root CA into the NSS browser trust store
	test -n "$$(command -v certutil)" || (echo "certutil not found; install libnss3-tools first" && exit 1)
	mkdir -p "$$HOME/.pki/nssdb"
	certutil -d sql:"$$HOME/.pki/nssdb" -A -t "C,," -n "Caddy Local Authority" -i caddy/certs/caddy-local-root.crt

backend-lint: ## Run Ruff checks for the backend
	cd $(BACKEND_DIR) && $(UV) run ruff check .

backend-lint-fix: ## Run Ruff with auto-fixes for the backend
	cd $(BACKEND_DIR) && $(UV) run ruff check . --fix

backend-format: ## Format backend Python files with Ruff
	cd $(BACKEND_DIR) && $(UV) run ruff format .

backend-test: ## Run all backend tests
	cd $(BACKEND_DIR) && $(UV) run --with pytest pytest ../test/ -v

backend-test-unit: ## Run backend unit tests only
	cd $(BACKEND_DIR) && $(UV) run --with pytest pytest ../test/unit/ -v

backend-test-integration: ## Run backend integration tests only
	cd $(BACKEND_DIR) && $(UV) run --with pytest pytest ../test/integration/ -v

backend-test-cov: ## Run backend tests with coverage output
	cd $(BACKEND_DIR) && $(UV) run --with pytest --with pytest-cov pytest ../test/ --cov=app --cov-report=html

frontend-install: ## Install frontend dependencies
	cd $(FRONTEND_DIR) && $(NPM) install

frontend-dev: ## Start the Expo dev client server
	cd $(FRONTEND_DIR) && npx expo start --dev-client

frontend-dev-go: ## Start Expo in Go mode
	cd $(FRONTEND_DIR) && npx expo start --go

frontend-android: ## Run the Expo Android app
	$(NPM) --prefix $(FRONTEND_DIR) run android

frontend-android-device: ## Run the Expo Android app on a connected device; optional DEVICE=<adb serial or name>
	$(NPM) --prefix $(FRONTEND_DIR) run android -- --device $(DEVICE)

frontend-ios: ## Run the Expo iOS app
	$(NPM) --prefix $(FRONTEND_DIR) run ios

frontend-web: ## Start Expo for web
	cd $(FRONTEND_DIR) && npx expo start --web

frontend-lint: ## Run frontend ESLint
	cd $(FRONTEND_DIR) && $(NPM) run lint

frontend-typecheck: ## Run frontend TypeScript type checks
	cd $(FRONTEND_DIR) && $(NPM) run typecheck
