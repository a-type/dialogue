import { ILogger, noopLogger } from './Logger.ts';

export interface ReconnectingWebsocketConfig {
	/**
	 * Get the full connection URL, including any authentication.
	 */
	getUrl: () => Promise<string> | string;
	/**
	 * Add extra options to the connection request.
	 */
	fetchOptions?: RequestInit;
	/**
	 * Override platform primitives like fetch and
	 * WebSocket if you like.
	 */
	environment?: {
		fetch?: typeof fetch;
		WebSocket?: typeof WebSocket;
	};
	/**
	 * Whether to automatically reconnect when the server
	 * intentionally closes the connection (code 1000).
	 * Default is false.
	 */
	reconnectOnServerClose?: boolean;
}

export class ReconnectingWebsocket {
	private websocket: WebSocket | null = null;
	private messageEvents = new EventTarget();
	private errorEvents = new EventTarget();
	private connectionEvents = new EventTarget();
	private backlog: string[] = [];
	#id = Math.random().toString(36).slice(2);
	get id() {
		return this.#id;
	}
	#status: 'closed' | 'open' | 'reconnecting' = 'closed';
	get status() {
		return this.#status;
	}
	private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
	private abortReconnect = false;
	private reconnectInterval = 3000;
	private reconnectAttempts = 0;

	constructor(
		private config: ReconnectingWebsocketConfig,
		private logger: ILogger = noopLogger,
	) {}

	get #logger() {
		return this.logger ?? noopLogger;
	}

	send = (message: string) => {
		if (this.#status === 'closed') {
			this.#logger.warn('Socket closed, cannot send', this.#id);
			return;
		}
		if (this.websocket?.readyState === WebSocket.OPEN) {
			this.websocket.send(message);
		} else {
			this.backlog.push(message);
		}
	};

	onMessage = (handler: (event: Event) => void) => {
		this.messageEvents.addEventListener('message', handler);
		return () => {
			this.messageEvents.removeEventListener('message', handler);
		};
	};

	onError = (handler: (event: Event) => void) => {
		this.errorEvents.addEventListener('error', handler);
		return () => {
			this.errorEvents.removeEventListener('error', handler);
		};
	};

	onConnect = (handler: () => void) => {
		this.connectionEvents.addEventListener('connect', handler);
		return () => {
			this.connectionEvents.removeEventListener('connect', handler);
		};
	};

	onDisconnect = (handler: () => void) => {
		this.connectionEvents.addEventListener('disconnect', handler);
		return () => {
			this.connectionEvents.removeEventListener('disconnect', handler);
		};
	};

	close = () => {
		if (this.#status === 'reconnecting') {
			this.#logger.debug('Socket waiting for connect before close', this.#id);
			// wait for connection before closing
			this.abortReconnect = true;
		} else {
			if (this.reconnectTimeout) {
				clearTimeout(this.reconnectTimeout);
				this.reconnectTimeout = null;
			}
			this.#logger.info('Socket closing', this.#id);
			this.websocket?.close(1000, 'Closed by user');
		}
	};

	reconnect = async () => {
		if (this.abortReconnect) {
			this.#logger.debug(
				'Cancelling abort due to explicit reconnect',
				this.#id,
			);
			this.abortReconnect = false;
		}
		if (this.reconnectAttempts >= 5) {
			this.#logger.error('Max reconnect attempts reached, giving up', this.#id);
			return;
		}
		if (this.#status === 'reconnecting') {
			this.#logger.debug(
				'Not initiating reconnect, already reconnecting',
				this.#id,
			);
			return;
		}
		this.#status = 'reconnecting';
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}
		try {
			const url = await this.config.getUrl();
			this.websocket?.close(1000, 'Forced reconnect');
			const websocket = (this.websocket = new WebSocket(url));

			websocket.addEventListener('open', () => {
				if (this.abortReconnect) {
					this.#logger.debug('Socket closed during [re]connect', this.#id);
					this.abortReconnect = false;
					websocket.close(1000, 'Closed during reconnect');
					return;
				}

				this.#logger.info('Socket connected', this.#id);
				this.#status = 'open';
				this.connectionEvents.dispatchEvent(new Event('connect'));

				this.reconnectAttempts = 0;
				this.reconnectInterval = 3000;

				if (this.backlog.length) {
					this.backlog.forEach((msg) => websocket.send(msg));
					this.backlog = [];
				}
			});
			websocket.addEventListener('close', (ev) => {
				this.#status = 'closed';
				this.connectionEvents.dispatchEvent(new Event('disconnect'));

				if (ev.code === 1000 && !this.config.reconnectOnServerClose) {
					this.#logger.debug(
						'Socket closed normally. Not reconnecting.',
						this.#id,
						ev.code,
						ev.reason,
					);
					return;
				}

				this.#logger.warn(
					'Socket closed',
					this.#id,
					'code',
					ev.code,
					ev.reason,
				);
				this.#queueReconnect();
			});
			websocket.addEventListener('message', (event) => {
				this.messageEvents.dispatchEvent(
					new MessageEvent('message', {
						data: event.data,
					}),
				);
			});
			websocket.addEventListener('error', (event) => {
				this.#logger.error('Socket error', this.#id, event);
				const err =
					event instanceof ErrorEvent ?
						event.error
					:	new Error('Unknown error');
				this.errorEvents.dispatchEvent(
					new ErrorEvent('error', {
						error: err,
					}),
				);
			});
		} catch (e) {
			this.#logger.error('Failed to reconnect socket', this.#id, e);
			this.#status = 'closed';
			this.#queueReconnect();
		}
	};

	#queueReconnect = () => {
		if (this.reconnectTimeout) {
			return;
		}
		this.#logger.debug(
			'Queueing socket reconnect',
			this.#id,
			'in',
			this.reconnectInterval,
			'ms',
			'attempt',
			this.reconnectAttempts + 1,
		);
		this.reconnectTimeout = setTimeout(this.reconnect, this.reconnectInterval);
		this.reconnectAttempts++;
		// Exponential backoff with a max of 30s
		this.reconnectInterval = Math.min(
			30000,
			this.reconnectInterval * 2 ** this.reconnectAttempts,
		);
	};
}
