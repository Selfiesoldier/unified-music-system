import json
import os
import time
from datetime import datetime

class HistoryManager:
    """Manages user history for the bot (CRM) with debounced disk writes."""
    
    def __init__(self, data_file="systems/admin/data/user_history.json"):
        self.data_file = data_file
        self.history = {}
        self._is_dirty = False
        self._last_save_time = time.time()
        self._ensure_data_file()
        self.load_history()
        
    def _ensure_data_file(self):
        os.makedirs(os.path.dirname(self.data_file), exist_ok=True)
        if not os.path.exists(self.data_file):
            with open(self.data_file, 'w', encoding='utf-8') as f:
                json.dump({}, f)
                
    def load_history(self):
        try:
            with open(self.data_file, 'r', encoding='utf-8') as f:
                self.history = json.load(f)
        except Exception as e:
            print(f"⚠️ Error loading user history: {e}")
            self.history = {}
            
    def save_history(self):
        try:
            with open(self.data_file, 'w', encoding='utf-8') as f:
                json.dump(self.history, f, indent=2)
            self._is_dirty = False
            self._last_save_time = time.time()
        except Exception as e:
            print(f"❌ Error saving user history: {e}")
            
    def flush(self):
        """Flush pending history changes to disk if dirty."""
        if self._is_dirty:
            self.save_history()

    def record_join(self, user_id, username):
        now = datetime.now().isoformat()
        if user_id not in self.history:
            self.history[user_id] = {
                "username": username,
                "first_seen": now,
                "last_seen": now,
                "messages_sent": 0,
                "joins": 1
            }
        else:
            self.history[user_id]["username"] = username
            self.history[user_id]["last_seen"] = now
            self.history[user_id]["joins"] = self.history[user_id].get("joins", 0) + 1
            
        self.save_history()
        
    def record_message(self, user_id, username):
        if user_id in self.history:
            self.history[user_id]["messages_sent"] = self.history[user_id].get("messages_sent", 0) + 1
            self.history[user_id]["last_seen"] = datetime.now().isoformat()
            self._is_dirty = True
        else:
            self.record_join(user_id, username)
            self.history[user_id]["messages_sent"] = 1
            return

        # Debounced saving: save at most once every 60 seconds during active chat
        if self._is_dirty and (time.time() - self._last_save_time > 60):
            self.save_history()
        
    def get_all_history(self):
        return self.history
