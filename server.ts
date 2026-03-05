import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  // Store room info: { gameState, players: { socketId: color } }
  const rooms = new Map<string, { gameState: any, players: Record<string, string> }>();

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("join-room", (roomId: string) => {
      socket.join(roomId);
      console.log(`User ${socket.id} joined room ${roomId}`);

      if (!rooms.has(roomId)) {
        rooms.set(roomId, { gameState: null, players: {} });
      }
      
      const room = rooms.get(roomId)!;
      if (room.gameState) {
        socket.emit("game-state", room.gameState);
      }
      // Send current player assignments to the joining user
      socket.emit("player-roles", room.players);
    });

    socket.on("select-role", ({ roomId, role }) => {
      const room = rooms.get(roomId);
      if (room) {
        // Remove existing role if any
        if (room.players[socket.id]) {
          delete room.players[socket.id];
        }

        // Only assign if it's a valid role (black or white)
        if (role === 'black' || role === 'white') {
          // Check if someone else already has this role
          const roleTaken = Object.values(room.players).includes(role);
          if (!roleTaken) {
            room.players[socket.id] = role;
          }
        } else if (role === 'spectator') {
          room.players[socket.id] = role;
        }
        io.to(roomId).emit("player-roles", room.players);
      }
    });

    socket.on("leave-role", (roomId: string) => {
      const room = rooms.get(roomId);
      if (room && room.players[socket.id]) {
        delete room.players[socket.id];
        io.to(roomId).emit("player-roles", room.players);
      }
    });

    socket.on("update-game", ({ roomId, state }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.gameState = state;
        // Broadcast to everyone else in the room
        socket.to(roomId).emit("game-state", state);
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      // Find which room the socket was in and remove their role
      for (const [roomId, room] of rooms.entries()) {
        if (room.players[socket.id]) {
          delete room.players[socket.id];
          io.to(roomId).emit("player-roles", room.players);
          break;
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
