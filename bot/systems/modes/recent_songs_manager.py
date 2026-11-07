"""
Recent Songs Manager - Tracks recently played songs
"""
import os
import json
from core.utils import load_json_data, save_json_data


class RecentSongsManager:
    """Manages recently played songs list - now using JSON mode format"""
    
    def __init__(self, file_path="systems/modes/data/modes/recent.json", max_songs=300):
        self.file_path = file_path
        self.max_songs = max_songs
        self.songs = []
        self.load_songs()
    
    def load_songs(self):
        """Load songs from JSON mode file"""
        mode_data = load_json_data(self.file_path, {})
        self.songs = mode_data.get('songs', [])
        print(f"✅ Loaded {len(self.songs)} recent songs")
    
    def add_song(self, song_query):
        """Add a song to recent songs and update the JSON mode file"""
        self.load_songs()
        
        if song_query not in self.songs:
            self.songs.insert(0, song_query)
            if len(self.songs) > self.max_songs:
                self.songs = self.songs[:self.max_songs]
            self.save_songs()
    
    def save_songs(self):
        """Save songs to JSON mode file"""
        mode_data = {
            "name": "recent",
            "display_name": "Recent",
            "description": "Songs recently played by users",
            "songs": self.songs
        }
        if save_json_data(self.file_path, mode_data):
            from systems.music.queue_manager import QueueManager
            QueueManager.reload_modes()
        else:
            print(f"⚠️ Error saving recent songs")
    
    def refresh(self):
        """Refresh songs from disk (call after external modifications)"""
        self.load_songs()
    
    def get_songs(self):
        """Get all songs"""
        return self.songs.copy()
    
    def get_random_song(self):
        """Get a random song from recent songs"""
        import random
        if self.songs:
            return random.choice(self.songs)
        return None
