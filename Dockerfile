# ---------- Stage 1: Build ----------
    FROM node:20-slim AS builder

    WORKDIR /usr/src/app
    
    COPY package*.json ./
    RUN npm ci
    
    COPY . .
    RUN npm run build
    
    
    # ---------- Stage 2: Minimal runtime ----------
    FROM node:20-slim
    
    WORKDIR /usr/src/app
    
    COPY package*.json ./
    RUN npm ci --omit=dev
    
    COPY --from=builder /usr/src/app/dist ./dist
    
    EXPOSE 8080
    
    CMD ["node", "dist/main.js"]
    