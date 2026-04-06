#!/bin/bash
echo "🏥 Checking service health..."
echo ""

services=("Gateway:3000" "Auth:3001" "UserProvider:3002" "Booking:3003" "AIContent:3004" "Payment:3005")

all_healthy=true
for service in "${services[@]}"; do
  name="${service%%:*}"
  port="${service##*:}"
  response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${port}/health" 2>/dev/null)
  if [ "$response" = "200" ]; then
    echo "  ✅ ${name} (port ${port}): healthy"
  else
    echo "  ❌ ${name} (port ${port}): unhealthy (HTTP ${response})"
    all_healthy=false
  fi
done

echo ""
if [ "$all_healthy" = true ]; then
  echo "✅ All services healthy!"
else
  echo "⚠️ Some services are unhealthy."
  exit 1
fi
