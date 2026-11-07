# System Info Module

Advanced system information, diagnostics, and monitoring module for the Music Bot.

## ⚠️ IMPORTANT: DM-ONLY COMMANDS

**All systeminfo commands are private and only accessible through DMs (whispers).** 
Responses are never sent to public chat for security and privacy.

## Overview

The SystemInfo module provides comprehensive bot information, health monitoring, user feedback collection, and bug reporting with automatic diagnostic capture. All interactions are completely private via DMs.

## Features

### 📊 Core Features
- **Version Management**: Track bot version, codename, and release information
- **Changelog System**: Maintain and display update history
- **Health Monitoring**: Real-time CPU, memory, and disk usage tracking
- **Performance Metrics**: Track commands executed, songs played, errors encountered
- **User Feedback**: Collect user feedback with rate limiting
- **Bug Reporting**: Automated bug reports with system diagnostics
- **Admin Statistics**: Comprehensive statistics dashboard for admins

### 🔧 Advanced Features
- **Automatic Diagnostics**: Bug reports include system state snapshot
- **Rate Limiting**: Prevent spam for feedback and bug reports
- **Atomic File Operations**: Thread-safe JSON operations with locks
- **Performance Tracking**: Real-time metrics collection
- **Owner Notifications**: Automatic notifications for feedback and bugs
- **Process Monitoring**: Track threads, memory usage per process

## Commands

### DM-Only Commands (All Users)

All commands send responses privately via DM - never in public chat.

#### `!system` (aliases: `sysinfo`, `about`, `botinfo`, `info`)
Display comprehensive system information (DM response).
- **Basic users**: See version, uptime, server time
- **Admins**: Additional health metrics, CPU, memory, queue stats
- **Privacy**: All info sent via whisper

#### `!version` (aliases: `ver`, `v`)
Display current bot version and metadata (DM response).

#### `!changelog` (aliases: `updates`, `changes`)
View latest update changelog with details (DM response).

#### `!uptime`
Display bot uptime in human-readable format (DM response).

#### `!feedback <message>`
Submit feedback to developers (DM response).
- **Rate limit**: 30 seconds
- **Features**: Auto-notify owner, timestamp tracking
- **Privacy**: Your feedback is private

#### `!reportbug <description>` (aliases: `bugreport`, `bug`)
Report a bug with automatic diagnostic capture (DM response).
- **Rate limit**: 60 seconds
- **Auto-captured**: Version, uptime, queue stats, CPU, memory
- **Features**: Generates unique report ID, notifies owner
- **Privacy**: Your bug report is confidential

### Admin-Only Commands (DM-Only)

All admin commands require admin access and send responses via DM only.

#### `!health` (aliases: `status`, `diagnostics`)
Display comprehensive system health dashboard (DM response).
- CPU and memory usage
- Disk usage statistics
- Process information (threads, memory)
- Bot statistics (queue, playlists, uptime)
- Performance metrics
- **Privacy**: Sensitive system data sent privately

#### `!ping` (alias: `latency`)
Check bot response time with status indicator (DM response).
- 🟢 Excellent: < 100ms
- 🔵 Good: 100-300ms
- 🟡 Fair: 300-500ms
- 🔴 Slow: > 500ms
- **Privacy**: Performance data sent privately

#### `!stats` (alias: `statistics`)
Display comprehensive bot statistics (DM response).
- Version information
- User counts (admins, VIPs)
- Feedback and bug report counts
- Runtime metrics
- **Privacy**: All statistics sent privately

## Data Files

### `version.json`
```json
{
  "version": "2.0.0",
  "codename": "Advanced Music Bot System",
  "release_date": "2025-11-19",
  "developer": "@paul_sanif",
  "status": "stable",
  "build": "2025.11.19.001"
}
```

### `changelog.json`
Stores update history with version, title, details, and release date.

### `feedback.json`
Stores user feedback with timestamp, username, and message.

### `bugs.json`
Stores bug reports with full system diagnostics snapshot.

## Architecture

### SystemInfoManager
Core manager class handling all system info operations.

**Key Methods:**
- `get_version()`: Retrieve version information
- `get_changelog()`: Get changelog data
- `add_feedback()`: Store user feedback with rate limiting
- `add_bug_report()`: Create bug report with diagnostics
- `collect_diagnostics()`: Gather system health metrics
- `get_statistics()`: Generate comprehensive stats
- `notify_owner()`: Send owner notifications

**Features:**
- Async/await support for non-blocking operations
- Thread-safe with asyncio locks
- Atomic file writes to prevent corruption
- Automatic rate limiting
- Performance metrics tracking

### Performance Metrics Tracked
- `commands_executed`: Total commands run
- `errors_encountered`: Total errors caught
- `songs_played`: Total songs played
- `playlists_created`: Total playlists created

## Integration

### In `main.py`
```python
from systems.systeminfo import SystemInfoManager

# Initialize in __init__
self.systeminfo = SystemInfoManager()
```

### In `loader.py`
Add "systeminfo" to `systems_to_load` list.

## Dependencies

### Required
- `asyncio`: Async operations and locks
- `json`: Data persistence
- `time`, `datetime`: Timestamps and uptime

### Optional
- `psutil`: Advanced system metrics (CPU, memory, disk)
  - Gracefully degrades if unavailable
  - Install: Already in requirements.txt

## Usage Examples

### User Feedback
```
User: !feedback This bot is amazing! Love the playlist feature.
Bot: ✅ Feedback Received!
     Thank you for your input!
     Your feedback helps improve the bot.
```

### Bug Report
```
User: !reportbug Music stops after 3 songs
Bot: ✅ Bug Report Submitted!
     Report ID: #1732043123
     Your report has been logged with:
     • System diagnostics
     • Version info
     • Performance metrics
```

### Admin Health Check
```
Admin: !health
Bot: ═══════════════════════════
     🛠️ System Health Dashboard
     ═══════════════════════════
     
     ⚡ Performance
     CPU: 45.2%
     Memory: 62.1%
     Disk: 12.3/50.0 GB (24.6%)
     
     🔧 Process Info
     Threads: 8
     Memory: 256.4 MB
     
     🎵 Bot Stats
     Queue: 5 songs
     Active Playlists: 2
     Uptime: 2h 34m 12s
```

## Rate Limiting

- **Feedback**: 30 seconds cooldown
- **Bug Reports**: 60 seconds cooldown
- Prevents spam and abuse
- User-friendly cooldown messages

## Owner Notifications

Automatic notifications sent to owner (@paul_sanif) for:
- New feedback submissions
- Bug reports with full diagnostics
- Logged to `logs/owner_notifications.log`

## Health Monitoring

### Metrics Collected
- **CPU Usage**: Real-time percentage
- **Memory Usage**: RAM percentage and MB
- **Disk Usage**: Total, used, free (GB and %)
- **Process Info**: Thread count, process memory
- **Bot Metrics**: Queue length, active playlists
- **Uptime**: Human-readable and seconds

### Diagnostic Snapshot
Every bug report captures:
- Bot version and codename
- Current uptime
- Queue length
- Active playlist count
- CPU and memory usage
- Timestamp

## Best Practices

1. **Regular Updates**: Update `version.json` on releases
2. **Changelog Maintenance**: Add changelog entries for major updates
3. **Monitor Feedback**: Check feedback regularly for user insights
4. **Bug Triage**: Review bug reports with diagnostic data
5. **Performance Tracking**: Monitor metrics for optimization opportunities

## Advanced Features

### Atomic Writes
All JSON operations use atomic writes:
1. Write to `.tmp` file
2. Replace original file atomically
3. Prevents corruption on crash

### Thread Safety
All file operations protected with asyncio locks:
- `_version_lock`
- `_changelog_lock`
- `_feedback_lock`
- `_bugs_lock`

### Graceful Degradation
- Works without psutil (limited metrics)
- Handles missing bot instance gracefully
- Never crashes on metric collection failure

## Troubleshooting

### Commands Not Loading
- Check loader.py includes "systeminfo"
- Restart bot to load new module
- Check logs for import errors

### No Advanced Metrics
- Install psutil: Already in requirements.txt
- Check if PSUTIL_AVAILABLE flag is True
- Review logs for import errors

### Rate Limit Issues
- Adjust cooldowns in SystemInfoManager
- `BUG_REPORT_COOLDOWN = 60`
- `FEEDBACK_COOLDOWN = 30`

## Future Enhancements

Potential additions:
- Web dashboard for statistics
- Email notifications for bugs
- Advanced analytics
- Export reports to CSV
- Historical metrics tracking
- Automated health alerts
- Performance benchmarking

## Version History

### v2.0.0 (2025-11-19)
- Initial implementation
- Full diagnostic system
- Advanced health monitoring
- User feedback collection
- Bug reporting with auto-diagnostics
- Performance metrics tracking
- Admin statistics dashboard

## Support

For issues or questions:
- Report bugs: `!reportbug <description>`
- Submit feedback: `!feedback <message>`
- Contact: @paul_sanif (Owner)
