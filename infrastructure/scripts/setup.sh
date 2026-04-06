#!/bin/bash
set -e

echo "🔧 Setting up LONGENY development environment..."

# Check prerequisites
command -v bun >/dev/null 2>&1 || { echo "❌ Bun is required. Install: curl -fsSL https://bun.sh/install | bash"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required."; exit 1; }

# Install dependencies
echo "📦 Installing dependencies..."
bun install

# Copy env file
if [ ! -f .env ]; then
  echo "📋 Creating .env from .env.example..."
  cp .env.example .env
  # Generate secrets
  echo "🔑 Generating secrets..."
  sed -i "s/change-me-generate-with-openssl-rand-hex-48/$(openssl rand -hex 48)/" .env
  sed -i "s/generate-with-openssl-rand-hex-32/$(openssl rand -hex 32)/g" .env
fi

# Start Docker services
echo "🐳 Starting Docker services..."
docker compose up -d
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Run migrations
echo "🗄️ Running database migrations..."
bun run db:generate
bun run db:migrate

# Seed data
echo "🌱 Seeding development data..."
bun run db:seed

echo ""
echo "✅ Setup complete!"
echo ""
echo "Run 'bun run dev' to start all services."
echo ""
echo "Services:"
echo "  Gateway:        http://localhost:3000"
echo "  Auth:           http://localhost:3001"
echo "  User/Provider:  http://localhost:3002"
echo "  Booking:        http://localhost:3003"
echo "  AI/Content:     http://localhost:3004"
echo "  Payment:        http://localhost:3005"
echo "  MailHog:        http://localhost:8025"
