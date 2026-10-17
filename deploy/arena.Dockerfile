# ============================================================
#  Arena (web CTF) — image produksi
#  Build context = folder root project
#  Jalankan: docker compose up -d --build   (lihat deploy/)
# ============================================================

FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

# Dependensi dulu supaya layer cache kepakai
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Aplikasi
COPY server.js ./
COPY public ./public
COPY data ./data
COPY challenges ./challenges

# data/ dan challenges/ juga di-mount oleh compose supaya bisa
# diedit tanpa rebuild image — isi image ini hanya cadangan.

EXPOSE 8080

USER node
CMD ["node", "server.js"]
