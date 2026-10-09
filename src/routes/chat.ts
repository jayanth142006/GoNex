import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ChatService } from '../ai/chatService.js';
import { AppError } from '../errors.js';

export interface ChatRouteOptions {
  chatService: ChatService;
  maxMessageChars: number;
}

/** Treat `null` / empty string the same as an omitted conversationId. */
const optionalId = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  z.uuid().optional(),
);

export const chatRoutes: FastifyPluginAsync<ChatRouteOptions> = async (app, opts) => {
  const bodySchema = z.object({
    message: z.string().trim().min(1).max(opts.maxMessageChars),
    conversationId: optionalId,
  });

  app.post('/api/chat', async (request) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      throw new AppError(
        400,
        field === 'conversationId'
          ? 'conversationId must be a valid conversation ID returned by GoNex.'
          : `message is required and must be a non-empty string of at most ${opts.maxMessageChars} characters.`,
      );
    }
    return opts.chatService.chat(parsed.data, request.log);
  });
};
