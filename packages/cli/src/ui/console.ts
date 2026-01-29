import inquirer from 'inquirer';
import { UserInterface } from '@orchestrator/exec';

export class ConsoleUI implements UserInterface {
  async confirm(message: string, details?: string, defaultNo?: boolean): Promise<boolean> {
    if (details) {
      console.log('\n' + details + '\n');
    }
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: message,
        default: !defaultNo,
      },
    ]);
    return confirmed;
  }
}
