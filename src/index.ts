#!/usr/bin/env node
import { Command } from 'commander';
import { intro, outro } from '@clack/prompts';
import pc from 'picocolors';

const program = new Command();

program
  .name('firma')
  .description('Personal asset tracker for overseas investors')
  .version('0.1.0');

program
  .command('sync')
  .description('Sync latest stock prices')
  .action(async () => {
    intro(pc.bgCyan(pc.black(' firma sync ')));
    // TODO
    outro('Done');
  });

program
  .command('portfolio')
  .alias('p')
  .description('Show portfolio overview')
  .action(async () => {
    intro(pc.bgCyan(pc.black(' firma portfolio ')));
    // TODO
    outro('Done');
  });

program
  .command('add')
  .description('Add stock position or transaction')
  .action(async () => {
    intro(pc.bgCyan(pc.black(' firma add ')));
    // TODO
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
