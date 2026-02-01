'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.CostTrackingAdapter = void 0;
class CostTrackingAdapter {
  providerId;
  adapter;
  tracker;
  constructor(providerId, adapter, tracker) {
    this.providerId = providerId;
    this.adapter = adapter;
    this.tracker = tracker;
  }
  id() {
    return this.adapter.id();
  }
  capabilities() {
    return this.adapter.capabilities();
  }
  async generate(req, ctx) {
    const response = await this.adapter.generate(req, ctx);
    if (response.usage) {
      this.tracker.recordUsage(this.providerId, response.usage);
    }
    return response;
  }
  async *stream(req, ctx) {
    if (!this.adapter.stream) return;
    for await (const event of this.adapter.stream(req, ctx)) {
      if (event.type === 'usage') {
        this.tracker.recordUsage(this.providerId, event.usage);
      }
      yield event;
    }
  }
}
exports.CostTrackingAdapter = CostTrackingAdapter;
//# sourceMappingURL=proxy.js.map
