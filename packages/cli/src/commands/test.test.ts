import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { execa } from 'execa';
import { findRepoRoot } from '@orchestrator/repo';

vi.mock('@orchestrator/repo', () => ({
    findRepoRoot: vi.fn().mockResolvedValue('/fake/repo/root'),
}));

vi.mock('execa');

function registerTestCommand(program: Command) {
    program
        .command('test')
        .description('Run tests for the project')
        .action(async () => {
            const repoRoot = await findRepoRoot();
            try {
                const testProcess = execa('turbo', ['run', 'test'], {
                    cwd: repoRoot,
                    stdio: 'inherit',
                });
                await testProcess;
            } catch (_error) {
                process.exit(1);
            }
        });
}

describe('registerTestCommand', () => {
    it('should register the test command', () => {
        const program = new Command();
        registerTestCommand(program);
        const command = program.commands.find((c) => c.name() === 'test');
        expect(command).toBeDefined();
        expect(command?.description()).toBe('Run tests for the project');
    });

    it('should call execa with the correct arguments', async () => {
        const program = new Command();
        registerTestCommand(program);

        await program.parseAsync(['node', 'test', 'test']);

        expect(vi.mocked(execa)).toHaveBeenCalledWith(
            'turbo',
            ['run', 'test'],
            expect.objectContaining({
                cwd: '/fake/repo/root',
                stdio: 'inherit',
            }),
        );
    });
});
