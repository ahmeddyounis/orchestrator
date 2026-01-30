'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.JsonlLogger = exports.ConsoleLogger = exports.logger = void 0;
const consoleLogger_1 = require('./consoleLogger');
Object.defineProperty(exports, 'ConsoleLogger', {
  enumerable: true,
  get: function () {
    return consoleLogger_1.ConsoleLogger;
  },
});
const jsonlLogger_1 = require('./jsonlLogger');
Object.defineProperty(exports, 'JsonlLogger', {
  enumerable: true,
  get: function () {
    return jsonlLogger_1.JsonlLogger;
  },
});
exports.logger = new consoleLogger_1.ConsoleLogger();
//# sourceMappingURL=index.js.map
