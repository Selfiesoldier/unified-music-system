"""
Message Handler - Handles incoming DMs/inbox messages
"""
from core.error_handler import safe_call
from core.color_formatter import Colors, MessageFormatter, BeautifulMessages
import asyncio
from core.context import message_context, conversation_context


async def _send_music_commands(bot, conversation_id):
    """Send detailed music commands"""
    chunks = [
        (f"{Colors.GOLD}🎵 MUSIC COMMANDS - Part 1\n\n"
         f"{Colors.LAVENDER}/play <song>\n"
         f"{Colors.LIGHT_GRAY}Play a song or add to queue\n"
         f"{Colors.SKY_BLUE}Cost: 10 pts (Free for VIPs)\n"
         f"{Colors.YELLOW}Example: /play shape of you\n"
         f"{Colors.CYAN}Usage: Type song name or paste YouTube URL\n\n"
         f"{Colors.LAVENDER}/current or /np\n"
         f"{Colors.LIGHT_GRAY}Show currently playing song with details\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.CYAN}Shows: Title, artist, duration, views, queue length"),
        (f"{Colors.GOLD}🎵 MUSIC COMMANDS - Part 2\n\n"
         f"{Colors.LAVENDER}/queue or /q\n"
         f"{Colors.LIGHT_GRAY}View all queued songs (up to 5 shown)\n"
         f"{Colors.SKY_BLUE}Free for everyone\n\n"
         f"{Colors.LAVENDER}/next\n"
         f"{Colors.LIGHT_GRAY}View the 1 upcoming song in queue\n"
         f"{Colors.SKY_BLUE}Free for everyone\n\n"
         f"{Colors.LAVENDER}/skip or /s\n"
         f"{Colors.LIGHT_GRAY}Skip current song / vote to skip\n"
         f"{Colors.SKY_BLUE}Vote is Free (or instant for Admin)"),
        (f"{Colors.GOLD}🎵 MUSIC COMMANDS - Part 3\n\n"
         f"{Colors.LAVENDER}/instskip\n"
         f"{Colors.LIGHT_GRAY}Instant skip without voting\n"
         f"{Colors.SKY_BLUE}Cost: 1000 pts\n\n"
         f"{Colors.LAVENDER}/clear\n"
         f"{Colors.LIGHT_GRAY}Clear entire queue\n"
         f"{Colors.SKY_BLUE}Cost: 20 pts per song (Free for VIPs 1x/hr)\n"
         f"{Colors.YELLOW}Example: 5 songs = 100 pts"),
        (f"{Colors.GOLD}🎵 MUSIC COMMANDS - Part 4\n\n"
         f"{Colors.LAVENDER}/autoplay\n"
         f"{Colors.LIGHT_GRAY}Toggle auto-play on/off\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.CYAN}When ON: Auto-plays songs when queue is empty\n\n"
         f"{Colors.LAVENDER}/modes\n"
         f"{Colors.LIGHT_GRAY}View all available music modes\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.CYAN}Shows: Current mode and recent songs count"),
        (f"{Colors.GOLD}🎵 MUSIC COMMANDS - Part 5\n\n"
         f"{Colors.LAVENDER}/mode <type>\n"
         f"{Colors.LIGHT_GRAY}Change auto-play music mode\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.YELLOW}Available modes:\n"
         f"{Colors.CYAN}• recent {Colors.LIGHT_GRAY}- Songs played by users\n"
         f"{Colors.CYAN}• old_bollywood {Colors.LIGHT_GRAY}- Classic hits\n"
         f"{Colors.CYAN}• new_bollywood {Colors.LIGHT_GRAY}- Latest tracks\n"
         f"{Colors.CYAN}• english {Colors.LIGHT_GRAY}- English songs\n"
         f"{Colors.CYAN}• islamic {Colors.LIGHT_GRAY}- Islamic music\n"
         f"{Colors.CYAN}• kashmiri {Colors.LIGHT_GRAY}- Kashmiri songs\n"
         f"{Colors.CYAN}• relax {Colors.LIGHT_GRAY}- Relaxing music"),
        (f"{Colors.GOLD}🎵 MUSIC COMMANDS - Part 6\n\n"
         f"{Colors.LAVENDER}/dedicate @username <song>\n"
         f"{Colors.LIGHT_GRAY}Dedicate a song to someone\n"
         f"{Colors.SKY_BLUE}Cost: 10 pts (Free for VIPs)\n"
         f"{Colors.YELLOW}Example: /dedicate @sarah shape of you\n"
         f"{Colors.CYAN}Song shows: Dedicated to @user by @you"),
        (f"{Colors.GOLD}🎵 MUSIC COMMANDS - Part 7\n\n"
         f"{Colors.LAVENDER}/tts\n"
         f"{Colors.LIGHT_GRAY}TTS voice announcements control\n"
         f"{Colors.SKY_BLUE}Admin: /tts on/off/voice/words\n\n"
         f"{Colors.LAVENDER}/stream\n"
         f"{Colors.LIGHT_GRAY}Get music stream link in DM\n"
         f"{Colors.SKY_BLUE}Free for everyone\n\n"
         f"{Colors.LAVENDER}/lyrics\n"
         f"{Colors.LIGHT_GRAY}Get current song lyrics link\n"
         f"{Colors.SKY_BLUE}Free for everyone\n\n"
         f"{Colors.PINK}💡 Type 'help' to return to main menu")
    ]

    for i, chunk in enumerate(chunks):
        await bot.highrise.send_message(conversation_id, chunk)
        if i < len(chunks) - 1:
            await asyncio.sleep(3.0)


async def _send_economy_commands(bot, conversation_id):
    """Send detailed economy commands"""
    chunks = [(f"{Colors.GOLD}💰 ECONOMY COMMANDS - Part 1\n\n"
               f"{Colors.LAVENDER}/balance or /bal\n"
               f"{Colors.LIGHT_GRAY}Check your Music Points balance\n"
               f"{Colors.SKY_BLUE}Free for everyone\n"
               f"{Colors.CYAN}Shows: Current points and tip reminder\n\n"
               f"{Colors.LAVENDER}/costs or /prices\n"
               f"{Colors.LIGHT_GRAY}View all command costs\n"
               f"{Colors.SKY_BLUE}Free for everyone\n"
               f"{Colors.CYAN}Shows: Complete pricing breakdown"),
              (f"{Colors.GOLD}💰 ECONOMY COMMANDS - Part 2\n\n"
               f"{Colors.LAVENDER}/packs or /packages\n"
               f"{Colors.LIGHT_GRAY}View Music Point packages\n"
               f"{Colors.SKY_BLUE}Free for everyone\n"
               f"{Colors.YELLOW}How to buy:\n"
               f"{Colors.CYAN}1. Choose a package\n"
               f"{Colors.CYAN}2. Tip the bot that exact gold amount\n"
               f"{Colors.CYAN}3. Points added automatically!\n\n"
               f"{Colors.LAVENDER}Package Examples:\n"
               f"{Colors.LIGHT_GRAY}• 10 gold = 50 pts (Starter)\n"
               f"{Colors.LIGHT_GRAY}• 50 gold = 300 pts (Basic)\n"
               f"{Colors.LIGHT_GRAY}• 100 gold = 700 pts (Premium)"),
              (f"{Colors.GOLD}💰 ECONOMY COMMANDS - Part 3\n\n"
               f"{Colors.LAVENDER}Custom Tip Amounts:\n"
               f"{Colors.LIGHT_GRAY}Tip any amount 10g or more!\n"
               f"{Colors.SKY_BLUE}Base rate: 10 gold = 50 pts\n"
               f"{Colors.YELLOW}Examples:\n"
               f"{Colors.CYAN}• 15 gold = 75 pts\n"
               f"{Colors.CYAN}• 25 gold = 125 pts\n"
               f"{Colors.CYAN}• 200 gold = 1,500 pts\n\n"
               f"{Colors.LAVENDER}VIP Benefits:\n"
               f"{Colors.LIGHT_GRAY}VIPs get ALL commands FREE!\n"
               f"{Colors.PINK}💡 Type 'help' to return to main menu")]

    for i, chunk in enumerate(chunks):
        await bot.highrise.send_message(conversation_id, chunk)
        if i < len(chunks) - 1:
            await asyncio.sleep(3.0)


async def _send_playlist_commands(bot, conversation_id):
    """Send detailed playlist commands"""
    chunks = [
        (f"{Colors.GOLD}📋 PLAYLIST SYSTEM (VIP+) - Part 1\n\n"
         f"{Colors.LAVENDER}/myplaylist\n"
         f"{Colors.LIGHT_GRAY}List all your playlists\n"
         f"{Colors.SKY_BLUE}Free for VIPs\n"
         f"{Colors.CYAN}Shows: Name, song count, status, creation date\n\n"
         f"{Colors.LAVENDER}/playlist create <name>\n"
         f"{Colors.LIGHT_GRAY}Create a new playlist\n"
         f"{Colors.SKY_BLUE}First 5 free, then 100 pts each\n"
         f"{Colors.YELLOW}Example: /playlist create Favorites\n"
         f"{Colors.CYAN}Note: Name must be unique"),
        (f"{Colors.GOLD}📋 PLAYLIST SYSTEM (VIP+) - Part 2\n\n"
         f"{Colors.LAVENDER}/playlist show <name>\n"
         f"{Colors.LIGHT_GRAY}View all songs in a playlist\n"
         f"{Colors.SKY_BLUE}Free for VIPs\n"
         f"{Colors.CYAN}Shows: Up to 10 songs with index numbers\n\n"
         f"{Colors.LAVENDER}/playlist add <playlist> <song>\n"
         f"{Colors.LIGHT_GRAY}Add song to playlist\n"
         f"{Colors.SKY_BLUE}First 50 songs free, then 5 pts each\n"
         f"{Colors.YELLOW}Example: /playlist add Favorites despacito\n"
         f"{Colors.CYAN}Bot will search and add the song"),
        (f"{Colors.GOLD}📋 PLAYLIST SYSTEM (VIP+) - Part 3\n\n"
         f"{Colors.LAVENDER}/playlist remove <playlist> <index/query>\n"
         f"{Colors.LIGHT_GRAY}Remove song from playlist\n"
         f"{Colors.SKY_BLUE}Free for VIPs\n"
         f"{Colors.YELLOW}Example 1: /playlist remove Favorites 3\n"
         f"{Colors.YELLOW}Example 2: /playlist remove Favorites despacito\n"
         f"{Colors.CYAN}Use index number or song name\n\n"
         f"{Colors.LAVENDER}/confirmremove <number>\n"
         f"{Colors.LIGHT_GRAY}Confirm removal if multiple matches found\n"
         f"{Colors.SKY_BLUE}Free for VIPs"),
        (f"{Colors.GOLD}📋 PLAYLIST SYSTEM (VIP+) - Part 4\n\n"
         f"{Colors.LAVENDER}/playlist play <name>\n"
         f"{Colors.LIGHT_GRAY}Activate playlist (songs auto-play)\n"
         f"{Colors.SKY_BLUE}Free for VIPs\n"
         f"{Colors.CYAN}Max 3 active playlists at once\n"
         f"{Colors.YELLOW}Songs play when queue is empty\n\n"
         f"{Colors.LAVENDER}/playlist stop <name>\n"
         f"{Colors.LIGHT_GRAY}Deactivate playlist\n"
         f"{Colors.SKY_BLUE}Free for VIPs\n"
         f"{Colors.CYAN}Stops auto-playing from this playlist"),
        (f"{Colors.GOLD}📋 PLAYLIST SYSTEM (VIP+) - Part 5\n\n"
         f"{Colors.LAVENDER}/playlist delete <name>\n"
         f"{Colors.LIGHT_GRAY}Permanently delete playlist\n"
         f"{Colors.SKY_BLUE}Free for VIPs\n"
         f"{Colors.YELLOW}Warning: Cannot be undone!\n\n"
         f"{Colors.LAVENDER}/playlist rename <old> <new>\n"
         f"{Colors.LIGHT_GRAY}Rename a playlist\n"
         f"{Colors.SKY_BLUE}Free for VIPs\n"
         f"{Colors.YELLOW}Example: /playlist rename Old New"),
        (f"{Colors.GOLD}📋 PLAYLIST SYSTEM (VIP+) - Part 6\n\n"
         f"{Colors.LAVENDER}/playlist active\n"
         f"{Colors.LIGHT_GRAY}View all active playlists (public)\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.CYAN}Shows: Playlist name and owner\n\n"
         f"{Colors.LAVENDER}/playlist info [name]\n"
         f"{Colors.LIGHT_GRAY}View playlist or system info\n"
         f"{Colors.SKY_BLUE}Free for VIPs\n"
         f"{Colors.YELLOW}No name: Shows limits & pricing\n"
         f"{Colors.YELLOW}With name: Shows playlist details"),
        (f"{Colors.GOLD}📋 PLAYLIST SYSTEM (VIP+) - Part 7\n\n"
         f"{Colors.LAVENDER}/shufflepl <name>\n"
         f"{Colors.LIGHT_GRAY}Shuffle playlist songs randomly\n"
         f"{Colors.SKY_BLUE}Free for VIPs\n\n"
         f"{Colors.LAVENDER}Limits & Costs:\n"
         f"{Colors.LIGHT_GRAY}• 5 playlists free\n"
         f"{Colors.LIGHT_GRAY}• 50 songs per playlist free\n"
         f"{Colors.LIGHT_GRAY}• Extra playlist: 100 pts\n"
         f"{Colors.LIGHT_GRAY}• Extra song: 5 pts\n\n"
         f"{Colors.PINK}💡 Type 'help' to return to main menu")
    ]

    for i, chunk in enumerate(chunks):
        await bot.highrise.send_message(conversation_id, chunk)
        if i < len(chunks) - 1:
            await asyncio.sleep(0.5)


async def _send_shop_commands(bot, conversation_id):
    """Send detailed shop commands"""
    chunks = [(f"{Colors.GOLD}🛍️ SHOP COMMANDS\n\n"
               f"{Colors.LAVENDER}/search <item>\n"
               f"{Colors.LIGHT_GRAY}Search for clothing items\n"
               f"{Colors.SKY_BLUE}Free for everyone\n"
               f"{Colors.YELLOW}Example: /search shirt\n"
               f"{Colors.CYAN}Returns: Up to 10 matching items\n\n"
               f"{Colors.LAVENDER}/buy <number>\n"
               f"{Colors.LIGHT_GRAY}Select item from search results\n"
               f"{Colors.SKY_BLUE}Free command (item may cost gold)\n"
               f"{Colors.YELLOW}Example: /buy 1\n"
               f"{Colors.CYAN}Shows: Item details and confirmation"),
              (f"{Colors.GOLD}🛍️ SHOP COMMANDS - Part 2\n\n"
               f"{Colors.LAVENDER}/confirm\n"
               f"{Colors.LIGHT_GRAY}Confirm and complete purchase\n"
               f"{Colors.SKY_BLUE}Free command\n"
               f"{Colors.CYAN}Bot will buy and equip the item\n\n"
               f"{Colors.LAVENDER}/cancel\n"
               f"{Colors.LIGHT_GRAY}Cancel pending purchase\n"
               f"{Colors.SKY_BLUE}Free command\n\n"
               f"{Colors.YELLOW}How it works:\n"
               f"{Colors.CYAN}1. Search for item\n"
               f"{Colors.CYAN}2. Select with /buy\n"
               f"{Colors.CYAN}3. Confirm or cancel\n\n"
               f"{Colors.PINK}💡 Type 'help' to return to main menu")]

    for i, chunk in enumerate(chunks):
        await bot.highrise.send_message(conversation_id, chunk)
        if i < len(chunks) - 1:
            await asyncio.sleep(3.0)


async def _send_outfit_commands(bot, conversation_id):
    """Send detailed outfit commands"""
    chunks = [
        (f"{Colors.GOLD}👕 OUTFIT COMMANDS - Part 1\n\n"
         f"{Colors.LAVENDER}/wear outfit <name>\n"
         f"{Colors.LIGHT_GRAY}Wear a saved outfit preset\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.YELLOW}Example: /wear outfit party\n"
         f"{Colors.CYAN}Available: party, casual, formal, sports, etc.\n\n"
         f"{Colors.LAVENDER}/wear <category> <item>\n"
         f"{Colors.LIGHT_GRAY}Wear specific item\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.YELLOW}Example: /wear shirt white tank\n"
         f"{Colors.CYAN}Categories: shirt, pants, shoes, etc."),
        (f"{Colors.GOLD}👕 OUTFIT COMMANDS - Part 2\n\n"
         f"{Colors.LAVENDER}/outfits or /presets\n"
         f"{Colors.LIGHT_GRAY}List all available outfit presets\n"
         f"{Colors.SKY_BLUE}Free for everyone\n\n"
         f"{Colors.LAVENDER}/saveoutfit <name>\n"
         f"{Colors.LIGHT_GRAY}Save current outfit as preset\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.YELLOW}Example: /saveoutfit mycool\n"
         f"{Colors.CYAN}Can overwrite existing presets"),
        (f"{Colors.GOLD}👕 OUTFIT COMMANDS - Part 3\n\n"
         f"{Colors.LAVENDER}/randomwear\n"
         f"{Colors.LIGHT_GRAY}Start random outfit loop\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.CYAN}Cycles through saved outfits every 3s\n\n"
         f"{Colors.LAVENDER}/randomgen\n"
         f"{Colors.LIGHT_GRAY}Generate completely random outfits\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.CYAN}Creates new combos from inventory"),
        (f"{Colors.GOLD}👕 OUTFIT COMMANDS - Part 4\n\n"
         f"{Colors.LAVENDER}/stopwear\n"
         f"{Colors.LIGHT_GRAY}Stop all outfit loops\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.CYAN}Keeps current outfit on\n\n"
         f"{Colors.LAVENDER}/inventory\n"
         f"{Colors.LIGHT_GRAY}Check bot's inventory stats\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.CYAN}Shows: Total items by category\n\n"
         f"{Colors.PINK}💡 Type 'help' to return to main menu")
    ]

    for i, chunk in enumerate(chunks):
        await bot.highrise.send_message(conversation_id, chunk)
        if i < len(chunks) - 1:
            await asyncio.sleep(3.0)


async def _send_systeminfo_commands(bot, conversation_id):
    """Send detailed systeminfo commands"""
    chunks = [(f"{Colors.GOLD}ℹ️ SYSTEM INFO COMMANDS - Part 1\n\n"
               f"{Colors.LAVENDER}/system or /info\n"
               f"{Colors.LIGHT_GRAY}View bot system information\n"
               f"{Colors.SKY_BLUE}Free for everyone (DM only)\n"
               f"{Colors.CYAN}Shows: Version, uptime, server time\n"
               f"{Colors.YELLOW}Admins see: CPU, memory, diagnostics\n\n"
               f"{Colors.LAVENDER}/version or /ver\n"
               f"{Colors.LIGHT_GRAY}View bot version details\n"
               f"{Colors.SKY_BLUE}Free for everyone (DM only)\n"
               f"{Colors.CYAN}Shows: Version, codename, release date"),
              (f"{Colors.GOLD}ℹ️ SYSTEM INFO COMMANDS - Part 2\n\n"
               f"{Colors.LAVENDER}/changelog or /updates\n"
               f"{Colors.LIGHT_GRAY}View latest bot updates\n"
               f"{Colors.SKY_BLUE}Free for everyone (DM only)\n"
               f"{Colors.CYAN}Shows: Latest changes and features\n\n"
               f"{Colors.LAVENDER}/uptime\n"
               f"{Colors.LIGHT_GRAY}Check how long bot has been running\n"
               f"{Colors.SKY_BLUE}Free for everyone (DM only)\n"
               f"{Colors.CYAN}Shows: Uptime in readable format"),
              (f"{Colors.GOLD}ℹ️ SYSTEM INFO COMMANDS - Part 3\n\n"
               f"{Colors.LAVENDER}/feedback <message>\n"
               f"{Colors.LIGHT_GRAY}Send feedback to developers\n"
               f"{Colors.SKY_BLUE}Free for everyone (DM only)\n"
               f"{Colors.YELLOW}Example: /feedback Love the bot!\n"
               f"{Colors.CYAN}Developer gets notified instantly\n\n"
               f"{Colors.LAVENDER}/reportbug <description>\n"
               f"{Colors.LIGHT_GRAY}Report bugs with auto diagnostics\n"
               f"{Colors.SKY_BLUE}Free for everyone (DM only)\n"
               f"{Colors.YELLOW}Example: /reportbug Music stops\n"
               f"{Colors.CYAN}Includes: System stats, version, uptime"),
              (f"{Colors.GOLD}ℹ️ SYSTEM INFO COMMANDS - Part 4\n\n"
               f"{Colors.LAVENDER}/health (Admin only)\n"
               f"{Colors.LIGHT_GRAY}Full system health dashboard\n"
               f"{Colors.SKY_BLUE}Admin only (DM only)\n"
               f"{Colors.CYAN}Shows: CPU, memory, disk, performance\n\n"
               f"{Colors.LAVENDER}/ping (Admin only)\n"
               f"{Colors.LIGHT_GRAY}Check bot response time\n"
               f"{Colors.SKY_BLUE}Admin only (DM only)\n"
               f"{Colors.CYAN}Shows: Latency and status"),
              (f"{Colors.GOLD}ℹ️ SYSTEM INFO COMMANDS - Part 5\n\n"
               f"{Colors.LAVENDER}/stats (Admin only)\n"
               f"{Colors.LIGHT_GRAY}Comprehensive bot statistics\n"
               f"{Colors.SKY_BLUE}Admin only (DM only)\n"
               f"{Colors.CYAN}Shows: All metrics and analytics\n\n"
               f"{Colors.LAVENDER}/feedbacklogs (Admin only)\n"
               f"{Colors.LIGHT_GRAY}View all user feedback\n"
               f"{Colors.SKY_BLUE}Admin only (DM only)\n"
               f"{Colors.CYAN}Shows: Last 100 feedback entries\n"
               f"{Colors.YELLOW}Auto-chunked for long lists\n\n"
               f"{Colors.PINK}💡 Type 'help' to return to main menu")]

    for i, chunk in enumerate(chunks):
        await bot.highrise.send_message(conversation_id, chunk)
        if i < len(chunks) - 1:
            await asyncio.sleep(3.0)


async def _send_admin_commands(bot, conversation_id):
    """Send detailed admin commands - reference to room command"""
    msg = (f"{Colors.GOLD}👑 ADMIN COMMANDS\n\n"
           f"{Colors.LAVENDER}Admin commands are best used in the room.\n\n"
           f"{Colors.CYAN}To see all admin commands:\n"
           f"{Colors.YELLOW}Type {Colors.PINK}/admincmd {Colors.YELLOW}in the room\n\n"
           f"{Colors.LAVENDER}Key Admin Commands:\n"
           f"{Colors.LIGHT_GRAY}• /admins - View admin list\n"
           f"{Colors.LIGHT_GRAY}• /vips - View VIP list\n"
           f"{Colors.LIGHT_GRAY}• /addadmin / /radmin\n"
           f"{Colors.LIGHT_GRAY}• /addvip / /rvip\n"
           f"{Colors.LIGHT_GRAY}• /freemusic <mins> - Free mode\n"
           f"{Colors.LIGHT_GRAY}• /give <@user/all> <pts>\n\n"
           f"{Colors.PURPLE}Owner Commands:\n"
           f"{Colors.LIGHT_GRAY}• /btm - Task manager (/btm help)\n"
           f"{Colors.LIGHT_GRAY}• //restart - Restart bot\n"
           f"{Colors.LIGHT_GRAY}• //restartserver - Restart music server\n\n"
           f"{Colors.PINK}💡 Type 'help' to return to main menu")
    await bot.highrise.send_message(conversation_id, msg)


async def _send_modes_commands(bot, conversation_id):
    """Send detailed modes management commands"""
    chunks = [
        (f"{Colors.GOLD}🎭 MODES MANAGEMENT - Part 1\n\n"
         f"{Colors.LAVENDER}Public Commands (use in room):\n\n"
         f"{Colors.CYAN}/modes\n"
         f"{Colors.LIGHT_GRAY}View all available modes\n"
         f"{Colors.SKY_BLUE}Free for everyone\n\n"
         f"{Colors.CYAN}/mode <type>\n"
         f"{Colors.LIGHT_GRAY}Switch to a different mode\n"
         f"{Colors.SKY_BLUE}Free for everyone\n"
         f"{Colors.YELLOW}Example: /mode relax\n\n"
         f"{Colors.CYAN}/modehelp\n"
         f"{Colors.LIGHT_GRAY}Show modes help in room\n"
         f"{Colors.SKY_BLUE}Free for everyone"),
        (f"{Colors.GOLD}🎭 MODES MANAGEMENT - Part 2\n\n"
         f"{Colors.LAVENDER}Admin/Owner DM Commands:\n\n"
         f"{Colors.CYAN}/listmodes\n"
         f"{Colors.LIGHT_GRAY}List all modes with details\n"
         f"{Colors.SKY_BLUE}Admin only (DM only)\n\n"
         f"{Colors.CYAN}/modesongs <mode>\n"
         f"{Colors.LIGHT_GRAY}View songs in a specific mode\n"
         f"{Colors.SKY_BLUE}Admin only (DM only)\n"
         f"{Colors.YELLOW}Example: /modesongs relax"),
        (f"{Colors.GOLD}🎭 MODES MANAGEMENT - Part 3\n\n"
         f"{Colors.CYAN}/addmode <name> <display> <desc>\n"
         f"{Colors.LIGHT_GRAY}Create a new mode\n"
         f"{Colors.SKY_BLUE}Admin only (DM only)\n"
         f"{Colors.YELLOW}Example: /addmode punjabi Punjabi Popular Punjabi songs\n\n"
         f"{Colors.CYAN}/addsongs <mode> [song1,song2,...]\n"
         f"{Colors.LIGHT_GRAY}Add songs to a mode\n"
         f"{Colors.SKY_BLUE}Admin only (DM only)\n"
         f"{Colors.YELLOW}Example: /addsongs punjabi [diljit,sidhu]"),
        (f"{Colors.GOLD}🎭 MODES MANAGEMENT - Part 4\n\n"
         f"{Colors.CYAN}/removesongs <mode> [song1,song2,...]\n"
         f"{Colors.LIGHT_GRAY}Remove songs from a mode\n"
         f"{Colors.SKY_BLUE}Admin only (DM only)\n"
         f"{Colors.YELLOW}Example: /removesongs relax [lofi beats]\n\n"
         f"{Colors.CYAN}/deletemode <mode>\n"
         f"{Colors.LIGHT_GRAY}Delete a mode (cannot delete core modes)\n"
         f"{Colors.SKY_BLUE}Admin only (DM only)\n\n"
         f"{Colors.PINK}💡 Type 'help' to return to main menu")
    ]
    
    for i, chunk in enumerate(chunks):
        await bot.highrise.send_message(conversation_id, chunk)
        if i < len(chunks) - 1:
            await asyncio.sleep(3.0)



async def _send_full_command_list(bot, conversation_id):
    """Send comprehensive command list - all categories"""
    intro_msg = (f"{Colors.PINK}✨ Complete Command List ✨\n\n"
                 f"{Colors.LAVENDER}Sending all command categories...\n"
                 f"{Colors.SKY_BLUE}This may take a moment!")
    await bot.highrise.send_message(conversation_id, intro_msg)
    await asyncio.sleep(1)

    # Send all categories in sequence
    await _send_music_commands(bot, conversation_id)
    await asyncio.sleep(1)
    await _send_economy_commands(bot, conversation_id)
    await asyncio.sleep(1)
    await _send_playlist_commands(bot, conversation_id)
    await asyncio.sleep(1)
    await _send_shop_commands(bot, conversation_id)
    await asyncio.sleep(1)
    await _send_outfit_commands(bot, conversation_id)
    await asyncio.sleep(1)
    await _send_systeminfo_commands(bot, conversation_id)
    await asyncio.sleep(1)
    await _send_admin_commands(bot, conversation_id)
    await asyncio.sleep(1)
    await _send_modes_commands(bot, conversation_id)

    # Final message
    outro_msg = (f"{Colors.PINK}✨ That's all the commands! ✨\n\n"
                 f"{Colors.LAVENDER}💡 Type 'help' to see the menu again")
    await bot.highrise.send_message(conversation_id, outro_msg)


async def _process_message(bot, user_id, conversation_id, is_new_conversation):
    """Internal function to process DM"""
    try:
        # Get message content
        messages = await bot.highrise.get_messages(conversation_id)
        if not messages or not hasattr(messages,
                                       'messages') or not messages.messages:
            return

        latest_message = messages.messages[0]
        message_content = latest_message.content.lower()

        # Check if it's a tip notification - send appropriate thank you message
        if "you got a tip" in message_content or "tipped you" in message_content or "tip from" in message_content:
            print(
                "🎁 Tip notification detected - checking amount and sending thank you"
            )

            # Try to extract tip amount from the message to determine if points were earned
            # Most tip notifications contain the gold amount
            import re
            gold_match = re.search(r'(\d+)\s*gold', message_content,
                                   re.IGNORECASE)

            if gold_match:
                gold_amount = int(gold_match.group(1))

                if gold_amount >= 10:
                    # Points were earned - full thank you
                    thank_you_msg = (
                        f"{Colors.GOLD}💰 Thank you so much for your generous tip!\n\n"
                        f"{Colors.PINK}🎵 Your support means the world to us!\n"
                        f"{Colors.MINT}✨ Points have been added to your account\n"
                        f"{Colors.GOLD}💎 Use /balance in the room to check your points\n\n"
                        f"{Colors.LAVENDER}🎶 Enjoy the music and thank you for keeping the party going! 🎉"
                    )
                else:
                    # Tip was below minimum - different message
                    thank_you_msg = (
                        f"{Colors.GOLD}💰 Thank you for your tip!\n\n"
                        f"{Colors.LAVENDER}🎵 Your support is appreciated!\n"
                        f"{Colors.SKY_BLUE}ℹ️ Minimum tip for points: 10 gold = 50 pts\n"
                        f"{Colors.CYAN}💡 Tip 10g or more to earn Music Points!\n\n"
                        f"{Colors.PINK}🎶 Thank you for keeping the party going! 🎉"
                    )
            else:
                # Couldn't parse amount - generic thank you
                thank_you_msg = (
                    f"{Colors.GOLD}💰 Thank you so much for your tip!\n\n"
                    f"{Colors.PINK}🎵 Your support means the world to us!\n"
                    f"{Colors.GOLD}💎 Use /balance in the room to check your points\n\n"
                    f"{Colors.LAVENDER}🎶 Enjoy the music and thank you for keeping the party going! 🎉"
                )

            await bot.highrise.send_message(conversation_id, thank_you_msg)
            return True  # Indicate successful processing

        print(f"📬 DM received from {user_id}: {message_content}")

        # Strip / prefix if present for easier matching (users can type /music or music)
        clean_message = message_content.lstrip('/')

        # Check if message starts with / - execute as command through registry
        if message_content.startswith('/'):
            command_parts = message_content.split()
            if command_parts:
                if command_parts[0].startswith("//"):
                    command_name = command_parts[0][2:]  # Remove the //
                elif command_parts[0].startswith("/"):
                    command_name = command_parts[0][1:]  # Remove the /
                else:
                    command_name = command_parts[0]
                handler = bot.command_registry.get_handler(command_name)

                if handler:
                    # Get username from the message if available, otherwise fetch from room
                    username = None

                    # Try to get username from various message attributes
                    if hasattr(latest_message, 'user') and latest_message.user:
                        if hasattr(latest_message.user, 'username'):
                            username = latest_message.user.username
                    elif hasattr(latest_message,
                                 'sender') and latest_message.sender:
                        if hasattr(latest_message.sender, 'username'):
                            username = latest_message.sender.username

                    # If username not in message, try to get it from the room
                    if not username or username == "DM_User":
                        try:
                            room_users = await bot.highrise.get_room_users()
                            for room_user, _ in room_users.content:
                                if room_user.id == user_id:
                                    username = room_user.username
                                    print(
                                        f"✅ Found username from room: {username}"
                                    )
                                    break

                            # If still not found, user is not in room
                            if not username:
                                print(f"⚠️ User {user_id} not found in room")
                        except Exception as e:
                            print(
                                f"⚠️ Could not fetch username from room: {e}")

                    # Final fallback - use user_id instead of generic "DM_User"
                    if not username:
                        username = f"User_{user_id[:8]}"
                        print(f"⚠️ Using fallback username: {username}")

                    # Create a user object for the command handler
                    from highrise.models import User
                    user = User(id=user_id, username=username)

                    # Set message and conversation context for this async task
                    msg_token = message_context.set("dm")
                    conv_token = conversation_context.set(conversation_id)
                    try:
                        # Execute command with centralized error handling
                        await safe_call(handler, bot, user, message_content)
                        return True  # Command executed successfully
                    finally:
                        # Always reset contexts to prevent leakage
                        message_context.reset(msg_token)
                        conversation_context.reset(conv_token)
                else:
                    # Command not found - send error message in DM
                    error_msg = (
                        f"{Colors.LAVENDER}💬 Command '{Colors.CYAN}!{command_name}{Colors.LAVENDER}' not recognized.\n\n"
                        f"{Colors.SKY_BLUE}Try:\n"
                        f"{Colors.CYAN}• 'help' {Colors.LIGHT_GRAY}- Show all commands\n"
                        f"{Colors.CYAN}• 'stream' {Colors.LIGHT_GRAY}- Get music stream\n"
                        f"{Colors.CYAN}• 'lyrics' {Colors.LIGHT_GRAY}- Get lyrics link\n"
                        f"{Colors.CYAN}• !music {Colors.LIGHT_GRAY}- Music commands (in room)"
                    )
                    await bot.highrise.send_message(conversation_id, error_msg)
                    return True  # Handled unrecognized command

        # Send welcome message for new conversations
        if is_new_conversation:
            welcome_msg = (
                f"{Colors.PINK}✨ Welcome to Music Bot! ✨\n\n"
                f"{Colors.PURPLE}🎵 DM Commands:\n"
                f"{Colors.LAVENDER}• {Colors.CYAN}'stream' {Colors.LIGHT_GRAY}- Get music stream link\n"
                f"{Colors.LAVENDER}• {Colors.CYAN}'help' {Colors.LIGHT_GRAY}- Show all commands\n"
                f"{Colors.LAVENDER}• {Colors.CYAN}'lyrics' {Colors.LIGHT_GRAY}- Get current song lyrics\n\n"
                f"{Colors.SKY_BLUE}💡 Use !music in the room for full commands")
            await bot.highrise.send_message(conversation_id, welcome_msg)
            return True

        # Handle different DM commands (accept both !command and command)
        elif 'commands' in clean_message or 'help' in clean_message:
            # Send interactive menu
            menu_msg = (
                f"{Colors.PINK}✨ Music Bot Help Menu ✨\n\n"
                f"{Colors.LAVENDER}Choose a category to see detailed commands:\n\n"
                f"{Colors.GOLD}1. {Colors.CYAN}music {Colors.LIGHT_GRAY}- All music commands\n"
                f"{Colors.GOLD}2. {Colors.CYAN}economy {Colors.LIGHT_GRAY}- Points & packages\n"
                f"{Colors.GOLD}3. {Colors.CYAN}playlists {Colors.LIGHT_GRAY}- Playlist system (VIP+)\n"
                f"{Colors.GOLD}4. {Colors.CYAN}shop {Colors.LIGHT_GRAY}- Shopping commands\n"
                f"{Colors.GOLD}5. {Colors.CYAN}outfits {Colors.LIGHT_GRAY}- Outfit commands\n"
                f"{Colors.GOLD}6. {Colors.CYAN}systeminfo {Colors.LIGHT_GRAY}- Bot info & feedback\n"
                f"{Colors.GOLD}7. {Colors.CYAN}admin {Colors.LIGHT_GRAY}- Admin commands (/admincmd in room)\n"
                f"{Colors.GOLD}8. {Colors.CYAN}modes {Colors.LIGHT_GRAY}- Modes management (/modehelp in room)\n"
                f"{Colors.GOLD}9. {Colors.CYAN}all {Colors.LIGHT_GRAY}- See everything\n\n"
                f"{Colors.SKY_BLUE}💡 Type the category name"
            )
            await bot.highrise.send_message(conversation_id, menu_msg)
            return True

        elif clean_message == 'music':
            # Send detailed music commands
            await _send_music_commands(bot, conversation_id)
            return True

        elif clean_message == 'economy':
            # Send detailed economy commands
            await _send_economy_commands(bot, conversation_id)
            return True

        elif clean_message == 'playlists':
            # Send detailed playlist commands
            await _send_playlist_commands(bot, conversation_id)
            return True

        elif clean_message == 'shop':
            # Send detailed shop commands
            await _send_shop_commands(bot, conversation_id)
            return True

        elif clean_message == 'outfits':
            # Send detailed outfit commands
            await _send_outfit_commands(bot, conversation_id)
            return True

        elif clean_message == 'systeminfo' or clean_message == 'system info' or clean_message == 'info':
            # Send detailed systeminfo commands
            await _send_systeminfo_commands(bot, conversation_id)
            return True

        elif clean_message == 'admin':
            # Send admin commands info
            await _send_admin_commands(bot, conversation_id)
            return True

        elif clean_message == 'modes':
            # Send modes management commands
            await _send_modes_commands(bot, conversation_id)
            return True

        elif clean_message == 'all':
            # Send comprehensive command list in chunks
            await _send_full_command_list(bot, conversation_id)
            return True

        elif 'stream' in message_content:
            # Check if music manager is available
            if not bot.music:
                await bot.highrise.send_message(
                    conversation_id,
                    MessageFormatter.error(
                        "Music system not ready yet. Please try again in a moment."
                    ))
                return

            # Get current song info
            try:
                current = await bot.music.get_current()
            except Exception as e:
                print(f"Error getting current song: {e}")
                await bot.highrise.send_message(
                    conversation_id,
                    MessageFormatter.error(
                        "Unable to fetch stream info right now"))
                return

            if current and current.get('isPlaying'):
                metadata = current.get('metadata')
                if metadata and metadata.get('title'):
                    title = metadata['title']
                    artist = metadata.get('artist', 'Unknown Artist')
                else:
                    title = current.get('title', 'Music')
                    artist = 'Unknown Artist'

                stream_msg = (f"{Colors.PINK}✨ Now Playing ✨\n\n"
                              f"{Colors.PURPLE}🎵 {Colors.PINK}{title}\n"
                              f"{Colors.LAVENDER}👤 {artist}\n\n"
                              f"{Colors.CYAN}🔗 Stream Link:\n"
                              f"{Colors.SKY_BLUE}{bot.get_public_stream_url() if hasattr(bot, 'get_public_stream_url') else f'{bot.music_server}/stream'}")
            else:
                stream_msg = (
                    f"{Colors.ORANGE}🔇 No music currently playing\n\n"
                    f"{Colors.CYAN}🔗 Stream Link:\n"
                    f"{Colors.SKY_BLUE}{bot.get_public_stream_url() if hasattr(bot, 'get_public_stream_url') else f'{bot.music_server}/stream'}\n\n"
                    f"{Colors.LAVENDER}💡 Use !play in the room to start music")

            await bot.highrise.send_message(conversation_id, stream_msg)
            return True

        elif 'lyrics' in message_content:
            # Check if music manager is available
            if not bot.music:
                await bot.highrise.send_message(
                    conversation_id,
                    MessageFormatter.error(
                        "Music system not ready yet. Please try again in a moment."
                    ))
                return

            try:
                current = await bot.music.get_current()
            except Exception as e:
                print(f"Error getting current song: {e}")
                await bot.highrise.send_message(
                    conversation_id,
                    MessageFormatter.error(
                        "Unable to get music info right now. Try again later.")
                )
                return

            if current and current.get('isPlaying'):
                metadata = current.get('metadata')
                if metadata and metadata.get('title'):
                    title = metadata['title']
                    artist = metadata.get('artist', 'Unknown Artist')
                else:
                    title = current.get('title', 'Music')
                    artist = 'Unknown Artist'

                lyrics_msg = (
                    f"{Colors.PURPLE}🎵 {Colors.PINK}{title}\n"
                    f"{Colors.LAVENDER}👤 {artist}\n\n"
                    f"{Colors.CYAN}🔍 Search lyrics at:\n"
                    f"{Colors.SKY_BLUE}https://www.google.com/search?q={title}+{artist}+lyrics"
                )
            else:
                lyrics_msg = f"{Colors.ORANGE}🔇 No music currently playing"

            await bot.highrise.send_message(conversation_id, lyrics_msg)
            return True

        else:
            # Default response for unrecognized messages
            default_msg = (
                f"{Colors.LAVENDER}💬 I don't understand that command.\n\n"
                f"{Colors.SKY_BLUE}Try:\n"
                f"{Colors.CYAN}• 'stream' {Colors.LIGHT_GRAY}- Get music stream\n"
                f"{Colors.CYAN}• 'help' {Colors.LIGHT_GRAY}- Show commands\n"
                f"{Colors.CYAN}• 'lyrics' {Colors.LIGHT_GRAY}- Get lyrics link"
            )
            await bot.highrise.send_message(conversation_id, default_msg)

        return True  # Indicate successful processing

    except Exception as e:
        print(f"Error in _process_message: {e}")
        # Re-raise the exception to be caught by handle_message
        raise


async def handle_message(bot, user_id, conversation_id, is_new_conversation):
    """Handle direct messages with centralized error handling"""
    result = await safe_call(_process_message, bot, user_id, conversation_id,
                             is_new_conversation)

    # If processing failed, try to notify user
    if result is None:
        try:
            msg = f"{Colors.RED}❌ Sorry, I encountered an error processing your message. {Colors.SKY_BLUE}Please try again later or use !music in the room."
            await bot.highrise.send_message(conversation_id, msg)
        except:
            pass
