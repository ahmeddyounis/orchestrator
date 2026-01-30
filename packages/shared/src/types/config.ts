import { Config } from '../config/schema';

export interface OrchestratorConfig extends Config {
  rootDir: string;
  orchestratorDir: string;
}
