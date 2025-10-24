FROM node:22
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    && rm -rf /var/lib/apt/lists/*


COPY . .
RUN corepack enable && yarn install --frozen-lockfile

ENV NODE_ENV=production
ENV CHROMIUM_PATH=/usr/bin/chromium

CMD ["node", "fatsecret.js"]
