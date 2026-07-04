// Lightweight authoritative-relay lobby server scaffold for Spreeschuss.
// Single-player-with-bots works WITHOUT this server. This provides a room
// system + state relay for future online play.
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8090;
const wss = new WebSocketServer({ port: PORT });

const rooms = new Map(); // roomId -> { clients:Set, state }

function send(ws, type, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, data }));
}
function broadcast(room, type, data, except) {
  for (const c of room.clients) if (c !== except) send(c, type, data);
}

wss.on('connection', (ws) => {
  ws.id = Math.random().toString(36).slice(2, 8);
  ws.room = null;
  send(ws, 'welcome', { id: ws.id });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { type, data } = msg;
    if (type === 'join') {
      const roomId = data.room || 'lobby';
      if (!rooms.has(roomId)) rooms.set(roomId, { clients: new Set(), host: ws.id });
      const room = rooms.get(roomId);
      room.clients.add(ws);
      ws.room = roomId;
      send(ws, 'joined', { room: roomId, host: room.host, count: room.clients.size });
      broadcast(room, 'peer:join', { id: ws.id }, ws);
    } else if (type === 'state' && ws.room) {
      broadcast(rooms.get(ws.room), 'state', { id: ws.id, ...data }, ws);
    } else if (type === 'event' && ws.room) {
      broadcast(rooms.get(ws.room), 'event', { id: ws.id, ...data }, ws);
    }
  });

  ws.on('close', () => {
    if (ws.room && rooms.has(ws.room)) {
      const room = rooms.get(ws.room);
      room.clients.delete(ws);
      broadcast(room, 'peer:leave', { id: ws.id });
      if (room.clients.size === 0) rooms.delete(ws.room);
    }
  });
});

console.log(`[Spreeschuss] Lobby-Server läuft auf ws://localhost:${PORT}`);
