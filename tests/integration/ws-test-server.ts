import { WebSocketServer } from 'ws';

// Bind to ephemeral port 0 and return the OS-assigned port. The previous
// freePort() helper (bind to 0, close, rebind) had a TOCTOU race under parallel
// test workers — two workers could receive the same released port and collide
// with EADDRINUSE on the re-bind.
export async function createTestWebSocketServer(): Promise<{
  server: WebSocketServer;
  port: number;
}> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('unable to allocate test WS port');
  }
  return { server, port: address.port };
}
