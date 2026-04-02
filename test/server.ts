/// <reference types="node" />

import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { port } from './common.ts';

const server = createServer((req, res) => {
	const rawUrl = req.url ?? '';
	const url = new URL(rawUrl, `http://${req.headers.host}`);

	if (url.pathname === '/ws') {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('WebSocket server is running.\n');
		return;
	}
});

const wss = new WebSocketServer({ server });

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

wss.on('connection', (ws, req) => {
	console.log(`Client connected from ${req.socket.remoteAddress}`);

	socketToId.set(ws, nextSocketId++);

	ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to server' }));

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
