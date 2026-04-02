import { DialogueError } from './DialogueError.ts';
import { Heartbeat, HeartbeatConfig } from './Heartbeat.ts';
import { ILogger, Logger, noopLogger } from './Logger.ts';
import {
	ReconnectingWebsocket,
	ReconnectingWebsocketConfig,
} from './ReconnectingWebsocket.ts';

type DiscriminatedMessage<TDiscriminatorKey extends string> = {
	[T in TDiscriminatorKey]: string;
};
type ResolvedMessageByType<
	TDiscriminatorKey extends string,
	TMessage extends DiscriminatedMessage<TDiscriminatorKey>,
	TType extends TMessage[TDiscriminatorKey],
> = {
	[K in TMessage[TDiscriminatorKey]]: Extract<
		TMessage,
		Record<TDiscriminatorKey, K>
	>;
}[TType];

export interface ConnectionConfig<
	TDiscriminatorKey extends string = string,
	TServerMessage extends DiscriminatedMessage<TDiscriminatorKey> =
		DiscriminatedMessage<TDiscriminatorKey>,
	TClientMessage extends DiscriminatedMessage<TDiscriminatorKey> =
		DiscriminatedMessage<TDiscriminatorKey>,
	TClientMessageBeforeProcessing = TClientMessage,
> {
	/**
	 * Connection relies on a "discriminator" key in messages to
	 * determine what type of message it is.
	 */
	messageTypeKey: TDiscriminatorKey;
	/**
	 * Provide a validator to ensure incoming messages are of the expected shape. This is important for security, especially if you are using the default JSON parsing logic.
	 *
	 * @param message The raw message data, after optional parsing
	 * @returns Whether the message is valid
	 * @throws If the message is invalid, you can throw an error to trigger the error handling logic
	 */
	parseClientMessage: (message: any) => TClientMessage;
	/**
	 * Provide a validator to ensure incoming messages are of the expected shape. This is important for security, especially if you are using the default JSON parsing logic.
	 *
	 * @param message The raw message data, after optional parsing
	 * @returns Whether the message is valid
	 * @throws If the message is invalid, you can throw an error to trigger the error handling logic
	 */
	parseServerMessage: (message: any) => TServerMessage;
	/**
	 * Optionally preprocess client messages before they are validated and sent.
	 * This is a great way to automatically add fields like timestamps or ids.
	 */
	preprocessClientMessage?: (
		message: TClientMessageBeforeProcessing,
	) => TClientMessage;

	/**
	 * Customize the logic to decide whether an incoming message is an
	 * intentional response to an outbound message. If not specified,
	 * any subsequent incoming message is considered a response.
	 */
	getIsResponse?: (
		clientMessage: TClientMessage,
		serverMessage: TServerMessage,
	) => boolean;

	/**
	 * Set to true to initiate connection on construction.
	 * Otherwise, call open() when desired.
	 */
	openImmediately?: boolean;

	/**
	 * Configure heartbeat options
	 */
	heartbeat?: HeartbeatConfig;

	/**
	 * Configure the websocket connection
	 */
	websocket: ReconnectingWebsocketConfig;

	/**
	 * Turn off default logging or provide a custom
	 * logger interface
	 */
	logger?: ILogger | false;
}

/**
 * Helper if you want to define your config independently of
 * constructing a Connection instance and still want convenient
 * type inference. Makes it so you don't have to manually fill
 * in the generics on the config type.
 */
export function defineConfig<
	TDiscriminatorKey extends string,
	TServerMessage extends DiscriminatedMessage<TDiscriminatorKey>,
	TClientMessage extends DiscriminatedMessage<TDiscriminatorKey>,
	TClientMessageBeforeProcessing = TClientMessage,
>(
	config: ConnectionConfig<
		TDiscriminatorKey,
		TServerMessage,
		TClientMessage,
		TClientMessageBeforeProcessing
	>,
) {
	return config;
}

export class Connection<
	TDiscriminatorKey extends string,
	TServerMessage extends DiscriminatedMessage<TDiscriminatorKey>,
	TClientMessage extends DiscriminatedMessage<TDiscriminatorKey>,
	TClientMessageBeforeProcessing = TClientMessage,
> {
	/**
	 * Direct access to the lower-level socket. This is still an
	 * abstraction, not an actual WebSocket. It wraps the raw socket
	 * and handles reconnection.
	 */
	readonly websocket: ReconnectingWebsocket;
	/**
	 * It's not recommended you mess with this. Controls the heartbeat
	 * mechanism which detects dead connections.
	 */
	readonly heartbeat: Heartbeat;

	constructor(
		private config: ConnectionConfig<
			TDiscriminatorKey,
			TServerMessage,
			TClientMessage,
			TClientMessageBeforeProcessing
		>,
	) {
		this.websocket = new ReconnectingWebsocket(config.websocket, this.#logger);
		this.heartbeat = new Heartbeat(
			this.websocket,
			this.#logger,
			config.heartbeat,
		);
		this.websocket.onConnect(this.heartbeat.start);
		this.websocket.onDisconnect(this.heartbeat.stop);
		if (config.openImmediately) {
			this.open();
		}
	}

	get #logger() {
		if (this.config.logger === false) {
			return noopLogger;
		}
		return this.config.logger ?? new Logger('🔌', 'dialogue');
	}

	#marshalServerMessage = (data: string): any => {
		return JSON.parse(data);
	};

	#marshalClientMessage = (message: TClientMessage): any => {
		return JSON.stringify(message);
	};

	#preprocessClientMessage = (
		message: TClientMessageBeforeProcessing,
	): TClientMessage => {
		if (this.config.preprocessClientMessage) {
			return this.config.preprocessClientMessage(message);
		}
		return message as unknown as TClientMessage;
	};

	#isMessageWithType(
		message: TClientMessage,
		type: TClientMessage[TDiscriminatorKey],
	): boolean;
	#isMessageWithType(
		message: TServerMessage,
		type: TServerMessage[TDiscriminatorKey],
	): boolean;
	#isMessageWithType(message: any, type: any): boolean {
		return message[this.config.messageTypeKey] === type;
	}

	/**
	 * Initiates the connection.
	 */
	open = () => {
		return this.websocket.reconnect();
	};

	/**
	 * Ends the connection. Connect again by calling open().
	 */
	close = () => {
		this.websocket.close();
		this.heartbeat.stop();
	};

	/**`
	 * Subscribes to incoming messages.
	 *
	 * @returns an unsubscriber
	 */
	on = <TType extends TServerMessage[TDiscriminatorKey]>(
		type: TType | '*',
		handler: (
			message: ResolvedMessageByType<TDiscriminatorKey, TServerMessage, TType>,
		) => void,
	) => {
		return this.websocket.onMessage((event) => {
			if (!(event instanceof MessageEvent)) {
				return;
			}
			const data = this.#marshalServerMessage(event.data);
			try {
				const parsed = this.config.parseServerMessage(data);
				if (type === '*' || this.#isMessageWithType(parsed, type)) {
					handler(
						parsed as ResolvedMessageByType<
							TDiscriminatorKey,
							TServerMessage,
							TType
						>,
					);
				}
			} catch (err) {
				this.#logger.error('Error handling message', err);
			}
		});
	};

	once = <TType extends TServerMessage[TDiscriminatorKey]>(
		type: TType,
		handler: (
			message: ResolvedMessageByType<TDiscriminatorKey, TServerMessage, TType>,
		) => void,
	) => {
		const unsub = this.on(type, (message) => {
			unsub();
			handler(message);
		});
		return unsub;
	};

	/**
	 * Sends a message to the server. The message will be preprocessed
	 * (if specified), validated, and converted to a string.
	 *
	 * Returns the processed and validated message.
	 *
	 * @throws If your client message validator throws an error, it will
	 * be thrown when calling this function.
	 */
	send = (message: TClientMessageBeforeProcessing) => {
		const preprocessed = this.#preprocessClientMessage(message);
		const parsed = this.config.parseClientMessage(preprocessed);
		const marshaled = this.#marshalClientMessage(parsed);
		this.websocket.send(marshaled);
		return parsed;
	};

	/**
	 * Sends a message and waits for a response. The response is determined
	 * by the getIsResponse function in the config. If the response doesn't
	 * arrive within the specified timeout, the promise is rejected.
	 *
	 * @throws If your client message validator throws an error, it will
	 * be thrown when calling this function. If the response times out, a
	 * DialogueError with code RequestTimeout is thrown.
	 */
	request = <TExpectedResponse extends TServerMessage = TServerMessage>(
		message: TClientMessageBeforeProcessing,
		{ timeout = 5000 } = {},
	): Promise<TExpectedResponse> => {
		let processedMessage: TClientMessage;
		const response = new Promise<TServerMessage>((resolve, reject) => {
			const unsub = this.on('*', (serverMessage) => {
				if (
					!this.config.getIsResponse ||
					this.config.getIsResponse?.(processedMessage, serverMessage)
				) {
					unsub();
					resolve(serverMessage);
				}
			});
			setTimeout(() => {
				unsub();
				reject(
					new DialogueError(
						DialogueError.Code.RequestTimeout,
						`Request timed out: ${JSON.stringify(message)}`,
					),
				);
			}, timeout);
		});

		processedMessage = this.send(message);

		return response as Promise<TExpectedResponse>;
	};
}
