export class Logger {
	#showDebug;
	constructor(
		private tag: string,
		debugTag = tag,
	) {
		const localStorage: any =
			// @ts-ignore
			typeof window !== 'undefined' ? window.localStorage : undefined;
		this.#showDebug =
			localStorage?.getItem('DEBUG') === 'true' ||
			localStorage?.getItem('DEBUG')?.includes(debugTag);
	}

	info = (...args: any[]) => {
		console.log(`[${this.tag}]`, ...args);
	};

	warn = (...args: any[]) => {
		console.warn(`[${this.tag}]`, ...args);
	};

	error = (...args: any[]) => {
		console.error(`[${this.tag}]`, ...args);
	};

	debug = (...args: any[]) => {
		if (!this.#showDebug) return;
		console.debug(`[${this.tag}]`, ...args);
	};
}

export const noopLogger: ILogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
};

export interface ILogger {
	info(...args: any[]): void;
	warn(...args: any[]): void;
	error(...args: any[]): void;
	debug(...args: any[]): void;
}
