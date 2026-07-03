/**
 * Interactive prompt utilities for CLI commands.
 */
import * as readline from 'readline';
import { T } from './types';

export async function prompt(message: string, defaultValue?: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    return new Promise((resolve) => {
        rl.question(`${message}${suffix}: `, (answer) => {
            rl.close();
            resolve(answer.trim() || defaultValue || '');
        });
    });
}

export async function confirm(message: string, defaultValue: boolean = true): Promise<boolean> {
    const suffix = defaultValue ? '[Y/n]' : '[y/N]';
    const answer = await prompt(`${message} ${suffix}`);
    
    if (!answer) return defaultValue;
    return answer.toLowerCase().startsWith('y');
}

export async function choose<T>(message: string, choices: T[], format: (item: T) => string): Promise<T | null> {
    if (choices.length === 0) return null;
    if (choices.length === 1) return choices[0];

    console.log(message);
    choices.forEach((choice, index) => {
        console.log(`  [${index + 1}] ${format(choice)}`);
    });

    const answer = await prompt(T('cmd.choosePrompt'), '1');
    const index = parseInt(answer) - 1;

    if (index >= 0 && index < choices.length) {
        return choices[index];
    }

    return null;
}
