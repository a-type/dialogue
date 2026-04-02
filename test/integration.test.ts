import { expect, it, vi } from 'vitest';
import { z } from 'zod/v4-mini';
import { Connection, defineConfig, Logger } from '../src/index.js';
import { port } from './common.js';

const clientMessage = z.union([
	z.object({ type: z.literal('ping') }),
	z.object({ type: z.literal('disconnect') }),
	z.object({ type: z.literal('stop-heartbeat') }),
	z.object({ type: z.literal('request'), id: z.string() }),
]);

const serverMessage = z.union([
	z.object({ type: z.literal('welcome') }),
	z.object({ type: z.literal('pong') }),
	z.object({ type: z.literal('response'), messageId: z.string() }),
]);

const baseConfig = defineConfig({
	openImmediately: true,
	websocket: {
		getUrl: () => `ws://localhost:${port}/ws`,
	},
	messageTypeKey: 'type',
	parseClientMessage: (message: any) => {
		return clientMessage.parse(message);
	},
	parseServerMessage: (message: any) => {
		return serverMessage.parse(message);
	},
	getIsResponse: (clientMessage, serverMessage) => {
		return (
			clientMessage.type === 'request' &&
			serverMessage.type === 'response' &&
			clientMessage.id === serverMessage.messageId
		);
	},
});

// implicitly tests subscription by type
async function setup(configOverrides?: Partial<typeof baseConfig>) {
	localStorage.setItem('DEBUG', 'true'); // turn on full logging
	const logger = new Logger('🧪', 'integration-test');
	const config = { ...baseConfig, logger, ...configOverrides };
	const socket = new Connection(config);
	socket.on('*', logger.debug);
	await new Promise((resolve) => {
		const unsub = socket.on('welcome', () => {
			unsub();
			resolve(null);
		});
	});
	return socket;
}

it('automatically reconnects', async ({ onTestFinished }) => {
	const socket = await setup();
	onTestFinished(() => socket.close());

	const onConnect = vi.fn();
	socket.websocket.onConnect(onConnect);
	socket.send({ type: 'disconnect' });

	await new Promise<void>((resolve) => {
		socket.once('welcome', () => resolve());
	});
	expect(onConnect).toHaveBeenCalledTimes(1);
});

it('subscribes to all messages', async ({ onTestFinished }) => {
	const socket = await setup();
	onTestFinished(() => socket.close());

	const onMessage = vi.fn();
	socket.on('*', onMessage);

	// various types of messages to trigger server responses
	socket.send({ type: 'request', id: '123' });
	socket.heartbeat.ping();

	await vi.waitFor(
		() => {
			if (onMessage.mock.calls.length < 2) {
				throw new Error(
					`Expected to receive 2 messages. Got ${
						onMessage.mock.calls.length
					}: ${JSON.stringify(onMessage.mock.calls)}`,
				);
			}
		},
		{
			timeout: 5000,
		},
	);

	expect(onMessage).toHaveBeenCalledWith({
		type: 'response',
		messageId: '123',
	});
	expect(onMessage).toHaveBeenCalledWith({ type: 'pong' });
});

it('waits for a response', async ({ onTestFinished }) => {
	const socket = await setup();
	onTestFinished(() => socket.close());

	const response = await socket.request({ type: 'request', id: '123' });
	expect(response).toEqual({ type: 'response', messageId: '123' });
});

it('detects a failed heartbeat', async ({ onTestFinished }) => {
	const socket = await setup({
		heartbeat: {
			interval: 100,
			pongTimeout: 50,
		},
	});
	onTestFinished(() => socket.close());

	const onConnect = vi.fn();
	socket.websocket.onConnect(onConnect);

	// stop heartbeat on server and wait for detection
	socket.send({ type: 'stop-heartbeat' });

	await new Promise<void>((resolve) => {
		socket.once('welcome', () => resolve());
	});
	expect(onConnect).toHaveBeenCalledTimes(1);
});
