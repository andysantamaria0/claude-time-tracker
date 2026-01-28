import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { loadConfig, updateConfig, getConfigDir } from '../config.js';

const PLIST_NAME = 'com.claude-tracker.weekly-email.plist';
const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = join(LAUNCH_AGENTS_DIR, PLIST_NAME);
const LOG_PATH = join(getConfigDir(), 'weekly-email.log');

interface ScheduleConfig {
  dayOfWeek: number; // 0 = Sunday
  hour: number;
  minute: number;
}

/**
 * Generate the launchd plist XML content
 */
export function generatePlist(config: ScheduleConfig): string {
  // Find the claude-tracker executable path
  const execPath = process.argv[1];
  const nodePath = process.execPath;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-tracker.weekly-email</string>

    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${execPath}</string>
        <string>send-weekly-email</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>${config.dayOfWeek}</integer>
        <key>Hour</key>
        <integer>${config.hour}</integer>
        <key>Minute</key>
        <integer>${config.minute}</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>${LOG_PATH}</string>

    <key>StandardErrorPath</key>
    <string>${LOG_PATH}</string>

    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>`;
}

/**
 * Install the launchd job
 */
export function installLaunchdJob(): void {
  const config = loadConfig();
  const scheduleConfig = config.schedule?.weeklyEmail || {
    dayOfWeek: 0, // Sunday
    hour: 20,     // 8 PM
    minute: 0,
  };

  // Unload existing job if present
  if (existsSync(PLIST_PATH)) {
    try {
      execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'ignore' });
    } catch {
      // Job might not be loaded, ignore
    }
  }

  // Generate and write the plist
  const plistContent = generatePlist(scheduleConfig);
  writeFileSync(PLIST_PATH, plistContent, { mode: 0o644 });
  logger.debug(`Plist written to ${PLIST_PATH}`);

  // Load the job
  try {
    execSync(`launchctl load "${PLIST_PATH}"`, { stdio: 'pipe' });
  } catch (err) {
    throw new Error(`Failed to load launchd job: ${err}`);
  }

  // Update config to mark as enabled
  updateConfig({
    schedule: {
      weeklyEmail: {
        enabled: true,
        ...scheduleConfig,
      },
    },
  });

  logger.debug('Launchd job installed and loaded');
}

/**
 * Uninstall the launchd job
 */
export function uninstallLaunchdJob(): void {
  if (existsSync(PLIST_PATH)) {
    try {
      execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'ignore' });
    } catch {
      // Job might not be loaded
    }
    unlinkSync(PLIST_PATH);
    logger.debug('Plist removed');
  }

  // Update config to mark as disabled
  const config = loadConfig();
  if (config.schedule?.weeklyEmail) {
    updateConfig({
      schedule: {
        weeklyEmail: {
          ...config.schedule.weeklyEmail,
          enabled: false,
        },
      },
    });
  }

  logger.debug('Launchd job uninstalled');
}

/**
 * Check if the schedule is currently active
 */
export function getScheduleStatus(): {
  enabled: boolean;
  plistExists: boolean;
  jobLoaded: boolean;
  nextRun: Date | null;
  config: ScheduleConfig | null;
} {
  const config = loadConfig();
  const scheduleConfig = config.schedule?.weeklyEmail;
  const enabled = scheduleConfig?.enabled ?? false;
  const plistExists = existsSync(PLIST_PATH);

  let jobLoaded = false;
  if (plistExists) {
    try {
      const result = execSync('launchctl list', { encoding: 'utf-8' });
      jobLoaded = result.includes('com.claude-tracker.weekly-email');
    } catch {
      // launchctl failed
    }
  }

  // Calculate next run time
  let nextRun: Date | null = null;
  if (enabled && scheduleConfig) {
    nextRun = calculateNextRun(scheduleConfig);
  }

  return {
    enabled,
    plistExists,
    jobLoaded,
    nextRun,
    config: scheduleConfig ? {
      dayOfWeek: scheduleConfig.dayOfWeek,
      hour: scheduleConfig.hour,
      minute: scheduleConfig.minute,
    } : null,
  };
}

/**
 * Calculate the next scheduled run time
 */
function calculateNextRun(config: ScheduleConfig): Date {
  const now = new Date();
  const next = new Date(now);

  // Set to the configured time
  next.setHours(config.hour, config.minute, 0, 0);

  // Find the next occurrence of the configured day
  const currentDay = now.getDay();
  let daysUntil = config.dayOfWeek - currentDay;

  if (daysUntil < 0 || (daysUntil === 0 && now >= next)) {
    // If the day has passed this week, or it's today but time has passed
    daysUntil += 7;
  }

  next.setDate(now.getDate() + daysUntil);
  return next;
}

/**
 * Format day of week number to name
 */
export function formatDayOfWeek(day: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[day] || 'Unknown';
}

/**
 * Format hour to 12-hour time
 */
export function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  const minuteStr = minute.toString().padStart(2, '0');
  return `${hour12}:${minuteStr} ${period}`;
}
