#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# ValueMitra — One-Time EC2 Server Setup Script
# Run this ONCE after creating the EC2 instance.
# Assumes: Ubuntu 24.04 LTS (Noble Numbat)
# Run as: sudo bash setup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e  # Exit immediately on any error

echo "======================================================"
echo "  ValueMitra — EC2 Server Setup"
echo "======================================================"

# ── 1. System updates ─────────────────────────────────────
echo ""
echo "→ Updating system packages..."
apt-get update -y
apt-get upgrade -y

# ── 2. Install Node.js 20 (via NodeSource) ───────────────
echo ""
echo "→ Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "  Node.js version: $(node --version)"
echo "  npm version: $(npm --version)"

# ── 3. Install PM2 globally ───────────────────────────────
echo ""
echo "→ Installing PM2..."
npm install -g pm2

# Enable PM2 startup on reboot
pm2 startup systemd -u ubuntu --hp /home/ubuntu
echo "  PM2 version: $(pm2 --version)"

# ── 4. Install Nginx ──────────────────────────────────────
echo ""
echo "→ Installing Nginx..."
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx
echo "  Nginx version: $(nginx -v 2>&1)"

# ── 5. Install MySQL client (for mysqldump import) ────────
echo ""
echo "→ Installing MySQL client..."
apt-get install -y mysql-client

# ── 6. Install Chromium deps for Playwright ───────────────
echo ""
echo "→ Installing Playwright/Chromium system dependencies..."
apt-get install -y \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 \
    libcairo2 libatspi2.0-0 libwayland-client0

# ── 7. Install LibreOffice (for PDF report generation) ────
echo ""
echo "→ Installing LibreOffice headless..."
apt-get install -y libreoffice-writer
echo "  LibreOffice version: $(soffice --version 2>/dev/null || echo 'installed')"

# ── 8. Create application directories ────────────────────
echo ""
echo "→ Creating application directories..."
mkdir -p /var/www/valuemitra
mkdir -p /var/log/valuemitra

# Set ownership to ubuntu user (EC2 default)
chown -R ubuntu:ubuntu /var/www/valuemitra
chown -R ubuntu:ubuntu /var/log/valuemitra
echo "  App dir:  /var/www/valuemitra"
echo "  Log dir:  /var/log/valuemitra"

# ── 9. Configure firewall (UFW) ───────────────────────────
echo ""
echo "→ Configuring firewall..."
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable
echo "  Firewall rules: SSH(22), HTTP(80), HTTPS(443) allowed"

# ── 10. Install Certbot (for SSL) ─────────────────────────
echo ""
echo "→ Installing Certbot (Let's Encrypt)..."
snap install --classic certbot
ln -sf /snap/bin/certbot /usr/bin/certbot
echo "  Certbot installed"

echo ""
echo "======================================================"
echo "  ✅ EC2 Setup Complete!"
echo "======================================================"
echo ""
echo "  Next steps:"
echo "  1. Clone the repo: cd /var/www/valuemitra && git clone <repo-url> ."
echo "  2. Copy your .env file to /var/www/valuemitra/apps/api/.env"
echo "  3. Run: bash infrastructure/scripts/deploy.sh"
echo ""
