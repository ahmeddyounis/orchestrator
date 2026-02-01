"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDir = ensureDir;
exports.atomicWrite = atomicWrite;
// packages/shared/src/fs/io.ts
const fs_1 = require("fs");
const path_1 = require("path");
const tmp_promise_1 = require("tmp-promise");
const fs_extra_1 = require("fs-extra");
async function ensureDir(path) {
    await (0, fs_extra_1.ensureDir)((0, path_1.dirname)(path));
}
async function atomicWrite(path, content) {
    await ensureDir(path);
    const tempPath = await (0, tmp_promise_1.tmpName)({ dir: (0, path_1.dirname)(path) });
    await fs_1.promises.writeFile(tempPath, content);
    await fs_1.promises.rename(tempPath, path);
}
//# sourceMappingURL=io.js.map