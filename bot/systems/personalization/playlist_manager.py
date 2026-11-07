"""
Playlist Manager - Core logic for VIP+ playlist system
Handles playlist CRUD, rotation, and batch injection algorithm
"""
import os
import json
import time
import asyncio
import random
from typing import Optional, Dict, List, Tuple, Any
from core.logger import write_system_log
from core.error_handler import safe_call


class PlaylistManager:
    """Manages VIP+ user playlists with round-robin batch injection"""
    
    MAX_PLAYLISTS_FREE = 5
    MAX_SONGS_FREE = 50
    PLAYLIST_CREATION_COST = 100
    EXTRA_SONG_COST = 5
    BATCH_SIZE = 5
    INJECT_TRIGGER = 4
    MAX_ACTIVE_PLAYLISTS = 5
    MAX_PLAYLIST_NAME_LENGTH = 50
    CONFIRMATION_TIMEOUT = 30
    
    def __init__(self, data_file="systems/personalization/data/user_playlists.json"):
        self.data_file = data_file
        self.lock = asyncio.Lock()
        
        self.active_playlists = []
        self.rotation_index = 0
        self.batch_state = {}
        self.pending_removals = {}
        self.pending_adds = {}
        
        self._ensure_data_file()
    
    def _ensure_data_file(self):
        """Ensure data file exists"""
        os.makedirs(os.path.dirname(self.data_file), exist_ok=True)
        if not os.path.exists(self.data_file):
            self._save_data({})
    
    def _load_data(self) -> Dict:
        """Load playlist data from JSON"""
        try:
            with open(self.data_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            write_system_log(f"Error loading playlist data: {e}")
            return {}
    
    def _save_data(self, data: Dict):
        """Save playlist data to JSON with atomic write"""
        try:
            tmp_file = self.data_file + '.tmp'
            with open(tmp_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            os.replace(tmp_file, self.data_file)
        except Exception as e:
            write_system_log(f"Error saving playlist data: {e}")
            raise
    
    async def create_playlist(self, user_id: str, name: str) -> Tuple[bool, str]:
        """Create a new playlist"""
        async with self.lock:
            if len(name) > self.MAX_PLAYLIST_NAME_LENGTH:
                return False, f"Playlist name too long (max {self.MAX_PLAYLIST_NAME_LENGTH} chars)"
            
            if not name or name.strip() == "":
                return False, "Playlist name cannot be empty"
            
            data = self._load_data()
            user_id_str = str(user_id)
            
            if user_id_str not in data:
                data[user_id_str] = {"playlists": {}, "meta": {"playlist_count": 0}}
            
            user_data = data[user_id_str]
            
            if name.lower() in [pl.lower() for pl in user_data["playlists"].keys()]:
                return False, "Playlist with this name already exists"
            
            user_data["playlists"][name] = {
                "owner_id": user_id_str,
                "name": name,
                "songs": [],
                "created_at": int(time.time()),
                "is_private": True
            }
            
            user_data["meta"]["playlist_count"] = len(user_data["playlists"])
            data[user_id_str] = user_data
            self._save_data(data)
            
            write_system_log(f"Playlist created: {name} by user {user_id}")
            return True, f"Playlist '{name}' created successfully!"
    
    async def delete_playlist(self, user_id: str, name: str) -> Tuple[bool, str]:
        """Delete a playlist (only if inactive)"""
        async with self.lock:
            if self.is_playlist_active(user_id, name):
                return False, "Cannot delete active playlist. Stop it first with !playlist stop"
            
            data = self._load_data()
            user_id_str = str(user_id)
            
            if user_id_str not in data:
                return False, "You don't have any playlists"
            
            user_data = data[user_id_str]
            
            actual_name = self._find_playlist_name(user_data, name)
            if not actual_name:
                return False, f"Playlist '{name}' not found"
            
            del user_data["playlists"][actual_name]
            user_data["meta"]["playlist_count"] = len(user_data["playlists"])
            data[user_id_str] = user_data
            self._save_data(data)
            
            write_system_log(f"Playlist deleted: {actual_name} by user {user_id}")
            return True, f"Playlist '{actual_name}' deleted successfully"
    
    async def rename_playlist(self, user_id: str, old_name: str, new_name: str) -> Tuple[bool, str]:
        """Rename a playlist (only if inactive)"""
        async with self.lock:
            if self.is_playlist_active(user_id, old_name):
                return False, "Cannot rename active playlist. Stop it first"
            
            if len(new_name) > self.MAX_PLAYLIST_NAME_LENGTH:
                return False, f"New name too long (max {self.MAX_PLAYLIST_NAME_LENGTH} chars)"
            
            data = self._load_data()
            user_id_str = str(user_id)
            
            if user_id_str not in data:
                return False, "You don't have any playlists"
            
            user_data = data[user_id_str]
            
            actual_old_name = self._find_playlist_name(user_data, old_name)
            if not actual_old_name:
                return False, f"Playlist '{old_name}' not found"
            
            if new_name.lower() in [pl.lower() for pl in user_data["playlists"].keys()]:
                return False, "A playlist with the new name already exists"
            
            playlist_data = user_data["playlists"].pop(actual_old_name)
            playlist_data["name"] = new_name
            user_data["playlists"][new_name] = playlist_data
            
            data[user_id_str] = user_data
            self._save_data(data)
            
            write_system_log(f"Playlist renamed: {actual_old_name} -> {new_name} by user {user_id}")
            return True, f"Playlist renamed from '{actual_old_name}' to '{new_name}'"
    
    async def add_song(self, user_id: str, playlist_name: str, song_title: str, economy_manager) -> Tuple[bool, str, int]:
        """Add a song to playlist. Handles payment if beyond free limit. Returns (success, message, cost)"""
        async with self.lock:
            data = self._load_data()
            user_id_str = str(user_id)
            
            if user_id_str not in data:
                return False, "You don't have any playlists", 0
            
            user_data = data[user_id_str]
            actual_name = self._find_playlist_name(user_data, playlist_name)
            
            if not actual_name:
                return False, f"Playlist '{playlist_name}' not found", 0
            
            playlist = user_data["playlists"][actual_name]
            
            # Check for duplicates (case-insensitive)
            if any(song.lower() == song_title.lower() for song in playlist["songs"]):
                return False, f"'{song_title}' is already in this playlist", 0
            
            current_song_count = len(playlist["songs"])
            
            cost = 0
            if current_song_count >= self.MAX_SONGS_FREE:
                cost = self.EXTRA_SONG_COST
                
                balance = await economy_manager.get_balance(user_id)
                if balance < cost:
                    return False, f"Adding songs beyond {self.MAX_SONGS_FREE} costs {cost} pts per song. Your balance: {balance} pts", cost
                
                success, new_balance = await economy_manager.deduct_points(user_id, cost, f"Added song to {actual_name}")
                if not success:
                    return False, "Insufficient points for extra song", cost
            
            playlist["songs"].append(song_title)
            data[user_id_str] = user_data
            self._save_data(data)
            
            new_count = len(playlist["songs"])
            write_system_log(f"Song added to playlist {actual_name}: {song_title} (cost: {cost})")
            
            if new_count <= self.MAX_SONGS_FREE:
                return True, f"Added '{song_title}' to '{actual_name}' ({new_count}/{self.MAX_SONGS_FREE} free)", cost
            else:
                return True, f"Added '{song_title}' to '{actual_name}' ({new_count} songs)", cost
    
    async def remove_song_by_index(self, user_id: str, playlist_name: str, index: int) -> Tuple[bool, str]:
        """Remove a song by index"""
        async with self.lock:
            data = self._load_data()
            user_id_str = str(user_id)
            
            if user_id_str not in data:
                return False, "You don't have any playlists"
            
            user_data = data[user_id_str]
            actual_name = self._find_playlist_name(user_data, playlist_name)
            
            if not actual_name:
                return False, f"Playlist '{playlist_name}' not found"
            
            playlist = user_data["playlists"][actual_name]
            
            if index < 1 or index > len(playlist["songs"]):
                return False, f"Invalid index. Must be between 1 and {len(playlist['songs'])}"
            
            removed_song = playlist["songs"].pop(index - 1)
            data[user_id_str] = user_data
            self._save_data(data)
            
            write_system_log(f"Song removed from playlist {actual_name}: {removed_song}")
            return True, f"Removed '{removed_song}' from '{actual_name}'"
    
    def find_song_matches(self, user_id: str, playlist_name: str, query: str) -> List[Tuple[int, str]]:
        """Find songs matching a query in a playlist"""
        data = self._load_data()
        user_id_str = str(user_id)
        
        if user_id_str not in data:
            return []
        
        user_data = data[user_id_str]
        actual_name = self._find_playlist_name(user_data, playlist_name)
        
        if not actual_name:
            return []
        
        playlist = user_data["playlists"][actual_name]
        matches = []
        
        query_lower = query.lower()
        for idx, song in enumerate(playlist["songs"], 1):
            if query_lower in song.lower():
                matches.append((idx, song))
        
        return matches
    
    def get_playlist(self, user_id: str, playlist_name: str) -> Optional[Dict]:
        """Get a playlist by name"""
        data = self._load_data()
        user_id_str = str(user_id)
        
        if user_id_str not in data:
            return None
        
        user_data = data[user_id_str]
        actual_name = self._find_playlist_name(user_data, playlist_name)
        
        if not actual_name:
            return None
        
        return user_data["playlists"][actual_name]
    
    def list_playlists(self, user_id: str) -> List[Dict]:
        """List all playlists for a user"""
        data = self._load_data()
        user_id_str = str(user_id)
        
        if user_id_str not in data:
            return []
        
        user_data = data[user_id_str]
        playlists = []
        
        for name, pl in user_data["playlists"].items():
            playlists.append({
                "name": name,
                "song_count": len(pl["songs"]),
                "created_at": pl["created_at"],
                "is_active": self.is_playlist_active(user_id, name)
            })
        
        return playlists
    
    async def shuffle_playlist(self, user_id: str, playlist_name: str) -> Tuple[bool, str]:
        """Shuffle the songs in a playlist"""
        async with self.lock:
            data = self._load_data()
            user_id_str = str(user_id)
            
            if user_id_str not in data:
                return False, "You don't have any playlists"
            
            user_data = data[user_id_str]
            actual_name = self._find_playlist_name(user_data, playlist_name)
            
            if not actual_name:
                return False, f"Playlist '{playlist_name}' not found"
            
            playlist = user_data["playlists"][actual_name]
            random.shuffle(playlist["songs"])
            
            data[user_id_str] = user_data
            self._save_data(data)
            
            write_system_log(f"Playlist shuffled: {actual_name} by user {user_id}")
            return True, f"Playlist '{actual_name}' has been shuffled"
    
    def get_user_playlist_count(self, user_id: str) -> int:
        """Get the number of playlists a user has"""
        data = self._load_data()
        user_id_str = str(user_id)
        
        if user_id_str not in data:
            return 0
        
        return data[user_id_str]["meta"]["playlist_count"]
    
    def is_playlist_active(self, user_id: str, playlist_name: str) -> bool:
        """Check if a playlist is currently active"""
        user_id_str = str(user_id)
        for ap in self.active_playlists:
            if ap["user_id"] == user_id_str and ap["playlist_name"].lower() == playlist_name.lower():
                return True
        return False
    
    def has_active_playlist(self, user_id: str) -> bool:
        """Check if user already has an active playlist"""
        user_id_str = str(user_id)
        for ap in self.active_playlists:
            if ap["user_id"] == user_id_str:
                return True
        return False
    
    def get_active_playlist_name(self, user_id: str) -> Optional[str]:
        """Get the name of user's active playlist if any"""
        user_id_str = str(user_id)
        for ap in self.active_playlists:
            if ap["user_id"] == user_id_str:
                return ap["playlist_name"]
        return None
    
    def get_active_playlists_list(self) -> List[Dict]:
        """Get list of all active playlists"""
        return [
            {
                "user_id": ap["user_id"],
                "username": ap.get("username", f"User_{ap['user_id']}"),
                "playlist_name": ap["playlist_name"],
                "position": idx + 1
            }
            for idx, ap in enumerate(self.active_playlists)
        ]
    
    async def activate_playlist(self, user_id: str, playlist_name: str, music_manager, username: Optional[str] = None) -> Tuple[bool, str]:
        """Activate a playlist for playback"""
        user_id_str = str(user_id)
        
        playlist = self.get_playlist(user_id, playlist_name)
        if not playlist:
            return False, f"Playlist '{playlist_name}' not found"
        
        if len(playlist["songs"]) == 0:
            return False, "This playlist is empty. Add songs before activating it"
        
        if self.has_active_playlist(user_id):
            active_name = self.get_active_playlist_name(user_id)
            return False, f"You already have an active playlist: '{active_name}'. Stop it first"
        
        if len(self.active_playlists) >= self.MAX_ACTIVE_PLAYLISTS:
            return False, f"Maximum active playlists ({self.MAX_ACTIVE_PLAYLISTS}) reached. Try again later"
        
        new_active = {
            "user_id": user_id_str,
            "username": username or f"User_{user_id_str}",
            "playlist_name": playlist["name"],
            "pointer": 0,
            "batch_size": self.BATCH_SIZE,
            "songs_injected": 0
        }
        
        self.active_playlists.append(new_active)
        self.batch_state[(user_id_str, playlist["name"])] = {
            "injected_count": 0,
            "finished_count": 0
        }
        
        await self._inject_batch_for_playlist(user_id_str, playlist["name"], music_manager)
        
        write_system_log(f"Playlist activated: {playlist['name']} by user {user_id}")
        return True, f"Playlist '{playlist['name']}' activated! First batch of songs added to queue"
    
    async def stop_playlist(self, user_id: str, playlist_name: str, is_admin: bool = False) -> Tuple[bool, str]:
        """Stop an active playlist"""
        user_id_str = str(user_id)
        
        found_idx = None
        found_playlist = None
        
        for idx, ap in enumerate(self.active_playlists):
            if ap["playlist_name"].lower() == playlist_name.lower():
                found_idx = idx
                found_playlist = ap
                break
        
        if found_idx is None or found_playlist is None:
            return False, f"Playlist '{playlist_name}' is not active"
        
        if found_playlist["user_id"] != user_id_str and not is_admin:
            return False, f"The playlist {playlist_name} doesn't belong to you"
        
        self.active_playlists.pop(found_idx)
        self.batch_state.pop((found_playlist["user_id"], found_playlist["playlist_name"]), None)
        
        if self.rotation_index >= len(self.active_playlists):
            self.rotation_index = 0
        
        write_system_log(f"Playlist stopped: {playlist_name}")
        return True, f"Playlist '{playlist_name}' stopped successfully"
    
    async def _inject_batch_for_playlist(self, user_id: str, playlist_name: str, music_manager):
        """Inject a batch of songs from playlist to queue"""
        playlist = self.get_playlist(user_id, playlist_name)
        if not playlist:
            return
        
        ap = None
        for item in self.active_playlists:
            if item["user_id"] == user_id and item["playlist_name"] == playlist_name:
                ap = item
                break
        
        if not ap:
            return
        
        pointer = ap["pointer"]
        songs = playlist["songs"]
        to_inject = songs[pointer:pointer + ap["batch_size"]]
        
        if not to_inject:
            await self.stop_playlist(user_id, playlist_name, is_admin=True)
            return
        
        username = ap.get("username", f"User_{user_id}")
        
        for song_title in to_inject:
            try:
                result = await music_manager.play_song(
                    song_title, 
                    is_autoplay=False,
                    source_playlist=playlist_name,
                    owner_username=username
                )
                if result and result.get('status') == 'queued':
                    self.batch_state[(user_id, playlist_name)]["injected_count"] += 1
                    ap["songs_injected"] += 1
                    write_system_log(f"Injected song from playlist {playlist_name} (@{username}): {song_title}")
            except Exception as e:
                write_system_log(f"Error injecting song {song_title}: {e}")
        
        ap["pointer"] += len(to_inject)
        
        if ap["pointer"] >= len(songs):
            write_system_log(f"Playlist {playlist_name} finished all songs")
            await self.stop_playlist(user_id, playlist_name, is_admin=True)
    
    async def on_song_finished(self, song_metadata: Dict, music_manager):
        """Handle song completion and trigger rotation if needed"""
        source_playlist = song_metadata.get("source_playlist")
        owner_id = song_metadata.get("owner")
        
        if not source_playlist or not owner_id:
            return
        
        key = (str(owner_id), source_playlist)
        if key not in self.batch_state:
            return
        
        self.batch_state[key]["finished_count"] += 1
        
        if self.batch_state[key]["finished_count"] >= self.INJECT_TRIGGER:
            self.batch_state[key]["finished_count"] = 0
            
            if len(self.active_playlists) > 0:
                self.rotation_index = (self.rotation_index + 1) % len(self.active_playlists)
                next_playlist = self.active_playlists[self.rotation_index]
                await self._inject_batch_for_playlist(
                    next_playlist["user_id"],
                    next_playlist["playlist_name"],
                    music_manager
                )
    
    def store_pending_removal(self, user_id: str, playlist_name: str, matches: List[Tuple[int, str]]):
        """Store pending removal confirmation"""
        self.pending_removals[str(user_id)] = {
            "created_at": time.time(),
            "playlist": playlist_name,
            "matches": matches
        }
    
    def get_pending_removal(self, user_id: str) -> Optional[Dict]:
        """Get pending removal if not expired"""
        pending = self.pending_removals.get(str(user_id))
        if not pending:
            return None
        
        if time.time() - pending["created_at"] > self.CONFIRMATION_TIMEOUT:
            del self.pending_removals[str(user_id)]
            return None
        
        return pending
    
    def clear_pending_removal(self, user_id: str):
        """Clear pending removal"""
        self.pending_removals.pop(str(user_id), None)
    
    def _find_playlist_name(self, user_data: Dict, name: str) -> Optional[str]:
        """Find playlist name (case-insensitive)"""
        for pl_name in user_data["playlists"].keys():
            if pl_name.lower() == name.lower():
                return pl_name
        return None
