"""
Global bot instance reference - allows access to the running bot from anywhere
"""

_bot_instance = None

def set_bot_instance(bot):
    """Set the global bot instance"""
    global _bot_instance
    _bot_instance = bot

def get_bot_instance():
    """Get the global bot instance"""
    return _bot_instance
