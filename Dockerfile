# Use full Node image to resolve GLIBC/sqlite3 compile issues on ARM64
FROM node:20

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/database.sqlite

# Create data directory for SQLite persistence
RUN mkdir -p /data && chown -R node:node /data

# Set working directory
WORKDIR /usr/src/app

# Copy package configurations
COPY package*.json ./

# Install production dependencies and compile native addons (sqlite3) from source
RUN npm install --omit=dev --build-from-source

# Copy application source files
COPY server.js whatsapp.js ./
COPY public/ ./public/

# Change ownership of app directory
RUN chown -R node:node /usr/src/app

# Run as non-privileged node user
USER node

# Expose server port
EXPOSE 3000

# Mountable volume for SQLite database
VOLUME ["/data"]

# Run server
CMD ["node", "server.js"]
