"""
Music Manager - Handles music playback, streaming, and server communication
"""
import aiohttp
import asyncio
import os
from typing import Optional, Dict, Any


class MusicManager:
    """Manages music playback and server communication"""

    def __init__(self, music_server_url: str):
        server = (
            os.getenv("MUSIC_API_URL")
            or os.getenv("MUSIC_SERVER_URL")
            or music_server_url
            or "http://localhost:5000"
        ).strip().rstrip("/")
        
        if server and not server.startswith("http://") and not server.startswith("https://"):
            server = f"http://{server}"
            
        self.api_server = server
                # Check public_url.txt from Cloudflare tunnel launcher first
        pub_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "public_url.txt")
        _tunnel_url = None
        if os.path.exists(pub_file):
            try:
                with open(pub_file, "r", encoding="utf-8") as _pf:
                    _u = _pf.read().strip()
                    if _u and "trycloudflare.com" in _u:
                        _tunnel_url = _u
            except Exception:
                pass
        self.stream_server = (_tunnel_url or os.getenv("PUBLIC_URL") or self.api_server).strip().rstrip("/")
        self._session: Optional[aiohttp.ClientSession] = None
        print(f"🎵 MusicManager connected to API server: {self.api_server}")

    async def _ensure_session(self):
        """Ensure aiohttp session exists"""
        if self._session is None or self._session.closed:
            password = os.getenv("ADMIN_PASSWORD") or os.getenv("MUSIC_SERVER_PASSWORD") or "changeme"
            room_id = os.getenv("MUSIC_ROOM_ID") or os.getenv("ROOM_ID") or "room1"
            headers = {
                "Authorization": f"Bearer {password}",
                "X-Room-Id": str(room_id).strip()
            }
            self._session = aiohttp.ClientSession(headers=headers)
        return self._session

    async def close(self):
        """Close the HTTP session to prevent resource leaks"""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    async def make_request(self, endpoint: str, method: str = "GET", data: Optional[Dict] = None) -> Optional[Dict[str, Any]]:
        """Make HTTP request to music server"""
        try:
            session = await self._ensure_session()
            url = f"{self.api_server}{endpoint}"
            if method == "POST":
                async with session.post(url, json=data) as response:
                    if response.status == 401:
                        print("❌ HTTP 401 Unauthorized: Bot password does not match server ADMIN_PASSWORD.")
                    return await response.json()
            else:
                async with session.get(url) as response:
                    if response.status == 401:
                        print("❌ HTTP 401 Unauthorized: Bot password does not match server ADMIN_PASSWORD.")
                    return await response.json()
        except Exception as e:
            print(f"Error connecting to music server: {e}")
            return None

    async def broadcast_event(self, data: Dict[str, Any]) -> bool:
        """Send broadcast event using the shared persistent HTTP session"""
        try:
            session = await self._ensure_session()
            url = f"{self.api_server}/api/broadcast"
            async with session.post(url, json=data, timeout=aiohttp.ClientTimeout(total=2)) as response:
                return response.status == 200
        except Exception:
            return False

    async def search_song(self, query: str) -> Optional[Dict[str, Any]]:
        """Search for a song without queueing it (used for playlists)"""
        return await self.make_request("/search", "POST", {"url": query})

    async def play_song(self, query: str, is_autoplay: bool = False, source_playlist: Optional[str] = None, owner_username: Optional[str] = None, requester_username: Optional[str] = None, dedicated_to: Optional[str] = None, dedicated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Play a song by query or URL"""
        data = {"url": query, "isAutoplay": is_autoplay}
        if source_playlist:
            data["sourcePlaylist"] = source_playlist
        if owner_username:
            data["ownerUsername"] = owner_username
        if requester_username:
            data["requesterUsername"] = requester_username
        if dedicated_to:
            data["dedicatedTo"] = dedicated_to
        if dedicated_by:
            data["dedicatedBy"] = dedicated_by
        return await self.make_request("/play", "POST", data)

    async def insert_song(self, query: str, requester_username: Optional[str] = None, dedicated_to: Optional[str] = None, dedicated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Insert a song at the front of the queue (admin only)"""
        data = {"url": query}
        if requester_username:
            data["requesterUsername"] = requester_username
        if dedicated_to:
            data["dedicatedTo"] = dedicated_to
        if dedicated_by:
            data["dedicatedBy"] = dedicated_by
        return await self.make_request("/insert", "POST", data)

    async def skip_song(self) -> Optional[Dict[str, Any]]:
        """Skip the current song"""
        return await self.make_request("/next", "POST")

    async def stop_playback(self) -> Optional[Dict[str, Any]]:
        """Stop music playback"""
        return await self.make_request("/stop", "POST")

    async def clear_queue(self) -> Optional[Dict[str, Any]]:
        """Clear the music queue"""
        return await self.make_request("/clear", "POST")

    async def get_current(self) -> Optional[Dict[str, Any]]:
        """Get current playing track info"""
        return await self.make_request("/current")

    async def get_queue(self) -> Optional[Dict[str, Any]]:
        """Get the music queue"""
        try:
            session = await self._ensure_session()
            async with session.get(f"{self.api_server}/queue", timeout=aiohttp.ClientTimeout(total=5)) as response:
                if response.status == 200:
                    data = await response.json()
                    if isinstance(data, list):
                        data = {'queue': data, 'queueLength': len(data)}
                    queue_items = data.get('queue', []) if isinstance(data, dict) else []
                    queue_length = data.get('queueLength', len(queue_items)) if isinstance(data, dict) else len(queue_items)
                    print(f"📋 Queue data from server: queueLength={queue_length}, queue items={len(queue_items)}")
                    return data
                else:
                    print(f"❌ Queue request failed with status {response.status}")
        except Exception as e:
            print(f"❌ Error getting queue: {e}")
        return None

    async def resolve_query(self, query: str) -> Optional[Dict[str, Any]]:
        """
        Resolve a query to canonical metadata (including video ID) without adding to queue.

        Args:
            query: Song search query or URL

        Returns:
            Metadata dict with videoId, or None if resolution fails
        """
        try:
            result = await self.make_request("/resolve", "POST", {"query": query})
            if result and result.get('status') == 'resolved':
                return result.get('metadata')
            return None
        except Exception as e:
            print(f"Error resolving query: {e}")
            return None

    async def is_song_in_queue(self, query: str) -> tuple[bool, Optional[str]]:
        """
        Check if a song (by title or URL) is already in the queue.
        Uses canonical video ID matching for accurate duplicate detection.
        Falls back to fuzzy matching if resolution fails.

        Args:
            query: Song search query or URL

        Returns:
            tuple: (is_duplicate, song_title_if_found)
        """
        queue_data = await self.get_queue()

        if not queue_data or not queue_data.get('queue'):
            return (False, None)

        queue = queue_data.get('queue', [])

        # Try to resolve the query to get canonical video ID
        resolved_metadata = await self.resolve_query(query)

        if resolved_metadata and resolved_metadata.get('videoId'):
            # Use canonical video ID matching (most reliable)
            query_video_id = str(resolved_metadata.get('videoId', '')).lower()

            for song in queue:
                queue_video_id = song.get('videoId', '').lower()
                if queue_video_id and query_video_id == queue_video_id:
                    return (True, song.get('title'))

            # Not found in queue
            return (False, None)

        # Fallback to fuzzy matching if resolution failed
        print(f"⚠️ Resolution failed for '{query}', using fuzzy matching")

        # If query is a URL, do exact URL matching
        if 'youtube.com' in query.lower() or 'youtu.be' in query.lower():
            query_lower = query.lower()
            for song in queue:
                url = song.get('url', '').lower()
                if query_lower in url or url in query_lower:
                    return (True, song.get('title'))
            return (False, None)

        # For text queries, use tokenized fuzzy matching
        query_tokens = set(query.lower().split())
        # Remove ONLY very common filler words (avoid removing real content like "music", "song")
        stop_words = {'official', 'video', 'audio', 'lyrics', 'hd', 'hq', 'ft', 'feat', 'full', 'new', 'latest', '2024', '2023', '2022', '2025'}
        query_tokens = query_tokens - stop_words

        # Need at least 2 significant words for fuzzy matching
        if len(query_tokens) < 2:
            query_lower = query.lower()
            for song in queue:
                title = song.get('title', '').lower()
                # For single-word queries, require it to be in title
                if query_lower in title:
                    return (True, song.get('title'))
            return (False, None)

        # Check each song in queue
        for song in queue:
            title = song.get('title', '').lower()
            title_tokens = set(title.split())
            title_tokens = title_tokens - stop_words

            # Calculate overlap: how many query tokens are in the title?
            overlap = query_tokens.intersection(title_tokens)
            overlap_ratio = len(overlap) / len(query_tokens) if query_tokens else 0

            # Require 80% match to reduce false positives (was 70%)
            # Also require at least 2 matching tokens to avoid false positives on single-word overlaps
            if overlap_ratio >= 0.8 and len(overlap) >= 2:
                return (True, song.get('title'))

        return (False, None)

    async def get_stream_url(self, force_new_session: bool = False) -> str:
        """Get the stream URL with cache-busting session ID for Highrise radio
        
        Args:
            force_new_session: If True, generates a new session ID to force Highrise to reconnect all users
        """
        import time
        result = await self.get_current()
        stream_version = result.get('streamVersion', 0) if result else 0
        
        if force_new_session:
            session_id = int(time.time())
            return f"{self.stream_server}/stream?sid={session_id}&v={stream_version}"
        return f"{self.stream_server}/stream?v={stream_version}"

    async def restore_queue(self) -> Optional[Dict[str, Any]]:
        """Restore and start playback from saved queue"""
        return await self.make_request("/restore", "POST")

    async def get_quality(self) -> Optional[Dict[str, Any]]:
        """Get current audio quality/bitrate"""
        return await self.make_request("/quality")

    async def set_quality(self, bitrate: str) -> Optional[Dict[str, Any]]:
        """
        Set audio quality/bitrate

        Args:
            bitrate: Bitrate (96k, 128k, 192k, 256k, 320k)

        Returns:
            Response dict with status
        """
        return await self.make_request("/quality", "POST", {"bitrate": bitrate})

    async def get_announcements(self) -> Optional[Dict[str, Any]]:
        """Get current announcement settings"""
        return await self.make_request("/announcements")

    async def set_announcements(self, enabled: Optional[bool] = None, voice: Optional[str] = None, word_limit: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """
        Configure TTS announcement settings

        Args:
            enabled: True to enable announcements, False to disable
            voice: TTS voice/accent code (en, en-gb, en-au, en-in, hi, ur, es, fr, de, it, pt, ar)
            word_limit: Max words in song title for TTS (3-50)

        Returns:
            Response dict with status
        """
        data = {}
        if enabled is not None:
            data["enabled"] = enabled
        if voice is not None:
            data["voice"] = voice
        if word_limit is not None:
            data["wordLimit"] = word_limit
        return await self.make_request("/announcements", "POST", data)

    async def get_volume(self) -> Optional[Dict[str, Any]]:
        """Get current volume level"""
        return await self.make_request("/volume")

    async def set_volume(self, level: int) -> Optional[Dict[str, Any]]:
        """
        Set volume level

        Args:
            level: Volume level (0-200, where 100 is normal)

        Returns:
            Response dict with status
        """
        return await self.make_request("/volume", "POST", {"level": level})