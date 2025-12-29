import { pino } from 'pino';

export const llmLogger = pino({
  name: 'llm-processor',
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});
