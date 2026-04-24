#!/usr/bin/env node
import { Command } from 'commander';
import { intro, outro } from '@clack/prompts';
import pc from 'picocolors';
import { syncCommand } from './commands/sync.ts';
import { addCommand } from './commands/add.ts';
import { portfolioCommand } from './commands/portfolio.ts';
import { loginCommand } from './commands/auth/login.ts';
import { whoamiCommand } from './commands/auth/whoami.ts';

const program = new Command();

program
  .name('firma')
  .description('Personal asset tracker for overseas investors')
  .version('0.1.0');

const auth = program.command('auth').description('Manage authentication');

auth
  .command('login')
  .description('Log in to your Firma account')
  .action(async () => {
    intro(pc.bgCyan(pc.black(' firma auth login ')));
    await loginCommand();
    outro('Done');
  });

auth
  .command('whoami')
  .description('Show currently logged-in account')
  .action(() => {
    intro(pc.bgCyan(pc.black(' firma auth whoami ')));
    whoamiCommand();
    outro('Done');
  });

program
  .command('sync')
  .description('Sync latest stock prices')
  .action(async () => {
    intro(pc.bgCyan(pc.black(' firma sync ')));
    await syncCommand();
    outro('Done');
  });

program
  .command('portfolio')
  .alias('p')
  .description('Show portfolio overview')
  .action(async () => {
    intro(pc.bgCyan(pc.black(' firma portfolio ')));
    await portfolioCommand();
    outro('Done');
  });

program
  .command('add')
  .description('Add a transaction')
  .action(async () => {
    intro(pc.bgCyan(pc.black(' firma add ')));
    await addCommand();
    outro('Done');
  });

program
  .command('flow')
  .description('Add income or expense')
  .action(async () => {
    intro(pc.bgCyan(pc.black(' firma flow ')));
    // TODO
    outro('Done');
  });

program.parse();
