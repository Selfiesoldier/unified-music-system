import asyncio
from core.error_handler import safe_call
from core.logger import write_system_log
from core.color_formatter import Colors


async def autoplay_loop(bot):
    print("🔄 Auto-play loop started, waiting 10 seconds...")
    write_system_log(f"Auto-play loop started (enabled={bot.auto_play_enabled})")
    await asyncio.sleep(10)
    print(f"✅ Auto-play loop active! (enabled={bot.auto_play_enabled})")
    
    # Lock to prevent multiple simultaneous autoplay triggers
    autoplay_lock = asyncio.Lock()
    
    while True:
        async with autoplay_lock:
            await safe_call(lambda: _auto_play_iteration(bot))
        await asyncio.sleep(10)


async def _auto_play_iteration(bot):
    import time
    from systems.music import QueueManager
    
    if not bot.auto_play_enabled:
        return True
    
    # Check timestamp guard - prevent duplicate requests within 15 seconds
    current_time = time.time()
    time_since_last_request = current_time - bot.last_autoplay_request_time
    
    if time_since_last_request < 20:
        # Too soon since last autoplay request, skip this iteration
        return True
    
    result = await bot.music.get_current()
    if result:
        is_playing = result.get('isPlaying', False)
        queue_length = result.get('queueLength', 0)
        is_transitioning = result.get('isTransitioning', False) or result.get('isPreparing', False)
        
        # Don't autoplay if transitioning between songs or if already playing/queued
        if not is_playing and queue_length == 0 and not is_transitioning:
            # Update timestamp BEFORE making the request to prevent race conditions
            bot.last_autoplay_request_time = current_time
            
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
                            continue  # Try another song
                
                song = candidate_song
                break
            
            if not song:
                print(f"⚠️ Could not find song within duration limit after {max_attempts} attempts")
                return True
            
            print(f"🤖 Auto-playing ({current_mode}): {song}")
            
            play_result = await bot.music.play_song(song, is_autoplay=True)
            if play_result and play_result.get('currentMetadata'):
                metadata = play_result['currentMetadata']
                msg = (
                    f"{Colors.CYAN}🤖 Auto-playing {Colors.LAVENDER}({current_mode})\n\n"
                    f"{Colors.PURPLE}🎵 {Colors.PINK}{metadata['title']}\n"
                    f"{Colors.LAVENDER}👤 {metadata['artist']}"
                )
                await bot.highrise.chat(msg)
    
    return True
