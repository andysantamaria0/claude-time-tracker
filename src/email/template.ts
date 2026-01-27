import { formatDuration, formatDateTime } from '../utils/formatting.js';
import type { Session } from '../types.js';

export function buildEmailHtml(session: Session): string {
  const duration = formatDuration(session.durationMs);
  const startTime = formatDateTime(session.startTime);
  const endTime = formatDateTime(session.endTime);

  const commitsHtml = session.commits.length > 0
    ? session.commits.map(c => `<li style="margin-bottom: 4px;">${escapeHtml(c)}</li>`).join('')
    : '<li style="color: #999;">No commits during session</li>';

  const filesHtml = session.changedFiles.length > 0
    ? session.changedFiles.slice(0, 20).map(f => `<li style="margin-bottom: 2px; font-family: monospace; font-size: 13px;">${escapeHtml(f)}</li>`).join('')
    : '<li style="color: #999;">No file changes detected</li>';

  const prHtml = session.prUrl
    ? `<tr><td style="padding: 8px 12px; color: #666; font-weight: 500;">PR</td><td style="padding: 8px 12px;"><a href="${escapeHtml(session.prUrl)}" style="color: #6b4fbb;">${escapeHtml(session.prUrl)}</a></td></tr>`
    : '';

  const summaryHtml = session.conversationSummary
    ? `
      <div style="margin-top: 20px; padding: 16px; background: #f0f0ff; border-radius: 8px;">
        <h3 style="margin: 0 0 8px 0; color: #6b4fbb; font-size: 15px;">Conversation Summary</h3>
        <p style="margin: 0; color: #333; line-height: 1.5;">${escapeHtml(session.conversationSummary)}</p>
      </div>
    `
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #6b4fbb, #9b59b6); border-radius: 12px 12px 0 0; padding: 24px; color: white;">
      <h1 style="margin: 0; font-size: 20px; font-weight: 600;">Claude Session Report</h1>
      <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 14px;">${escapeHtml(session.projectName)} &mdash; ${escapeHtml(session.feature || 'Session')}</p>
    </div>

    <!-- Session Details -->
    <div style="background: white; padding: 20px; border: 1px solid #e0e0e0;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 12px; color: #666; font-weight: 500; width: 120px;">Duration</td>
          <td style="padding: 8px 12px; font-weight: 600; color: #333;">${duration}</td>
        </tr>
        <tr style="background: #fafafa;">
          <td style="padding: 8px 12px; color: #666; font-weight: 500;">Project</td>
          <td style="padding: 8px 12px;">${escapeHtml(session.projectName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; color: #666; font-weight: 500;">Branch</td>
          <td style="padding: 8px 12px; font-family: monospace; font-size: 13px;">${escapeHtml(session.branch)}</td>
        </tr>
        <tr style="background: #fafafa;">
          <td style="padding: 8px 12px; color: #666; font-weight: 500;">Feature</td>
          <td style="padding: 8px 12px;">${escapeHtml(session.feature)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; color: #666; font-weight: 500;">Start</td>
          <td style="padding: 8px 12px;">${startTime}</td>
        </tr>
        <tr style="background: #fafafa;">
          <td style="padding: 8px 12px; color: #666; font-weight: 500;">End</td>
          <td style="padding: 8px 12px;">${endTime}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; color: #666; font-weight: 500;">End Reason</td>
          <td style="padding: 8px 12px;">${session.endReason}</td>
        </tr>
        ${prHtml}
      </table>

      ${summaryHtml}

      <!-- Commits -->
      <div style="margin-top: 20px;">
        <h3 style="margin: 0 0 8px 0; color: #333; font-size: 15px;">Commits (${session.commits.length})</h3>
        <ul style="margin: 0; padding-left: 20px; color: #555; font-size: 14px;">
          ${commitsHtml}
        </ul>
      </div>

      <!-- Changed Files -->
      <div style="margin-top: 20px;">
        <h3 style="margin: 0 0 8px 0; color: #333; font-size: 15px;">Changed Files (${session.changedFiles.length})</h3>
        <ul style="margin: 0; padding-left: 20px; color: #555; font-size: 14px;">
          ${filesHtml}
          ${session.changedFiles.length > 20 ? `<li style="color: #999;">...and ${session.changedFiles.length - 20} more</li>` : ''}
        </ul>
      </div>
    </div>

    <!-- Footer -->
    <div style="background: #fafafa; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px; padding: 16px; text-align: center;">
      <p style="margin: 0; color: #999; font-size: 12px;">
        Sent by Claude Time Tracker &bull; Session ID: ${session.id.slice(0, 8)}
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

export function buildReportHtml(
  title: string,
  sessions: Session[],
  periodLabel: string,
): string {
  const totalMs = sessions.reduce((sum, s) => sum + s.durationMs, 0);
  const totalDuration = formatDuration(totalMs);

  const projectGroups = new Map<string, Session[]>();
  for (const session of sessions) {
    const existing = projectGroups.get(session.projectName) || [];
    existing.push(session);
    projectGroups.set(session.projectName, existing);
  }

  const projectRows = [...projectGroups.entries()]
    .map(([name, projSessions]) => {
      const projMs = projSessions.reduce((sum, s) => sum + s.durationMs, 0);
      return `
        <tr>
          <td style="padding: 8px 12px; font-weight: 500;">${escapeHtml(name)}</td>
          <td style="padding: 8px 12px; text-align: center;">${projSessions.length}</td>
          <td style="padding: 8px 12px; text-align: right;">${formatDuration(projMs)}</td>
        </tr>
      `;
    })
    .join('');

  const sessionRows = sessions
    .map(s => `
      <tr>
        <td style="padding: 6px 12px; font-size: 13px;">${escapeHtml(s.projectName)}</td>
        <td style="padding: 6px 12px; font-size: 13px;">${escapeHtml(s.feature || '—')}</td>
        <td style="padding: 6px 12px; font-size: 13px; text-align: right;">${formatDuration(s.durationMs)}</td>
        <td style="padding: 6px 12px; font-size: 13px;">${formatDateTime(s.startTime)}</td>
      </tr>
    `)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5;">
  <div style="max-width: 700px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #6b4fbb, #9b59b6); border-radius: 12px 12px 0 0; padding: 24px; color: white;">
      <h1 style="margin: 0; font-size: 20px;">${escapeHtml(title)}</h1>
      <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 14px;">${periodLabel} &bull; ${sessions.length} sessions &bull; ${totalDuration} total</p>
    </div>

    <div style="background: white; padding: 20px; border: 1px solid #e0e0e0;">
      <h3 style="margin: 0 0 12px 0;">By Project</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f0f0f0;">
            <th style="padding: 8px 12px; text-align: left;">Project</th>
            <th style="padding: 8px 12px; text-align: center;">Sessions</th>
            <th style="padding: 8px 12px; text-align: right;">Duration</th>
          </tr>
        </thead>
        <tbody>${projectRows}</tbody>
      </table>

      <h3 style="margin: 20px 0 12px 0;">All Sessions</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f0f0f0;">
            <th style="padding: 6px 12px; text-align: left; font-size: 13px;">Project</th>
            <th style="padding: 6px 12px; text-align: left; font-size: 13px;">Feature</th>
            <th style="padding: 6px 12px; text-align: right; font-size: 13px;">Duration</th>
            <th style="padding: 6px 12px; text-align: left; font-size: 13px;">Started</th>
          </tr>
        </thead>
        <tbody>${sessionRows}</tbody>
      </table>
    </div>

    <div style="background: #fafafa; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px; padding: 16px; text-align: center;">
      <p style="margin: 0; color: #999; font-size: 12px;">Claude Time Tracker Report</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
