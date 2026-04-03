# Dialogue

A small&mdash;opinionated&mdash;robust&mdash;convenient WebSocket wrapper.

## Features

- Automatic reconnection with exponential backoff
  - Reconnects on error
  - Reconnects based on heartbeat to detect broken pipes
- Buffers outgoing messages until connection is ready
- Parses and validates incoming and outgoing messages to your schema
- Easily subscribe to specific message types with typechecking: `on('chat', (chatMessage) => {})`
- All subscribers return unsubcribers
- `once()`
- Send a "request" message which awaits a response
- Preprocess outgoing messages
- No dependencies

## Get started

Configure your Connection with client and server message validators. These validators will automatically apply appropriate types to the Connection's methods.

```ts
import { Connection } from '@a-type/dialogue';
import { z } from 'zod';

// define validators for your server and client message protocol
// (you don't have to use Zod - anything that takes in a raw
// JSON message and returns a typed one)

const clientMessageSchema = z.union([
	z.object({ type: z.literal('ping') }),
	z.object({ type: z.literal('chat'), message: z.string() }),
	z.object({ type: z.literal('ack-this'), id: z.string() }),
]);
type ClientMessage = z.infer<typeof clientMessageSchema>;
const serverMessageSchema = z.union([
	z.object({ type: z.literal('pong') }),
	z.object({ type: z.literal('new-chat'), message: z.string() }),
	z.object({ type: z.literal('ack'), ackedId: z.string() }),
]);

// setup a Connection

const connection = new Connection({
	// required: which key indicates the message type?
	messageTypeKey: 'type',
	parseClientMessage: (m) => clientMessageSchema.parse(m),
	parseServerMessage: (m) => serverMessageSchema.parse(m),
	// optional. omit to open connection manually
	openImmediately: true,
	// configure your websocket connection
	websocket: {
		getUrl: async () => {
			// you can fetch a token here, or whatever
			const token = await getToken();
			return `wss://your.app/socket?token=${token}`;
		},
	},
	// optional: setup response handling for request()
	// what indicates a message is meant as a response for another?
	// remember... delivery isn't guaranteed... request() is just
	// a convenience.
	getIsResponse: (clientMsg, serverMsg) => {
		if (clientMsg.type === 'ack-this' && serverMsg.type === 'ack') {
			return serverMsg.ackedId === clientMsg.id;
		}
		return false;
	},
	// optional: apply pre-processing to all outgoing messages, like adding
	// a timestamp or generating an ID. you must manually specify a type
	// for the parameter, which becomes the type used for validating send()
	// and request() automatically.
	preprocessClientMessage: (
		input: OmitMessageProperty<ClientMessage, 'id'>,
	) => {
		if (input.type === 'ack-this') {
			return {
				...input,
				id: Math.random().toString(),
			};
		}
		return input;
	},
	// optional: configure heartbeat
	heartbeat: {
		getPing: () => `{"type":"ping"}`, // this is the default.
		interval: 5000,
		pongTimeout: 2000,
	},
});
```

## Using a Connection

### Connecting and disconnecting

```ts
connection.open();

connection.close();
```

If your `getUrl` configured function throws an error, it will not attempt a reconnect. It's assumed you had a non-retryable failure, like authentication failure. If you have logic like token fetching in `getUrl` you want to retry, you must handle that yourself.

### Sending and subscribing to messages

```ts
// send a message. parameter is typechecked and runtime validated.
connection.send({ type: 'chat', message: 'hello world' });

// subscribe to any incoming message with '*'. "message" is typed
// as any server message. cleanup removes the listener.
const cleanup = connection.on('*', (message) => {});

// subscribe to a particular message type. "message" is narrowed
// to that type.
connection.on('ack', (message) => {});

// listen for one matching message, then clean up automatically
connection.once('new-chat', (message) => {});

// send a message and await a response. "response" is decided
// by the 'getIsResponse' configuration passed to the constructor.
// by default any incoming message is considered a response.
const response = await connection.request(
	{
		type: 'ack-this',
		id: 'foo',
	},
	{
		timeout: 5000, // the default. throws if hit.
	},
);
```

## Advanced

Supply an override for `WebSocket` with `config.websocket.environment.WebSocket`.

Configure whether the socket should auto-reconnect on clean server close (code 1000) with `config.websocket.reconnectOnServerClose`.

Configure whether an incoming message is treated as a pong for heartbeats with `config.heartbeat.isPong`.

Turn off default logging with `config.logger: false` or pass it your own object which implements the `ILogger` interface.

When using the default logging, show debug messages by setting `DEBUG` to `dialogue` or `true` in `localStorage`.

To tune the reconnection backoff settings, see options on `config.websocket`: `initialReconnectDelay`, `maxReconnectDelay`, `reconnectDelayFactor`, `maxReconnectAttempts`.

Invalid server messages are ignored by default. To handle them, pass `config.onInvalidServerMessage`. It receives the raw string message, and the error from either JSON.parse or your server message validator.
