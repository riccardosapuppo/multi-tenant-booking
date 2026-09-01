FROM node:20-alpine

# Alpine ships without the zone database, so TZ is accepted and quietly
# ignored and the container stays on UTC — which puts every centre's opening
# hours out by the offset and offers the first appointment of the day two
# hours late. Two megabytes against appointments at the wrong time.
RUN apk add --no-cache tzdata

WORKDIR /app

# Dependencies first, so a change to the source does not reinstall them.
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY backend/ ./

ENV NODE_ENV=production
CMD ["node", "start.js"]
