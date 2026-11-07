"""
Mode Manager - Manages bot mode configuration
"""
import os
from core.utils import load_json_data, save_json_data


class ModeManager:
    """Manages bot mode settings"""
    
    def __init__(self, file_path="systems/modes/data/mode_config.json"):
        self.file_path = file_path
        self.current_mode = "old_bollywood"
        self.load_mode()
    
    def load_mode(self):
        """Load current mode from file"""
        data = load_json_data(self.file_path, {'mode': 'old_bollywood'})
        self.current_mode = data.get('mode', 'old_bollywood')
        print(f"✅ Loaded saved mode: {self.current_mode}")
    
    def save_mode(self, mode):
        """Save current mode to file"""
        self.current_mode = mode
        if save_json_data(self.file_path, {'mode': mode}):
            print(f"💾 Saved mode: {mode}")
        else:
            print(f"⚠️ Error saving mode")
    
    def get_mode(self):
        """Get current mode"""
        return self.current_mode
