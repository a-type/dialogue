import { expect, inject, it, vi } from 'vitest';
import { z } from 'zod/v4-mini';
import {
	Connection,
	defineConfig,
	Logger,
	OmitMessageProperty,
} from '../src/index.js';

const port = inject('SERVER_PORT');

const clientMessage = z.union([
	z.object({ type: z.literal('ping') }),
	z.object({ type: z.literal('disconnect') }),
	z.object({ type: z.literal('stop-heartbeat') }),
	z.object({ type: z.literal('request'), id: z.string() }),
]);
type ClientMessage = z.infer<typeof clientMessage>;
// pre-processing, the "request" message type has no id
type ClientMessageBeforeProcessing = OmitMessageProperty<ClientMessage, 'id'>;

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
	preprocessClientMessage: (message: ClientMessageBeforeProcessing) => {
		if (message.type === 'request') {
			return { ...message, id: crypto.randomUUID() };
		}
		return message;
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

it('preprocesses messages', async ({ onTestFinished }) => {
	const socket = await setup();
	onTestFinished(() => socket.close());

	const onMessage = vi.fn();
	socket.on('*', onMessage);
	const processed = socket.send({ type: 'request' });

	expect(processed).toHaveProperty('id');
});

it('subscribes to all messages', async ({ onTestFinished }) => {
	const socket = await setup();
	onTestFinished(() => socket.close());

	const onMessage = vi.fn();
	socket.on('*', onMessage);

	// various types of messages to trigger server responses
	socket.send({ type: 'request' });
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
		messageId: expect.any(String),
	});
	expect(onMessage).toHaveBeenCalledWith({ type: 'pong' });
});

it('waits for a response', async ({ onTestFinished }) => {
	const socket = await setup();
	onTestFinished(() => socket.close());

	const response = await socket.request({ type: 'request' });
	expect(response).toEqual({ type: 'response', messageId: expect.any(String) });
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
