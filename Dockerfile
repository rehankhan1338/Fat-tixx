FROM node:22-bookworm-slim

WORKDIR /workspace

# Copy both applications
COPY . .

# Install shared dependencies
RUN cd Fattixx-web && npm ci

# Public environment variable needed at build time
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}

# Build admin with temporary database values.
# These are NOT real database credentials.
RUN cd Fattixx-admin && \
    DB_HOST=127.0.0.1 \
    DB_PORT=3306 \
    DB_USER=build_placeholder \
    DB_PASSWORD=build_placeholder \
    DB_NAME=build_placeholder \
    npm run build

# Production configuration
ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /workspace/Fattixx-admin

EXPOSE 8080

# Run Next.js
CMD ["sh", "-c", "node ../Fattixx-web/node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-8080}"]
