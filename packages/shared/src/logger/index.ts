import { ConsoleLogger } from './consoleLogger';
import { JsonlLogger } from './jsonlLogger';
export type { Logger } from './types';

export const logger = new ConsoleLogger();
export { ConsoleLogger, JsonlLogger };
