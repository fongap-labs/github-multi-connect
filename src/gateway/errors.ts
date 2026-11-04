export class McpPublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpPublicError';
  }
}
