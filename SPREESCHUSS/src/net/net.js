import { bus } from '../engine/eventbus.js';

// Optional online client. The game is fully playable offline with bots; this
// connects to the lobby server (server/index.js) when a URL is provided.
export class NetClient {
  constructor(url = `ws://${location.hostname}:8090`) {
    this.url = url;
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.peers = new Map();
  }

  connect(room = 'lobby') {
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      console.warn('[net] Verbindung fehlgeschlagen, Offline-Modus.', e);
      return;
    }
    this.ws.onopen = () => { this.connected = true; this.send('join', { room }); bus.emit('net:open'); };
    this.ws.onclose = () => { this.connected = false; bus.emit('net:close'); };
    this.ws.onerror = () => { this.connected = false; };
    this.ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      const { type, data } = msg;
      if (type === 'welcome') this.id = data.id;
      if (type === 'peer:join') this.peers.set(data.id, {});
      if (type === 'peer:leave') this.peers.delete(data.id);
      if (type === 'state') { const p = this.peers.get(data.id) || {}; Object.assign(p, data); this.peers.set(data.id, p); }
      bus.emit('net:' + type, data);
    };
  }

  send(type, data) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type, data }));
  }

  sendState(state) { this.send('state', state); }
}
