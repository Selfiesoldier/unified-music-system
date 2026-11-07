"""
System Info Commands - DM-only bot information and diagnostics
All commands send responses via DM conversation for privacy
Provides version, health, feedback, bug reporting, and statistics
"""
import time
import asyncio
from core.error_handler import log_error_to_file
from core.color_formatter import Colors, MessageFormatter
from core.logger import write_command_log
from core.context import message_context, conversation_context
from core.message_utils import MessageChunker


async def send_dm_response(bot, user_id, message):
    """
    Send response in DM conversation if available, otherwise send as whisper.
    This ensures DM commands reply in the conversation thread, not as whispers.
    """
    conv_id = conversation_context.get()
    if conv_id:
        # We're in a DM conversation - reply in the thread
        await bot.highrise.send_message(conv_id, message)
    else:
        # Fallback to whisper (shouldn't happen for DM-only commands, but safe)
        await bot.highrise.send_whisper(user_id, message)


def register(bot):
    """Register system info commands with the bot (DM-only)"""
    
    @bot.command("system", "sysinfo", "about", "botinfo", "info")
    async def system_cmd(bot, user, message):
        """Display comprehensive system information (DM only)"""
        try:
            # DM-only check
            if message_context.get() != "dm":
                await send_dm_response(bot, user.id, 
                    f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                    f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!system {Colors.SKY_BLUE}to use this command"
                )
                return
            
            write_command_log(user.username, user.id, "system")
            
            version = await bot.systeminfo.get_version()
            server_time, local_time = bot.systeminfo.get_times()
            uptime = bot.systeminfo.format_uptime()
            
            # Base information for all users
            msg = (
                f"{Colors.PINK}═══════════════════════════\n"
                f"{Colors.GOLD}🎶 {version.get('codename', 'Music Bot')}\n"
                f"{Colors.PINK}═══════════════════════════\n\n"
                f"{Colors.LAVENDER}📌 Version: {Colors.CYAN}{version.get('version')} {Colors.GRAY}({version.get('build', 'N/A')})\n"
                f"{Colors.LAVENDER}👨‍💻 Developer: {Colors.PURPLE}{version.get('developer')}\n"
                f"{Colors.LAVENDER}📅 Released: {Colors.SKY_BLUE}{version.get('release_date')}\n"
                f"{Colors.LAVENDER}⏱ Uptime: {Colors.MINT}{uptime}\n"
                f"{Colors.LAVENDER}🌐 Server: {Colors.GRAY}{server_time}\n"
                f"{Colors.LAVENDER}📍 Local: {Colors.GRAY}{local_time}\n"
            )
            
            # Enhanced info for admins
            if bot.admin.has_admin_access(user.username):
                cpu, mem = bot.systeminfo.get_cpu_memory()
                diagnostics = await bot.systeminfo.collect_diagnostics(bot)
                
                msg += (
                    f"\n{Colors.ORANGE}═══ Admin Diagnostics ═══\n"
                    f"{Colors.LAVENDER}🔋 CPU: {Colors.YELLOW}{cpu if cpu is not None else 'N/A'}%\n"
                    f"{Colors.LAVENDER}💾 Memory: {Colors.YELLOW}{mem if mem is not None else 'N/A'}%\n"
                    f"{Colors.LAVENDER}🎶 Active Playlists: {Colors.CYAN}{diagnostics.get('active_playlists', 0)}\n"
                    f"{Colors.LAVENDER}📦 Queue Length: {Colors.CYAN}{diagnostics.get('queue_length', 0)}\n"
                )
                
                disk = bot.systeminfo.get_disk_usage()
                if disk:
                    msg += f"{Colors.LAVENDER}💿 Disk: {Colors.YELLOW}{disk['used_gb']}/{disk['total_gb']} GB ({disk['percent']}%)\n"
            
            msg += (
                f"\n{Colors.PINK}═══════════════════════════\n"
                f"{Colors.SKY_BLUE}💡 All system info is private!\n"
                f"{Colors.PINK}═══════════════════════════"
            )
            
            # Send via DM with auto-chunking
            await send_dm_response(bot, user.id, msg)
            
        except Exception as e:
            log_error_to_file("system_cmd", e)
            await send_dm_response(bot, user.id, MessageFormatter.error(f"System error: {str(e)}"))
    
    @bot.command("version", "ver", "v")
    async def version_cmd(bot, user, message):
        """Display version information (DM only)"""
        try:
            # DM-only check
            if message_context.get() != "dm":
                await send_dm_response(bot, user.id, 
                    f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                    f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!version {Colors.SKY_BLUE}to use this command"
                )
                return
            
            write_command_log(user.username, user.id, "version")
            
            version = await bot.systeminfo.get_version()
            msg = (
                f"{Colors.GOLD}🎵 Bot Version\n\n"
                f"{Colors.CYAN}Version: {Colors.WHITE}{version.get('version')}\n"
                f"{Colors.LAVENDER}Codename: {Colors.PINK}{version.get('codename')}\n"
                f"{Colors.SKY_BLUE}Released: {Colors.GRAY}{version.get('release_date')}\n"
                f"{Colors.PURPLE}Status: {Colors.MINT}{version.get('status', 'stable').upper()}\n"
                f"{Colors.ORANGE}Developer: {Colors.YELLOW}{version.get('developer')}"
            )
            
            # Send via DM
            await send_dm_response(bot, user.id, msg)
            
        except Exception as e:
            log_error_to_file("version_cmd", e)
            await send_dm_response(bot, user.id, MessageFormatter.error("Version check failed"))
    
    @bot.command("changelog", "updates", "changes")
    async def changelog_cmd(bot, user, message):
        """Display latest changelog (DM only)"""
        try:
            # DM-only check
            if message_context.get() != "dm":
                await send_dm_response(bot, user.id, 
                    f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                    f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!changelog {Colors.SKY_BLUE}to use this command"
                )
                return
            
            write_command_log(user.username, user.id, "changelog")
            
            changelog = await bot.systeminfo.get_changelog()
            changes = changelog.get("changes", [])
            
            if not changes:
                await send_dm_response(bot, user.id, MessageFormatter.error("No changelog available"))
                return
            
            # Show latest update
            latest = changes[0]
            msg = (
                f"{Colors.PINK}═══════════════════════════\n"
                f"{Colors.GOLD}📝 Latest Update - v{latest.get('version')}\n"
                f"{Colors.PINK}═══════════════════════════\n\n"
                f"{Colors.LAVENDER}🎯 {latest.get('title')}\n"
                f"{Colors.SKY_BLUE}📅 Released: {latest.get('released_at')}\n\n"
                f"{Colors.CYAN}✨ Changes:\n"
            )
            
            details = latest.get("details", [])[:6]  # Limit to 6 for space
            for detail in details:
                msg += f"{Colors.MINT}• {detail}\n"
            
            if len(latest.get("details", [])) > 6:
                msg += f"{Colors.GRAY}  ...and {len(latest.get('details', [])) - 6} more\n"
            
            msg += f"\n{Colors.PINK}═══════════════════════════"
            
            # Send via DM
            await send_dm_response(bot, user.id, msg)
            
        except Exception as e:
            log_error_to_file("changelog_cmd", e)
            await send_dm_response(bot, user.id, MessageFormatter.error("Changelog unavailable"))
    
    @bot.command("feedback")
    async def feedback_cmd(bot, user, message):
        """Submit feedback to developers (DM only)"""
        try:
            # DM-only check
            if message_context.get() != "dm":
                await send_dm_response(bot, user.id, 
                    f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                    f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!feedback {Colors.SKY_BLUE}to use this command"
                )
                return
            
            parts = message.split(maxsplit=1)
            msg_text = parts[1].strip() if len(parts) > 1 else ""
            
            if not msg_text:
                await send_dm_response(bot, user.id, 
                    f"{Colors.RED}❌ Usage: {Colors.LAVENDER}!feedback <your message>\n"
                    f"{Colors.SKY_BLUE}Example: {Colors.GRAY}!feedback Great bot, loving the playlist system!"
                )
                return
            
            write_command_log(user.username, user.id, "feedback", msg_text[:50])
            
            success, result_msg = await bot.systeminfo.add_feedback(
                user.username, 
                user.id, 
                msg_text
            )
            
            if success:
                response = (
                    f"{Colors.MINT}✅ Feedback Received!\n\n"
                    f"{Colors.SKY_BLUE}Thank you for your input!\n"
                    f"{Colors.LAVENDER}Your feedback helps improve the bot.\n\n"
                    f"{Colors.GRAY}💡 Found a bug? Use !reportbug"
                )
                
                # Notify owner
                await bot.systeminfo.notify_owner(
                    bot, 
                    f"📬 New Feedback from {user.username}:\n{msg_text}"
                )
            else:
                response = f"{Colors.ORANGE}⚠️ {result_msg}"
            
            # Send via DM
            await send_dm_response(bot, user.id, response)
            
        except Exception as e:
            log_error_to_file("feedback_cmd", e)
            await send_dm_response(bot, user.id, MessageFormatter.error("Feedback submission failed"))
    
    @bot.command("feedbacklogs", "viewfeedback", "allfeedback")
    async def feedbacklogs_cmd(bot, user, message):
        """View all feedback submissions (Admin only, DM only)"""
        try:
            # DM-only check
            if message_context.get() != "dm":
                await send_dm_response(bot, user.id, 
                    f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                    f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!feedbacklogs {Colors.SKY_BLUE}to use this command"
                )
                return
            
            # Admin access check
            if not bot.admin.has_admin_access(user.username):
                await send_dm_response(bot, user.id, MessageFormatter.error("Admin access required!"))
                return
            
            write_command_log(user.username, user.id, "feedbacklogs")
            
            # Get all feedback
            all_feedback = await bot.systeminfo.get_all_feedback()
            total_count = len(all_feedback)
            
            if total_count == 0:
                await send_dm_response(bot, user.id, 
                    f"{Colors.YELLOW}📭 No feedback submissions yet!\n"
                    f"{Colors.GRAY}Users can submit feedback using {Colors.LAVENDER}!feedback <message>"
                )
                return
            
            # Build header
            msg = (
                f"{Colors.PINK}═══════════════════════════\n"
                f"{Colors.GOLD}📬 Feedback Log ({total_count} total)\n"
                f"{Colors.PINK}═══════════════════════════\n\n"
            )
            
            # Display feedback entries (show last 100)
            display_limit = 100
            feedback_to_show = all_feedback[:display_limit]
            
            for idx, entry in enumerate(feedback_to_show, 1):
                username = entry.get("user", "Unknown")
                message_text = entry.get("message", "No message")
                date = entry.get("date", "Unknown date")
                
                # Truncate very long messages to keep output manageable
                if len(message_text) > 100:
                    message_text = message_text[:97] + "..."
                
                msg += (
                    f"{Colors.CYAN}#{idx} {Colors.LAVENDER}{username}\n"
                    f"{Colors.SKY_BLUE}📅 {date}\n"
                    f"{Colors.WHITE}{message_text}\n"
                    f"{Colors.GRAY}{'─' * 27}\n"
                )
            
            # Show if there are more entries
            if total_count > display_limit:
                msg += f"\n{Colors.YELLOW}📋 Showing {display_limit} of {total_count} entries\n"
                msg += f"{Colors.GRAY}(Oldest {total_count - display_limit} entries not shown)\n"
            
            msg += f"\n{Colors.PINK}═══════════════════════════"
            
            # Send via DM with automatic chunking for long messages
            conv_id = conversation_context.get()
            if conv_id:
                # Use MessageChunker to handle potentially long messages
                chunks = MessageChunker.chunk_message(msg, max_length=240)
                for i, chunk in enumerate(chunks):
                    await bot.highrise.send_message(conv_id, chunk)
                    # Add delay between chunks (except after the last one)
                    if i < len(chunks) - 1:
                        await asyncio.sleep(1.5)
            else:
                # Fallback to whisper with chunking
                chunks = MessageChunker.chunk_message(msg, max_length=240)
                for i, chunk in enumerate(chunks):
                    await bot.highrise.send_whisper(user.id, chunk)
                    if i < len(chunks) - 1:
                        await asyncio.sleep(1.5)
            
        except Exception as e:
            log_error_to_file("feedbacklogs_cmd", e)
            await send_dm_response(bot, user.id, MessageFormatter.error("Failed to retrieve feedback logs"))
    
    @bot.command("reportbug", "bugreport", "bug")
    async def reportbug_cmd(bot, user, message):
        """Report a bug with automatic diagnostics (DM only)"""
        try:
            # DM-only check
            if message_context.get() != "dm":
                await send_dm_response(bot, user.id, 
                    f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                    f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!reportbug {Colors.SKY_BLUE}to use this command"
                )
                return
            
            bug_desc = message.split(maxsplit=1)[1] if len(message.split(maxsplit=1)) > 1 else ""
            
            if not bug_desc:
                await send_dm_response(bot, user.id, 
                    f"{Colors.RED}❌ Usage: {Colors.LAVENDER}!reportbug <description>\n"
                    f"{Colors.SKY_BLUE}Example: {Colors.GRAY}!reportbug Music stops after 3 songs"
                )
                return
            
            write_command_log(user.username, user.id, "reportbug", bug_desc[:50])
            
            # Determine user role
            if bot.admin.is_owner(user.username):
                role = "Owner"
            elif bot.admin.is_admin(user.username):
                role = "Admin"
            elif bot.admin.is_vip(user.username):
                role = "VIP"
            else:
                role = "User"
            
            success, result_msg, entry = await bot.systeminfo.add_bug_report(
                user.username,
                user.id,
                role,
                bug_desc,
                bot
            )
            
            if success:
                response = (
                    f"{Colors.MINT}✅ Bug Report Submitted!\n\n"
                    f"{Colors.LAVENDER}Report ID: {Colors.CYAN}#{entry.get('timestamp')}\n"
                    f"{Colors.SKY_BLUE}Your report has been logged with:\n"
                    f"{Colors.GRAY}• System diagnostics\n"
                    f"{Colors.GRAY}• Version info\n"
                    f"{Colors.GRAY}• Performance metrics\n\n"
                    f"{Colors.PINK}Thank you for helping us improve!"
                )
                
                # Detailed owner notification
                owner_msg = (
                    f"🐞 Bug Report #{entry.get('timestamp')}\n"
                    f"From: {user.username} ({role})\n"
                    f"Description: {bug_desc}\n\n"
                    f"📊 Diagnostics:\n"
                    f"• Version: {entry.get('version')}\n"
                    f"• Uptime: {entry.get('uptime')}\n"
                    f"• Queue: {entry.get('queue_length')}\n"
                    f"• Active Playlists: {entry.get('active_playlists')}\n"
                    f"• CPU: {entry.get('cpu_usage')}%\n"
                    f"• Memory: {entry.get('memory_usage')}%"
                )
                
                await bot.systeminfo.notify_owner(bot, owner_msg)
            else:
                response = f"{Colors.ORANGE}⚠️ {result_msg}"
            
            # Send via DM
            await send_dm_response(bot, user.id, response)
            
        except Exception as e:
            log_error_to_file("reportbug_cmd", e)
            await send_dm_response(bot, user.id, MessageFormatter.error("Bug report failed"))
    
    @bot.command("uptime")
    async def uptime_cmd(bot, user, message):
        """Display bot uptime (DM only)"""
        try:
            # DM-only check
            if message_context.get() != "dm":
                await send_dm_response(bot, user.id, 
                    f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                    f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!uptime {Colors.SKY_BLUE}to use this command"
                )
                return
            
            write_command_log(user.username, user.id, "uptime")
            
            uptime = bot.systeminfo.format_uptime()
            uptime_sec = bot.systeminfo.get_uptime_seconds()
            
            msg = (
                f"{Colors.MINT}⏱ Bot Uptime\n\n"
                f"{Colors.CYAN}{uptime}\n"
                f"{Colors.GRAY}({uptime_sec:,} seconds)\n\n"
                f"{Colors.SKY_BLUE}🟢 Running smoothly!"
            )
            
            # Send via DM
            await send_dm_response(bot, user.id, msg)
            
        except Exception as e:
            log_error_to_file("uptime_cmd", e)
            await send_dm_response(bot, user.id, MessageFormatter.error("Uptime check failed"))
    
    @bot.command("health", "status", "diagnostics")
    async def health_cmd(bot, user, message):
        """Display system health (Admin only, DM only)"""
        try:
            # DM-only check
            if message_context.get() != "dm":
                await send_dm_response(bot, user.id, 
                    f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                    f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!health {Colors.SKY_BLUE}to use this command"
                )
                return
            
            # Debug logging
            print(f"🔍 DEBUG health command: username='{user.username}', is_owner={bot.admin.is_owner(user.username)}, has_admin_access={bot.admin.has_admin_access(user.username)}")
            
            if not bot.admin.has_admin_access(user.username):
                await send_dm_response(bot, user.id, MessageFormatter.error("Admin access required!"))
                return
            
            write_command_log(user.username, user.id, "health")
            
            diagnostics = await bot.systeminfo.collect_diagnostics(bot)
            cpu, mem = bot.systeminfo.get_cpu_memory()
            disk = bot.systeminfo.get_disk_usage()
            process = bot.systeminfo.get_process_info()
            metrics = bot.systeminfo.get_metrics()
            
            msg = (
                f"{Colors.PINK}═══════════════════════════\n"
                f"{Colors.GOLD}🛠️ System Health Dashboard\n"
                f"{Colors.PINK}═══════════════════════════\n\n"
                f"{Colors.ORANGE}⚡ Performance\n"
                f"{Colors.LAVENDER}CPU: {Colors.YELLOW}{cpu if cpu else 'N/A'}%\n"
                f"{Colors.LAVENDER}Memory: {Colors.YELLOW}{mem if mem else 'N/A'}%\n"
            )
            
            if disk:
                msg += f"{Colors.LAVENDER}Disk: {Colors.YELLOW}{disk['used_gb']}/{disk['total_gb']} GB ({disk['percent']}%)\n"
            
            if process:
                msg += (
                    f"\n{Colors.ORANGE}🔧 Process Info\n"
                    f"{Colors.LAVENDER}Threads: {Colors.CYAN}{process['threads']}\n"
                    f"{Colors.LAVENDER}Memory: {Colors.CYAN}{process['memory_mb']} MB\n"
                )
            
            msg += (
                f"\n{Colors.ORANGE}🎵 Bot Stats\n"
                f"{Colors.LAVENDER}Queue: {Colors.CYAN}{diagnostics.get('queue_length', 0)} songs\n"
                f"{Colors.LAVENDER}Active Playlists: {Colors.CYAN}{diagnostics.get('active_playlists', 0)}\n"
                f"{Colors.LAVENDER}Uptime: {Colors.MINT}{diagnostics.get('uptime')}\n"
            )
            
            msg += (
                f"\n{Colors.ORANGE}📊 Metrics\n"
                f"{Colors.LAVENDER}Commands: {Colors.CYAN}{metrics.get('commands_executed', 0):,}\n"
                f"{Colors.LAVENDER}Songs Played: {Colors.CYAN}{metrics.get('songs_played', 0):,}\n"
                f"{Colors.LAVENDER}Errors: {Colors.RED}{metrics.get('errors_encountered', 0)}\n"
            )
            
            msg += f"\n{Colors.PINK}═══════════════════════════"
            
            # Send via DM
            await send_dm_response(bot, user.id, msg)
            
        except Exception as e:
            log_error_to_file("health_cmd", e)
            await send_dm_response(bot, user.id, MessageFormatter.error("Health check failed"))
    
    @bot.command("ping", "latency")
    async def ping_cmd(bot, user, message):
        """Check bot response time (Admin only, DM only)"""
        try:
            # DM-only check
            if message_context.get() != "dm":
                await send_dm_response(bot, user.id, 
                    f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                    f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!ping {Colors.SKY_BLUE}to use this command"
                )
                return
            
            if not bot.admin.has_admin_access(user.username):
                await send_dm_response(bot, user.id, MessageFormatter.error("Admin access required!"))
                return
            
            write_command_log(user.username, user.id, "ping")
            
            start_time = time.time()
            
            # Measure response time
            await send_dm_response(bot, user.id, f"{Colors.YELLOW}🏓 Pinging...")
            
            elapsed_ms = int((time.time() - start_time) * 1000)
            
            # Determine status based on latency
            if elapsed_ms < 100:
                status = f"{Colors.MINT}Excellent"
                emoji = "🟢"
            elif elapsed_ms < 300:
                status = f"{Colors.CYAN}Good"
                emoji = "🔵"
            elif elapsed_ms < 500:
                status = f"{Colors.YELLOW}Fair"
                emoji = "🟡"
            else:
                status = f"{Colors.RED}Slow"
                emoji = "🔴"
            
            msg = (
                f"{Colors.PINK}🏓 Pong!\n\n"
                f"{Colors.LAVENDER}Latency: {Colors.CYAN}{elapsed_ms}ms\n"
                f"{Colors.LAVENDER}Status: {status} {emoji}"
            )
            
            # Send via DM
            await send_dm_response(bot, user.id, msg)
            
        except Exception as e:
            log_error_to_file("ping_cmd", e)
            await send_dm_response(bot, user.id, MessageFormatter.error("Ping failed"))
    
    @bot.command("stats", "statistics")
    async def stats_cmd(bot, user, message):
        """Display comprehensive statistics (Admin only, DM only)"""
        try:
            # DM-only check
            if message_context.get() != "dm":
                await send_dm_response(bot, user.id, 
                    f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                    f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!stats {Colors.SKY_BLUE}to use this command"
                )
                return
            
            if not bot.admin.has_admin_access(user.username):
                await send_dm_response(bot, user.id, MessageFormatter.error("Admin access required!"))
                return
            
            write_command_log(user.username, user.id, "stats")
            
            stats = await bot.systeminfo.get_statistics(bot)
            version = stats.get("version", {})
            
            msg = (
                f"{Colors.PINK}═══════════════════════════\n"
                f"{Colors.GOLD}📊 Bot Statistics\n"
                f"{Colors.PINK}═══════════════════════════\n\n"
                f"{Colors.ORANGE}🎵 Version\n"
                f"{Colors.LAVENDER}Current: {Colors.CYAN}{version.get('version')}\n"
                f"{Colors.LAVENDER}Codename: {Colors.PURPLE}{version.get('codename')}\n\n"
                f"{Colors.ORANGE}👥 Users\n"
                f"{Colors.LAVENDER}Admins: {Colors.CYAN}{stats.get('admin_count', 0)}\n"
                f"{Colors.LAVENDER}VIPs: {Colors.GOLD}{stats.get('vip_count', 0)}\n\n"
                f"{Colors.ORANGE}📬 Feedback\n"
                f"{Colors.LAVENDER}Total Feedback: {Colors.CYAN}{stats.get('feedback_count', 0)}\n"
                f"{Colors.LAVENDER}Bug Reports: {Colors.RED}{stats.get('bug_count', 0)}\n\n"
                f"{Colors.ORANGE}📝 Updates\n"
                f"{Colors.LAVENDER}Changelog Entries: {Colors.CYAN}{stats.get('changelog_entries', 0)}\n"
            )
            
            diagnostics = stats.get("diagnostics", {})
            msg += (
                f"\n{Colors.ORANGE}⏱ Runtime\n"
                f"{Colors.LAVENDER}Uptime: {Colors.MINT}{diagnostics.get('uptime')}\n"
                f"{Colors.LAVENDER}Queue: {Colors.CYAN}{diagnostics.get('queue_length', 0)}\n"
                f"{Colors.LAVENDER}Playlists: {Colors.CYAN}{diagnostics.get('active_playlists', 0)}\n"
            )
            
            msg += f"\n{Colors.PINK}═══════════════════════════"
            
            # Send via DM
            await send_dm_response(bot, user.id, msg)
            
        except Exception as e:
            log_error_to_file("stats_cmd", e)
            await send_dm_response(bot, user.id, MessageFormatter.error("Stats retrieval failed"))
