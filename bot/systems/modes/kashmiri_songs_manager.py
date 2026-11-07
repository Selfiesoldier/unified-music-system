"""
Kashmiri Songs Manager - Manages Kashmiri songs playlist
"""
import os
import json
from core.utils import load_json_data, save_json_data


class KashmiriSongsManager:
    """Manages Kashmiri songs playlist"""
    
    def __init__(self, file_path="systems/modes/data/kashmiri_songs.json"):
        self.file_path = file_path
        self.songs = []
        self.load_songs()
    
    def load_songs(self):
        """Load Kashmiri songs from file"""
        self.songs = load_json_data(self.file_path, [])
        if not self.songs:
            print("⚠️ No kashmiri songs file found, creating empty one")
            self.save_songs()
        else:
            print(f"✅ Loaded {len(self.songs)} kashmiri songs")
    
    def save_songs(self):
        """Save Kashmiri songs to file"""
        if save_json_data(self.file_path, self.songs):
            pass
        else:
            print(f"⚠️ Error saving kashmiri songs")
    
    def get_songs(self):
        """Get all Kashmiri songs"""
        return self.songs.copy()
    
    def get_random_song(self):
        """Get a random Kashmiri song"""
        import random
        if self.songs:
            return random.choice(self.songs)
        return None
