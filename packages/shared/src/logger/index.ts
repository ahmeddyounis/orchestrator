import { ConsoleLogger } from './consoleLogger';
import { JsonlLogger } from './jsonlLogger';

export const logger = new ConsoleLogger();
export { ConsoleLogger, JsonlLogger };
