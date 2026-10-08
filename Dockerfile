# DECOY v2 서버 이미지: 정적 클라이언트 + WebSocket 권한 서버를 한 프로세스로 띄운다.
# 방 상태는 메모리에 있으므로 인스턴스는 반드시 1개로 둔다 (docs/DEPLOY.md)

# Docker Hub 요청 제한에 걸리면 --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim
ARG NODE_IMAGE=node:22-bookworm-slim

# ── 빌드 ──
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY tests/package.json tests/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY config config
COPY docs/images/logo_decoy.png docs/images/logo_decoy.png
COPY scripts scripts
COPY shared shared
COPY server server
COPY client client
RUN npm run build

# ── 실행 ──
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
COPY --from=build /app/config/balance.json config/balance.json
COPY --from=build /app/node_modules/ws node_modules/ws
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
