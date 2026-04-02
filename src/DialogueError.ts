const dialogueErrorCodes = {
	Unknown: 'unknown',
	InvalidMessage: 'invalid_message',
	RequestTimeout: 'request_timeout',
	RequestFailed: 'request_failed',
};
export type DialogueErrorCode =
	(typeof dialogueErrorCodes)[keyof typeof dialogueErrorCodes];

export class DialogueError extends Error {
	static Code = dialogueErrorCodes;

	code: DialogueErrorCode;
	constructor(
		code: DialogueErrorCode,
		...params: Parameters<ErrorConstructor>
	) {
		super(...params);
		this.code = code;
	}
}
