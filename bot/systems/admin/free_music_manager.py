
"""
Free Music Manager - Handles persistent free music mode state
"""
import json
import os
import time
from typing import Optional


class FreeMusicManager:
    """Manages persistent free music mode state"""
    
    STATE_FILE = os.path.join(os.path.dirname(__file__), "data/free_music_state.json")
    
    @staticmethod
    def save_state(free_music_until: Optional[float]) -> bool:
        """Save free music state to disk"""
        try:
            os.makedirs(os.path.dirname(FreeMusicManager.STATE_FILE), exist_ok=True)
            state = {
                "free_music_until": free_music_until,
                "saved_at": time.time()
            }
            with open(FreeMusicManager.STATE_FILE, 'w') as f:
                json.dump(state, f, indent=2)
            return True
        except Exception as e:
            print(f"⚠️ Failed to save free music state: {e}")
            return False
    
    @staticmethod
    def load_state() -> Optional[float]:
        """Load free music state from disk"""
        try:
            if not os.path.exists(FreeMusicManager.STATE_FILE):
                return None
            
            with open(FreeMusicManager.STATE_FILE, 'r') as f:
                state = json.load(f)
            
            free_music_until = state.get("free_music_until")
            
            # Check if free music mode is still active
            if free_music_until and time.time() < free_music_until:
                remaining_minutes = int((free_music_until - time.time()) / 60)
                print(f"✅ Restored free music mode: {remaining_minutes} minutes remaining")
                return free_music_until
            else:
                # Free music mode expired, clear the state
                FreeMusicManager.save_state(None)
                return None
                
        except Exception as e:
            print(f"⚠️ Failed to load free music state: {e}")
            return None
    
    @staticmethod
    def clear_state() -> bool:
        """Clear free music state"""
        return FreeMusicManager.save_state(None)
