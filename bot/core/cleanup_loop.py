import asyncio
import gc
from core.error_handler import safe_call
from core.logger import write_system_log


async def cooldown_cleanup_loop(bot):
    print("🧹 Cooldown cleanup & memory maintenance loop started, waiting 60 seconds...")
    write_system_log("Cooldown cleanup loop started")
    await asyncio.sleep(60)
    print("✅ Cooldown cleanup & memory maintenance loop active!")
    
    while True:
        await _cooldown_cleanup_iteration(bot)
        await asyncio.sleep(300)


async def _cooldown_cleanup_iteration(bot=None):
    try:
        from core.cooldowns import cleanup_expired
        cleaned = cleanup_expired()
        if cleaned > 0:
            print(f"🧹 Cleaned {cleaned} expired cooldown entries")
            write_system_log(f"Cleaned {cleaned} expired cooldown entries")
        
        # Flush pending history changes if any
        if bot and hasattr(bot, 'history') and hasattr(bot.history, 'flush'):
            bot.history.flush()
            
        # Collect unreferenced garbage and release Python memory
        collected = gc.collect()
        if collected > 0:
            write_system_log(f"Memory maintenance: GC collected {collected} objects")
            
        return True
    except Exception as e:
        print(f"⚠️ Cooldown cleanup error: {e}")
        write_system_log(f"Cooldown cleanup error: {e}")
        return False
