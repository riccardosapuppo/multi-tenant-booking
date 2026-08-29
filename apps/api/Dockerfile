FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json angular.json ./
COPY apps/api ./apps/api
COPY packages ./packages
RUN npm run build:api

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/api ./dist/api
EXPOSE 3000
CMD ["node", "dist/api/main.js"]
