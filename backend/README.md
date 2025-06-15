# Video Chat Backend

This is the backend server for the random video chat application. It handles WebRTC signaling and user matching.

## Features

- WebRTC signaling server
- Random user matching
- Interest-based matching
- Text chat support
- Real-time communication using Socket.IO

## Prerequisites

- Node.js >= 14.0.0
- npm

## Installation

1. Clone the repository
2. Navigate to the backend directory:
   ```bash
   cd backend
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Environment Variables

Create a `.env` file in the backend directory with the following variables:

```
PORT=3000
FRONTEND_URL=https://your-frontend-url.com
```

## Running the Server

Development:
```bash
npm run dev
```

Production:
```bash
npm start
```

## API Endpoints

The server uses WebSocket connections for real-time communication. No REST endpoints are exposed.

## Deployment

This server is configured for deployment on Render.com. The `package.json` includes the necessary scripts and engine specifications. 