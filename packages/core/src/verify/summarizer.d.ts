import { CheckResult, FailureSummary } from './types';
export declare class FailureSummarizer {
    summarize(checks: CheckResult[]): Promise<FailureSummary>;
    private summarizeCheck;
    private extractKeyErrors;
    private extractFiles;
}
//# sourceMappingURL=summarizer.d.ts.map