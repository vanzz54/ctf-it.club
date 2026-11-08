FROM node:20-alpine

WORKDIR /app

# Copy package.json and install dependencies
COPY src/package.json ./
RUN npm install

# Copy application source code
COPY src/ ./

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "server.js"]
