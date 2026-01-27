import chalk from 'chalk';

const prefix = chalk.blue('[claude-tracker]');

export const logger = {
  info(message: string) {
    console.log(`${prefix} ${message}`);
  },

  success(message: string) {
    console.log(`${prefix} ${chalk.green('✓')} ${message}`);
  },

  warn(message: string) {
    console.log(`${prefix} ${chalk.yellow('⚠')} ${message}`);
  },

  error(message: string) {
    console.error(`${prefix} ${chalk.red('✗')} ${message}`);
  },

  debug(message: string) {
    if (process.env.DEBUG) {
      console.log(`${prefix} ${chalk.gray(message)}`);
    }
  },

  dim(message: string) {
    console.log(`${prefix} ${chalk.dim(message)}`);
  },

  heading(message: string) {
    console.log(`\n${chalk.bold.cyan(message)}`);
    console.log(chalk.dim('─'.repeat(message.length)));
  },

  keyValue(key: string, value: string) {
    console.log(`  ${chalk.dim(key + ':')} ${value}`);
  },
};
