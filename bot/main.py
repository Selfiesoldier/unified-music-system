"""
Main Bot File - Modular Music Bot for Highrise
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Fix working directory for external hosts (OriHost, etc.)
# This ensures relative paths work correctly no matter where the bot is started from
PROJECT_ROOT = Path(__file__).resolve().parent
os.chdir(PROJECT_ROOT)
sys.path.insert(0, str(PROJECT_ROOT))
print(f"📂 Working directory: {PROJECT_ROOT}")

load_dotenv(dotenv_path=PROJECT_ROOT / ".env", override=True)

from highrise import BaseBot, Position, AnchorPosition
from highrise.__main__ import BotDefinition, main
import asyncio
import signal
import time
import random
# Import all managers
from systems.music import MusicManager, QueueManager
from systems.economy import EconomyManager
from systems.admin import AdminManager, FreeMusicManager
from systems.outfits import InventoryManager, AvatarOutfitManager
from systems.shop import ShopManager
from systems.position import PositionManager
from systems.modes import ModeManager, RecentSongsManager, KashmiriSongsManager
from systems.admin.history_manager import HistoryManager
from systems.personalization import PlaylistManager
from systems.systeminfo import SystemInfoManager

# Import command loader
from loader import load_all_commands

# Import event handlers
from handlers.chat_handler import handle_chat
from handlers.tip_handler import handle_tip
from handlers.join_handler import handle_user_join
from handlers.message_handler import handle_message

# Import centralized error handler and logger
from core.error_handler import safe_call
from core.logger import write_system_log

# Import new connection manager
from core.connection_manager import ConnectionManager, BotRestartManager, RestartRequestedException

# Import color formatter
from core.color_formatter import Colors, MessageFormatter

# Import message utilities
from core.message_utils import MessageChunker
from core.chunking_proxy import ChunkingHighriseProxy

# Import context variables
from core.context import message_context, conversation_context

# Import Background Task Manager
from core.background_manager import BackgroundManager

# Import bot instance singleton
from core.bot_instance import set_bot_instance

# Import background loop functions
from systems.music.autoplay_loop import autoplay_loop
from systems.music.song_monitor_loop import song_monitor_loop
from systems.systeminfo.system_monitor_loop import system_health_monitor_loop
from systems.systeminfo.idle_presence_loop import idle_presence_loop
from systems.position.anchor_guardian_loop import anchor_guardian_loop
from core.cleanup_loop import cooldown_cleanup_loop
from systems.api.ipc_server import start_ipc_server


class MusicBot(BaseBot):
    """Modular Music Bot - Clean Architecture"""
    
    def get_public_base_url(self):
        """Returns the public base URL (Cloudflare tunnel) for Highrise users and stream commands"""
        pub_file = PROJECT_ROOT / "public_url.txt"
        if pub_file.exists():
            try:
                url = pub_file.read_text(encoding="utf-8").strip()
                if url and "trycloudflare.com" in url:
                    return url.rstrip('/')
            except Exception:
                pass

        for env_key in ["PUBLIC_STREAM_URL", "PUBLIC_URL"]:
            val = os.environ.get(env_key, "").strip().rstrip("/")
            if val and "localhost" not in val and "127.0.0.1" not in val:
                if not val.startswith("http://") and not val.startswith("https://"):
                    val = f"https://{val}"
                return val

        return self.music_server.rstrip('/')

    def get_public_stream_url(self):
        """Returns the full public stream URL (e.g. https://...trycloudflare.com/stream)"""
        return f"{self.get_public_base_url()}/stream"

    def __init__(self):
        super().__init__()
        raw_server = (
            os.environ.get("MUSIC_API_URL")
            or os.environ.get("MUSIC_SERVER_URL")
            or os.environ.get("PUBLIC_URL")
            or "http://localhost:5000"
        ).strip().rstrip("/")
        if raw_server and not raw_server.startswith("http://") and not raw_server.startswith("https://"):
            raw_server = f"http://{raw_server}"
        self.music_server = raw_server
        print(f"🎵 Music server URL: {self.music_server}")
        
        # Initialize all managers
        print("🔧 Initializing systems...")
        self.music = MusicManager(self.music_server)
        self.admin = AdminManager()
        self.history = HistoryManager()
        self.economy = EconomyManager()
        self.playlist_manager = PlaylistManager()
        self.position_manager = PositionManager()
        self.inventory_manager = InventoryManager()
        self.outfit_manager = None  # Will be initialized after inventory loads
        self.shop = ShopManager()
        self.mode_manager = ModeManager()
        self.recent_songs_manager = RecentSongsManager()
        self.kashmiri_songs_manager = KashmiriSongsManager()
        self.systeminfo = SystemInfoManager()
        
        # Bot state
        self.auto_play_enabled = True
        self.free_music_until = None
        self.bot_user_id = None
        self.max_song_duration = 600  # Default: 10 minutes (600 seconds), 0 = no limit
        
        # Background tasks (legacy references for free_music_timer)
        self.free_music_task = None
        
        # Track current song for change detection
        self.last_announced_song_id = None
        
        # Autoplay guard - prevent duplicate autoplay requests
        self.last_autoplay_request_time = 0
        
        # Connection manager
        self.connection_manager = ConnectionManager(self)
        
        # Initialize Background Task Manager
        print("🎛️ Initializing Background Task Manager...")
        self.background_manager = BackgroundManager(self)
        
        # Register background tasks
        self.background_manager.register_task("autoplay", lambda: autoplay_loop(self))
        self.background_manager.register_task("song_monitor", lambda: song_monitor_loop(self))
        self.background_manager.register_task("cooldown_cleanup", lambda: cooldown_cleanup_loop(self))
        self.background_manager.register_task("health_monitor", lambda: system_health_monitor_loop(self))
        self.background_manager.register_task("idle_presence", lambda: idle_presence_loop(self))
        self.background_manager.register_task("anchor_guardian", lambda: anchor_guardian_loop(self))
        
        # Load commands from all systems
        print("📋 Loading command modules...")
        load_all_commands(self)
        print("✅ Bot initialization complete!")
    
    async def send_message(self, message: str, user_id = None, max_length: int = 240):
        """
        Send a message with automatic chunking via ChunkingHighriseProxy.
        
        Context-aware messaging:
        - If called from DM context: sends as DM
        - If user_id provided: sends as whisper
        - Otherwise: sends as public chat
        
        Args:
            message: The message to send
            user_id: If provided, sends as whisper. If None, sends as chat (default: None)
            max_length: Maximum characters per chunk (ignored - proxy handles this)
        
        Returns:
            None (proxy handles chunking internally)
        """
        # Check if we're in a DM context
        current_context = message_context.get()
        if current_context == "dm":
            # Get conversation_id from context
            conversation_id = conversation_context.get()
            if conversation_id:
                # Delegate to proxy - it will handle chunking automatically
                await self.highrise.send_message(conversation_id, message)
                return
        
        # Default behavior: whisper or chat
        # Delegate to proxy - it will handle chunking automatically
        if user_id:
            await self.highrise.send_whisper(user_id, message)
        else:
            await self.highrise.chat(message)

    async def ensure_bot_presence(self, force: bool = False):
        """Ensure bot avatar entity is physically spawned and visible in the room scene"""
        if not self.bot_user_id:
            return
        
        now = time.time()
        if not force and hasattr(self, '_last_presence_time') and (now - self._last_presence_time < 8):
            return
        self._last_presence_time = now
        
        if self.position_manager and self.position_manager.has_position():
            try:
                await self.position_manager.ensure_home_position(self)
                # Trigger an emote to force the Highrise 3D room engine to render the avatar
                try:
                    await self.highrise.send_emote("idle-dance-headbobbing", self.bot_user_id)
                except Exception:
                    pass
            except Exception as e:
                print(f"⚠️ Failed to maintain bot position presence: {e}")

    async def on_start(self, session_metadata):
        """Called when bot connects to room"""
        print(f"✅ Music Bot connected!")
        print(f"Bot ID: {session_metadata.user_id}")
        self.bot_user_id = session_metadata.user_id
        
        # Wrap Highrise client with chunking proxy for automatic message chunking
        # Store real client for reference, replace self.highrise with proxy
        self._core_highrise = self.highrise
        self.highrise = ChunkingHighriseProxy(self._core_highrise)
        print("✅ Universal message chunking enabled via proxy - ALL messages will be auto-chunked")
        
        # Log system event
        write_system_log(f"Bot connected to Highrise | Bot ID: {session_metadata.user_id}")
        
        # Restore free music state if it exists
        restored_time = FreeMusicManager.load_state()
        if restored_time:
            self.free_music_until = restored_time
            remaining_minutes = int((restored_time - time.time()) / 60)
            write_system_log(f"Free music mode restored: {remaining_minutes} minutes remaining")
        
        # Send super attractive animated welcome message
        welcome_msg = (
            f"{Colors.PINK}✨ ═══════════════════════ ✨\n"
            f"{Colors.GOLD}🎵 MUSIC BOT IS LIVE! 🎵\n"
            f"{Colors.PINK}✨ ═══════════════════════ ✨\n\n"
            f"{Colors.PURPLE}♫ {Colors.PINK}FREE Music{Colors.PURPLE} | {Colors.MINT}24/7 Vibes{Colors.PURPLE} | {Colors.CYAN}Non-Stop Beats\n\n"
            f"{Colors.LAVENDER}🎧 Request ANY song with:\n"
            f"{Colors.SKY_BLUE}/play <song name>\n\n"
            f"{Colors.GOLD}💡 {Colors.AMBER}Type {Colors.YELLOW}/music {Colors.AMBER}for all commands\n"
            f"{Colors.MINT}💬 DM me 'help' for the full guide!\n\n"
            f"{Colors.RAINBOW_1}Let's vibe together! 🎉"
        )
        await self.send_message(welcome_msg)
        
        # Load inventory
        self.inventory_manager.load_inventory()
        try:
            print("📦 Fetching bot inventory...")
            success = await asyncio.wait_for(self.inventory_manager.fetch_inventory(self.highrise), timeout=6.0)
            if success:
                item_count = self.inventory_manager.get_item_count()
                print(f"✅ Inventory loaded: {item_count} items")
            else:
                print("⚠️ Could not fetch inventory")
        except Exception as e:
            print(f"⚠️ Inventory fetch error: {e}")
        
        # Initialize outfit manager with inventory reference
        if not self.outfit_manager:
            self.outfit_manager = AvatarOutfitManager(self.inventory_manager)
            print("✅ Outfit manager initialized")
            
            # Sync outfit state from Highrise
            try:
                await asyncio.wait_for(self.outfit_manager.sync_from_highrise(self.highrise), timeout=6.0)
            except Exception as e:
                print(f"⚠️ Failed to sync outfit from Highrise: {e}")
        
        # Move to default position / anchor with resilient startup docking
        if self.position_manager.has_position():
            async def _startup_dock():
                await asyncio.sleep(2.5)
                try:
                    await self.position_manager.ensure_home_position(self)
                    default_pos = self.position_manager.get_position()
                    if isinstance(default_pos, AnchorPosition):
                        print(f"⚓ Bot anchored to furniture: {default_pos.entity_id} #{default_pos.anchor_ix}")
                    elif isinstance(default_pos, Position):
                        print(f"🚶 Bot moved to default position: ({default_pos.x}, {default_pos.y}, {default_pos.z})")
                except Exception as e:
                    print(f"⚠️ Failed to move to default position: {e}")
            asyncio.create_task(_startup_dock())
        
        # Try to restore saved queue from music server
        try:
            restore_result = await self.music.restore_queue()
            if restore_result and restore_result.get('status') == 'restored':
                queue_length = restore_result.get('queueLength', 0)
                print(f"✅ Restored {queue_length} songs from saved queue")
                write_system_log(f"Queue restored: {queue_length} songs")
                if queue_length > 0:
                    await self.highrise.chat(f"{Colors.CYAN}🔄 Restored {Colors.PINK}{queue_length} songs {Colors.CYAN}from previous session!")
            elif restore_result and restore_result.get('status') == 'already_playing':
                print(f"✅ Music already playing: {restore_result.get('nowPlaying')}")
        except Exception as e:
            print(f"⚠️ Failed to restore queue: {e}")
        
        # Start connection manager first
        await self.connection_manager.start()
        
        # Start all background tasks via Background Task Manager
        print("\n🚀 Starting background tasks via BTM...")
        await self.background_manager.start_task("autoplay")
        await self.background_manager.start_task("song_monitor")
        await self.background_manager.start_task("cooldown_cleanup")
        await self.background_manager.start_task("health_monitor")
        await self.background_manager.start_task("idle_presence")
        await self.background_manager.start_task("anchor_guardian")
        
        # Start BTM monitor
        await self.background_manager.start_monitor()
        
        # Log system event
        write_system_log("Background tasks started via BTM: Connection Manager, Autoplay, Song Monitor, Cooldown Cleanup, Health Monitor, Idle Presence, Anchor Guardian")
    
    async def broadcast_event(self, data: dict):
        try:
            if hasattr(self, 'music') and self.music:
                await self.music.broadcast_event(data)
            else:
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    await session.post("http://127.0.0.1:5000/api/broadcast", json=data, timeout=aiohttp.ClientTimeout(total=2))
        except:
            pass

    async def on_chat(self, user, message):
        """Handle chat messages"""
        self.history.record_message(user.id, user.username)
        
        await self.broadcast_event({
            "type": "chat",
            "user": user.username,
            "message": message
        })
        
        await handle_chat(self, user, message)
    
    async def process_command(self, user, message):
        """Process a command programmatically (e.g. from IPC/dashboard)"""
        await handle_chat(self, user, message)
    
    async def on_tip(self, sender, receiver, tip):
        """Handle tip events"""
        await handle_tip(self, sender, receiver, tip)
    
    async def on_user_join(self, user, position):
        """Handle user join events"""
        # Record user history
        self.history.record_join(user.id, user.username)
        await handle_user_join(self, user, position)
    
    async def on_message(self, user_id, conversation_id, is_new_conversation):
        """Handle incoming DMs"""
        await handle_message(self, user_id, conversation_id, is_new_conversation)
    
    
    def is_music_free(self):
        """Check if music is currently free"""
        if self.free_music_until is None:
            return False
        import time
        return time.time() < self.free_music_until
    
    async def start_free_music_mode(self, minutes):
        """Start free music mode for specified minutes"""
        self.free_music_until = time.time() + (minutes * 60)
        
        # Save state to disk
        FreeMusicManager.save_state(self.free_music_until)
        write_system_log(f"Free music mode started: {minutes} minutes")
        
        if self.free_music_task:
            self.free_music_task.cancel()
        self.free_music_task = asyncio.create_task(self.free_music_timer(minutes))
    
    async def free_music_timer(self, minutes):
        """Track and announce when free music ends"""
        try:
            await asyncio.sleep(minutes * 60)
            self.free_music_until = None
            
            # Clear saved state
            FreeMusicManager.clear_state()
            write_system_log("Free music mode ended")
            
            await self.highrise.chat(
                f"{Colors.ORANGE}⏰ FREE MUSIC MODE has ended!\n"
                f"{Colors.YELLOW}💰 Music commands now require points again.\n"
                f"{Colors.SKY_BLUE}💡 Tip the bot gold to get points!"
            )
        except asyncio.CancelledError:
            pass


# Watchdog - Auto-reconnect functionality
shutdown_flag = False

def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully"""
    global shutdown_flag
    print("\n🛑 Shutdown signal received (Ctrl+C)")
    print("⏹️ Stopping bot...")
    shutdown_flag = True
    sys.exit(0)

def calculate_reconnect_delay(attempts: int) -> float:
    """
    Calculate reconnection delay with fast empty-room recovery.
    Keeps delay fast (1.5s - 5s max) with randomized jitter so that when
    a human enters the room, the bot returns within seconds instead of
    being trapped in a 60-second backoff sleep.
    """
    if attempts <= 0:
        return round(1.5 + random.uniform(0.1, 0.8), 2)
    # Fast reconnect: 3s to 5s max with jitter to recover quickly as soon as a user enters
    base_delay = min(3.0 + (attempts * 0.5), 5.0)
    jitter = random.uniform(0.1, 0.9)
    return round(base_delay + jitter, 2)

async def run_bot_with_watchdog():
    """
    Run bot with ultra-robust CloseHandler auto-reconnect system
    
    Features:
    - CloseHandler randomized exponential backoff with jitter (1.5s -> 5s -> 10s -> 20s -> 40s -> 60s max)
    - Never gives up reconnecting unless Ctrl+C
    - Resets backoff after sustained successful connection (>= 60s)
    - Dedicated Bot API Gateway Room Pinning
    - 15-second raw KeepaliveRequest packet heartbeat
    - Automatically reinitializes ConnectionManager on every connection
    """
    global shutdown_flag
    
    room_id = os.getenv("ROOM_ID", "")
    api_token = os.getenv("API_TOKEN", "")
    
    if not room_id or not api_token:
        print("❌ ERROR: ROOM_ID and API_TOKEN must be set in environment variables")
        write_system_log("ERROR: ROOM_ID or API_TOKEN not set - bot cannot start")
        return
    
    gateway_url = os.getenv("HR_BOTAPI_URL", "wss://highrise.game/web/botapi")
    masked_token = f"{api_token[:6]}...{api_token[-4:]}" if len(api_token) > 10 else "***"
    
    print("==================================================")
    print("🌐 HIGHRISE GATEWAY NETWORKING INITIALIZED")
    print(f"📌 Gateway URL: {gateway_url}")
    print(f"📌 Room Pinning: Active (Room ID: {room_id})")
    print(f"📌 Authenticated Bot Token: {masked_token}")
    print("==================================================")
    write_system_log(f"Watchdog starting: Gateway={gateway_url} | Room={room_id}")
    
    reconnect_count = 0
    consecutive_failures = 0
    
    while not shutdown_flag:
        try:
            print(f"\n{'='*60}")
            if reconnect_count == 0:
                print("🚀 STARTING MUSIC BOT")
                print(f"📌 Room Pinning: Dedicated TCP stream to {gateway_url}")
                print("🛡️ 24/7 Networking Active (Raw Keepalive + CloseHandler Reconnect)")
                print("💪 Bot will NEVER give up unless you press Ctrl+C")
            else:
                print(f"🔄 RECONNECTION ATTEMPT #{reconnect_count} (Consecutive: {consecutive_failures})")
                print(f"📌 Re-establishing pinned gateway stream for room {room_id}")
            print(f"{'='*60}\n")
            
            # Create fresh bot instance for each connection
            # Each bot gets its own ConnectionManager that will be started in on_start
            bot = MusicBot()
            set_bot_instance(bot)
            definitions = [
                BotDefinition(
                    bot=bot,
                    room_id=room_id,
                    api_token=api_token
                )
            ]
            
            start_time = time.time()
            
            # Create tasks for session runner
            # Race main() against connection_manager.wait_for_restart()
            # This allows restart exceptions to properly propagate to the watchdog
            main_task = asyncio.create_task(main(definitions))
            restart_task = asyncio.create_task(bot.connection_manager.wait_for_restart())
            
            # Start IPC Server independently so its socket lifecycle never crashes the bot session
            ipc_task = asyncio.create_task(start_ipc_server())
            
            # Wait for either bot session or explicit restart request to complete
            done, pending = await asyncio.wait(
                {main_task, restart_task},
                return_when=asyncio.FIRST_COMPLETED
            )
            
            # Cancel ipc and any remaining tasks
            ipc_task.cancel()
            for task in pending:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
            
            # Check if restart was triggered
            if restart_task in done:
                # Restart was requested - get the exception
                try:
                    restart_task.result()  # This will re-raise RestartRequestedException
                except RestartRequestedException as e:
                    # Re-raise to be caught by the except block below
                    raise
            else:
                # main() completed (bot disconnected or room entry denied)
                session_duration = time.time() - start_time
                reconnect_count += 1
                
                # If connection lasted >= 60s, it was a stable session; reset consecutive counter
                if session_duration >= 60:
                    consecutive_failures = 0
                else:
                    consecutive_failures += 1
                
                delay = calculate_reconnect_delay(consecutive_failures)
                print(f"\n🔄 Connection closed after {session_duration:.1f}s.")
                print(f"⏳ CloseHandler: Reconnecting in {delay}s (Exponential Backoff + Jitter)...")
                write_system_log(f"Connection ended ({session_duration:.1f}s) - CloseHandler backoff: {delay}s (attempt #{reconnect_count})")
                await asyncio.sleep(delay)
            
        except RestartRequestedException as e:
            # Intentional restart (admin command, auto-restart timer, or connection loss)
            reconnect_count += 1
            consecutive_failures = 0
            
            print(f"\n{'='*60}")
            print(f"🔄 RESTART CONFIRMED BY WATCHDOG")
            print(f"{'='*60}")
            print(f"Reason: {str(e)}")
            print(f"Reconnection attempt: #{reconnect_count}")
            print(f"{'='*60}\n")
            
            write_system_log(f"Watchdog caught restart request: {str(e)}")
            
            # Small delay before reconnecting
            await asyncio.sleep(2)
            
        except KeyboardInterrupt:
            # Ctrl+C pressed
            print("\n🛑 Shutdown signal received (Ctrl+C)")
            print("⏹️ Stopping bot...")
            write_system_log("Bot shutdown requested by user (Ctrl+C)")
            break
            
        except Exception as e:
            if shutdown_flag:
                break
            
            session_duration = time.time() - start_time if 'start_time' in locals() else 0
            reconnect_count += 1
            if session_duration >= 60:
                consecutive_failures = 1
            else:
                consecutive_failures += 1
            
            delay = calculate_reconnect_delay(consecutive_failures)
            
            print(f"\n{'='*60}")
            print(f"❌ BOT DISCONNECTED: {type(e).__name__}")
            print(f"Error Message: {str(e)}")
            print(f"\n🔄 CLOSEHANDLER RECONNECTION STRATEGY:")
            print(f"   Total Attempts: #{reconnect_count}")
            print(f"   Consecutive Failures: #{consecutive_failures}")
            print(f"   Delay: {delay}s (Randomized Exponential Backoff + Jitter)")
            print(f"   Status: Will NEVER give up!")
            print(f"\n💡 Press Ctrl+C to stop the bot")
            print(f"{'='*60}\n")
            
            write_system_log(f"Bot disconnected ({type(e).__name__}: {str(e)}) - CloseHandler backoff: {delay}s (attempt #{reconnect_count})")
            
            try:
                await asyncio.sleep(delay)
            except KeyboardInterrupt:
                print("\n🛑 Shutdown signal received (Ctrl+C)")
                print("⏹️ Stopping bot...")
                write_system_log("Bot shutdown requested by user (Ctrl+C during reconnect)")
                break
    
    print("✅ Bot stopped successfully")
    write_system_log("Bot stopped successfully")

# Bot configuration
if __name__ == "__main__":
    # Setup signal handler for Ctrl+C
    signal.signal(signal.SIGINT, signal_handler)
    
    print("🔧 Music Bot Watchdog Started")
    print("💡 The bot will automatically reconnect if disconnected")
    print("💡 Press Ctrl+C to stop the bot\n")
    
    # Run the bot with watchdog
    try:
        asyncio.run(run_bot_with_watchdog())
    except KeyboardInterrupt:
        print("\n🛑 Bot stopped by user")
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
