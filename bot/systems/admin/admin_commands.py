"""
Admin commands - All admin-related bot commands
"""
import asyncio
from core.error_handler import log_error_to_file
from core.color_formatter import Colors, MessageFormatter
from core.connection_manager import BotRestartManager


def register(bot):
    """Register admin commands with the bot"""
    
    @bot.command("addadmin")
    async def addadmin_cmd(bot, user, message):
        parts = message.split(maxsplit=1)
        target_username = parts[1].strip().lstrip('@') if len(parts) > 1 else ""
        if not target_username:
            msg = f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/addadmin <username>"
            await bot.send_message(msg, user.id)
            return
        
        success, result_msg = await bot.admin.add_admin(target_username, user.username)
        if success:
            msg = f"{Colors.MINT}{result_msg}"
            await bot.highrise.chat(msg)
        else:
            msg = f"{Colors.RED}{result_msg}"
            await bot.send_message(msg, user.id)
    
    @bot.command("radmin")
    async def radmin_cmd(bot, user, message):
        parts = message.split(maxsplit=1)
        target_username = parts[1].strip().lstrip('@') if len(parts) > 1 else ""
        if not target_username:
            msg = f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/radmin <username>"
            await bot.send_message(msg, user.id)
            return
        
        success, result_msg = await bot.admin.remove_admin(target_username, user.username)
        if success:
            msg = f"{Colors.ORANGE}{result_msg}"
            await bot.highrise.chat(msg)
        else:
            msg = f"{Colors.RED}{result_msg}"
            await bot.send_message(msg, user.id)
    
    @bot.command("addvip")
    async def addvip_cmd(bot, user, message):
        parts = message.split(maxsplit=1)
        target_username = parts[1].strip().lstrip('@') if len(parts) > 1 else ""
        if not target_username:
            msg = f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/addvip <username>"
            await bot.send_message(msg, user.id)
            return
        
        success, result_msg = await bot.admin.add_vip(target_username, user.username)
        if success:
            msg = f"{Colors.GOLD}{result_msg}"
            await bot.highrise.chat(msg)
        else:
            msg = f"{Colors.RED}{result_msg}"
            await bot.send_message(msg, user.id)
    
    @bot.command("rvip")
    async def rvip_cmd(bot, user, message):
        parts = message.split(maxsplit=1)
        target_username = parts[1].strip().lstrip('@') if len(parts) > 1 else ""
        if not target_username:
            msg = f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/rvip <username>"
            await bot.send_message(msg, user.id)
            return
        
        success, result_msg = await bot.admin.remove_vip(target_username, user.username)
        if success:
            msg = f"{Colors.ORANGE}{result_msg}"
            await bot.highrise.chat(msg)
        else:
            msg = f"{Colors.RED}{result_msg}"
            await bot.send_message(msg, user.id)
    
    @bot.command("admins")
    async def admins_cmd(bot, user, message):
        admins_list = bot.admin.get_admins_list()
        msg = (
            f"{Colors.GOLD}👑 Admin System\n\n"
            f"{Colors.PINK}Owner: {Colors.PURPLE}{bot.admin.OWNER_USERNAME}\n"
            f"{Colors.LAVENDER}Admins: {Colors.CYAN}{admins_list}\n\n"
            f"{Colors.SKY_BLUE}💡 Full command access"
        )
        await bot.send_message(msg, user.id)
    
    @bot.command("vips")
    async def vips_cmd(bot, user, message):
        vips_list = bot.admin.get_vips_list()
        msg = (
            f"{Colors.GOLD}⭐ VIP List\n\n"
            f"{Colors.PINK}{vips_list}\n\n"
            f"{Colors.SKY_BLUE}💡 Free commands for VIPs"
        )
        await bot.send_message(msg, user.id)
    
    @bot.command("freemusic")
    async def freemusic_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return
        
        try:
            parts = message.split(maxsplit=1)
            minutes = int(parts[1].strip()) if len(parts) > 1 else 0
            if minutes <= 0:
                await bot.send_message(MessageFormatter.error("Minutes must be > 0"), user.id)
                return
            
            if minutes > 1440:
                await bot.send_message(MessageFormatter.error("Max limit is 1440 minutes (24 hours)"), user.id)
                return
            
            await bot.start_free_music_mode(minutes)
            msg = f"{Colors.PINK}🎉 FREE Mode {Colors.GOLD}{minutes}min!\n{Colors.MINT}💝 All commands FREE for everyone!"
            await bot.highrise.chat(msg)
        except (ValueError, IndexError):
            msg = f"{Colors.RED}❌ Use: {Colors.LAVENDER}/freemusic <mins>"
            await bot.send_message(msg, user.id)
        except Exception as e:
            log_error_to_file("freemusic_cmd", e)
            await bot.send_message(MessageFormatter.error(f"Error: {str(e)}"), user.id)
    
    @bot.command("stopfreemusic")
    async def stopfreemusic_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return
        
        if not bot.is_music_free():
            await bot.send_message(f"{Colors.ORANGE}⚠️ Free music mode is not active", user.id)
            return
        
        # Stop the free music mode
        bot.free_music_until = None
        if bot.free_music_task:
            bot.free_music_task.cancel()
        
        # Clear saved state
        from systems.admin import FreeMusicManager
        FreeMusicManager.clear_state()
        
        msg = f"{Colors.LAVENDER}🛑 Free Music Mode Stopped\n{Colors.CYAN}Normal pricing restored"
        await bot.highrise.chat(msg)
    
    @bot.command("admincmd")
    async def admincmd_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return
        
        msg1 = (
            f"{Colors.GOLD}👑 Admin Commands\n\n"
            f"{Colors.LAVENDER}/admins {Colors.CYAN}• View list\n"
            f"{Colors.LAVENDER}/vips {Colors.CYAN}• View VIPs\n"
            f"{Colors.LAVENDER}/addadmin <user> {Colors.CYAN}• Add\n"
            f"{Colors.LAVENDER}/radmin <user> {Colors.CYAN}• Remove\n"
            f"{Colors.LAVENDER}/addvip <user> {Colors.CYAN}• Add VIP\n"
            f"{Colors.LAVENDER}/rvip <user> {Colors.CYAN}• Remove"
        )
        msg2 = (
            f"{Colors.LAVENDER}/give <user> <pts> {Colors.CYAN}• Gift\n"
            f"{Colors.LAVENDER}/freemusic <mins> {Colors.CYAN}• Free mode\n"
            f"{Colors.LAVENDER}/stopfreemusic {Colors.CYAN}• Stop free mode\n"
            f"{Colors.LAVENDER}/outfit {Colors.CYAN}• Outfit help\n"
            f"{Colors.LAVENDER}/pstcmd {Colors.CYAN}• Position help"
        )
        msg3 = (
            f"{Colors.GOLD}🔧 System Commands\n\n"
            f"{Colors.PINK}//restart {Colors.CYAN}• Restart bot\n"
            f"{Colors.PINK}//restartserver {Colors.CYAN}• Restart server\n"
            f"{Colors.PINK}//restartboth {Colors.CYAN}• Restart both\n"
            f"{Colors.PINK}//connection {Colors.CYAN}• Connection status"
        )
        await bot.send_message(msg1, user.id)
        await asyncio.sleep(1.5)
        await bot.send_message(msg2, user.id)
        await asyncio.sleep(1.5)
        await bot.send_message(msg3, user.id)
    
    @bot.command("restartbot", "restart")
    async def restartbot_cmd(bot, user, message):
        """Restart the bot connection (admin only)"""
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return
        
        msg = (
            f"{Colors.GOLD}🔄 Bot Restart Initiated\n"
            f"{Colors.CYAN}Reconnecting to Highrise...\n"
            f"{Colors.LAVENDER}This will take a few seconds."
        )
        await bot.highrise.chat(msg)
        
        # Wait a moment for message to send
        await asyncio.sleep(1)
        
        # Trigger restart
        await BotRestartManager.restart_bot(bot.connection_manager)
    
    @bot.command("restartserver")
    async def restartserver_cmd(bot, user, message):
        """Restart the music server (admin only)"""
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return
        
        msg = (
            f"{Colors.GOLD}🔄 Music Server Restart Initiated\n"
            f"{Colors.CYAN}Restarting the music server...\n"
            f"{Colors.LAVENDER}Server will be back online in a few seconds."
        )
        await bot.highrise.chat(msg)
        
        # Wait a moment for message to send
        await asyncio.sleep(1)
        
        # Trigger server restart
        success = await BotRestartManager.restart_server()
        
        # Wait for server to restart (give it time to come back up)
        await asyncio.sleep(3)
        
        result_msg = f"{Colors.MINT}✅ Music server should be back online now!"
        await bot.highrise.chat(result_msg)
    
    @bot.command("restartboth")
    async def restartboth_cmd(bot, user, message):
        """Restart both bot and music server (admin only)"""
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return
        
        msg = (
            f"{Colors.GOLD}🔄 FULL RESTART Initiated\n"
            f"{Colors.CYAN}Restarting bot + music server...\n"
            f"{Colors.LAVENDER}This will take a few seconds."
        )
        await bot.highrise.chat(msg)
        
        # Wait a moment for message to send
        await asyncio.sleep(1)
        
        # Trigger full restart
        await BotRestartManager.restart_both(bot.connection_manager)
    
    @bot.command("connection")
    async def connection_cmd(bot, user, message):
        """Show connection status (admin only)"""
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return
        
        status = bot.connection_manager.get_status()
        
        msg = (
            f"{Colors.GOLD}📡 Connection Status\n\n"
            f"{Colors.CYAN}Status: {Colors.MINT}{'🟢 Connected' if status['connected'] else '🔴 Disconnected'}\n"
            f"{Colors.CYAN}Uptime: {Colors.LAVENDER}{status['uptime']}\n"
            f"{Colors.CYAN}Keepalive Pings: {Colors.PINK}{status['total_pings']}\n"
            f"{Colors.CYAN}Failed Pings: {Colors.ORANGE}{status['failed_pings']}\n"
            f"{Colors.CYAN}Success Rate: {Colors.MINT}{status['success_rate']}\n"
            f"{Colors.CYAN}Last Ping: {Colors.LAVENDER}{status['last_ping']}"
        )
        await bot.send_message(msg, user.id)
    
    # Register personalized demo commands
    from . import personalized_demo_commands
    personalized_demo_commands.register(bot)
