import chalk from 'chalk';

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatDurationShort(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateTime(date: Date | string): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

export function box(content: string, title?: string): string {
  const lines = content.split('\n');
  const maxLen = Math.max(...lines.map(l => stripAnsi(l).length), title ? stripAnsi(title).length + 4 : 0);
  const width = maxLen + 2;

  const top = title
    ? `╭─ ${chalk.bold(title)} ${'─'.repeat(Math.max(0, width - stripAnsi(title).length - 4))}╮`
    : `╭${'─'.repeat(width)}╮`;
  const bottom = `╰${'─'.repeat(width)}╯`;

  const body = lines
    .map(line => {
      const padding = ' '.repeat(Math.max(0, maxLen - stripAnsi(line).length));
      return `│ ${line}${padding} │`;
    })
    .join('\n');

  return `${top}\n${body}\n${bottom}`;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function table(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => {
    const maxDataWidth = Math.max(...rows.map(r => stripAnsi(r[i] || '').length));
    return Math.max(stripAnsi(h).length, maxDataWidth);
  });

  const headerRow = headers
    .map((h, i) => chalk.bold(h.padEnd(colWidths[i])))
    .join('  ');
  const separator = colWidths.map(w => '─'.repeat(w)).join('──');
  const bodyRows = rows.map(row =>
    row.map((cell, i) => {
      const padding = ' '.repeat(Math.max(0, colWidths[i] - stripAnsi(cell).length));
      return cell + padding;
    }).join('  ')
  );

  return [headerRow, separator, ...bodyRows].join('\n');
}
