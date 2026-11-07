"""
Cooldown System - Prevents command spam and abuse

This system tracks command usage per user and enforces cooldown periods
to prevent:
- API rate limit violations
- Bot lag from spam
- Queue system abuse
- Economy exploits
- Outfit system freezing
"""
import time

# Dictionary to store cooldown data: {user_id:command_name: expiry_timestamp}
cooldowns = {}


def check_cd(user_id, command, seconds):
    """
    Check if user is on cooldown for a command
    
    Args:
        user_id: The user's ID (string or int)
        command: Command name (e.g., "play", "skip", "buy")
        seconds: Cooldown duration in seconds
    
    Returns:
        float: Remaining cooldown time in seconds (0 if not on cooldown)
    """
    now = time.time()
    key = f"{user_id}:{command}"
    
    # Check if user is still on cooldown
    if key in cooldowns and cooldowns[key] > now:
        return cooldowns[key] - now  # Return remaining time
    
    # Set new cooldown
    cooldowns[key] = now + seconds
    return 0  # No cooldown, proceed


def reset_cd(user_id, command):
    """
    Reset cooldown for a specific user and command
    Useful for admin overrides or refunds
    
    Args:
        user_id: The user's ID
        command: Command name to reset
    """
    key = f"{user_id}:{command}"
    if key in cooldowns:
        del cooldowns[key]


def get_remaining_cd(user_id, command):
    """
    Get remaining cooldown time without setting a new cooldown
    
    Args:
        user_id: The user's ID
        command: Command name
    
    Returns:
        float: Remaining cooldown time in seconds (0 if not on cooldown)
    """
    now = time.time()
    key = f"{user_id}:{command}"
    
    if key in cooldowns and cooldowns[key] > now:
        return cooldowns[key] - now
    
    return 0


def cleanup_expired():
    """
    Remove expired cooldowns to prevent memory bloat
    Should be called periodically
    """
    now = time.time()
    expired_keys = [key for key, expiry in cooldowns.items() if expiry <= now]
    for key in expired_keys:
        del cooldowns[key]
    
    return len(expired_keys)  # Return number of cleaned entries
