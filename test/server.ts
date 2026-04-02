/// <reference types="node" />

import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

export async function startTestServer() {
	const port = Math.floor(8000 + Math.random() * 1000);

	const server = createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('WebSocket server is running.\n');
	});

	const wss = new WebSocketServer({ noServer: true });

	const socketToId = new WeakMap<WebSocket, number>();
	let nextSocketId = 1;
	const stopHeartbeats = new Set<number>();

	function handleMessage(ws: WebSocket, raw: Buffer): void {
		console.log(
			`Received message from client ${socketToId.get(ws)}: ${raw.toString()}`,
		);
		const message = raw.toString();
		const data = JSON.parse(message);

		if (data.type === 'ping') {
			if (!stopHeartbeats.has(socketToId.get(ws)!)) {
				ws.send(JSON.stringify({ type: 'pong' }));
			}
		} else if (data.type === 'disconnect') {
			ws.close(1008, 'Client requested disconnect');
		} else if (data.type === 'stop-heartbeat') {
			stopHeartbeats.add(socketToId.get(ws)!);
		} else if (data.type === 'request') {
			setTimeout(() => {
				ws.send(
					JSON.stringify({
						type: 'response',
						messageId: data.id,
					}),
				);
			}, 300);
		}
	}

	server.on('upgrade', (req, socket, head) => {
		if (req.url === '/ws?fail=true') {
			console.log('Simulating connection failure for WebSocket upgrade');
			socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
			socket.destroy();
			return;
		}

		wss.handleUpgrade(req, socket, head, function done(ws) {
			wss.emit('connection', ws, req);
		});
	});

	wss.on('connection', (ws, req) => {
		console.log(`Client connected`);

		socketToId.set(ws, nextSocketId++);

		ws.send(
			JSON.stringify({ type: 'welcome', message: 'Connected to server' }),
		);

		ws.on('message', (data, isBinary) => {
			if (isBinary || !(data instanceof Buffer)) return;
			handleMessage(ws, data);
		});

		ws.on('close', () => {
			console.log('Client disconnected');
		});

		ws.on('error', (err) => {
			console.error('WebSocket error:', err);
		});
	});

	server.listen(port, () => {
		console.log(`HTTP/WebSocket server listening on http://localhost:${port}`);
	});

	function cleanup() {
		wss.clients.forEach((client) => {
			client.close(1000, 'Server shutting down');
		});
		server.close(() => {
			console.log('Server closed');
		});
	}

	process.on('beforeExit', cleanup);
	process.on('SIGINT', () => {
		cleanup();
		process.exit();
	});

	return {
		port,
		cleanup,
	};
}
