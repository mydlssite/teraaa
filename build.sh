#!/usr/bin/env bash
# Build script for VPS deployment (not needed for Render — use Dockerfile instead)

set -e

echo "📦 Installing Python dependencies..."
pip install -r requirements.txt

echo "🌐 Installing Playwright Chromium browser + deps..."
playwright install --with-deps chromium

echo "✅ Build complete!"
echo "🚀 Start with: gunicorn server:app --bind 0.0.0.0:5000 --timeout 120 --workers 2"
