'use strict';
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator['throw'](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
var __generator =
  (this && this.__generator) ||
  function (thisArg, body) {
    var _ = {
        label: 0,
        sent: function () {
          if (t[0] & 1) throw t[1];
          return t[1];
        },
        trys: [],
        ops: [],
      },
      f,
      y,
      t,
      g = Object.create((typeof Iterator === 'function' ? Iterator : Object).prototype);
    return (
      (g.next = verb(0)),
      (g['throw'] = verb(1)),
      (g['return'] = verb(2)),
      typeof Symbol === 'function' &&
        (g[Symbol.iterator] = function () {
          return this;
        }),
      g
    );
    function verb(n) {
      return function (v) {
        return step([n, v]);
      };
    }
    function step(op) {
      if (f) throw new TypeError('Generator is already executing.');
      while ((g && ((g = 0), op[0] && (_ = 0)), _))
        try {
          if (
            ((f = 1),
            y &&
              (t =
                op[0] & 2
                  ? y['return']
                  : op[0]
                    ? y['throw'] || ((t = y['return']) && t.call(y), 0)
                    : y.next) &&
              !(t = t.call(y, op[1])).done)
          )
            return t;
          if (((y = 0), t)) op = [op[0] & 2, t.value];
          switch (op[0]) {
            case 0:
            case 1:
              t = op;
              break;
            case 4:
              _.label++;
              return { value: op[1], done: false };
            case 5:
              _.label++;
              y = op[1];
              op = [0];
              continue;
            case 7:
              op = _.ops.pop();
              _.trys.pop();
              continue;
            default:
              if (
                !((t = _.trys), (t = t.length > 0 && t[t.length - 1])) &&
                (op[0] === 6 || op[0] === 2)
              ) {
                _ = 0;
                continue;
              }
              if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) {
                _.label = op[1];
                break;
              }
              if (op[0] === 6 && _.label < t[1]) {
                _.label = t[1];
                t = op;
                break;
              }
              if (t && _.label < t[2]) {
                _.label = t[2];
                _.ops.push(op);
                break;
              }
              if (t[2]) _.ops.pop();
              _.trys.pop();
              continue;
          }
          op = body.call(thisArg, _);
        } catch (e) {
          op = [6, e];
          y = 0;
        } finally {
          f = t = 0;
        }
      if (op[0] & 5) throw op[1];
      return { value: op[0] ? op[1] : void 0, done: true };
    }
  };
Object.defineProperty(exports, '__esModule', { value: true });
var core_1 = require('@orchestrator/core');
var repo_1 = require('@orchestrator/repo');
var core_2 = require('@orchestrator/core');
var adapters_1 = require('@orchestrator/adapters');
var path = require('path');
var fs = require('fs/promises');
function main() {
  return __awaiter(this, void 0, void 0, function () {
    var repoRoot,
      config,
      registry,
      git,
      orchestrator,
      runId1,
      trace1,
      events1,
      perf1,
      orchestrator2,
      runId2,
      trace2,
      events2,
      perf2,
      scanDuration1,
      scanDuration2;
    return __generator(this, function (_a) {
      switch (_a.label) {
        case 0:
          repoRoot = path.resolve('large_repo_fixture');
          config = core_1.ConfigLoader.load({ cwd: repoRoot });
          registry = new core_2.ProviderRegistry(config);
          registry.registerFactory('fake', function (config) {
            return new adapters_1.FakeAdapter(config);
          });
          config.providers = {
            fake: {
              type: 'fake',
              model: 'fake-model',
            },
          };
          config.defaults = {
            planner: 'fake',
            executor: 'fake',
            reviewer: 'fake',
          };
          git = new repo_1.GitService({ repoRoot: repoRoot });
          return [
            4 /*yield*/,
            core_1.Orchestrator.create({
              config: config,
              git: git,
              registry: registry,
              repoRoot: repoRoot,
            }),
          ];
        case 1:
          orchestrator = _a.sent();
          console.log('Running with default settings (no guardrails)...');
          runId1 = Date.now().toString();
          return [4 /*yield*/, orchestrator.run('test goal', { thinkLevel: 'L1', runId: runId1 })];
        case 2:
          _a.sent();
          return [
            4 /*yield*/,
            fs.readFile(
              path.join(repoRoot, '.orchestrator', 'runs', runId1, 'trace.jsonl'),
              'utf-8',
            ),
          ];
        case 3:
          trace1 = _a.sent();
          events1 = trace1
            .split('\n')
            .filter(Boolean)
            .map(function (line) {
              return JSON.parse(line);
            });
          perf1 = events1.filter(function (e) {
            return e.type === 'PerformanceMeasured';
          });
          console.log('Performance (no guardrails):');
          console.table(
            perf1.map(function (e) {
              return e.payload;
            }),
          );
          // Now with guardrails
          config.context = config.context || {};
          config.context.maxCandidates = 100;
          config.context.scanner = {
            maxFiles: 1000,
            maxFileSize: 1024 * 1024,
          };
          return [
            4 /*yield*/,
            core_1.Orchestrator.create({
              config: config,
              git: git,
              registry: registry,
              repoRoot: repoRoot,
            }),
          ];
        case 4:
          orchestrator2 = _a.sent();
          console.log('Running with guardrails...');
          runId2 = Date.now().toString();
          return [4 /*yield*/, orchestrator2.run('test goal', { thinkLevel: 'L1', runId: runId2 })];
        case 5:
          _a.sent();
          return [
            4 /*yield*/,
            fs.readFile(
              path.join(repoRoot, '.orchestrator', 'runs', runId2, 'trace.jsonl'),
              'utf-8',
            ),
          ];
        case 6:
          trace2 = _a.sent();
          events2 = trace2
            .split('\n')
            .filter(Boolean)
            .map(function (line) {
              return JSON.parse(line);
            });
          perf2 = events2.filter(function (e) {
            return e.type === 'PerformanceMeasured';
          });
          console.log('Performance (with guardrails):');
          console.table(
            perf2.map(function (e) {
              return e.payload;
            }),
          );
          scanDuration1 = perf1.find(function (e) {
            return e.payload.name === 'repo_scan';
          }).payload.durationMs;
          scanDuration2 = perf2.find(function (e) {
            return e.payload.name === 'repo_scan';
          }).payload.durationMs;
          if (scanDuration2 >= scanDuration1) {
            throw new Error(
              'Scan with guardrails should be faster. No guardrails: '
                .concat(scanDuration1, 'ms, with guardrails: ')
                .concat(scanDuration2, 'ms'),
            );
          }
          console.log('Performance test passed!');
          return [2 /*return*/];
      }
    });
  });
}
main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
