"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoneSandboxProvider = void 0;
class NoneSandboxProvider {
    async prepare(repoRoot, 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _runId) {
        return { cwd: repoRoot };
    }
}
exports.NoneSandboxProvider = NoneSandboxProvider;
//# sourceMappingURL=index.js.map