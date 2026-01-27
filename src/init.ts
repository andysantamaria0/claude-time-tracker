import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { logger } from './utils/logger.js';
import { loadConfig, updateConfig, type TrackerConfig } from './config.js';
import { testAirtableConnection, createAirtableTable } from './storage/airtable.js';
import { testResendConnection, sendTestEmail } from './email/resend.js';

export async function runInit(): Promise<void> {
  logger.heading('Claude Time Tracker Setup');
  console.log(chalk.dim('Configure integrations for session tracking.\n'));

  const config = loadConfig();

  // Step 1: Conversation Analysis (Claude API)
  const { setupConversation } = await inquirer.prompt<{ setupConversation: boolean }>([
    {
      type: 'confirm',
      name: 'setupConversation',
      message: 'Enable AI conversation analysis? (requires Anthropic API key)',
      default: config.features.conversationAnalysis,
    },
  ]);

  if (setupConversation) {
    const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
      {
        type: 'password',
        name: 'apiKey',
        message: 'Anthropic API key:',
        mask: '*',
        validate: (input: string) => input.startsWith('sk-') || 'API key should start with sk-',
      },
    ]);

    config.anthropicApiKey = apiKey;
    config.features.conversationAnalysis = true;
    logger.success('Conversation analysis enabled');
  } else {
    config.features.conversationAnalysis = false;
  }

  // Step 2: Airtable
  const { setupAirtable } = await inquirer.prompt<{ setupAirtable: boolean }>([
    {
      type: 'confirm',
      name: 'setupAirtable',
      message: 'Enable Airtable sync?',
      default: config.features.airtableSync,
    },
  ]);

  if (setupAirtable) {
    await configureAirtable(config);
  } else {
    config.features.airtableSync = false;
  }

  // Step 3: Email Reports
  const { setupEmail } = await inquirer.prompt<{ setupEmail: boolean }>([
    {
      type: 'confirm',
      name: 'setupEmail',
      message: 'Enable email reports via Resend?',
      default: config.features.emailReports,
    },
  ]);

  if (setupEmail) {
    await configureEmail(config);
  } else {
    config.features.emailReports = false;
  }

  // Step 4: Idle detection settings
  const { idleTimeout } = await inquirer.prompt<{ idleTimeout: number }>([
    {
      type: 'number',
      name: 'idleTimeout',
      message: 'Idle timeout (minutes):',
      default: config.idleTimeoutMinutes,
      validate: (input: number) => (input > 0 && input <= 120) || 'Must be between 1 and 120 minutes',
    },
  ]);

  config.idleTimeoutMinutes = idleTimeout;

  // Save config
  updateConfig(config);
  console.log('');
  logger.success('Configuration saved!');
  console.log(chalk.dim('Run `claude-tracker start` to begin tracking.\n'));
}

async function configureAirtable(config: TrackerConfig): Promise<void> {
  const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Airtable Personal Access Token:',
      mask: '*',
      validate: (input: string) => input.startsWith('pat') || 'Token should start with "pat"',
    },
  ]);

  const { setupChoice } = await inquirer.prompt<{ setupChoice: string }>([
    {
      type: 'list',
      name: 'setupChoice',
      message: 'Airtable table setup:',
      choices: [
        { name: 'Create new table in existing base', value: 'create' },
        { name: 'Use existing base and table', value: 'existing' },
      ],
    },
  ]);

  const { baseId } = await inquirer.prompt<{ baseId: string }>([
    {
      type: 'input',
      name: 'baseId',
      message: 'Airtable Base ID (starts with "app"):',
      validate: (input: string) => input.startsWith('app') || 'Base ID should start with "app"',
    },
  ]);

  let tableName = 'Sessions';
  let tableId = '';

  if (setupChoice === 'create') {
    const { name } = await inquirer.prompt<{ name: string }>([
      {
        type: 'input',
        name: 'name',
        message: 'Table name:',
        default: 'Claude Sessions',
      },
    ]);
    tableName = name;

    const spinner = ora('Creating Airtable table...').start();
    const created = await createAirtableTable(apiKey, baseId, tableName);
    if (created) {
      spinner.succeed('Airtable table created');
    } else {
      spinner.fail('Failed to create table. You may need to create it manually.');
    }
  } else {
    const answers = await inquirer.prompt<{ tableName: string; tableId: string }>([
      {
        type: 'input',
        name: 'tableName',
        message: 'Table name:',
        default: 'Sessions',
      },
      {
        type: 'input',
        name: 'tableId',
        message: 'Table ID (optional, starts with "tbl"):',
      },
    ]);
    tableName = answers.tableName;
    tableId = answers.tableId;
  }

  // Test connection
  const spinner = ora('Testing Airtable connection...').start();
  const connected = await testAirtableConnection(apiKey, baseId, tableName);
  if (connected) {
    spinner.succeed('Airtable connection verified');
  } else {
    spinner.warn('Could not verify Airtable connection (table may need records first)');
  }

  config.airtable = { apiKey, baseId, tableId, tableName };
  config.features.airtableSync = true;
  logger.success('Airtable sync enabled');
}

async function configureEmail(config: TrackerConfig): Promise<void> {
  const { resendApiKey } = await inquirer.prompt<{ resendApiKey: string }>([
    {
      type: 'password',
      name: 'resendApiKey',
      message: 'Resend API key:',
      mask: '*',
      validate: (input: string) => input.startsWith('re_') || 'API key should start with "re_"',
    },
  ]);

  const { recipientEmail } = await inquirer.prompt<{ recipientEmail: string }>([
    {
      type: 'input',
      name: 'recipientEmail',
      message: 'Recipient email address:',
      validate: (input: string) => input.includes('@') || 'Please enter a valid email',
    },
  ]);

  const { fromEmail } = await inquirer.prompt<{ fromEmail: string }>([
    {
      type: 'input',
      name: 'fromEmail',
      message: 'From email (must be verified in Resend):',
      default: 'tracker@resend.dev',
    },
  ]);

  // Test connection
  const spinner = ora('Testing Resend connection...').start();
  const connected = await testResendConnection(resendApiKey);
  if (connected) {
    spinner.succeed('Resend connection verified');
  } else {
    spinner.fail('Could not verify Resend connection');
  }

  // Send test email
  const { sendTest } = await inquirer.prompt<{ sendTest: boolean }>([
    {
      type: 'confirm',
      name: 'sendTest',
      message: 'Send a test email?',
      default: true,
    },
  ]);

  if (sendTest) {
    const testSpinner = ora('Sending test email...').start();
    try {
      await sendTestEmail(resendApiKey, fromEmail, recipientEmail);
      testSpinner.succeed('Test email sent!');
    } catch (err) {
      testSpinner.fail(`Failed to send test email: ${err}`);
    }
  }

  config.email = { resendApiKey, recipientEmail, fromEmail };
  config.features.emailReports = true;
  logger.success('Email reports enabled');
}
