# Imagem do API Gateway (Node + Express). Só dependências de produção, roda como usuário "node" (não root).
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=7521 DATA_DIR=/app/data

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

# pasta do cadastro de APIs (apis.json). O docker-compose monta um volume aqui para sobreviver aos deploys.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 7521

# Docker marca o container como "healthy"/"unhealthy" consultando GET /health. A imagem não tem curl/wget: usa o fetch do Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||7521)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
