"""
Robust Connection Manager for Highrise Bot
Ensures bot stays connected 24/7 with aggressive keepalive and smart reconnection
"""
import asyncio
import time
import os
import sys
from datetime import datetime
from core.logger import write_system_log


class RestartRequestedException(Exception):
    """Exception raised to trigger bot restart"""
    pass

class ConnectionManager:
    """
    Advanced connection manager that prevents bot disconnection
    
    Features:
    - Aggressive keepalive pings (every 15 seconds)
    - Smart reconnection with exponential backoff
    - Connection state tracking
    - Never gives up unless Ctrl+C
    - Periodic full restart to refresh connection
    """
    
    def __init__(self, bot):
        self.bot = bot
        self.keepalive_task = None
        self.restart_timer_task = None
        self.is_connected = False
        self.connection_start_time = None
        self.ping_failures = 0
        self.max_ping_failures = 3  # Trigger reconnection after 3 failures
        self.keepalive_interval = 15  # Aggressive ping every 15 seconds
        self.restart_interval_hours = 4  # Auto-restart every 4 hours
        
        # Restart signaling - this event will be set to trigger reconnection
        self.restart_event = asyncio.Event()
        self.restart_reason = None
        
        # Readiness signal - set when connection manager is fully started
        self.started_event = asyncio.Event()
        
        # Track statistics
        self.total_pings_sent = 0
        self.total_pings_failed = 0
        self.last_successful_ping = None
        
        print("🔗 Connection Manager initialized")
        write_system_log("Connection Manager initialized")
    
    async def start(self):
        """Start connection management tasks"""
        self.is_connected = True
        self.connection_start_time = time.time()
        self.ping_failures = 0
        self.restart_event.clear()  # Clear any previous restart signals
        self.restart_reason = None
        self.started_event.clear()
        
        # Cancel any previous tasks to avoid duplicate loops
        if self.keepalive_task and not self.keepalive_task.done():
            self.keepalive_task.cancel()
        if self.restart_timer_task and not self.restart_timer_task.done():
            self.restart_timer_task.cancel()

        # Start keepalive task
        self.keepalive_task = asyncio.create_task(self._keepalive_loop())
        
        # Start periodic restart timer
        self.restart_timer_task = asyncio.create_task(self._restart_timer())
        
        print("✅ Connection Manager started")
        write_system_log(f"Connection Manager started - Keepalive every {self.keepalive_interval}s, Auto-restart every {self.restart_interval_hours}h")
        
        # Signal that connection manager is ready
        self.started_event.set()
    
    async def stop(self):
        """Stop connection management tasks"""
        self.is_connected = False
        
        if self.keepalive_task:
            self.keepalive_task.cancel()
            try:
                await self.keepalive_task
            except asyncio.CancelledError:
                pass
        
        if self.restart_timer_task:
            self.restart_timer_task.cancel()
            try:
                await self.restart_timer_task
            except asyncio.CancelledError:
                pass
        
        print("⏹️ Connection Manager stopped")
        write_system_log("Connection Manager stopped")
    
    async def _keepalive_loop(self):
        """
        💓 15-Second Raw KeepaliveRequest Heartbeat Loop
        
        Matches the Highrise SDK networking specification:
        - Sends serialized raw packet {"_type": "KeepaliveRequest"} directly every 15 seconds
        - Keeps room session pinned in Highrise server memory, preventing room hibernation
        - Detects true WebSocket transport failures without false alarms from slow room queries
        """
        print(f"💓 Raw Keepalive started - sending KeepaliveRequest every {self.keepalive_interval} seconds")
        write_system_log(f"Raw Keepalive loop started with {self.keepalive_interval}s interval")
        
        # Initial delay to allow connection setup to settle
        await asyncio.sleep(10)
        
        ticks = 0
        while self.is_connected:
            try:
                # 1. Access active underlying WebSocket connection
                ws = getattr(self.bot.highrise, 'ws', None)
                if not ws and hasattr(self.bot, '_core_highrise'):
                    ws = getattr(self.bot._core_highrise, 'ws', None)
                
                if ws is None or ws.closed:
                    print("⚡ [ConnectionManager] Underlying WebSocket is closed - triggering instant reconnect...")
                    write_system_log("Underlying WebSocket closed - triggering instant reconnect")
                    self.restart_reason = "Underlying WebSocket transport closed"
                    self.restart_event.set()
                    return
                
                # 2. Send the serialized raw KeepaliveRequest packet directly to wss://highrise.game/web/botapi
                await ws.send_json({"_type": "KeepaliveRequest"})
                
                # Heartbeat success!
                self.total_pings_sent += 1
                self.last_successful_ping = time.time()
                self.ping_failures = 0  # Reset failure counter
                ticks += 1
                
                # Print periodic status (every 10 pings = ~2.5 minutes)
                if self.total_pings_sent % 10 == 0:
                    uptime = self._get_uptime()
                    print(f"💓 Keepalive OK (KeepaliveRequest) | Pings: {self.total_pings_sent} | Uptime: {uptime}")
                
                # 3. Decoupled room presence check every 4 ticks (~60s)
                # Non-blocking so API lag never impacts the 15-second keepalive heartbeat
                if ticks % 4 == 0:
                    asyncio.create_task(self._check_room_presence())
                
            except Exception as e:
                # Ping failed
                self.ping_failures += 1
                self.total_pings_failed += 1
                
                print(f"⚠️ Raw keepalive heartbeat failed ({self.ping_failures}/{self.max_ping_failures}) - Error: {e}")
                write_system_log(f"Raw keepalive failed ({self.ping_failures}/{self.max_ping_failures}) - {type(e).__name__}: {e}")
                
                # If too many failures, trigger reconnection
                if self.ping_failures >= self.max_ping_failures:
                    print("🔴 CRITICAL: Multiple keepalive failures detected!")
                    print("🔄 Connection lost - triggering auto-reconnect...")
                    write_system_log(f"CRITICAL: {self.max_ping_failures} consecutive keepalive failures - connection lost")
                    
                    # Signal restart via event
                    self.restart_reason = f"Connection lost: {self.max_ping_failures} consecutive raw keepalive failures"
                    self.restart_event.set()
                    return  # Exit the loop
            
            # Wait before next ping (15 seconds standard)
            await asyncio.sleep(self.keepalive_interval)
    
    async def _check_room_presence(self):
        """Decoupled, non-fatal room presence check to refresh bot avatar in room scene"""
        try:
            response = await self.bot.highrise.get_room_users()
            if hasattr(response, 'content'):
                real_users = [u for u, _ in response.content if u.id != self.bot.bot_user_id]
                user_count = len(real_users)
                if user_count > 0:
                    if getattr(self, '_room_was_empty', False):
                        print(f"👥 Room active ({user_count} users) - ensuring bot avatar presence")
                        if hasattr(self.bot, 'ensure_bot_presence'):
                            await self.bot.ensure_bot_presence(force=True)
                    self._room_was_empty = False
                else:
                    self._room_was_empty = True
        except Exception:
            # Non-fatal: room query timeout should never drop the bot's session
            pass
    
    async def _restart_timer(self):
        """Automatic periodic restart to establish fresh connection"""
        restart_seconds = self.restart_interval_hours * 3600
        
        print(f"⏰ Auto-restart timer started - will restart in {self.restart_interval_hours} hours")
        write_system_log(f"Auto-restart timer started - interval: {self.restart_interval_hours} hours")
        
        while self.is_connected:
            try:
                # Wait for restart interval
                await asyncio.sleep(restart_seconds)
                
                # Time to restart!
                uptime = self._get_uptime()
                print("\n" + "="*60)
                print(f"⏰ AUTO-RESTART TIME!")
                print(f"Current uptime: {uptime}")
                print(f"Establishing fresh connection to prevent any issues...")
                print("="*60 + "\n")
                
                write_system_log(f"Auto-restart triggered after {uptime} uptime")
                
                # Signal restart via event
                self.restart_reason = f"Automatic periodic restart after {uptime} uptime"
                self.restart_event.set()
                return  # Exit the loop
                
            except asyncio.CancelledError:
                # Timer was cancelled (manual restart or shutdown)
                break
            except Exception as e:
                print(f"⚠️ Restart timer error: {e}")
                write_system_log(f"Restart timer error: {e}")
    
    def _get_uptime(self):
        """Get formatted uptime string"""
        if not self.connection_start_time:
            return "Unknown"
        
        uptime_seconds = int(time.time() - self.connection_start_time)
        hours = uptime_seconds // 3600
        minutes = (uptime_seconds % 3600) // 60
        seconds = uptime_seconds % 60
        
        return f"{hours}h {minutes}m {seconds}s"
    
    def get_status(self):
        """Get connection status information"""
        uptime = self._get_uptime()
        success_rate = 0
        if self.total_pings_sent > 0:
            success_rate = ((self.total_pings_sent - self.total_pings_failed) / self.total_pings_sent) * 100
        
        status = {
            'connected': self.is_connected,
            'uptime': uptime,
            'total_pings': self.total_pings_sent,
            'failed_pings': self.total_pings_failed,
            'success_rate': f"{success_rate:.1f}%",
            'last_ping': datetime.fromtimestamp(self.last_successful_ping).strftime("%H:%M:%S") if self.last_successful_ping else "Never",
            'current_failures': self.ping_failures
        }
        
        return status
    
    async def force_reconnect(self, reason="Manual reconnection requested"):
        """Force immediate reconnection by setting restart event"""
        print("🔄 Forcing reconnection...")
        write_system_log(f"Manual reconnection triggered: {reason}")
        self.restart_reason = reason
        self.restart_event.set()
    
    async def wait_for_restart(self):
        """
        Wait for restart event and perform graceful shutdown
        
        This coroutine is awaited by the session runner alongside main().
        When restart is requested, it performs cleanup and raises RestartRequestedException,
        which the session runner propagates to the watchdog.
        
        This is the correct pattern for restart handling - the exception is raised
        in a coroutine that's actually awaited, so it properly propagates.
        """
        # Wait for restart event to be set (no dependency on started_event)
        await self.restart_event.wait()
        
        # Restart was requested - perform clean shutdown
        if self.restart_reason:
            print(f"\n{'='*60}")
            print(f"🔄 RESTART REQUESTED: {self.restart_reason}")
            print(f"{'='*60}")
            print("📋 Performing graceful shutdown...")
            write_system_log(f"Restart requested: {self.restart_reason}")
        
        # Stop all connection manager tasks cleanly
        print("⏹️ Stopping connection manager tasks...")
        self.is_connected = False
        
        # Cancel and await background tasks
        if self.keepalive_task and not self.keepalive_task.done():
            self.keepalive_task.cancel()
            try:
                await self.keepalive_task
            except asyncio.CancelledError:
                pass
        
        if self.restart_timer_task and not self.restart_timer_task.done():
            self.restart_timer_task.cancel()
            try:
                await self.restart_timer_task
            except asyncio.CancelledError:
                pass
        
        # Stop all background tasks via Background Task Manager
        if hasattr(self.bot, 'background_manager'):
            await self.bot.background_manager.stop_all_tasks()
        
        print("✅ Tasks stopped")
        
        # Close HTTP session to prevent resource leaks
        if hasattr(self.bot, 'music') and hasattr(self.bot.music, 'close'):
            try:
                await self.bot.music.close()
                print("✅ Music manager HTTP session closed")
            except Exception as e:
                print(f"⚠️ Error closing music manager session: {e}")
        
        # Try to close the Highrise connection gracefully
        try:
            print("🔌 Closing Highrise connection...")
            write_system_log("Closing Highrise connection for graceful reconnection")
            
            # Close the WebSocket connection
            if hasattr(self.bot.highrise, '_client') and self.bot.highrise._client:
                await self.bot.highrise._client.close()
                print("✅ Highrise connection closed")
            
        except Exception as e:
            print(f"⚠️ Error during connection close: {e}")
            write_system_log(f"Connection close error: {e}")
        
        print("✅ Graceful shutdown complete")
        print(f"{'='*60}\n")
        write_system_log("Graceful shutdown complete - raising RestartRequestedException")
        
        # Raise RestartRequestedException to signal the watchdog
        # Since this coroutine is awaited by the session runner, the exception will propagate
        raise RestartRequestedException(self.restart_reason or "Restart requested")


class BotRestartManager:
    """
    Manages bot and server restart commands
    """
    
    @staticmethod
    async def restart_bot(connection_manager):
        """Restart the bot (reconnect to Highrise)"""
        print("\n" + "="*60)
        print("🔄 BOT RESTART REQUESTED")
        print("="*60)
        write_system_log("Bot restart requested via command")
        
        # Trigger reconnection via event
        await connection_manager.force_reconnect("Bot restart requested by admin command")
    
    @staticmethod
    async def restart_server():
        """Restart the music server"""
        print("\n" + "="*60)
        print("🔄 MUSIC SERVER RESTART REQUESTED")
        print("="*60)
        write_system_log("Music server restart requested via command")
        
        # Import here to avoid circular dependency
        import aiohttp
        
        try:
            # Get server URL
            public_url = os.getenv("PUBLIC_URL")
            replit_domain = os.getenv("REPLIT_DEV_DOMAIN")
            
            if public_url:
                server_url = public_url.rstrip('/')
            elif replit_domain:
                server_url = f"https://{replit_domain}"
            else:
                server_url = "http://localhost:5000"
            
            # Send restart command to server
            async with aiohttp.ClientSession() as session:
                restart_url = f"{server_url}/restart"
                async with session.post(restart_url, timeout=aiohttp.ClientTimeout(total=5)) as response:
                    if response.status == 200:
                        print("✅ Music server restart initiated")
                        write_system_log("Music server restart successful")
                        return True
                    else:
                        print(f"⚠️ Music server restart failed: Status {response.status}")
                        write_system_log(f"Music server restart failed: Status {response.status}")
                        return False
        except Exception as e:
            print(f"❌ Failed to restart music server: {e}")
            write_system_log(f"Music server restart failed: {e}")
            return False
    
    @staticmethod
    async def restart_both(connection_manager):
        """Restart both bot and music server"""
        print("\n" + "="*60)
        print("🔄 FULL RESTART REQUESTED (BOT + SERVER)")
        print("="*60)
        write_system_log("Full restart (bot + server) requested via command")
        
        # First restart server
        await BotRestartManager.restart_server()
        
        # Wait a moment for server to restart
        await asyncio.sleep(2)
        
        # Then restart bot - this will raise RestartRequestedException
        await BotRestartManager.restart_bot(connection_manager)
        
        return True  # This won't be reached, but kept for clarity
