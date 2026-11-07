"""
Join Handler - Handles user join events
"""
from core.error_handler import safe_call
from core.color_formatter import Colors
import asyncio


async def _process_user_join(bot, user, position):
    """Internal function to process user join"""
    print(f"👋 {user.username} joined the room")

    # Only ensure bot avatar presence if the joining user is the bot itself
    if bot.bot_user_id and user.id == bot.bot_user_id:
        try:
            if hasattr(bot, 'ensure_bot_presence'):
                await bot.ensure_bot_presence(force=True)
            elif bot.position_manager and bot.position_manager.has_position():
                await bot.position_manager.ensure_home_position(bot)
        except Exception as e:
            print(f"⚠️ Could not ensure bot position on startup join: {e}")


    # Get user's role for personalized greeting
    from core.personalized_messages import PersonalizedMessages
    role = PersonalizedMessages.get_user_role(bot.admin, user.username)
    badge = PersonalizedMessages.get_role_badge(role)

    # Build super attractive personalized welcome message
    welcome_msg = f"{badge} {Colors.PINK}═══════════════════\n"

    # Personalized greeting by role
    if role == 'owner':
        welcome_msg += f"{Colors.GOLD}👑 The Boss has arrived!\n"
        welcome_msg += f"{Colors.AMBER}All systems tuned, all beats ready—\n"
        welcome_msg += f"{Colors.YELLOW}the studio awaits your lead, {user.username}. 🎶🔥\n"
    elif role == 'admin':
        welcome_msg += f"{Colors.PURPLE}⚔️ Admin detected!\n"
        welcome_msg += f"{Colors.LAVENDER}The stage just got a bit more powerful—\n"
        welcome_msg += f"{Colors.MAGENTA}music is ready for command mode, {user.username}. 🎵📡\n"
    elif role == 'vip':
        welcome_msg += f"{Colors.PINK}💫 VIP in the house!\n"
        welcome_msg += f"{Colors.LIGHT_PINK}Premium energy unlocked—\n"
        welcome_msg += f"{Colors.ROSE}your presence just leveled up the playlist, {user.username}! 🔥🎧\n"
    else:
        welcome_msg += f"{Colors.SKY_BLUE}✨ A new listener just stepped in!\n"
        welcome_msg += f"{Colors.CYAN}Time to vibe—drop a song and\n"
        welcome_msg += f"{Colors.LIGHT_BLUE}let the music roll, {user.username}! 🎶\n"

    welcome_msg += f"{Colors.PINK}═══════════════════\n\n"

    # Add current song info if available
    try:
        if bot.music:
            current = await bot.music.get_current()
            if current and current.get('isPlaying'):
                metadata = current.get('metadata')
                if metadata and metadata.get('title'):
                    title = metadata['title']
                    # Truncate very long titles
                    if len(title) > 35:
                        title = title[:32] + "..."
                    artist = metadata.get('artist', 'Unknown')
                    if len(artist) > 25:
                        artist = artist[:22] + "..."
                    welcome_msg += f"{Colors.PURPLE}♫ NOW VIBING TO:\n{Colors.PINK}{title}\n{Colors.LAVENDER}👤 {artist}\n\n"
                else:
                    welcome_msg += f"{Colors.PURPLE}♫ Music flowing...\n\n"
            else:
                welcome_msg += f"{Colors.CYAN}🎵 Queue is empty!\n{Colors.MINT}Be the first to play! 🎧\n\n"
        else:
            welcome_msg += f"{Colors.CYAN}🎵 Music system ready...\n\n"
    except Exception as e:
        print(f"Error getting current song for greeting: {e}")
        welcome_msg += f"{Colors.MINT}🎵 Let's get started! 🎧\n\n"

    # Add quick start commands with personalized colors
    if role == 'owner':
        welcome_msg += (
            f"{Colors.GOLD}👑 YOUR COMMANDS:\n"
            f"{Colors.AMBER}/music {Colors.YELLOW}- See all powers\n"
            f"{Colors.AMBER}/play <song> {Colors.YELLOW}- Command the vibe\n"
            f"{Colors.GOLD}DM 'help' for royal options!")
    elif role == 'admin':
        welcome_msg += (
            f"{Colors.PURPLE}⚡ ADMIN ACCESS:\n"
            f"{Colors.VIOLET}/music {Colors.LAVENDER}- All commands\n"
            f"{Colors.VIOLET}/play <song> {Colors.LAVENDER}- Control the music\n"
            f"{Colors.PURPLE}DM 'help' for admin tools!")
    elif role == 'vip':
        welcome_msg += (
            f"{Colors.PINK}💎 VIP PERKS:\n"
            f"{Colors.ROSE}/music {Colors.LIGHT_PINK}- Premium commands\n"
            f"{Colors.ROSE}/play <song> {Colors.LIGHT_PINK}- FREE requests!\n"
            f"{Colors.PINK}DM 'help' for VIP features!")
    else:
        welcome_msg += (
            f"{Colors.CYAN}🎵 GET STARTED:\n"
            f"{Colors.SKY_BLUE}/music {Colors.LIGHT_BLUE}- Browse commands\n"
            f"{Colors.SKY_BLUE}/play <song> {Colors.LIGHT_BLUE}- Request a track\n"
            f"{Colors.CYAN}DM 'help' for full guide!")

    # Send welcome whisper with auto-chunking
    # Use manual chunking with custom 2-second delay for better readability
    from core.message_utils import MessageChunker
    chunks = MessageChunker.chunk_message(welcome_msg, max_length=240)

    for i, chunk in enumerate(chunks):
        await bot.highrise.send_whisper(user.id, chunk)
        # Add 3.5-second delay between chunks (except after the last one)
        if i < len(chunks) - 1:
            await asyncio.sleep(3.0)


async def handle_user_join(bot, user, position):
    """Handle user join events with centralized error handling"""
    await safe_call(_process_user_join, bot, user, position)
