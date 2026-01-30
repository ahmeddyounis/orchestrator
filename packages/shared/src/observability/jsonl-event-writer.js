"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonlEventWriter = void 0;
const fs_1 = __importDefault(require("fs"));
class JsonlEventWriter {
    logPath;
    stream;
    closed = false;
    constructor(logPath) {
        this.logPath = logPath;
        this.stream = fs_1.default.createWriteStream(this.logPath, { flags: 'a' });
    }
    write(event) {
        if (this.closed) {
            // Maybe use a proper logger here in the future
            console.warn(`Attempted to write to closed trace writer: ${this.logPath}`);
            return;
        }
        this.stream.write(JSON.stringify(event) + '\n');
    }
    close() {
        return new Promise((resolve) => {
            if (this.closed) {
                resolve();
                return;
            }
            this.closed = true;
            this.stream.end(() => resolve());
        });
    }
}
exports.JsonlEventWriter = JsonlEventWriter;
