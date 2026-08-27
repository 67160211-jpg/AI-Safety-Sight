FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data /app/public

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/safety-sight.db

EXPOSE 3000

CMD ["node", "server.js"]
