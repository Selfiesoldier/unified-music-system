"""
Idle Presence Loop - Keeps the bot avatar visible in the room.

The Highrise server puts bot avatars into hibernation when a room is empty
for an extended period. Playing an idle emote every ~60 seconds signals to
Highrise that the avatar is still active, preventing it from disappearing.

This mirrors the behaviour of kmrbot's idle_emotes loop.
"""
import asyncio
import random
from core.error_handler import safe_call
from core.logger import write_system_log

# Music-themed dance emotes - keeps the bot grooving to the beat 🎵
# Uses a mix of free and premium dance emotes from Highrise
IDLE_EMOTES = [
    "idle-dance-swinging",      # Boogie Swing
    "idle-dance-headbobbing",   # Feel The Beat
    "dance-tiktok8",            # Savage Dance (free)
    "dance-tiktok2",            # Don't Start Now (free)
    "dance-tiktok9",            # TikTok Dance 9 (free)
    "dance-blackpink",          # K-Pop Dance (free)
    "dance-macarena",           # Macarena (free)
    "dance-russian",            # Russian Dance (free)
    "dance-pennywise",          # Penny's Dance (free)
    "dance-shoppingcart",       # Let's Go Shopping (free)
    "dance-zombie",             # Dance Zombie (free)
    "dance-pinguin",            # Penguin dance (free)
    "dance-creepypuppet",       # Creepy puppet (free)
    "dance-jinglebell",         # Jinglebell (free)
    "idle-loop-tapdance",       # Tap Loop
    "dance-breakdance",         # Breakdance
    "dance-floss",              # Floss
    "dance-metal",              # Rock Out
    "dance-handsup",            # Hands in the Air
]


async def idle_presence_loop(bot):
    """Periodically play an idle emote to keep the bot avatar visible."""
    print("🎭 Idle presence loop started, waiting 60 seconds...")
    write_system_log("Idle presence loop started")
    await asyncio.sleep(60)
    print("✅ Idle presence loop active!")

    while True:
        await safe_call(lambda: _idle_emote_tick(bot))
        # Fire every 55 seconds (safely under 60s to avoid Highrise hibernation)
        await asyncio.sleep(55)


async def _idle_emote_tick(bot):
    """Play a single idle emote to signal avatar activity."""
    try:
        if not bot.bot_user_id:
            return

        emote_id = random.choice(IDLE_EMOTES)
        await bot.highrise.send_emote(emote_id, bot.bot_user_id)

    except Exception as e:
        err = str(e).lower()
        # Suppress noisy connection-closing errors silently
        if "closing" not in err and "connection" not in err and "transport" not in err:
            print(f"⚠️ Idle presence emote failed: {e}")
