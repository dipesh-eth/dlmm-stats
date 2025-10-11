# Use Node.js LTS version
FROM node:22-bookworm-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create a non-root user and group (if they don't exist)
RUN groupadd -g 1001 nodejs || true && \
    useradd -m -u 1001 -g nodejs nodejs || true

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app

RUN apt-get update && apt-get install -y \
    fontconfig \
    libfreetype6-dev \
    libfontconfig1 \
    fonts-liberation \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Switch to non-root user
USER nodejs

# Health check (optional but recommended)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# Start the bot
CMD ["node", "bot.js"]

