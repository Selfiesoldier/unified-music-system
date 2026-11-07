"""
Advanced System Info Manager - Comprehensive diagnostics and monitoring
Handles version, changelog, feedback, bugs, health metrics, and performance tracking
"""
import os
import json
import time
import asyncio
from datetime import datetime, timezone
from typing import Dict, List, Tuple, Optional, Any
from core.logger import write_system_log, write_log

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    print("⚠️ psutil not available - some metrics will be limited")


class SystemInfoManager:
    """Manages system information, health metrics, and user feedback"""
    
    # Rate limiting configuration
    BUG_REPORT_COOLDOWN = 60  # seconds
    FEEDBACK_COOLDOWN = 30  # seconds
    
    def __init__(self, data_dir="systems/systeminfo/data"):
        self.data_dir = data_dir
        self.version_file = os.path.join(data_dir, "version.json")
        self.changelog_file = os.path.join(data_dir, "changelog.json")
        self.feedback_file = os.path.join(data_dir, "feedback.json")
        self.bugs_file = os.path.join(data_dir, "bugs.json")
        
        # Locks for thread-safe operations
        self._version_lock = asyncio.Lock()
        self._changelog_lock = asyncio.Lock()
        self._feedback_lock = asyncio.Lock()
        self._bugs_lock = asyncio.Lock()
        
        # Track bot start time for uptime
        self._start_time = time.time()
        
        # Rate limiting tracking
        self._last_bug_report = {}  # {username: timestamp}
        self._last_feedback = {}  # {username: timestamp}
        
        # Performance metrics
        self._metrics = {
            "commands_executed": 0,
            "errors_encountered": 0,
            "songs_played": 0,
            "playlists_created": 0
        }
        
        self._ensure_data_dir()
        write_system_log("SystemInfoManager initialized")
    
    def _ensure_data_dir(self):
        """Ensure data directory exists"""
        os.makedirs(self.data_dir, exist_ok=True)
    
    def _atomic_write(self, path: str, data: Dict):
        """Atomic JSON write to prevent corruption"""
        tmp_path = path + ".tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            os.replace(tmp_path, path)
        except Exception as e:
            write_system_log(f"Error in atomic write to {path}: {e}")
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise
    
    async def _load_json(self, path: str, lock: asyncio.Lock) -> Dict:
        """Load JSON file with lock"""
        async with lock:
            if not os.path.exists(path):
                return {}
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                write_system_log(f"Error loading {path}: {e}")
                return {}
    
    async def _save_json(self, path: str, data: Dict, lock: asyncio.Lock):
        """Save JSON file with lock"""
        async with lock:
            self._atomic_write(path, data)
    
    # ========== VERSION & CHANGELOG ==========
    
    async def get_version(self) -> Dict:
        """Get current version information"""
        return await self._load_json(self.version_file, self._version_lock)
    
    async def get_changelog(self) -> Dict:
        """Get full changelog"""
        return await self._load_json(self.changelog_file, self._changelog_lock)
    
    async def get_latest_changes(self, limit: int = 3) -> List[Dict]:
        """Get latest changelog entries"""
        changelog = await self.get_changelog()
        changes = changelog.get("changes", [])
        return changes[:limit]
    
    async def add_changelog_entry(self, version: str, title: str, details: List[str], owner_username: str) -> Tuple[bool, str]:
        """Add new changelog entry (owner only)"""
        entry = {
            "version": version,
            "title": title,
            "details": details,
            "released_at": datetime.now().strftime("%Y-%m-%d"),
            "timestamp": int(time.time())
        }
        
        data = await self._load_json(self.changelog_file, self._changelog_lock)
        if "changes" not in data:
            data["changes"] = []
        
        data["changes"].insert(0, entry)  # newest first
        await self._save_json(self.changelog_file, data, self._changelog_lock)
        
        write_system_log(f"Changelog entry added: {version} - {title}")
        return True, f"Changelog entry for v{version} added successfully!"
    
    # ========== FEEDBACK SYSTEM ==========
    
    async def add_feedback(self, username: str, user_id: str, message: str) -> Tuple[bool, str]:
        """Add user feedback with rate limiting"""
        # Rate limiting check
        last_time = self._last_feedback.get(username, 0)
        if time.time() - last_time < self.FEEDBACK_COOLDOWN:
            remaining = int(self.FEEDBACK_COOLDOWN - (time.time() - last_time))
            return False, f"Please wait {remaining}s before submitting more feedback"
        
        entry = {
            "user": username,
            "user_id": str(user_id),
            "message": message,
            "timestamp": int(time.time()),
            "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        data = await self._load_json(self.feedback_file, self._feedback_lock)
        if "feedback" not in data:
            data["feedback"] = []
        
        data["feedback"].append(entry)
        await self._save_json(self.feedback_file, data, self._feedback_lock)
        
        self._last_feedback[username] = time.time()
        write_system_log(f"Feedback received from {username}: {message}")
        
        return True, "Thank you! Your feedback has been recorded."
    
    async def get_recent_feedback(self, limit: int = 10) -> List[Dict]:
        """Get recent feedback entries"""
        data = await self._load_json(self.feedback_file, self._feedback_lock)
        feedback = data.get("feedback", [])
        return feedback[-limit:][::-1]  # Most recent first
    
    async def get_all_feedback(self) -> List[Dict]:
        """Get all feedback entries (most recent first)"""
        data = await self._load_json(self.feedback_file, self._feedback_lock)
        feedback = data.get("feedback", [])
        return feedback[::-1]  # Most recent first
    
    async def get_feedback_count(self) -> int:
        """Get total feedback count"""
        data = await self._load_json(self.feedback_file, self._feedback_lock)
        return len(data.get("feedback", []))
    
    # ========== BUG REPORTING SYSTEM ==========
    
    async def add_bug_report(
        self, 
        username: str, 
        user_id: str, 
        role: str, 
        message: str,
        bot_instance=None
    ) -> Tuple[bool, str, Optional[Dict]]:
        """Add bug report with system diagnostics"""
        # Rate limiting check
        last_time = self._last_bug_report.get(username, 0)
        if time.time() - last_time < self.BUG_REPORT_COOLDOWN:
            remaining = int(self.BUG_REPORT_COOLDOWN - (time.time() - last_time))
            return False, f"Please wait {remaining}s before submitting another bug report", None
        
        # Collect system diagnostics
        version = await self.get_version()
        diagnostics = await self.collect_diagnostics(bot_instance)
        
        entry = {
            "user": username,
            "user_id": str(user_id),
            "role": role,
            "message": message,
            "version": version.get("version"),
            "codename": version.get("codename"),
            "uptime": diagnostics.get("uptime"),
            "queue_length": diagnostics.get("queue_length"),
            "active_playlists": diagnostics.get("active_playlists"),
            "cpu_usage": diagnostics.get("cpu_usage"),
            "memory_usage": diagnostics.get("memory_usage"),
            "timestamp": int(time.time()),
            "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        data = await self._load_json(self.bugs_file, self._bugs_lock)
        if "bugs" not in data:
            data["bugs"] = []
        
        data["bugs"].append(entry)
        await self._save_json(self.bugs_file, data, self._bugs_lock)
        
        self._last_bug_report[username] = time.time()
        write_system_log(f"Bug report from {username} ({role}): {message}")
        
        return True, "Bug report submitted! Thank you for helping improve the bot.", entry
    
    async def get_recent_bugs(self, limit: int = 10) -> List[Dict]:
        """Get recent bug reports"""
        data = await self._load_json(self.bugs_file, self._bugs_lock)
        bugs = data.get("bugs", [])
        return bugs[-limit:][::-1]  # Most recent first
    
    async def get_bug_count(self) -> int:
        """Get total bug report count"""
        data = await self._load_json(self.bugs_file, self._bugs_lock)
        return len(data.get("bugs", []))
    
    # ========== SYSTEM HEALTH & DIAGNOSTICS ==========
    
    def format_uptime(self) -> str:
        """Format uptime as human-readable string"""
        delta = int(time.time() - self._start_time)
        days, rem = divmod(delta, 86400)
        hours, rem = divmod(rem, 3600)
        minutes, seconds = divmod(rem, 60)
        
        if days > 0:
            return f"{days}d {hours}h {minutes}m"
        elif hours > 0:
            return f"{hours}h {minutes}m {seconds}s"
        else:
            return f"{minutes}m {seconds}s"
    
    def get_uptime_seconds(self) -> int:
        """Get uptime in seconds"""
        return int(time.time() - self._start_time)
    
    def get_cpu_memory(self) -> Tuple[Optional[float], Optional[float]]:
        """Get CPU and memory usage"""
        if not PSUTIL_AVAILABLE:
            return None, None
        
        try:
            cpu = psutil.cpu_percent(interval=0.1)
            mem = psutil.virtual_memory().percent
            return cpu, mem
        except Exception as e:
            write_system_log(f"Error getting CPU/memory: {e}")
            return None, None
    
    def get_disk_usage(self) -> Optional[Dict]:
        """Get disk usage information"""
        if not PSUTIL_AVAILABLE:
            return None
        
        try:
            disk = psutil.disk_usage('/')
            return {
                "total_gb": round(disk.total / (1024**3), 2),
                "used_gb": round(disk.used / (1024**3), 2),
                "free_gb": round(disk.free / (1024**3), 2),
                "percent": disk.percent
            }
        except Exception as e:
            write_system_log(f"Error getting disk usage: {e}")
            return None
    
    def get_process_info(self) -> Optional[Dict]:
        """Get current process information"""
        if not PSUTIL_AVAILABLE:
            return None
        
        try:
            process = psutil.Process()
            return {
                "threads": process.num_threads(),
                "memory_mb": round(process.memory_info().rss / (1024**2), 2),
                "cpu_percent": process.cpu_percent(interval=0.1)
            }
        except Exception as e:
            write_system_log(f"Error getting process info: {e}")
            return None
    
    def get_times(self) -> Tuple[str, str]:
        """Get server and local time"""
        now_utc = datetime.now(timezone.utc)
        server_time = now_utc.strftime("%Y-%m-%d %H:%M:%S UTC")
        local_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return server_time, local_time
    
    async def collect_diagnostics(self, bot_instance=None) -> Dict:
        """Collect comprehensive system diagnostics"""
        cpu, mem = self.get_cpu_memory()
        disk = self.get_disk_usage()
        process = self.get_process_info()
        server_time, local_time = self.get_times()
        
        diagnostics = {
            "uptime": self.format_uptime(),
            "uptime_seconds": self.get_uptime_seconds(),
            "cpu_usage": cpu,
            "memory_usage": mem,
            "disk_usage": disk,
            "process_info": process,
            "server_time": server_time,
            "local_time": local_time,
            "queue_length": 0,
            "active_playlists": 0,
            "metrics": self._metrics.copy()
        }
        
        # Try to get bot-specific metrics
        if bot_instance:
            try:
                # Queue length from music manager
                if hasattr(bot_instance, 'music') and hasattr(bot_instance.music, 'get_queue'):
                    queue_data = await bot_instance.music.get_queue()
                    if queue_data and isinstance(queue_data, dict):
                        diagnostics["queue_length"] = queue_data.get("length", 0)
                    else:
                        diagnostics["queue_length"] = 0
                
                # Active playlists count
                if hasattr(bot_instance, 'playlist_manager'):
                    diagnostics["active_playlists"] = len(bot_instance.playlist_manager.active_playlists)
            except Exception as e:
                write_system_log(f"Error collecting bot metrics: {e}")
        
        return diagnostics
    
    # ========== STATISTICS ==========
    
    def increment_metric(self, metric_name: str):
        """Increment a performance metric"""
        if metric_name in self._metrics:
            self._metrics[metric_name] += 1
    
    def get_metrics(self) -> Dict:
        """Get all performance metrics"""
        return self._metrics.copy()
    
    async def get_statistics(self, bot_instance=None) -> Dict:
        """Get comprehensive statistics"""
        diagnostics = await self.collect_diagnostics(bot_instance)
        
        stats = {
            "version": await self.get_version(),
            "diagnostics": diagnostics,
            "feedback_count": await self.get_feedback_count(),
            "bug_count": await self.get_bug_count(),
            "changelog_entries": len((await self.get_changelog()).get("changes", []))
        }
        
        # Add bot-specific stats if available
        if bot_instance:
            try:
                if hasattr(bot_instance, 'economy'):
                    # Could add total points in circulation, etc.
                    pass
                
                if hasattr(bot_instance, 'admin'):
                    stats["admin_count"] = len(bot_instance.admin.admins)
                    stats["vip_count"] = len(bot_instance.admin.vips)
            except Exception as e:
                write_system_log(f"Error collecting bot stats: {e}")
        
        return stats
    
    # ========== OWNER NOTIFICATIONS ==========
    
    async def notify_owner(self, bot_instance, message: str):
        """Send notification to bot owner via DM"""
        try:
            owner_username = "_paul_sanif_"
            notification = f"🔔 System Notification\n\n{message}"
            
            # Try to send DM to owner
            if hasattr(bot_instance, 'highrise'):
                try:
                    # Get all room users to find owner's ID
                    room_users = await bot_instance.highrise.get_room_users()
                    owner_id = None
                    
                    for room_user, _ in room_users.content:
                        if room_user.username.lower() == owner_username.lower():
                            owner_id = room_user.id
                            break
                    
                    if owner_id:
                        # Get or create conversation with owner
                        conversations = await bot_instance.highrise.get_conversations()
                        owner_conv_id = None
                        
                        for conv in conversations.conversations:
                            # For DM conversations, member_ids contains bot ID + other person's ID
                            if conv.member_ids and owner_id in conv.member_ids:
                                # Check if it's a 1-on-1 conversation (2 members)
                                if len(conv.member_ids) == 2:
                                    owner_conv_id = conv.id
                                    break
                        
                        if owner_conv_id:
                            # Send DM to existing conversation
                            await bot_instance.highrise.send_message(owner_conv_id, notification)
                            write_system_log(f"✅ DM sent to owner: {message[:50]}...")
                        else:
                            # No existing conversation found, use whisper as fallback
                            try:
                                await bot_instance.highrise.send_whisper(owner_id, notification)
                                write_system_log(f"⚠️ No DM conversation found, sent whisper to owner: {message[:50]}...")
                            except Exception as whisper_error:
                                write_system_log(f"⚠️ Failed to whisper owner: {whisper_error}, logging instead")
                                write_log("owner_notifications.log", f"To {owner_username}: {message}")
                    else:
                        write_system_log(f"⚠️ Owner not found in room, logging instead")
                        write_log("owner_notifications.log", f"To {owner_username}: {message}")
                
                except Exception as dm_error:
                    write_system_log(f"⚠️ Failed to send DM to owner: {dm_error}, logging instead")
                    write_log("owner_notifications.log", f"To {owner_username}: {message}")
            else:
                # Fallback to logging
                write_log("owner_notifications.log", f"To {owner_username}: {message}")
                write_system_log(f"Owner notification logged: {message}")
        except Exception as e:
            write_system_log(f"Failed to notify owner: {e}")
