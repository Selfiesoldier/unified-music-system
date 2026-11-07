"""
Music commands - All music-related bot commands
"""
import asyncio
from .music_manager import MusicManager
from .queue_manager import QueueManager
from .skip_vote_manager import SkipVoteManager
from core.cooldowns import check_cd
from core.color_formatter import Colors, MessageFormatter, BeautifulMessages
from core.context import message_context, conversation_context
from core.message_utils import MessageChunker


def chunk_message(text, max_length=240):
    """Split a long message into chunks that fit within message limit"""
    if len(text) <= max_length:
        return [text]
    
    chunks = []
    lines = text.split('\n')
    current_chunk = ""
    
    for line in lines:
        # If adding this line would exceed limit, save current chunk and start new one
        if len(current_chunk) + len(line) + 1 > max_length:
            if current_chunk:
                chunks.append(current_chunk.rstrip())
            current_chunk = line + "\n"
        else:
            current_chunk += line + "\n"
    
    # Add the last chunk
    if current_chunk:
        chunks.append(current_chunk.rstrip())
    
    return chunks if chunks else [text[:max_length]]


def format_duration_limit(seconds):
    """Format seconds into a readable duration string"""
    if seconds >= 3600:
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        return f"{hours}h {minutes}m" if minutes else f"{hours}h"
    elif seconds >= 60:
        minutes = seconds // 60
        secs = seconds % 60
        return f"{minutes}m {secs}s" if secs else f"{minutes}m"
    return f"{seconds}s"


async def get_eligible_voters(bot):
    """
    Get count of eligible voters for skip poll.
    Excludes: bot itself, owner, and admins.
    Includes: regular users and VIPs only.
    """
    try:
        response = await bot.highrise.get_room_users()
        if not hasattr(response, 'content'):
            return 1
        
        eligible_count = 0
        for room_user, _ in response.content:
            username = room_user.username
            user_id = room_user.id
            
            # Skip the bot itself
            if bot.bot_user_id and user_id == bot.bot_user_id:
                continue
            
            # Skip owner and admins (they can use !skip to instant skip)
            if bot.admin.has_admin_access(username):
                continue
            
            # This user is eligible (regular user or VIP)
            eligible_count += 1
        
        return max(1, eligible_count)  # At least 1 to avoid division by zero
    except Exception as e:
        print(f"⚠️ Error getting eligible voters: {e}")
        return 1


def get_now_playing_title(result):
    """Safely extract now-playing track title from server skip response"""
    if not result or not isinstance(result, dict):
        return None
    if result.get('nowPlaying'):
        return result['nowPlaying']
    curr = result.get('current')
    if isinstance(curr, dict):
        return curr.get('metadata', {}).get('title') or curr.get('title')
    return None


async def trigger_immediate_autoplay(bot):
    """
    Trigger immediate autoplay after a skip when queue is empty.
    This avoids waiting for the 10-second autoplay loop.
    """
    import time
    
    if not bot.auto_play_enabled:
        return
    
    # Pre-check: Ensure server is truly idle and queue is empty
    try:
        current_status = await bot.music.get_current()
        if current_status:
            is_playing = current_status.get('isPlaying', False)
            is_preparing = current_status.get('isPreparing', False)
            queue_len = current_status.get('queueLength', 0)
            if is_playing or is_preparing or queue_len > 0:
                print(f"🛑 Autoplay suppressed: server is active (playing={is_playing}, preparing={is_preparing}, queue={queue_len})")
                return
    except Exception as e:
        print(f"⚠️ Error checking server status before autoplay: {e}")
        return

    # Set the autoplay timestamp immediately to lock out background autoplay loop
    bot.last_autoplay_request_time = time.time()
    
    current_mode = bot.mode_manager.get_mode()
    
    # Try up to 5 songs to find one within duration limit
    max_attempts = 5
    song = None
    for attempt in range(max_attempts):
        candidate_song = QueueManager.get_random_song(current_mode)
        
        # Check duration limit before playing
        max_duration = getattr(bot, 'max_song_duration', 0)
        if max_duration > 0:
            metadata = await bot.music.resolve_query(candidate_song)
            if metadata:
                duration_seconds = metadata.get('durationSeconds', 0)
                if duration_seconds > 0 and duration_seconds > max_duration:
                    print(f"⏭️ Skipping autoplay (too long: {metadata.get('duration', '?')}): {candidate_song}")
                    continue
        
        song = candidate_song
        break
    
    if not song:
        print(f"⚠️ Could not find song within duration limit after {max_attempts} attempts")
        return
    
    print(f"⚡ Immediate autoplay ({current_mode}): {song}")
    
    # Update timestamp to prevent duplicate plays
    bot.last_autoplay_request_time = time.time()
    
    play_result = await bot.music.play_song(song, is_autoplay=True)
    if play_result and play_result.get('currentMetadata'):
        metadata = play_result['currentMetadata']
        msg = (
            f"{Colors.CYAN}🤖 Auto-playing {Colors.LAVENDER}({current_mode})\n\n"
            f"{Colors.PURPLE}🎵 {Colors.PINK}{metadata['title']}\n"
            f"{Colors.LAVENDER}👤 {metadata['artist']}"
        )
        await bot.highrise.chat(msg)


async def check_song_duration(bot, query, refund_callback=None):
    """
    Check if a song exceeds the max duration limit.
    Returns (is_valid, metadata, error_message)
    """
    max_duration = getattr(bot, 'max_song_duration', 0)
    if max_duration <= 0:
        return (True, None, None)
    
    metadata = await bot.music.resolve_query(query)
    if not metadata:
        return (True, None, None)
    
    duration_seconds = metadata.get('durationSeconds', 0)
    if duration_seconds > 0 and duration_seconds > max_duration:
        limit_str = format_duration_limit(max_duration)
        song_duration = metadata.get('duration', 'Unknown')
        title = metadata.get('title', 'Unknown')
        error_msg = f"{Colors.RED}❌ Song too long!\n{Colors.PINK}{title}\n{Colors.LAVENDER}Duration: {song_duration}\n{Colors.YELLOW}Limit: {limit_str}"
        return (False, metadata, error_msg)
    
    return (True, metadata, None)


def register(bot):
    """Register music commands with the bot"""
    
    @bot.command("play")
    async def play_cmd(bot, user, message):
        remaining = check_cd(user.id, "play", 4)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return
        
        has_vip = bot.admin.has_vip_access(user.username)
        is_free = bot.is_music_free()
        cost = 0
        balance = 0
        
        if not has_vip and not is_free:
            success, balance, cost, error_msg = await bot.economy.check_and_deduct_command_cost(user.id, "play")
            if not success:
                msg = f"{Colors.RED}❌ {error_msg}\n{Colors.SKY_BLUE}💡 Tip gold or use !packs"
                await bot.send_message(msg, user.id)
                return
        
        play_parts = message.split(maxsplit=1)
        query = play_parts[1].strip() if len(play_parts) > 1 else ""
        if not query:
            if not has_vip and not is_free and cost > 0:
                await bot.economy.add_points(user.id, cost, "Refund - no query")
            await bot.send_message(MessageFormatter.error("Please provide a song name or YouTube URL"))
            return
        
        if has_vip:
            msg = f"{Colors.CYAN}🔍 {Colors.PINK}{query}\n{Colors.GOLD}⭐ VIP • Free"
            await bot.send_message(msg, user.id)
        elif is_free:
            msg = f"{Colors.CYAN}🔍 {Colors.PINK}{query}\n{Colors.GREEN}🎉 Free Mode Active"
            await bot.send_message(msg, user.id)
        else:
            msg = f"{Colors.CYAN}🔍 {Colors.PINK}{query}\n{Colors.YELLOW}💳 -{cost}pts {Colors.LIGHT_GRAY}• {Colors.GOLD}{balance}pts left"
            await bot.send_message(msg, user.id)
        
        # Check if song is already in queue (duplicate prevention)
        is_duplicate, duplicate_title = await bot.music.is_song_in_queue(query)
        if is_duplicate:
            # Refund points if they were already deducted
            if not has_vip and not is_free and cost > 0:
                await bot.economy.add_points(user.id, cost, f"Refund - duplicate song: {duplicate_title}")
            
            # Notify user
            msg = f"{Colors.ORANGE}⚠️ Already in queue!\n{Colors.PINK}{duplicate_title}\n{Colors.SKY_BLUE}💡 Use !queue to see queued songs"
            await bot.send_message(msg, user.id)
            return
        
        # Check song duration limit
        is_valid, _, duration_error = await check_song_duration(bot, query)
        if not is_valid:
            if not has_vip and not is_free and cost > 0:
                await bot.economy.add_points(user.id, cost, "Refund - song too long")
            await bot.send_message(duration_error, user.id)
            return
        
        result = await bot.music.play_song(query, requester_username=user.username)
        
        if result and result.get('error'):
            await bot.send_message(MessageFormatter.error(result['error']), user.id)
        elif result:
            bot.recent_songs_manager.add_song(query)
            
            if result.get('status') == 'queued':
                queued_title = result.get('queuedTitle', 'Song')
                position = result.get('position', 0)
                msg = f"{Colors.LAVENDER}➕ Queued #{position}\n{Colors.PINK}{queued_title}"
                await bot.highrise.chat(msg)
            else:
                metadata = result.get('currentMetadata')
                if metadata:
                    song_info = (
                        f"{Colors.MINT}▶️ Now Playing\n"
                        f"{Colors.PINK}{metadata['title']}\n"
                        f"{Colors.LAVENDER}👤 {metadata['artist']} {Colors.CYAN}⏱ {metadata['duration']}\n"
                        f"{Colors.SKY_BLUE}🔄 Reconnecting players..."
                    )
                    await bot.highrise.chat(song_info)
                else:
                    msg = f"{Colors.MINT}▶️ {Colors.PINK}{result.get('currentTitle', 'Loading...')}\n{Colors.SKY_BLUE}🔄 Reconnecting..."
                    await bot.highrise.chat(msg)
        else:
            await bot.send_message(MessageFormatter.error("Failed to add song. Make sure the music server is running!"), user.id)
    
    @bot.command("dedicate")
    async def dedicate_cmd(bot, user, message):
        remaining = check_cd(user.id, "dedicate", 4)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return
        
        has_vip = bot.admin.has_vip_access(user.username)
        is_free = bot.is_music_free()
        cost = 0
        balance = 0
        
        if not has_vip and not is_free:
            success, balance, cost, error_msg = await bot.economy.check_and_deduct_command_cost(user.id, "dedicate")
            if not success:
                msg = f"{Colors.RED}❌ {error_msg}\n{Colors.SKY_BLUE}💡 Tip gold or use !packs"
                await bot.send_message(msg, user.id)
                return
        
        # Parse message: /dedicate @username song query
        dedicate_parts = message.split(maxsplit=1)
        args = dedicate_parts[1].strip() if len(dedicate_parts) > 1 else ""
        if not args:
            if not has_vip and not is_free and cost > 0:
                await bot.economy.add_points(user.id, cost, "Refund - no args")
            await bot.send_message(MessageFormatter.error("Usage: /dedicate @username song name"))
            return
        
        # Extract @username
        parts = args.split(None, 1)
        if len(parts) < 2:
            if not has_vip and not is_free and cost > 0:
                await bot.economy.add_points(user.id, cost, "Refund - missing song")
            await bot.send_message(MessageFormatter.error("Usage: /dedicate @username song name"))
            return
        
        # Validate that first part is a username mention
        if not parts[0].startswith('@'):
            if not has_vip and not is_free and cost > 0:
                await bot.economy.add_points(user.id, cost, "Refund - invalid format")
            await bot.send_message(MessageFormatter.error("Please mention a user with @ (e.g., /dedicate @username song name)"))
            return
        
        dedicated_to = parts[0][1:]  # Remove @ symbol
        if not dedicated_to:
            if not has_vip and not is_free and cost > 0:
                await bot.economy.add_points(user.id, cost, "Refund - empty username")
            await bot.send_message(MessageFormatter.error("Please provide a valid username"))
            return
        
        query = parts[1].strip()
        if not query:
            if not has_vip and not is_free and cost > 0:
                await bot.economy.add_points(user.id, cost, "Refund - no query")
            await bot.send_message(MessageFormatter.error("Please provide a song name or YouTube URL"))
            return
        
        if has_vip:
            msg = f"{Colors.CYAN}💝 Dedicating to {Colors.PINK}@{dedicated_to}\n{Colors.CYAN}🔍 {Colors.PINK}{query}\n{Colors.GOLD}⭐ VIP • Free"
            await bot.send_message(msg, user.id)
        elif is_free:
            msg = f"{Colors.CYAN}💝 Dedicating to {Colors.PINK}@{dedicated_to}\n{Colors.CYAN}🔍 {Colors.PINK}{query}\n{Colors.GREEN}🎉 Free Mode Active"
            await bot.send_message(msg, user.id)
        else:
            msg = f"{Colors.CYAN}💝 Dedicating to {Colors.PINK}@{dedicated_to}\n{Colors.CYAN}🔍 {Colors.PINK}{query}\n{Colors.YELLOW}💳 -{cost}pts {Colors.LIGHT_GRAY}• {Colors.GOLD}{balance}pts left"
            await bot.send_message(msg, user.id)
        
        # Check if song is already in queue (duplicate prevention)
        is_duplicate, duplicate_title = await bot.music.is_song_in_queue(query)
        if is_duplicate:
            # Refund points if they were already deducted
            if not has_vip and not is_free and cost > 0:
                await bot.economy.add_points(user.id, cost, f"Refund - duplicate song: {duplicate_title}")
            
            # Notify user
            msg = f"{Colors.ORANGE}⚠️ Already in queue!\n{Colors.PINK}{duplicate_title}\n{Colors.SKY_BLUE}💡 Use !queue to see queued songs"
            await bot.send_message(msg, user.id)
            return
        
        # Check song duration limit
        is_valid, _, duration_error = await check_song_duration(bot, query)
        if not is_valid:
            if not has_vip and not is_free and cost > 0:
                await bot.economy.add_points(user.id, cost, "Refund - song too long")
            await bot.send_message(duration_error, user.id)
            return
        
        result = await bot.music.play_song(query, dedicated_to=dedicated_to, dedicated_by=user.username)
        
        if result and result.get('error'):
            await bot.send_message(MessageFormatter.error(result['error']), user.id)
        elif result:
            bot.recent_songs_manager.add_song(query)
            
            if result.get('status') == 'queued':
                queued_title = result.get('queuedTitle', 'Song')
                position = result.get('position', 0)
                msg = f"{Colors.LAVENDER}➕ Queued #{position}\n{Colors.PINK}{queued_title}\n{Colors.CYAN}💝 Dedicated to {Colors.PINK}@{dedicated_to}"
                await bot.highrise.chat(msg)
            else:
                metadata = result.get('currentMetadata')
                if metadata:
                    song_info = (
                        f"{Colors.MINT}▶️ Now Playing\n"
                        f"{Colors.PINK}{metadata['title']}\n"
                        f"{Colors.LAVENDER}👤 {metadata['artist']} {Colors.CYAN}⏱ {metadata['duration']}\n"
                        f"{Colors.CYAN}💝 Dedicated to {Colors.PINK}@{dedicated_to}\n"
                        f"{Colors.SKY_BLUE}🔄 Reconnecting players..."
                    )
                    await bot.highrise.chat(song_info)
                else:
                    msg = f"{Colors.MINT}▶️ {Colors.PINK}{result.get('currentTitle', 'Loading...')}\n{Colors.CYAN}💝 Dedicated to {Colors.PINK}@{dedicated_to}\n{Colors.SKY_BLUE}🔄 Reconnecting..."
                    await bot.highrise.chat(msg)
        else:
            await bot.send_message(MessageFormatter.error("Failed to add song. Make sure the music server is running!"), user.id)
    
    @bot.command("next", "upcoming", "upnext")
    async def next_cmd(bot, user, message):
        """Show the 1 upcoming song in the queue"""
        remaining = check_cd(user.id, "next", 3)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return
        
        result = await bot.music.get_queue()
        if not result:
            await bot.send_message(MessageFormatter.error("Failed to check queue info"), user.id)
            return
        
        queue_list = result.get('queue', [])
        if queue_list and len(queue_list) > 0:
            next_song = queue_list[0]
            title = next_song.get('title', 'Unknown Track')
            artist = next_song.get('artist', 'Unknown Artist')
            duration = next_song.get('duration', 'Unknown')
            requester = next_song.get('requesterUsername')
            
            msg = (
                f"{Colors.PURPLE}⏭️ Up Next in Queue\n\n"
                f"{Colors.PINK}🎵 {title}\n"
                f"{Colors.LAVENDER}👤 {artist} {Colors.SKY_BLUE}⏱️ {duration}"
            )
            if requester:
                msg += f"\n{Colors.CYAN}🎤 Requested by {Colors.PINK}@{requester}"
            if len(queue_list) > 1:
                msg += f"\n\n{Colors.LIGHT_GRAY}📋 +{len(queue_list) - 1} more in /queue"
            
            await bot.highrise.chat(msg)
        else:
            if bot.auto_play_enabled:
                current_mode = bot.mode_manager.get_mode()
                msg = (
                    f"{Colors.YELLOW}📋 Queue is empty!\n\n"
                    f"{Colors.CYAN}🤖 Auto-play will pick the next song ({current_mode})\n"
                    f"{Colors.SKY_BLUE}💡 Use {Colors.PINK}/play <song> {Colors.SKY_BLUE}to add songs!"
                )
            else:
                msg = (
                    f"{Colors.YELLOW}📋 Queue is empty!\n\n"
                    f"{Colors.SKY_BLUE}💡 Use {Colors.PINK}/play <song> {Colors.SKY_BLUE}to add songs!"
                )
            await bot.send_message(msg, user.id)

    @bot.command("skip", "s")
    async def skip_cmd(bot, user, message):
        # Initialize skip vote manager if not exists
        if not hasattr(bot, 'skip_vote_manager'):
            bot.skip_vote_manager = SkipVoteManager()
        
        # Admin/Owner: Instant skip for free
        if bot.admin.has_admin_access(user.username):
            # Clear any active vote when admin skips
            vote_was_active = False
            if bot.skip_vote_manager.active_vote:
                vote_was_active = True
                bot.skip_vote_manager.end_vote()
            
            result = await bot.music.skip_song()
            if result:
                if result.get('status') == 'not_playing':
                    await bot.send_message(f"{Colors.YELLOW}⚠️ Nothing playing", user.id)
                else:
                    now_playing_title = get_now_playing_title(result)
                    skip_msg = f"{Colors.LAVENDER}⏭️ Skipped by admin"
                    if vote_was_active:
                        skip_msg += f"\n{Colors.LIGHT_GRAY}(Active vote cleared)"
                    if now_playing_title:
                        skip_msg += f"\n{Colors.MINT}▶️ Now playing: {Colors.PINK}{now_playing_title}"
                        await bot.highrise.chat(skip_msg)
                    else:
                        await bot.highrise.chat(skip_msg)
                        if result.get('queueLength', 0) == 0 and not result.get('current'):
                            await trigger_immediate_autoplay(bot)
            else:
                await bot.send_message(MessageFormatter.error("Skip failed"), user.id)
            return
        
        # Regular users: Start a skip vote
        # Apply cooldown
        remaining = check_cd(user.id, "skip", 60)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return
        
        # Check if vote already active
        if bot.skip_vote_manager.active_vote:
            # Try to add vote
            if bot.skip_vote_manager.add_vote(user.id):
                # Get eligible voters (excludes bot, owner, admins - only real users and VIPs)
                total_users = await get_eligible_voters(bot)
                
                status = bot.skip_vote_manager.get_vote_status(total_users)
                msg = f"{Colors.CYAN}📊 Skip Vote: {Colors.PINK}{status['votes']}/{status['needed']} {Colors.LIGHT_GRAY}({status['percentage']:.0f}%)"
                await bot.highrise.chat(msg)
                
                # Check if threshold reached
                if bot.skip_vote_manager.check_threshold(total_users):
                    bot.skip_vote_manager.end_vote()
                    result = await bot.music.skip_song()
                    if result:
                        now_playing_title = get_now_playing_title(result)
                        if now_playing_title:
                            await bot.highrise.chat(f"{Colors.MINT}✅ Vote passed! Skipping...\n{Colors.MINT}▶️ Now playing: {Colors.PINK}{now_playing_title}")
                        else:
                            await bot.highrise.chat(f"{Colors.MINT}✅ Vote passed! Skipped")
                            if result.get('queueLength', 0) == 0 and not result.get('current'):
                                await trigger_immediate_autoplay(bot)
                    else:
                        await bot.send_message(MessageFormatter.error("Skip failed"), user.id)
            else:
                await bot.send_message(f"{Colors.ORANGE}⚠️ You already voted!", user.id)
            return
        
        # Start new vote
        if not bot.skip_vote_manager.start_vote(user.id):
            await bot.send_message(f"{Colors.RED}❌ Vote already in progress", user.id)
            return
        
        # Get eligible voters (excludes bot, owner, admins - only real users and VIPs)
        total_users = await get_eligible_voters(bot)
        
        # Check if threshold is already met (e.g., only 1 user in room)
        if bot.skip_vote_manager.check_threshold(total_users):
            bot.skip_vote_manager.end_vote()
            result = await bot.music.skip_song()
            if result:
                now_playing_title = get_now_playing_title(result)
                if now_playing_title:
                    await bot.highrise.chat(f"{Colors.MINT}⏭️ Skipped by {Colors.PINK}@{user.username}\n{Colors.MINT}▶️ Now playing: {Colors.PINK}{now_playing_title}")
                else:
                    await bot.highrise.chat(f"{Colors.MINT}⏭️ Skipped by {Colors.PINK}@{user.username}")
                    if result.get('queueLength', 0) == 0 and not result.get('current'):
                        await trigger_immediate_autoplay(bot)
            else:
                await bot.send_message(MessageFormatter.error("Skip failed"), user.id)
            return
        
        status = bot.skip_vote_manager.get_vote_status(total_users)
        
        msg = (
            f"{Colors.PINK}📊 Skip Vote Started!\n"
            f"{Colors.CYAN}@{user.username} {Colors.LIGHT_GRAY}wants to skip\n"
            f"{Colors.LAVENDER}Type {Colors.YELLOW}/skip or /s {Colors.LAVENDER}to vote\n"
            f"{Colors.PINK}{status['votes']}/{status['needed']} {Colors.LIGHT_GRAY}votes needed (80%)"
        )
        await bot.highrise.chat(msg)
        
        # Auto-end vote after 30 seconds
        async def vote_timeout():
            await asyncio.sleep(30)
            if bot.skip_vote_manager.active_vote and not bot.skip_vote_manager.admin_cancelled:
                status = bot.skip_vote_manager.get_vote_status(total_users)
                bot.skip_vote_manager.end_vote()
                await bot.highrise.chat(f"{Colors.ORANGE}⏰ Skip vote expired {Colors.LIGHT_GRAY}• {status['votes']}/{status['needed']} votes")
        
        bot.skip_vote_manager.vote_task = asyncio.create_task(vote_timeout())
    
    @bot.command("skipvote-")
    async def skipvote_cancel_cmd(bot, user, message):
        # Admin only command
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(f"{Colors.RED}⛔ This command is for admins only!", user.id)
            return
        
        # Initialize skip vote manager if not exists
        if not hasattr(bot, 'skip_vote_manager'):
            bot.skip_vote_manager = SkipVoteManager()
        
        # Cancel active vote
        if bot.skip_vote_manager.cancel_vote_by_admin():
            await bot.highrise.chat(f"{Colors.RED}🚫 Skip vote cancelled by admin")
        else:
            await bot.send_message(f"{Colors.ORANGE}⚠️ No active vote to cancel", user.id)
    
    @bot.command("instskip")
    async def instant_skip_cmd(bot, user, message):
        # Initialize skip vote manager if not exists
        if not hasattr(bot, 'skip_vote_manager'):
            bot.skip_vote_manager = SkipVoteManager()
        
        # Apply cooldown
        if not bot.admin.has_admin_access(user.username):
            remaining = check_cd(user.id, "instskip", 60)
            if remaining > 0:
                await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
                return
        
        # Check if user has 1000 points (VIPs must also pay)
        balance = await bot.economy.get_balance(user.id)
        if balance < 1000:
            msg = f"{Colors.RED}❌ Need 1000pts for instant skip\n{Colors.GOLD}💰 Balance: {Colors.YELLOW}{balance}pts\n{Colors.SKY_BLUE}💡 Tip gold or use !packs"
            await bot.send_message(msg, user.id)
            return
        
        # Deduct 1000 points
        async with bot.economy.lock:
            current = bot.economy.balances.get(str(user.id), 0)
            bot.economy.balances[str(user.id)] = current - 1000
            bot.economy.save_balances()
            new_balance = bot.economy.balances[str(user.id)]
        
        msg = f"{Colors.PURPLE}⚡ Instant Skip!\n{Colors.YELLOW}💳 -1000pts {Colors.LIGHT_GRAY}• {Colors.GOLD}{new_balance}pts left"
        await bot.send_message(msg, user.id)
        
        # Clear any active vote when using instant skip
        vote_was_active = False
        if bot.skip_vote_manager.active_vote:
            vote_was_active = True
            bot.skip_vote_manager.end_vote()
        
        # Skip the song
        result = await bot.music.skip_song()
        if result:
            if result.get('status') == 'not_playing':
                await bot.send_message(f"{Colors.YELLOW}⚠️ Nothing playing", user.id)
            else:
                now_playing_title = get_now_playing_title(result)
                skip_msg = f"{Colors.LAVENDER}⚡ Instant skip by {Colors.PINK}@{user.username}"
                if vote_was_active:
                    skip_msg += f"\n{Colors.LIGHT_GRAY}(Active vote cleared)"
                if now_playing_title:
                    skip_msg += f"\n{Colors.MINT}▶️ Now playing: {Colors.PINK}{now_playing_title}"
                    await bot.highrise.chat(skip_msg)
                else:
                    await bot.highrise.chat(skip_msg)
                    if result.get('queueLength', 0) == 0 and not result.get('current'):
                        await trigger_immediate_autoplay(bot)
        else:
            await bot.send_message(MessageFormatter.error("Skip failed"), user.id)
    
    @bot.command("clear")
    async def clear_cmd(bot, user, message):
        remaining = check_cd(user.id, "clear", 5)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return
        
        # Check admin/owner access (unrestricted)
        has_admin = bot.admin.has_admin_access(user.username)
        has_vip = bot.admin.has_vip_access(user.username) and not has_admin
        is_free = bot.is_music_free()
        
        queue_result = await bot.music.get_queue()
        if not queue_result:
            await bot.send_message(MessageFormatter.error("Failed to check queue. Cannot calculate cost."), user.id)
            return
        
        queue_length = queue_result.get('length', 0)
        if queue_length == 0:
            await bot.send_message(f"{Colors.YELLOW}📋 Queue already empty", user.id)
            return
        
        # VIP users: Check 1-hour cooldown (unless in free mode or admin)
        if has_vip and not is_free:
            can_use, vip_remaining = bot.economy.can_vip_use_clear(user.id)
            if not can_use:
                minutes_left = int(vip_remaining // 60)
                seconds_left = int(vip_remaining % 60)
                msg = f"{Colors.ORANGE}⏰ VIP Clear Cooldown\n{Colors.YELLOW}Next use in: {Colors.PINK}{minutes_left}m {seconds_left}s\n{Colors.SKY_BLUE}💡 VIPs can clear once per hour"
                await bot.send_message(msg, user.id)
                return
            
            # Record usage for VIP
            bot.economy.record_vip_clear(user.id)
            msg = f"{Colors.GOLD}⭐ VIP Clear {Colors.LAVENDER}• Free\n{Colors.LIGHT_GRAY}Next use in 1 hour"
            await bot.send_message(msg, user.id)
        
        # Regular users: Pay doubled cost (unless in free mode)
        elif not has_admin and not is_free:
            success, balance, cost, error_msg = await bot.economy.check_and_deduct_command_cost(user.id, "clear", queue_length)
            if not success:
                msg = f"{Colors.RED}❌ {error_msg}\n{Colors.SKY_BLUE}💡 Tip gold or !packs"
                await bot.send_message(msg, user.id)
                return
            msg = f"{Colors.PURPLE}🗑️ Clearing queue...\n{Colors.YELLOW}💳 -{cost}pts {Colors.LIGHT_GRAY}• {Colors.GOLD}{balance}pts left"
            await bot.send_message(msg, user.id)
        
        # Admin/Owner or free mode
        elif has_admin:
            msg = f"{Colors.GOLD}👑 Admin Clear {Colors.LAVENDER}• Unrestricted"
            await bot.send_message(msg, user.id)
        
        result = await bot.music.clear_queue()
        if result:
            count = result.get('clearedCount', 0)
            if count > 0:
                msg = f"{Colors.LAVENDER}🗑️ Cleared {Colors.PINK}{count} songs"
            else:
                msg = f"{Colors.YELLOW}📋 Already empty"
            await bot.highrise.chat(msg)
        else:
            await bot.send_message(MessageFormatter.error("Clear failed"), user.id)
    
    @bot.command("current", "np")
    async def current_cmd(bot, user, message):
        remaining = check_cd(user.id, "current", 3)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return
            
        print(f"🎵 Running np/current command for {user.username}")
        result = await bot.music.get_current()
        print(f"🎵 get_current result: {result}")
        if result:
            metadata = result.get('metadata')
            queue_len = result.get('queueLength', 0)
            is_autoplay = result.get('isAutoplay', False)
            
            if metadata:
                requester = metadata.get('requesterUsername')
                dedicated_to = metadata.get('dedicatedTo')
                dedicated_by = metadata.get('dedicatedBy')
                
                try:
                    song_info = BeautifulMessages.now_playing(
                        metadata.get('title', 'Unknown Track'),
                        metadata.get('artist', 'Unknown Artist'),
                        metadata.get('duration', 'Unknown'),
                        metadata.get('views', 'N/A'),
                        queue_len,
                        is_autoplay=is_autoplay,
                        requester=requester,
                        dedicated_to=dedicated_to,
                        dedicated_by=dedicated_by
                    )
                    print(f"🎵 Sending np message: {song_info[:100]}...")
                    # Try sending as chat instead of whisper to test
                    await bot.highrise.chat(song_info)
                    print(f"🎵 np message sent successfully")
                except Exception as e:
                    print(f"❌ Error sending np message: {e}")
                    import traceback
                    traceback.print_exc()
            else:
                title = result.get('title', 'Unknown')
                msg = f"{Colors.PINK}🎧 {Colors.PURPLE}{title}\n{Colors.YELLOW}📋 {queue_len} in queue"
                await bot.send_message(msg, user.id)
        else:
            await bot.send_message(MessageFormatter.error("No track info"), user.id)
    
    @bot.command("queue", "q")
    async def queue_cmd(bot, user, message):
        remaining = check_cd(user.id, "queue", 3)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return

        result = await bot.music.get_queue()
        
        # Debug log to see what we're getting
        print(f"📋 Queue result: {result}")
        
        if not result:
            msg = f"{Colors.RED}❌ Failed to get queue info"
            await bot.send_message(msg, user.id)
            return
        
        queue_length = result.get('queueLength', 0)  # Fixed: use 'queueLength' not 'length'
        queue_list = result.get('queue', [])
        
        # Check both length and actual queue list
        if queue_length > 0 or len(queue_list) > 0:
            actual_length = max(queue_length, len(queue_list))
            queue_text = f"{Colors.PINK}📋 Queue ({actual_length})\n\n"
            
            # Display up to 5 songs
            for idx, item in enumerate(queue_list[:5], 1):
                title = item.get('title', 'Unknown')
                artist = item.get('artist', 'Unknown Artist')
                duration = item.get('duration', '0:00')
                position = item.get('position', idx)
                
                queue_text += MessageFormatter.queue_item(
                    position,
                    title,
                    artist,
                    duration
                ) + "\n"
            
            if actual_length > 5:
                queue_text += f"{Colors.LIGHT_GRAY}+{actual_length - 5} more"
            
            # Use auto-chunking for long queue lists - whisper to user
            await bot.send_message(queue_text, user.id)
        else:
            msg = f"{Colors.YELLOW}📋 Queue empty {Colors.SKY_BLUE}• /play to add"
            await bot.send_message(msg, user.id)
    
    @bot.command("autoplay")
    async def autoplay_cmd(bot, user, message):
        remaining = check_cd(user.id, "autoplay", 4)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return

        bot.auto_play_enabled = not bot.auto_play_enabled
        if bot.auto_play_enabled:
            msg = f"{Colors.MINT}🤖 Auto-play {Colors.GREEN}ON"
        else:
            msg = f"{Colors.LAVENDER}🤖 Auto-play {Colors.RED}OFF"
        await bot.highrise.chat(msg)
    
    @bot.command("maxduration", "songlimit")
    async def maxduration_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(f"{Colors.RED}⛔ Admin only command", user.id)
            return
        
        args = message.split(None, 1)
        if len(args) < 2 or not args[1].strip():
            current = getattr(bot, 'max_song_duration', 0)
            if current <= 0:
                msg = f"{Colors.CYAN}⏱️ Song Duration Limit\n{Colors.MINT}Currently: {Colors.GREEN}No limit\n\n{Colors.LAVENDER}Usage: /maxduration <minutes>\n{Colors.LIGHT_GRAY}Set to 0 to disable"
            else:
                limit_str = format_duration_limit(current)
                msg = f"{Colors.CYAN}⏱️ Song Duration Limit\n{Colors.PINK}Currently: {Colors.YELLOW}{limit_str}\n\n{Colors.LAVENDER}Usage: /maxduration <minutes>\n{Colors.LIGHT_GRAY}Set to 0 to disable"
            await bot.send_message(msg, user.id)
            return
        
        try:
            minutes = int(args[1].strip())
            if minutes < 0:
                await bot.send_message(f"{Colors.RED}❌ Duration must be 0 or positive", user.id)
                return
            
            bot.max_song_duration = minutes * 60
            
            if minutes == 0:
                msg = f"{Colors.MINT}⏱️ Song limit {Colors.GREEN}disabled\n{Colors.LIGHT_GRAY}Songs of any length allowed"
            else:
                limit_str = format_duration_limit(bot.max_song_duration)
                msg = f"{Colors.CYAN}⏱️ Song limit set to {Colors.YELLOW}{limit_str}\n{Colors.LIGHT_GRAY}Songs longer than this will be rejected"
            await bot.highrise.chat(msg)
        except ValueError:
            await bot.send_message(f"{Colors.RED}❌ Please enter a valid number of minutes", user.id)
    
    @bot.command("insert", "insertplay", "playnext")
    async def insert_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(f"{Colors.RED}⛔ Admin only command", user.id)
            return
        
        parts = message.split(None, 1)
        if len(parts) < 2 or not parts[1].strip():
            msg = f"{Colors.CYAN}⏫ Insert Song (Admin)\n{Colors.LAVENDER}Usage: /insert <song name or URL>\n{Colors.LIGHT_GRAY}Adds song to front of queue - plays next"
            await bot.send_message(msg, user.id)
            return
        
        query = parts[1].strip()
        
        is_valid, _, duration_error = await check_song_duration(bot, query)
        if not is_valid:
            await bot.send_message(duration_error, user.id)
            return
        
        result = await bot.music.insert_song(query, requester_username=user.username)
        
        if result:
            status = result.get('status', '')
            if status == 'inserted':
                title = result.get('insertedTitle', 'Unknown')
                queue_len = result.get('queueLength', 1)
                msg = f"{Colors.CYAN}⏫ {Colors.MINT}Inserted at front!\n{Colors.PINK}🎵 {Colors.PURPLE}{title}\n{Colors.YELLOW}Will play next • {queue_len} in queue"
                await bot.highrise.chat(msg)
            elif status == 'playing':
                title = result.get('currentTitle', 'Unknown')
                msg = f"{Colors.MINT}▶️ Now Playing\n{Colors.PINK}🎵 {Colors.PURPLE}{title}"
                await bot.highrise.chat(msg)
            else:
                await bot.highrise.chat(f"{Colors.MINT}✅ Song inserted successfully")
        else:
            await bot.send_message(MessageFormatter.error("Failed to insert song"), user.id)
    
    @bot.command("tts", "announcements")
    async def tts_cmd(bot, user, message):
        remaining = check_cd(user.id, "tts", 3)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return

        parts = message.split()
        subcmd = parts[1].lower() if len(parts) > 1 else "status"

        if subcmd in ["on", "enable", "true", "1"]:
            if not bot.admin.has_admin_access(user.username):
                await bot.send_message(f"{Colors.RED}⛔ Admin only command", user.id)
                return
            res = await bot.music.set_announcements(enabled=True)
            if res and res.get("status") == "ok":
                msg = f"{Colors.MINT}🎙️ TTS Announcements: {Colors.GREEN}ENABLED\n{Colors.LIGHT_GRAY}Song title and requester will play before each track."
                await bot.highrise.chat(msg)
            else:
                await bot.send_message(MessageFormatter.error("Failed to enable TTS"), user.id)

        elif subcmd in ["off", "disable", "false", "0"]:
            if not bot.admin.has_admin_access(user.username):
                await bot.send_message(f"{Colors.RED}⛔ Admin only command", user.id)
                return
            res = await bot.music.set_announcements(enabled=False)
            if res and res.get("status") == "ok":
                msg = f"{Colors.LAVENDER}🎙️ TTS Announcements: {Colors.RED}DISABLED"
                await bot.highrise.chat(msg)
            else:
                await bot.send_message(MessageFormatter.error("Failed to disable TTS"), user.id)

        elif subcmd in ["voice", "accent", "lang"]:
            if not bot.admin.has_admin_access(user.username):
                await bot.send_message(f"{Colors.RED}⛔ Admin only command", user.id)
                return
            if len(parts) < 3:
                msg = (
                    f"{Colors.CYAN}🎙️ TTS Voice Selection\n"
                    f"{Colors.LAVENDER}Usage: /tts voice <code>\n\n"
                    f"{Colors.YELLOW}Popular voices:\n"
                    f"{Colors.LIGHT_GRAY}• en (US) • en-gb (UK) • en-in (India)\n"
                    f"{Colors.LIGHT_GRAY}• hi (Hindi) • ur (Urdu) • es (Spanish)\n"
                    f"{Colors.LIGHT_GRAY}• fr (French) • de (German) • ar (Arabic)"
                )
                await bot.send_message(msg, user.id)
                return

            voice_code = parts[2].lower()
            res = await bot.music.set_announcements(voice=voice_code)
            if res and res.get("status") == "ok":
                voice_name = res.get("voiceName", voice_code)
                msg = f"{Colors.MINT}🎙️ TTS Voice set to: {Colors.YELLOW}{voice_name} {Colors.LIGHT_GRAY}({voice_code})"
                await bot.highrise.chat(msg)
            else:
                await bot.send_message(MessageFormatter.error("Invalid voice code or server error"), user.id)

        elif subcmd in ["voices", "list"]:
            msg = (
                f"{Colors.GOLD}🎙️ Supported TTS Voices\n\n"
                f"{Colors.LAVENDER}• en {Colors.LIGHT_GRAY}- English (US)\n"
                f"{Colors.LAVENDER}• en-gb {Colors.LIGHT_GRAY}- English (UK)\n"
                f"{Colors.LAVENDER}• en-in {Colors.LIGHT_GRAY}- English (India)\n"
                f"{Colors.LAVENDER}• hi {Colors.LIGHT_GRAY}- Hindi\n"
                f"{Colors.LAVENDER}• ur {Colors.LIGHT_GRAY}- Urdu\n"
                f"{Colors.LAVENDER}• es {Colors.LIGHT_GRAY}- Spanish\n"
                f"{Colors.LAVENDER}• fr {Colors.LIGHT_GRAY}- French\n"
                f"{Colors.LAVENDER}• de {Colors.LIGHT_GRAY}- German\n"
                f"{Colors.LAVENDER}• it {Colors.LIGHT_GRAY}- Italian\n"
                f"{Colors.LAVENDER}• pt {Colors.LIGHT_GRAY}- Portuguese\n"
                f"{Colors.LAVENDER}• ar {Colors.LIGHT_GRAY}- Arabic\n\n"
                f"{Colors.PINK}Change voice with: {Colors.CYAN}/tts voice <code>"
            )
            await bot.send_message(msg, user.id)

        elif subcmd in ["words", "limit", "wordlimit"]:
            if not bot.admin.has_admin_access(user.username):
                await bot.send_message(f"{Colors.RED}⛔ Admin only command", user.id)
                return
            if len(parts) < 3:
                msg = f"{Colors.CYAN}🎙️ TTS Word Limit\n{Colors.LAVENDER}Usage: /tts words <number>\n{Colors.LIGHT_GRAY}Controls max words in title spoken by TTS (3-30)"
                await bot.send_message(msg, user.id)
                return

            try:
                words = int(parts[2])
                if words < 1 or words > 50:
                    await bot.send_message(f"{Colors.RED}❌ Word limit must be between 1 and 50", user.id)
                    return
                res = await bot.music.set_announcements(word_limit=words)
                if res and res.get("status") == "ok":
                    msg = f"{Colors.MINT}🎙️ TTS Word Limit set to: {Colors.YELLOW}{words} words"
                    await bot.highrise.chat(msg)
                else:
                    await bot.send_message(MessageFormatter.error("Failed to set word limit"), user.id)
            except ValueError:
                await bot.send_message(f"{Colors.RED}❌ Please enter a valid number", user.id)

        else:
            current = await bot.music.get_announcements()
            if current:
                is_enabled = current.get("enabled", False)
                voice = current.get("voice", "en")
                voice_name = current.get("voiceName", "English (US)")
                word_limit = current.get("wordLimit", 10)
                status_str = f"{Colors.GREEN}ENABLED" if is_enabled else f"{Colors.RED}DISABLED"
                msg = (
                    f"{Colors.GOLD}🎙️ TTS Voice Announcements\n\n"
                    f"{Colors.CYAN}Status: {status_str}\n"
                    f"{Colors.CYAN}Voice: {Colors.YELLOW}{voice_name} ({voice})\n"
                    f"{Colors.CYAN}Word Limit: {Colors.YELLOW}{word_limit} words\n\n"
                    f"{Colors.LAVENDER}Commands:\n"
                    f"{Colors.LIGHT_GRAY}• /tts on {Colors.CYAN}- Enable\n"
                    f"{Colors.LIGHT_GRAY}• /tts off {Colors.CYAN}- Disable\n"
                    f"{Colors.LIGHT_GRAY}• /tts voice <code> {Colors.CYAN}- Change accent\n"
                    f"{Colors.LIGHT_GRAY}• /tts voices {Colors.CYAN}- List all voices\n"
                    f"{Colors.LIGHT_GRAY}• /tts words <num> {Colors.CYAN}- Word limit"
                )
            else:
                msg = (
                    f"{Colors.GOLD}🎙️ TTS Voice Announcements\n\n"
                    f"{Colors.LAVENDER}Commands:\n"
                    f"{Colors.LIGHT_GRAY}• /tts on {Colors.CYAN}- Enable\n"
                    f"{Colors.LIGHT_GRAY}• /tts off {Colors.CYAN}- Disable\n"
                    f"{Colors.LIGHT_GRAY}• /tts voice <code> {Colors.CYAN}- Change accent\n"
                    f"{Colors.LIGHT_GRAY}• /tts voices {Colors.CYAN}- List all voices"
                )
            await bot.send_message(msg, user.id)
    
    @bot.command("modes")
    async def modes_cmd(bot, user, message):
        remaining = check_cd(user.id, "modes", 3)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return

        from systems.modes.modes_commands_manager import ModesCommandsManager
        
        QueueManager.reload_modes()
        QueueManager.get_modes()
        
        modes_list = ModesCommandsManager.get_all_modes()
        modes_dict = {}
        for mode in modes_list:
            mode_name = mode.get('name')
            if mode_name:
                modes_dict[mode_name] = mode
        
        recent_count = len(bot.recent_songs_manager.get_songs())
        current_mode = bot.mode_manager.get_mode()
        modes_msg = BeautifulMessages.modes_list(current_mode, recent_count, modes_dict)
        # Use auto-chunking for long modes list - whisper to user
        await bot.send_message(modes_msg, user.id)
    
    @bot.command("mode")
    async def mode_cmd(bot, user, message):
        # Check if command is being called from a DM
        msg_context = message_context.get()
        conv_id = conversation_context.get()
        is_dm = (msg_context == "dm")
        
        remaining = check_cd(user.id, "mode", 6)
        if remaining > 0:
            cooldown_msg = MessageFormatter.cooldown(remaining)
            if is_dm and conv_id:
                await bot.highrise.send_message(conv_id, cooldown_msg)
            elif is_dm:
                try:
                    await bot.highrise.send_message(user.id, cooldown_msg)
                except:
                    await bot.send_message(cooldown_msg, user.id)
            else:
                await bot.send_message(cooldown_msg, user.id)
            return
        
        mode_parts = message.split(maxsplit=1)
        mode = mode_parts[1].strip().lower() if len(mode_parts) > 1 else ""
        
        if not mode:
            error_msg = MessageFormatter.error(f"Invalid usage! Use {Colors.SKY_BLUE}/modes {Colors.RED}to see available modes")
            if is_dm and conv_id:
                await bot.highrise.send_message(conv_id, error_msg)
            elif is_dm:
                try:
                    await bot.highrise.send_message(user.id, error_msg)
                except:
                    await bot.send_message(error_msg, user.id)
            else:
                await bot.send_message(error_msg, user.id)
            return
        
        QueueManager.reload_modes()
        modes = QueueManager.get_modes()
        
        if mode in modes:
            bot.mode_manager.save_mode(mode)
            msg = f"{Colors.PURPLE}🎭 Mode: {Colors.PINK}{mode} {Colors.MINT}✅\n{Colors.CYAN}💾 Saved for next session"
            if is_dm and conv_id:
                await bot.highrise.send_message(conv_id, msg)
            elif is_dm:
                try:
                    await bot.highrise.send_message(user.id, msg)
                except:
                    await bot.send_message(msg, user.id)
            else:
                await bot.highrise.chat(msg)
        else:
            error_msg = MessageFormatter.error(f"Invalid mode! Use {Colors.SKY_BLUE}/modes {Colors.RED}to see available modes")
            if is_dm and conv_id:
                await bot.highrise.send_message(conv_id, error_msg)
            elif is_dm:
                try:
                    await bot.highrise.send_message(user.id, error_msg)
                except:
                    await bot.send_message(error_msg, user.id)
            else:
                await bot.send_message(error_msg, user.id)
    
    @bot.command("stream")
    async def stream_cmd(bot, user, message):
        remaining = check_cd(user.id, "stream", 3)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return

        # Check if command is being called from a DM
        msg_context = message_context.get()
        conv_id = conversation_context.get()
        
        # Get current song info
        current = None
        if bot.music:
            try:
                current = await bot.music.get_current()
            except Exception as e:
                print(f"Error getting current song for stream: {e}")
        
        # Build the stream message with cache-busting parameter
        import time
        cache_buster = int(time.time())
        
        base_url = bot.get_public_base_url() if hasattr(bot, "get_public_base_url") else bot.music_server
        stream_msg = f"{base_url}/stream?t={cache_buster}"
        
        # If called from DM, reply to the same conversation
        if msg_context == "dm" and conv_id:
            await bot.highrise.send_message(conv_id, stream_msg)
        else:
            # Called from room - try to send DM to user
            try:
                # Try to send DM
                await bot.highrise.send_message(user.id, stream_msg)
                # Send public confirmation
                confirm_msg = f"{Colors.SKY_BLUE}📬 {Colors.PINK}@{user.username} {Colors.MINT}✅ Stream link sent to your DMs!"
                await bot.highrise.chat(confirm_msg)
            except Exception as e:
                print(f"Error sending stream DM: {e}")
                # Fallback to whisper if DM fails
                error_msg = f"{Colors.RED}❌ Couldn't send DM. Please message the bot directly and type 'stream'"
                await bot.send_message(error_msg, user.id)
    
    @bot.command("radiourl")
    async def radiourl_cmd(bot, user, message):
        """Generate a fresh radio URL with new session ID to force Highrise to reconnect all users"""
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(
                MessageFormatter.error("Admin-only command"),
                user.id
            )
            return
        
        import time
        session_id = int(time.time())
        
        base_url = bot.get_public_base_url() if hasattr(bot, "get_public_base_url") else bot.music_server
        new_url = f"{base_url}/stream?sid={session_id}"
        
        msg = (
            f"{Colors.PINK}📻 Fresh Radio URL\n\n"
            f"{Colors.CYAN}Copy this URL and set it as the room radio:\n\n"
            f"{Colors.SKY_BLUE}{new_url}\n\n"
            f"{Colors.LAVENDER}💡 This forces Highrise to reconnect all users\n"
            f"{Colors.YELLOW}⚠️ Update room settings with this new URL"
        )
        
        await bot.send_message(msg, user.id)
        print(f"📻 {user.username} generated new radio URL: {new_url}")
    
    @bot.command("lyrics")
    async def lyrics_cmd(bot, user, message):
        remaining = check_cd(user.id, "lyrics", 4)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return

        # Check if command is being called from a DM
        msg_context = message_context.get()
        conv_id = conversation_context.get()
        
        # Get current song info
        current = None
        if bot.music:
            try:
                current = await bot.music.get_current()
            except Exception as e:
                print(f"Error getting current song for lyrics: {e}")
        
        # Build the lyrics message
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
        
        # If called from DM, reply to the same conversation
        if msg_context == "dm" and conv_id:
            await bot.highrise.send_message(conv_id, lyrics_msg)
        else:
            # Called from room - try to send DM to user
            try:
                # Try to send DM
                await bot.highrise.send_message(user.id, lyrics_msg)
                # Send public confirmation
                confirm_msg = f"{Colors.SKY_BLUE}📬 {Colors.PINK}@{user.username} {Colors.MINT}✅ Lyrics link sent to your DMs!"
                await bot.highrise.chat(confirm_msg)
            except Exception as e:
                print(f"Error sending lyrics DM: {e}")
                # Fallback to whisper if DM fails
                error_msg = f"{Colors.RED}❌ Couldn't send DM. Please message the bot directly and type 'lyrics'"
                await bot.send_message(error_msg, user.id)
    
    @bot.command("music")
    async def music_help_cmd(bot, user, message):
        remaining = check_cd(user.id, "music_help", 4)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return

        # Check if free music mode is active
        if bot.is_music_free():
            # Show free music mode menu
            import time
            remaining_seconds = int(bot.free_music_until - time.time())
            remaining_minutes = remaining_seconds // 60
            
            free_msg_1 = (
                f"{Colors.PINK}🎉 FREE MUSIC MODE ACTIVE! 🎉\n\n"
                f"{Colors.GOLD}⏰ Time Remaining: {Colors.MINT}{remaining_minutes} minutes\n\n"
                f"{Colors.LAVENDER}ALL MUSIC COMMANDS ARE FREE:\n\n"
                f"{Colors.MINT}✅ /play <song> {Colors.LIGHT_GRAY}- Normally 10pts\n"
                f"{Colors.MINT}✅ /dedicate @user <song> {Colors.LIGHT_GRAY}- Normally 10pts\n"
                f"{Colors.MINT}✅ /clear {Colors.LIGHT_GRAY}- Normally 20pts/song"
            )
            
            free_msg_2 = (
                f"{Colors.CYAN}📋 Other Commands:\n\n"
                f"{Colors.LAVENDER}/skip {Colors.LIGHT_GRAY}or {Colors.LAVENDER}/s {Colors.LIGHT_GRAY}- Vote to skip (always free)\n"
                f"{Colors.LAVENDER}/next {Colors.LIGHT_GRAY}- View upcoming song in queue\n"
                f"{Colors.LAVENDER}/instskip {Colors.YELLOW}1000pts {Colors.LIGHT_GRAY}- Instant skip\n"
                f"{Colors.LAVENDER}/current {Colors.LIGHT_GRAY}- Current song info\n"
                f"{Colors.LAVENDER}/queue {Colors.LIGHT_GRAY}- View queue\n"
                f"{Colors.LAVENDER}/stream {Colors.LIGHT_GRAY}- Get stream link\n"
                f"{Colors.LAVENDER}/lyrics {Colors.LIGHT_GRAY}- Get lyrics link\n\n"
                f"{Colors.PINK}💝 Enjoy free music for everyone!"
            )
            
            await bot.send_message(free_msg_1, user.id)
            await asyncio.sleep(MessageChunker.DELAY_BETWEEN_CHUNKS)
            await bot.send_message(free_msg_2, user.id)
        else:
            # Show normal music help menu - whisper to user
            help1_chunks = MessageFormatter.split_message(BeautifulMessages.music_help_1(), limit=240)
            for chunk in help1_chunks:
                await bot.send_message(chunk, user.id)
                await asyncio.sleep(MessageChunker.DELAY_BETWEEN_CHUNKS)
            
            await asyncio.sleep(MessageChunker.DELAY_BETWEEN_CHUNKS)
            
            help2_chunks = MessageFormatter.split_message(BeautifulMessages.music_help_2(), limit=240)
            for chunk in help2_chunks:
                await bot.send_message(chunk, user.id)
                await asyncio.sleep(MessageChunker.DELAY_BETWEEN_CHUNKS)
    
    @bot.command("quality")
    async def quality_cmd(bot, user, message):
        # Owner-only command
        if not bot.admin.is_owner(user.username):
            await bot.send_message(
                MessageFormatter.error("This command is owner-only"),
                user.id
            )
            return
        
        # Parse bitrate from message (skip command name)
        parts = message.strip().split()[1:]  # Skip the command name (!quality)
        
        # No argument - show current quality
        if len(parts) == 0:
            result = await bot.music.get_quality()
            if result and result.get('status') == 'ok':
                bitrate = result.get('bitrate', 'Unknown')
                options = ', '.join(result.get('availableOptions', []))
                msg = (
                    f"{Colors.PURPLE}🎚️ Audio Quality Settings\n\n"
                    f"{Colors.PINK}Current: {Colors.MINT}{bitrate}\n"
                    f"{Colors.LAVENDER}Available: {Colors.SKY_BLUE}{options}\n\n"
                    f"{Colors.LIGHT_GRAY}Use: !quality <bitrate>"
                )
                await bot.send_message(msg, user.id)
            else:
                await bot.send_message(
                    MessageFormatter.error("Failed to get quality info"),
                    user.id
                )
            return
        
        # Change quality
        new_bitrate = parts[0]
        result = await bot.music.set_quality(new_bitrate)
        
        if result and result.get('status') == 'ok':
            old = result.get('oldBitrate', 'Unknown')
            new = result.get('newBitrate', 'Unknown')
            msg = (
                f"{Colors.MINT}✅ Quality Updated!\n\n"
                f"{Colors.LAVENDER}{old} {Colors.LIGHT_GRAY}→ {Colors.PINK}{new}\n\n"
                f"{Colors.SKY_BLUE}Will apply to next track"
            )
            await bot.send_message(msg, user.id)
            print(f"🎚️ {user.username} changed quality: {old} → {new}")
        else:
            error = result.get('error', 'Unknown error') if result else 'Failed to connect to server'
            await bot.send_message(
                MessageFormatter.error(f"Failed to change quality: {error}"),
                user.id
            )
    
    @bot.command("volume", "vol")
    async def volume_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(
                MessageFormatter.error("Admin-only command"),
                user.id
            )
            return
        
        parts = message.strip().split()[1:]
        
        if len(parts) == 0:
            result = await bot.music.get_volume()
            if result and result.get('status') == 'ok':
                current_vol = result.get('volume', 100)
                min_vol = result.get('min', 0)
                max_vol = result.get('max', 200)
                
                vol_bar = ""
                filled = int(current_vol / 10)
                vol_bar = "█" * min(filled, 20) + "░" * max(0, 20 - filled)
                
                msg = (
                    f"{Colors.PURPLE}🔊 Volume Settings\n\n"
                    f"{Colors.PINK}Current: {Colors.MINT}{current_vol}%\n"
                    f"{Colors.LAVENDER}Range: {Colors.SKY_BLUE}{min_vol}-{max_vol}%\n\n"
                    f"{Colors.CYAN}{vol_bar}\n\n"
                    f"{Colors.LIGHT_GRAY}Use: !volume <0-200>"
                )
                await bot.send_message(msg, user.id)
            else:
                await bot.send_message(
                    MessageFormatter.error("Failed to get volume info"),
                    user.id
                )
            return
        
        try:
            new_volume = int(parts[0])
        except ValueError:
            await bot.send_message(
                MessageFormatter.error("Volume must be a number (0-200)"),
                user.id
            )
            return
        
        result = await bot.music.set_volume(new_volume)
        
        if result and result.get('status') == 'ok':
            old_vol = result.get('oldVolume', 100)
            new_vol = result.get('newVolume', new_volume)
            msg = (
                f"{Colors.MINT}✅ Volume Updated!\n\n"
                f"{Colors.LAVENDER}{old_vol}% {Colors.LIGHT_GRAY}→ {Colors.PINK}{new_vol}%\n\n"
                f"{Colors.SKY_BLUE}Will apply to next track"
            )
            await bot.highrise.chat(msg)
            print(f"🔊 {user.username} changed volume: {old_vol}% → {new_vol}%")
        else:
            error = result.get('error', 'Unknown error') if result else 'Failed to connect to server'
            await bot.send_message(
                MessageFormatter.error(f"Failed to change volume: {error}"),
                user.id
            )
    
    @bot.command("announce+")
    async def announce_on_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(
                MessageFormatter.error("Admin-only command"),
                user.id
            )
            return
        
        result = await bot.music.set_announcements(True)
        
        if result and result.get('status') == 'ok':
            msg = (
                f"{Colors.MINT}✅ Announcements Enabled!\n\n"
                f"{Colors.LAVENDER}🎙️ TTS announcements will now play\n"
                f"{Colors.SKY_BLUE}before each song with song info,\n"
                f"{Colors.SKY_BLUE}requester, and dedication info"
            )
            await bot.highrise.chat(msg)
            print(f"🎙️ {user.username} enabled announcements")
        else:
            error = result.get('error', 'Unknown error') if result else 'Failed to connect to server'
            await bot.send_message(
                MessageFormatter.error(f"Failed to enable announcements: {error}"),
                user.id
            )
    
    @bot.command("announce-")
    async def announce_off_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(
                MessageFormatter.error("Admin-only command"),
                user.id
            )
            return
        
        result = await bot.music.set_announcements(False)
        
        if result and result.get('status') == 'ok':
            msg = (
                f"{Colors.ORANGE}🔇 Announcements Disabled\n\n"
                f"{Colors.LAVENDER}Songs will play without\n"
                f"{Colors.SKY_BLUE}TTS announcements"
            )
            await bot.highrise.chat(msg)
            print(f"🎙️ {user.username} disabled announcements")
        else:
            error = result.get('error', 'Unknown error') if result else 'Failed to connect to server'
            await bot.send_message(
                MessageFormatter.error(f"Failed to disable announcements: {error}"),
                user.id
            )
    
    @bot.command("announce")
    async def announce_status_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(
                MessageFormatter.error("Admin-only command"),
                user.id
            )
            return
        
        result = await bot.music.get_announcements()
        
        if result and result.get('status') == 'ok':
            enabled = result.get('enabled', False)
            voice = result.get('voiceName', 'English (US)')
            word_limit = result.get('wordLimit', 10)
            status = f"{Colors.MINT}✅ On" if enabled else f"{Colors.ORANGE}🔇 Off"
            msg = (
                f"{Colors.PURPLE}🎙️ Announcement Settings\n\n"
                f"{Colors.PINK}Status: {status}\n"
                f"{Colors.PINK}Voice: {Colors.CYAN}{voice}\n"
                f"{Colors.PINK}Word Limit: {Colors.CYAN}{word_limit}\n\n"
                f"{Colors.LAVENDER}!announce+ {Colors.SKY_BLUE}• Enable\n"
                f"{Colors.LAVENDER}!announce- {Colors.SKY_BLUE}• Disable\n"
                f"{Colors.LAVENDER}!voice <code> {Colors.SKY_BLUE}• Change\n"
                f"{Colors.LAVENDER}!ttswords <n> {Colors.SKY_BLUE}• Word limit"
            )
            await bot.send_message(msg, user.id)
        else:
            await bot.send_message(
                MessageFormatter.error("Failed to get announcement settings"),
                user.id
            )
    
    @bot.command("voice")
    async def voice_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(
                MessageFormatter.error("Admin-only command"),
                user.id
            )
            return
        
        voice_parts = message.split(maxsplit=1)
        voice_code = voice_parts[1].strip().lower() if len(voice_parts) > 1 else ""
        
        if not voice_code:
            result = await bot.music.get_announcements()
            voices = result.get('availableVoices', {}) if result else {}
            voice_list = "\n".join([f"{Colors.CYAN}{code}: {Colors.LAVENDER}{name}" for code, name in voices.items()])
            msg = (
                f"{Colors.PURPLE}🎙️ Available Voices\n\n"
                f"{voice_list}\n\n"
                f"{Colors.YELLOW}Usage: {Colors.SKY_BLUE}!voice en-uk"
            )
            await bot.send_message(msg, user.id)
            return
        
        result = await bot.music.set_announcements(voice=voice_code)
        
        if result and result.get('status') == 'ok':
            voice_name = result.get('voiceName', voice_code)
            msg = (
                f"{Colors.MINT}✅ Voice Changed!\n\n"
                f"{Colors.PINK}New Voice: {Colors.CYAN}{voice_name}"
            )
            await bot.highrise.chat(msg)
            print(f"🎙️ {user.username} changed TTS voice to {voice_name}")
        else:
            error = result.get('error', 'Unknown error') if result else 'Failed to connect to server'
            await bot.send_message(
                MessageFormatter.error(f"Failed to change voice: {error}"),
                user.id
            )
    
    @bot.command("ttswords")
    async def ttswords_cmd(bot, user, message):
        """Set the word limit for TTS song title announcements"""
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(
                MessageFormatter.error("Admin-only command"),
                user.id
            )
            return
        
        ttswords_parts = message.split(maxsplit=1)
        args = ttswords_parts[1].strip() if len(ttswords_parts) > 1 else ""
        
        if not args:
            result = await bot.music.get_announcements()
            if result and result.get('status') == 'ok':
                word_limit = result.get('wordLimit', 10)
                msg = (
                    f"{Colors.PURPLE}🎙️ TTS Word Limit\n\n"
                    f"{Colors.PINK}Current: {Colors.CYAN}{word_limit} words\n\n"
                    f"{Colors.LAVENDER}Usage: {Colors.SKY_BLUE}!ttswords 8\n"
                    f"{Colors.LAVENDER}Range: {Colors.SKY_BLUE}3-50 words"
                )
                await bot.send_message(msg, user.id)
            else:
                await bot.send_message(
                    MessageFormatter.error("Failed to get settings"),
                    user.id
                )
            return
        
        try:
            word_limit = int(args)
        except ValueError:
            await bot.send_message(
                MessageFormatter.error("Please enter a number (3-50)"),
                user.id
            )
            return
        
        result = await bot.music.set_announcements(word_limit=word_limit)
        
        if result and result.get('status') == 'ok':
            new_limit = result.get('wordLimit', word_limit)
            msg = (
                f"{Colors.MINT}✅ Word Limit Updated!\n\n"
                f"{Colors.PINK}TTS Title Limit: {Colors.CYAN}{new_limit} words"
            )
            await bot.highrise.chat(msg)
            print(f"🎙️ {user.username} set TTS word limit to {new_limit}")
        else:
            error = result.get('error', 'Unknown error') if result else 'Failed to connect to server'
            await bot.send_message(
                MessageFormatter.error(f"Failed to set word limit: {error}"),
                user.id
            )
    
    
