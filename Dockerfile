
# Node.js 22
FROM node:22-bookworm-slim

# Main repository directory
WORKDIR /workspace

# Copy both Fattixx projects
COPY . .

# Install shared dependencies using the existing lockfile
RUN cd Fattixx-web && npm ci

# Make the public Turnstile key available during Next.js build
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}

# Build Fattixx-admin using its original package.json
RUN cd Fattixx-admin && npm run build

# Production configuration
ENV NODE_ENV=production
ENV PORT=8080

# Run the admin application from its own directory
WORKDIR /workspace/Fattixx-admin

# DigitalOcean HTTP port
EXPOSE 8080

# Start Next.js with shared dependencies
CMD ["sh", "-c", "node ../Fattixx-web/node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-8080}"]
