.PHONY: setup dev build test lint clean docker-up docker-down migrate seed health

# ── Setup ──
setup:
	bun install
	cp -n .env.example .env || true
	make docker-up
	sleep 3
	make migrate
	make seed
	@echo "✓ Setup complete. Run 'make dev' to start."

# ── Development ──
dev:
	bun run dev

build:
	bun run build

test:
	bun run test

lint:
	bun run lint

lint-fix:
	bun run lint:fix

format:
	bun run format

typecheck:
	bun run typecheck

clean:
	bun run clean

# ── Docker ──
docker-up:
	docker compose up -d
	@echo "Waiting for services..."
	@sleep 2
	@docker compose ps

docker-down:
	docker compose down

docker-reset:
	docker compose down -v
	docker compose up -d

# ── Database ──
migrate:
	bun run db:generate
	bun run db:migrate

seed:
	bun run db:seed

studio:
	bun run db:studio

# ── Health Check ──
health:
	@echo "Gateway:       $$(curl -s http://localhost:3000/health | head -c 50)"
	@echo "Auth:          $$(curl -s http://localhost:3001/health | head -c 50)"
	@echo "User/Provider: $$(curl -s http://localhost:3002/health | head -c 50)"
	@echo "Booking:       $$(curl -s http://localhost:3003/health | head -c 50)"
	@echo "AI/Content:    $$(curl -s http://localhost:3004/health | head -c 50)"
	@echo "Payment:       $$(curl -s http://localhost:3005/health | head -c 50)"
