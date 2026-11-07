import asyncio
from core.error_handler import safe_call
from core.logger import write_system_log
from core.color_formatter import Colors


async def song_monitor_loop(bot):
    print("🎵 Song change monitor started, waiting 15 seconds...")
    write_system_log("Song change monitor started")
    await asyncio.sleep(15)
    print("✅ Song change monitor active!")
    
    while True:
        await safe_call(lambda: _song_change_iteration(bot))
        await asyncio.sleep(10)


async def _song_change_iteration(bot):
    try:
        if not bot.music:
            return True
        
        current = await bot.music.get_current()
        if current and current.get('isPlaying'):
            metadata = current.get('metadata')
            if metadata:
                # Handle nested metadata structures (some responses wrap as {metadata: {...}})
                if 'metadata' in metadata and isinstance(metadata['metadata'], dict):
                    metadata = metadata['metadata']
                
                # Handle metadata safely with defaults
                title = metadata.get('title', 'Unknown Track')
                artist = metadata.get('artist', 'Unknown Artist')
                
                # Include attribution in song_id so the same song with different attribution is announced
                dedicated_to = metadata.get('dedicatedTo')
                dedicated_by = metadata.get('dedicatedBy')
                source_playlist = metadata.get('sourcePlaylist')
                owner_username = metadata.get('ownerUsername')
                requester_username = metadata.get('requesterUsername')
                
                attribution_key = ""
                if dedicated_to and dedicated_by:
                    attribution_key = f"_dedicated_{dedicated_to}_{dedicated_by}"
                elif source_playlist and owner_username:
                    attribution_key = f"_playlist_{source_playlist}_{owner_username}"
                elif requester_username:
                    attribution_key = f"_requested_{requester_username}"
                
                song_id = f"{title}_{artist}{attribution_key}"
                
                # Announce if it's a new song OR if it's the first song (last_announced_song_id is None)
                if song_id != bot.last_announced_song_id:
                    # Only call on_song_finished if there was a previous song
                    if bot.last_announced_song_id is not None:
                        await bot.playlist_manager.on_song_finished(metadata, bot.music)
                    
                    is_autoplay = current.get('isAutoplay', False)
                    
                    if not is_autoplay:
                        # Truncate long titles to avoid "Message too long" error
                        max_title_length = 60
                        display_title = title if len(title) <= max_title_length else title[:max_title_length] + "..."
                        duration = metadata.get('duration', 'Unknown')
                        
                        # Build message with attribution at top
                        msg = ""
                        
                        if dedicated_to and dedicated_by:
                            msg += f"{Colors.PINK}💝 Dedicated to {Colors.GOLD}@{dedicated_to} {Colors.CYAN}by {Colors.PINK}@{dedicated_by}\n"
                        elif source_playlist and owner_username:
                            msg += f"{Colors.CYAN}📋 From playlist of {Colors.PINK}@{owner_username}\n"
                        elif requester_username:
                            msg += f"{Colors.CYAN}🎤 Requested by {Colors.PINK}@{requester_username}\n"
                        
                        msg += f"{Colors.PURPLE}♫ Now Playing\n"
                        msg += f"{Colors.PINK}🎵 {display_title}\n"
                        msg += f"{Colors.LAVENDER}👤 {artist} {Colors.SKY_BLUE}⏱️ {duration}"
                        
                        await bot.highrise.chat(msg)
                        
                        # Log with attribution info
                        log_msg = f"🎵 Announced queued song: {title}"
                        if dedicated_to and dedicated_by:
                            log_msg += f" (dedicated to @{dedicated_to} by @{dedicated_by})"
                        elif owner_username:
                            log_msg += f" (from @{owner_username}'s playlist)"
                        elif requester_username:
                            log_msg += f" (requested by @{requester_username})"
                        print(log_msg)
                
                bot.last_announced_song_id = song_id
    except Exception:
        pass
    
    return True
