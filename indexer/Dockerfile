FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npx prisma generate
RUN npm run build

EXPOSE 4000

# We use a script or wait-for-it for DB, but here we just start
# The first run will need migrations: npx prisma migrate deploy
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
