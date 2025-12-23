# Use Node.js 18 LTS as base image
FROM node:18-bullseye

# Set working directory
WORKDIR /app

# Install system dependencies including Inkscape
# - Inkscape for SVG to PDF conversion
# - Required fonts and libraries for Inkscape
RUN apt-get update && apt-get install -y \
    inkscape \
    libpango1.0-0 \
    libcairo2 \
    libgdk-pixbuf2.0-0 \
    libatk1.0-0 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libharfbuzz0b \
    libfreetype6 \
    libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*

# Verify Inkscape installation
RUN which inkscape && inkscape --version

# Set environment variable for Inkscape path in production
ENV INKSCAPE_BIN=/usr/bin/inkscape

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port (Railway will set PORT dynamically)
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 4000) + '/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start the application
CMD ["npm", "start"]
