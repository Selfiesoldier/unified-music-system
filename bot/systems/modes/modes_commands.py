"""
Modes DM Commands - DM-only commands for mode management
"""
from .modes_commands_manager import ModesCommandsManager
from core.color_formatter import Colors
from core.context import message_context, conversation_context


def register(bot):
    """Register modes DM commands with the bot"""
    
    @bot.command("modehelp")
    async def modehelp_cmd(bot, user, message):
        help_msg = (
            f"{Colors.GOLD}🎭 Modes System Help\n\n"
            f"{Colors.PINK}═══ Public Commands ═══\n"
            f"{Colors.CYAN}!modes {Colors.LIGHT_GRAY}• View all available modes\n"
            f"{Colors.CYAN}!mode <type> {Colors.LIGHT_GRAY}• Switch to a different mode\n"
            f"{Colors.CYAN}!modehelp {Colors.LIGHT_GRAY}• Show this help message\n\n"
            f"{Colors.PURPLE}═══ Admin/Owner DM Commands ═══\n"
            f"{Colors.LAVENDER}!listmodes {Colors.LIGHT_GRAY}• List all modes with details\n"
            f"{Colors.LAVENDER}!modesongs <mode> {Colors.LIGHT_GRAY}• View songs in a mode\n"
            f"{Colors.LAVENDER}!addmode <name> <display> <desc> {Colors.LIGHT_GRAY}• Create mode\n"
            f"{Colors.LAVENDER}!addsongs <mode> [song1,song2,...] {Colors.LIGHT_GRAY}• Add songs\n"
            f"{Colors.LAVENDER}!removesongs <mode> [song1,song2,...] {Colors.LIGHT_GRAY}• Remove songs\n"
            f"{Colors.LAVENDER}!deletemode <mode> {Colors.LIGHT_GRAY}• Delete a mode\n\n"
            f"{Colors.YELLOW}📝 Examples:\n"
            f"{Colors.SKY_BLUE}!mode relax {Colors.LIGHT_GRAY}• Switch to relax mode\n"
            f"{Colors.SKY_BLUE}!addsongs punjabi [diljit,sidhu] {Colors.LIGHT_GRAY}(DM)\n"
            f"{Colors.SKY_BLUE}!removesongs relax [lofi beats] {Colors.LIGHT_GRAY}(DM)\n\n"
            f"{Colors.MINT}💡 DM commands require admin/owner access"
        )
        
        await bot.send_message(help_msg, user.id)
    
    @bot.command("addmode")
    async def addmode_cmd(bot, user, message):
        msg_context = message_context.get()
        conv_id = conversation_context.get()
        
        if msg_context != "dm":
            await bot.highrise.send_whisper(
                user.id,
                f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!addmode {Colors.SKY_BLUE}to use this command"
            )
            return
        
        if not conv_id:
            await bot.highrise.send_whisper(user.id, f"{Colors.RED}❌ DM conversation not found!")
            return
        
        if not bot.admin.has_admin_access(user.username):
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Admin/Owner only command!")
            return
        
        parts = message.split(maxsplit=3)
        if len(parts) < 4:
            help_msg = (
                f"{Colors.GOLD}📝 Add Mode Command\n\n"
                f"{Colors.CYAN}Usage:\n"
                f"{Colors.LAVENDER}!addmode <name> <display_name> <description>\n\n"
                f"{Colors.YELLOW}Example:\n"
                f"{Colors.PINK}!addmode punjabi Punjabi Popular Punjabi songs and bhangra\n\n"
                f"{Colors.SKY_BLUE}💡 Then use !addsongs to add songs to this mode"
            )
            await bot.highrise.send_message(conv_id, help_msg)
            return
        
        mode_name = parts[1].lower().replace(' ', '_')
        display_name = parts[2]
        description = parts[3]
        
        if ModesCommandsManager.create_mode(mode_name, display_name, description):
            from systems.music.queue_manager import QueueManager
            QueueManager.reload_modes()
            QueueManager.get_modes()
            
            msg = (
                f"{Colors.MINT}✅ Mode Created!\n\n"
                f"{Colors.PURPLE}Name: {Colors.PINK}{mode_name}\n"
                f"{Colors.PURPLE}Display: {Colors.PINK}{display_name}\n"
                f"{Colors.PURPLE}Description: {Colors.LAVENDER}{description}\n\n"
                f"{Colors.CYAN}💡 Use !addsongs {mode_name} [song1,song2,...] to add songs"
            )
            await bot.highrise.send_message(conv_id, msg)
        else:
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Failed to create mode. It may already exist!")
    
    @bot.command("addsongs")
    async def addsongs_cmd(bot, user, message):
        msg_context = message_context.get()
        conv_id = conversation_context.get()
        
        if msg_context != "dm":
            await bot.highrise.send_whisper(
                user.id,
                f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!addsongs {Colors.SKY_BLUE}to use this command"
            )
            return
        
        if not conv_id:
            await bot.highrise.send_whisper(user.id, f"{Colors.RED}❌ DM conversation not found!")
            return
        
        if not bot.admin.has_admin_access(user.username):
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Admin/Owner only command!")
            return
        
        parts = message.split(maxsplit=1)
        if len(parts) < 2:
            help_msg = (
                f"{Colors.GOLD}🎵 Add Songs Command\n\n"
                f"{Colors.CYAN}Usage:\n"
                f"{Colors.LAVENDER}!addsongs <mode_name> [song1,song2,song3,...]\n\n"
                f"{Colors.YELLOW}Examples:\n"
                f"{Colors.PINK}!addsongs punjabi [diljit dosanjh songs,sidhu moose wala,ap dhillon]\n"
                f"{Colors.PINK}!addsongs relax [lofi beats,calm music,nature sounds]\n\n"
                f"{Colors.SKY_BLUE}💡 Songs should be inside square brackets and separated by commas"
            )
            await bot.highrise.send_message(conv_id, help_msg)
            return
        
        args = parts[1].split(maxsplit=1)
        if len(args) < 2:
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Please provide mode name and songs!")
            return
        
        mode_name = args[0].lower()
        songs_str = args[1]
        
        # Support both [song1,song2] and song1,song2 formats
        if '[' in songs_str and ']' in songs_str:
            # Extract content between square brackets
            start = songs_str.find('[')
            end = songs_str.rfind(']')
            songs_str = songs_str[start+1:end]
        
        songs = [s.strip() for s in songs_str.split(',') if s.strip()]
        
        if not songs:
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ No songs provided!")
            return
        
        if ModesCommandsManager.add_songs_to_mode(mode_name, songs, bot):
            from systems.music.queue_manager import QueueManager
            QueueManager.reload_modes()
            QueueManager.get_modes()
            
            msg = (
                f"{Colors.MINT}✅ Songs Added!\n\n"
                f"{Colors.PURPLE}Mode: {Colors.PINK}{mode_name}\n"
                f"{Colors.PURPLE}Added: {Colors.YELLOW}{len(songs)} songs\n\n"
                f"{Colors.LAVENDER}Songs:\n"
            )
            for i, song in enumerate(songs[:5], 1):
                msg += f"{Colors.SKY_BLUE}{i}. {Colors.PINK}{song}\n"
            if len(songs) > 5:
                msg += f"{Colors.LIGHT_GRAY}+{len(songs) - 5} more..."
            await bot.highrise.send_message(conv_id, msg)
        else:
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Failed to add songs! Mode may not exist.")
    
    @bot.command("removesongs")
    async def removesongs_cmd(bot, user, message):
        msg_context = message_context.get()
        conv_id = conversation_context.get()
        
        if msg_context != "dm":
            await bot.highrise.send_whisper(
                user.id,
                f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!removesongs {Colors.SKY_BLUE}to use this command"
            )
            return
        
        if not conv_id:
            await bot.highrise.send_whisper(user.id, f"{Colors.RED}❌ DM conversation not found!")
            return
        
        if not bot.admin.has_admin_access(user.username):
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Admin/Owner only command!")
            return
        
        parts = message.split(maxsplit=1)
        if len(parts) < 2:
            help_msg = (
                f"{Colors.GOLD}🗑️ Remove Songs Command\n\n"
                f"{Colors.CYAN}Usage:\n"
                f"{Colors.LAVENDER}!removesongs <mode_name> [song1,song2,...]\n"
                f"{Colors.LAVENDER}!removesongs <mode_name> [1,5,8,...]\n\n"
                f"{Colors.YELLOW}Examples:\n"
                f"{Colors.PINK}!removesongs relax [lofi beats,calm music]\n"
                f"{Colors.PINK}!removesongs punjabi [1,3,5,8]\n"
                f"{Colors.PINK}!removesongs old_bollywood [2,arijit singh]\n\n"
                f"{Colors.SKY_BLUE}💡 You can use song names, indices, or both!\n"
                f"{Colors.SKY_BLUE}💡 Use !modesongs <mode> to see song numbers"
            )
            await bot.highrise.send_message(conv_id, help_msg)
            return
        
        args = parts[1].split(maxsplit=1)
        if len(args) < 2:
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Please provide mode name and songs!")
            return
        
        mode_name = args[0].lower()
        songs_str = args[1]
        
        # Support both [song1,song2] and song1,song2 formats
        if '[' in songs_str and ']' in songs_str:
            # Extract content between square brackets
            start = songs_str.find('[')
            end = songs_str.rfind(']')
            songs_str = songs_str[start+1:end]
        
        songs = [s.strip() for s in songs_str.split(',') if s.strip()]
        
        if not songs:
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ No songs provided!")
            return
        
        removed_songs, not_found_items = ModesCommandsManager.remove_songs_from_mode(mode_name, songs, bot)
        
        if removed_songs:
            from systems.music.queue_manager import QueueManager
            QueueManager.reload_modes()
            QueueManager.get_modes()
            
            msg = (
                f"{Colors.MINT}✅ Songs Removed!\n\n"
                f"{Colors.PURPLE}Mode: {Colors.PINK}{mode_name}\n"
                f"{Colors.PURPLE}Removed: {Colors.YELLOW}{len(removed_songs)} songs\n\n"
                f"{Colors.LAVENDER}Removed Songs:\n"
            )
            for i, song in enumerate(removed_songs[:5], 1):
                msg += f"{Colors.SKY_BLUE}{i}. {Colors.PINK}{song}\n"
            if len(removed_songs) > 5:
                msg += f"{Colors.LIGHT_GRAY}+{len(removed_songs) - 5} more...\n"
            
            if not_found_items:
                msg += f"\n{Colors.ORANGE}⚠️ Not found: {Colors.LIGHT_GRAY}{', '.join(not_found_items)}"
            
            await bot.highrise.send_message(conv_id, msg)
        else:
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Failed to remove songs! Songs may not exist in mode.")
    
    @bot.command("modesongs")
    async def modesongs_cmd(bot, user, message):
        msg_context = message_context.get()
        conv_id = conversation_context.get()
        
        if msg_context != "dm":
            await bot.highrise.send_whisper(
                user.id,
                f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!modesongs {Colors.SKY_BLUE}to use this command"
            )
            return
        
        if not conv_id:
            await bot.highrise.send_whisper(user.id, f"{Colors.RED}❌ DM conversation not found!")
            return
        
        if not bot.admin.has_admin_access(user.username):
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Admin/Owner only command!")
            return
        
        parts = message.split(maxsplit=1)
        if len(parts) < 2:
            help_msg = (
                f"{Colors.GOLD}🎵 View Mode Songs\n\n"
                f"{Colors.CYAN}Usage:\n"
                f"{Colors.LAVENDER}!modesongs <mode_name>\n\n"
                f"{Colors.YELLOW}Example:\n"
                f"{Colors.PINK}!modesongs old_bollywood\n\n"
                f"{Colors.SKY_BLUE}💡 Use !listmodes to see all available modes"
            )
            await bot.highrise.send_message(conv_id, help_msg)
            return
        
        mode_name = parts[1].strip().lower()
        mode_data = ModesCommandsManager.get_mode_details(mode_name)
        
        if not mode_data:
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Mode '{mode_name}' not found!")
            return
        
        songs = mode_data.get('songs', [])
        display_name = mode_data.get('display_name', mode_name)
        description = mode_data.get('description', 'No description')
        
        msg = (
            f"{Colors.PURPLE}🎭 {Colors.PINK}{display_name}\n"
            f"{Colors.LAVENDER}{description}\n"
            f"{Colors.CYAN}━━━━━━━━━━━━━━━━━━━━━━\n"
            f"{Colors.GOLD}📋 Songs ({len(songs)}):\n\n"
        )
        
        if not songs:
            msg += f"{Colors.YELLOW}No songs in this mode yet.\n{Colors.SKY_BLUE}Use !addsongs to add songs"
        else:
            for i, song in enumerate(songs, 1):
                msg += f"{Colors.CYAN}#{i} {Colors.PINK}{song}\n"
                
                if i % 20 == 0 and i < len(songs):
                    await bot.highrise.send_message(conv_id, msg)
                    msg = ""
            
            # Add removal tip at the end
            if msg and len(songs) > 0:
                msg += f"\n{Colors.LIGHT_GRAY}💡 Use !removesongs {mode_name} [1,5,8] to remove by number"
        
        if msg:
            await bot.highrise.send_message(conv_id, msg)
    
    @bot.command("listmodes")
    async def listmodes_cmd(bot, user, message):
        msg_context = message_context.get()
        conv_id = conversation_context.get()
        
        if msg_context != "dm":
            await bot.highrise.send_whisper(
                user.id,
                f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!listmodes {Colors.SKY_BLUE}to use this command"
            )
            return
        
        if not conv_id:
            await bot.highrise.send_whisper(user.id, f"{Colors.RED}❌ DM conversation not found!")
            return
        
        if not bot.admin.has_admin_access(user.username):
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Admin/Owner only command!")
            return
        
        modes = ModesCommandsManager.get_all_modes()
        
        if not modes:
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ No modes found!")
            return
        
        msg = (
            f"{Colors.GOLD}🎭 Available Modes\n"
            f"{Colors.CYAN}━━━━━━━━━━━━━━━━━━━━━━\n\n"
        )
        
        modes.sort(key=lambda x: x.get('name', ''))
        
        for mode in modes:
            name = mode.get('name', 'unknown')
            if name == 'recent':
                continue
            
            display_name = mode.get('display_name', name)
            description = mode.get('description', 'No description')
            song_count = len(mode.get('songs', []))
            
            msg += (
                f"{Colors.PURPLE}▸ {Colors.PINK}{display_name}\n"
                f"{Colors.LAVENDER}  {description}\n"
                f"{Colors.SKY_BLUE}  Songs: {song_count}\n"
                f"{Colors.CYAN}  ID: {Colors.LIGHT_GRAY}{name}\n\n"
            )
        
        msg += f"{Colors.YELLOW}💡 Use !modesongs <mode_id> to view songs in a mode"
        
        await bot.highrise.send_message(conv_id, msg)
    
    @bot.command("deletemode")
    async def deletemode_cmd(bot, user, message):
        msg_context = message_context.get()
        conv_id = conversation_context.get()
        
        if msg_context != "dm":
            await bot.highrise.send_whisper(
                user.id,
                f"{Colors.ORANGE}⚠️ This command is DM-only!\n"
                f"{Colors.SKY_BLUE}💡 Send me a DM with {Colors.LAVENDER}!deletemode {Colors.SKY_BLUE}to use this command"
            )
            return
        
        if not conv_id:
            await bot.highrise.send_whisper(user.id, f"{Colors.RED}❌ DM conversation not found!")
            return
        
        if not bot.admin.has_admin_access(user.username):
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Admin/Owner only command!")
            return
        
        parts = message.split(maxsplit=1)
        if len(parts) < 2:
            help_msg = (
                f"{Colors.GOLD}🗑️ Delete Mode Command\n\n"
                f"{Colors.CYAN}Usage:\n"
                f"{Colors.LAVENDER}!deletemode <mode_name>\n\n"
                f"{Colors.YELLOW}Example:\n"
                f"{Colors.PINK}!deletemode punjabi\n\n"
                f"{Colors.RED}⚠️ This action cannot be undone!"
            )
            await bot.highrise.send_message(conv_id, help_msg)
            return
        
        mode_name = parts[1].strip().lower()
        
        if mode_name in ['recent', 'old_bollywood']:
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Cannot delete core modes!")
            return
        
        if ModesCommandsManager.delete_mode(mode_name, bot):
            from systems.music.queue_manager import QueueManager
            QueueManager.reload_modes()
            QueueManager.get_modes()
            
            msg = (
                f"{Colors.MINT}✅ Mode Deleted!\n\n"
                f"{Colors.PURPLE}Mode: {Colors.PINK}{mode_name}\n"
                f"{Colors.YELLOW}⚠️ This action cannot be undone"
            )
            await bot.highrise.send_message(conv_id, msg)
        else:
            await bot.highrise.send_message(conv_id, f"{Colors.RED}❌ Failed to delete mode! It may not exist.")
