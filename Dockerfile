#Official lightweight Node.js Alpine image as the base image
FROM node:18-alpine

# Install Git
RUN apk add --no-cache git

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of your application code
COPY . .

# Build the TypeScript code
RUN npm run build

# Set the command to run your CLI tool
ENTRYPOINT ["node", "dist/index.js"]
