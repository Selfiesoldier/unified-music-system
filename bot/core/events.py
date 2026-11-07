"""
Event bus system for cross-module communication
"""
from typing import Callable, Dict, List


class EventBus:
    """Simple event bus for pub/sub pattern"""
    
    def __init__(self):
        self.subscribers: Dict[str, List[Callable]] = {}
    
    def subscribe(self, event_name: str, callback: Callable):
        """Subscribe to an event"""
        if event_name not in self.subscribers:
            self.subscribers[event_name] = []
        self.subscribers[event_name].append(callback)
    
    async def publish(self, event_name: str, *args, **kwargs):
        """Publish an event to all subscribers"""
        if event_name in self.subscribers:
            for callback in self.subscribers[event_name]:
                try:
                    await callback(*args, **kwargs)
                except Exception as e:
                    print(f"⚠️ Error in event handler for {event_name}: {e}")


# Global event bus instance
event_bus = EventBus()
