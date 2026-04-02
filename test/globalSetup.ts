import type { TestProject } from 'vitest/node';
import { startTestServer } from './server';

export default async function globalSetup(project: TestProject) {
	const { cleanup, port } = await startTestServer();
	project.provide('SERVER_PORT', port.toString());
	return cleanup;
}
