# The interface, built and then served by nginx.
#
# Two stages: Angular needs a toolchain to build and nothing to run, so the
# toolchain does not travel. The result is static files and a proxy.

FROM node:20-alpine AS build

WORKDIR /app

COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY web/ ./
RUN npm run build

FROM nginx:1.27-alpine

COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/browser /usr/share/nginx/html

EXPOSE 80
