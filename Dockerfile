FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install only production dependencies (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy application source
COPY . .

# Run as the unprivileged "node" user that ships with the image
RUN chown -R node:node /app
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/health || exit 1

CMD ["node", "server.js"]
