FROM node:22-slim
WORKDIR /app
COPY dist/main.mjs dist/main.mjs
COPY assets assets
ENV NODE_ENV=production
CMD ["node", "dist/main.mjs"]
