"""
Queue Manager - Manages auto-play queues and playlists
"""
import random
import json
import os
from typing import List, Dict, Any, Optional


class QueueManager:
    """Manages auto-play queues and playlist modes"""
    
    MODES_DIR = os.path.join(os.path.dirname(__file__), "../modes/data/modes")
    _modes_cache = None
    
    @staticmethod
    def _load_modes_from_json() -> Dict[str, List[str]]:
        """Load all modes from JSON files"""
        if QueueManager._modes_cache is not None:
            return QueueManager._modes_cache
        
        modes = {"recent": []}
        
        if not os.path.exists(QueueManager.MODES_DIR):
            print(f"⚠️ Modes directory not found: {QueueManager.MODES_DIR}")
            return modes
        
        try:
            for filename in os.listdir(QueueManager.MODES_DIR):
                if filename.endswith('.json'):
                    filepath = os.path.join(QueueManager.MODES_DIR, filename)
                    try:
                        with open(filepath, 'r') as f:
                            mode_data = json.load(f)
                            mode_name = mode_data.get('name')
                            songs = mode_data.get('songs', [])
                            if mode_name and isinstance(songs, list):
                                modes[mode_name] = songs
                                print(f"✅ Loaded mode: {mode_name} ({len(songs)} songs)")
                    except Exception as e:
                        print(f"⚠️ Failed to load mode file {filename}: {e}")
        except Exception as e:
            print(f"⚠️ Failed to read modes directory: {e}")
        
        QueueManager._modes_cache = modes
        return modes
    
    @staticmethod
    def reload_modes():
        """Force reload modes from JSON files"""
        QueueManager._modes_cache = None
        return QueueManager._load_modes_from_json()
    
    @staticmethod
    def get_modes() -> List[str]:
        """Get list of available modes"""
        modes = QueueManager._load_modes_from_json()
        return list(modes.keys())
    
    @staticmethod
    def get_playlist(mode: str) -> List[str]:
        """Get playlist for a specific mode"""
        modes = QueueManager._load_modes_from_json()
        playlist = modes.get(mode)
        if playlist is None:
            return modes.get("old_bollywood", [])
        return playlist
    
    @staticmethod
    def get_random_song(mode: str) -> str:
        """Get a random song from the specified mode"""
        playlist = QueueManager.get_playlist(mode)
        return random.choice(playlist) if playlist else "old bollywood songs"
    
    # Persistent Queue Functions
    QUEUE_PATH = os.path.join(os.path.dirname(__file__), "data/queue.json")
    
    @staticmethod
    def load_queue() -> List[Dict[str, Any]]:
        """Load queue from persistent storage"""
        if not os.path.exists(QueueManager.QUEUE_PATH):
            return []
        try:
            with open(QueueManager.QUEUE_PATH, 'r') as f:
                queue = json.load(f)
                return queue if isinstance(queue, list) else []
        except Exception as e:
            print(f"⚠️ Failed to load queue: {e}")
            return []
    
    @staticmethod
    def save_queue(queue: List[Dict[str, Any]]) -> bool:
        """Save queue to persistent storage"""
        try:
            os.makedirs(os.path.dirname(QueueManager.QUEUE_PATH), exist_ok=True)
            with open(QueueManager.QUEUE_PATH, 'w') as f:
                json.dump(queue, f, indent=2)
            return True
        except Exception as e:
            print(f"⚠️ Failed to save queue: {e}")
            return False
    
    @staticmethod
    def clear_saved_queue() -> bool:
        """Clear the saved queue file"""
        return QueueManager.save_queue([])
