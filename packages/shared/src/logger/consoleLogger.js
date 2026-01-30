"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsoleLogger = void 0;
class ConsoleLogger {
    log(event) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(event));
    }
    trace(event, message) {
        // eslint-disable-next-line no-console
        console.log(message, JSON.stringify(event));
    }
    error(error, message) {
        if (message) {
            // eslint-disable-next-line no-console
            console.error(message, error);
        }
        else {
            // eslint-disable-next-line no-console
            console.error(error);
        }
    }
}
exports.ConsoleLogger = ConsoleLogger;
//# sourceMappingURL=consoleLogger.js.map