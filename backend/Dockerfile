FROM node:20-alpine

WORKDIR /app

# Dependencies first, so a change to the source does not reinstall them.
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY backend/ ./

ENV NODE_ENV=production
CMD ["node", "start.js"]
