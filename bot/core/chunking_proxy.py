"""
Chunking Highrise Proxy - Transparent automatic message chunking
This proxy wraps the Highrise client to automatically chunk all messages
while preserving all other SDK functionality.
"""
from core.message_utils import MessageChunker


class ChunkingHighriseProxy:
    """
    A proxy that wraps the Highrise client to automatically chunk all messages.
    
    This proxy intercepts chat, whisper, and DM methods and routes them through
    the existing MessageChunker helpers, while all other attributes/methods are
    forwarded directly to the real Highrise client.
    
    Benefits:
    - No monkey-patching (clean lifecycle)
    - Reuses existing MessageChunker logic (no duplication)
    - Preserves all SDK return values and behavior
    - Transparent to all existing code
    """
    
    def __init__(self, highrise_client):
        """
        Create a chunking proxy around the Highrise client.
        
        Args:
            highrise_client: The real Highrise client instance
        """
        # Store the real client (use __dict__ to avoid infinite recursion in __getattr__)
        object.__setattr__(self, '_real_client', highrise_client)
    
    async def chat(self, message: str):
        """
        Auto-chunking version of highrise.chat()
        
        Args:
            message: The message to send to public chat
        """
        await MessageChunker.send_chunked_chat(self._real_client, message)
    
    async def send_whisper(self, user_id: str, message: str):
        """
        Auto-chunking version of highrise.send_whisper()
        
        Args:
            user_id: The user ID to whisper to
            message: The message to send
        """
        await MessageChunker.send_chunked_whisper(self._real_client, user_id, message)
    
    async def send_message(self, conversation_id: str, message: str):
        """
        Auto-chunking version of highrise.send_message() (for DMs)
        
        Args:
            conversation_id: The conversation ID to send to
            message: The message to send
        """
        # DM chunking with instant delivery (no delay)
        chunks = MessageChunker.chunk_message(message)
        for i, chunk in enumerate(chunks):
            await self._real_client.send_message(conversation_id, chunk)
            if i < len(chunks) - 1:
                import asyncio
                await asyncio.sleep(MessageChunker.DM_DELAY_BETWEEN_CHUNKS)
    
    def __getattr__(self, name):
        """
        Forward all other attribute access to the real Highrise client.
        This ensures all non-messaging SDK methods work normally.
        """
        return getattr(self._real_client, name)
    
    def __setattr__(self, name, value):
        """
        Forward all attribute setting to the real Highrise client.
        (Except for _real_client which is handled specially)
        """
        if name == '_real_client':
            object.__setattr__(self, name, value)
        else:
            setattr(self._real_client, name, value)
