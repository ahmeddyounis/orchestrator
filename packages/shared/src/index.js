'use strict';
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __exportStar =
  (this && this.__exportStar) ||
  function (m, exports) {
    for (var p in m)
      if (p !== 'default' && !Object.prototype.hasOwnProperty.call(exports, p))
        __createBinding(exports, m, p);
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.MANIFEST_VERSION =
  exports.MANIFEST_FILENAME =
  exports.ManifestManager =
  exports.name =
    void 0;
exports.name = '@orchestrator/shared';
__exportStar(require('./types/events'), exports);
__exportStar(require('./logger/jsonlLogger'), exports);
__exportStar(require('./logger'), exports);
__exportStar(require('./redaction'), exports);
__exportStar(require('./errors'), exports);
__exportStar(require('./fs/artifacts'), exports);
// NOTE: ./artifacts exports a different Manifest type; avoid re-export conflict.
var artifacts_1 = require('./artifacts');
Object.defineProperty(exports, 'ManifestManager', {
  enumerable: true,
  get: function () {
    return artifacts_1.ManifestManager;
  },
});
Object.defineProperty(exports, 'MANIFEST_FILENAME', {
  enumerable: true,
  get: function () {
    return artifacts_1.MANIFEST_FILENAME;
  },
});
Object.defineProperty(exports, 'MANIFEST_VERSION', {
  enumerable: true,
  get: function () {
    return artifacts_1.MANIFEST_VERSION;
  },
});
__exportStar(require('./config/schema'), exports);
__exportStar(require('./types/memory'), exports);
__exportStar(require('./types/llm'), exports);
__exportStar(require('./types/patch'), exports);
__exportStar(require('./types/tools'), exports);
__exportStar(require('./types/config'), exports);
__exportStar(require('./summary/summary'), exports);
__exportStar(require('./observability'), exports);
__exportStar(require('./eval'), exports);
__exportStar(require('./config/schema'), exports);
//# sourceMappingURL=index.js.map
