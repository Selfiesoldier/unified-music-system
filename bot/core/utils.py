"""
Utility functions used across the bot
"""
import json
import os
from typing import Any, Dict, Optional


def load_json_data(file_path: str, default: Any = None) -> Any:
    """Load JSON data from a file with error handling"""
    try:
        if os.path.exists(file_path):
            with open(file_path, 'r') as f:
                return json.load(f)
        else:
            return default if default is not None else {}
    except Exception as e:
        print(f"⚠️ Error loading {file_path}: {e}")
        return default if default is not None else {}


def save_json_data(file_path: str, data: Any) -> bool:
    """Save JSON data to a file with error handling"""
    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        print(f"⚠️ Error saving {file_path}: {e}")
        return False


def format_time(seconds: int) -> str:
    """Format seconds into MM:SS format"""
    minutes = seconds // 60
    secs = seconds % 60
    return f"{minutes}:{secs:02d}"


def parse_args(args: tuple, default: str = "") -> str:
    """Parse command arguments into a single string"""
    return " ".join(args) if args else default
