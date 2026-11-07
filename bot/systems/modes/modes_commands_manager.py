"""
Modes Commands Manager - Manages mode operations (add, modify, list)
"""
import os
import json
from typing import List, Dict, Any, Optional


class ModesCommandsManager:
    """Manages mode commands and operations"""
    
    MODES_DIR = "systems/modes/data/modes"
    
    @staticmethod
    def _refresh_recent_manager_if_needed(mode_name: str, bot=None):
        """Refresh RecentSongsManager cache if the recent mode was modified"""
        if mode_name == "recent":
            try:
                from core.bot_instance import get_bot_instance
                bot_instance = get_bot_instance()
                if bot_instance and hasattr(bot_instance, 'recent_songs_manager'):
                    bot_instance.recent_songs_manager.refresh()
                    print("✅ Refreshed RecentSongsManager cache")
                else:
                    print(f"⚠️ Bot instance not available for recent mode refresh")
            except Exception as e:
                print(f"⚠️ Could not refresh RecentSongsManager: {e}")
    
    @staticmethod
    def get_all_modes() -> List[Dict[str, Any]]:
        """Get all available modes with their details"""
        modes = []
        
        if not os.path.exists(ModesCommandsManager.MODES_DIR):
            return modes
        
        try:
            for filename in os.listdir(ModesCommandsManager.MODES_DIR):
                if filename.endswith('.json'):
                    filepath = os.path.join(ModesCommandsManager.MODES_DIR, filename)
                    try:
                        with open(filepath, 'r') as f:
                            mode_data = json.load(f)
                            modes.append(mode_data)
                    except Exception as e:
                        print(f"⚠️ Failed to load mode file {filename}: {e}")
        except Exception as e:
            print(f"⚠️ Failed to read modes directory: {e}")
        
        return modes
    
    @staticmethod
    def get_mode_details(mode_name: str) -> Optional[Dict[str, Any]]:
        """Get details of a specific mode"""
        filepath = os.path.join(ModesCommandsManager.MODES_DIR, f"{mode_name}.json")
        
        if not os.path.exists(filepath):
            return None
        
        try:
            with open(filepath, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠️ Failed to load mode {mode_name}: {e}")
            return None
    
    @staticmethod
    def create_mode(mode_name: str, display_name: str, description: str, songs: Optional[List[str]] = None) -> bool:
        """Create a new mode"""
        if songs is None:
            songs = []
        
        mode_name = mode_name.lower().replace(' ', '_')
        filepath = os.path.join(ModesCommandsManager.MODES_DIR, f"{mode_name}.json")
        
        if os.path.exists(filepath):
            print(f"⚠️ Mode {mode_name} already exists")
            return False
        
        mode_data = {
            "name": mode_name,
            "display_name": display_name,
            "description": description,
            "songs": songs
        }
        
        try:
            os.makedirs(ModesCommandsManager.MODES_DIR, exist_ok=True)
            with open(filepath, 'w') as f:
                json.dump(mode_data, f, indent=2)
            print(f"✅ Created mode: {mode_name}")
            
            from systems.music.queue_manager import QueueManager
            QueueManager.reload_modes()
            
            return True
        except Exception as e:
            print(f"⚠️ Failed to create mode {mode_name}: {e}")
            return False
    
    @staticmethod
    def add_songs_to_mode(mode_name: str, songs: List[str], bot=None) -> bool:
        """Add songs to an existing mode"""
        mode_data = ModesCommandsManager.get_mode_details(mode_name)
        
        if not mode_data:
            print(f"⚠️ Mode {mode_name} not found")
            return False
        
        current_songs = mode_data.get('songs', [])
        
        new_songs = [song for song in songs if song not in current_songs]
        if not new_songs:
            print(f"⚠️ All songs already exist in mode {mode_name}")
            return False
        
        current_songs.extend(new_songs)
        mode_data['songs'] = current_songs
        
        filepath = os.path.join(ModesCommandsManager.MODES_DIR, f"{mode_name}.json")
        
        try:
            with open(filepath, 'w') as f:
                json.dump(mode_data, f, indent=2)
            print(f"✅ Added {len(new_songs)} songs to mode: {mode_name}")
            
            from systems.music.queue_manager import QueueManager
            QueueManager.reload_modes()
            
            ModesCommandsManager._refresh_recent_manager_if_needed(mode_name, bot)
            
            return True
        except Exception as e:
            print(f"⚠️ Failed to update mode {mode_name}: {e}")
            return False
    
    @staticmethod
    def remove_songs_from_mode(mode_name: str, songs: List[str], bot=None) -> tuple:
        """
        Remove songs from an existing mode by name or index.
        Returns tuple of (removed_songs, not_found_items).
        
        Args:
            mode_name: Name of the mode
            songs: List of song names OR indices (as strings like "1", "5", "12")
            bot: Bot instance (optional)
            
        Returns:
            Tuple of (list of removed song names, list of not found items)
            Returns (None, []) on failure
        """
        mode_data = ModesCommandsManager.get_mode_details(mode_name)
        
        if not mode_data:
            print(f"⚠️ Mode {mode_name} not found")
            return None, []
        
        current_songs = mode_data.get('songs', [])
        
        removed_songs = []
        indices_to_remove = []
        not_found_items = []
        
        # Separate indices from song names and track what wasn't found
        for item in songs:
            if item.isdigit():
                # It's an index
                idx = int(item)
                if 1 <= idx <= len(current_songs):
                    indices_to_remove.append(idx - 1)  # Convert to 0-based
                else:
                    not_found_items.append(f"#{idx}")
                    print(f"⚠️ Invalid index: {idx} (must be 1-{len(current_songs)})")
            else:
                # It's a song name
                if item in current_songs:
                    indices_to_remove.append(current_songs.index(item))
                else:
                    not_found_items.append(item)
        
        # Remove duplicates and sort in reverse order (to avoid index shifting issues)
        indices_to_remove = sorted(set(indices_to_remove), reverse=True)
        
        # Remove songs by index
        for idx in indices_to_remove:
            removed_songs.append(current_songs[idx])
            current_songs.pop(idx)
        
        if not removed_songs:
            print(f"⚠️ No matching songs found in mode {mode_name}")
            return None, not_found_items
        
        mode_data['songs'] = current_songs
        
        filepath = os.path.join(ModesCommandsManager.MODES_DIR, f"{mode_name}.json")
        
        try:
            with open(filepath, 'w') as f:
                json.dump(mode_data, f, indent=2)
            print(f"✅ Removed {len(removed_songs)} songs from mode: {mode_name}")
            
            from systems.music.queue_manager import QueueManager
            QueueManager.reload_modes()
            
            ModesCommandsManager._refresh_recent_manager_if_needed(mode_name, bot)
            
            return removed_songs, not_found_items
        except Exception as e:
            print(f"⚠️ Failed to update mode {mode_name}: {e}")
            return None, []
    
    @staticmethod
    def delete_mode(mode_name: str, bot=None) -> bool:
        """Delete a mode"""
        filepath = os.path.join(ModesCommandsManager.MODES_DIR, f"{mode_name}.json")
        
        if not os.path.exists(filepath):
            print(f"⚠️ Mode {mode_name} not found")
            return False
        
        try:
            os.remove(filepath)
            print(f"✅ Deleted mode: {mode_name}")
            
            from systems.music.queue_manager import QueueManager
            QueueManager.reload_modes()
            
            ModesCommandsManager._refresh_recent_manager_if_needed(mode_name, bot)
            
            return True
        except Exception as e:
            print(f"⚠️ Failed to delete mode {mode_name}: {e}")
            return False
