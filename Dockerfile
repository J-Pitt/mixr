# Website only. Electron does not run in this image.
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ffmpeg ca-certificates curl \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:client

ENV MIXR_DATA_DIR=/data \
    MIXR_HOST=0.0.0.0 \
    MIXR_PORT=8787

EXPOSE 8787
VOLUME /data

CMD ["npx", "tsx", "server/standalone.ts"]
