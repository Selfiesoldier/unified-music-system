"""
Message Utilities - Auto-chunking and sending utilities for Highrise messages
"""
import asyncio
from typing import List


class MessageChunker:
    """Handles automatic message chunking for Highrise's character limits"""

    DEFAULT_LIMIT = 240  # Highrise's safe character limit
    DELAY_BETWEEN_CHUNKS = 1.5  # Seconds between chunk sends (chat/whisper)
    DM_DELAY_BETWEEN_CHUNKS = 0  # Seconds between DM chunks (instant)

    @staticmethod
    def chunk_message(text: str, max_length: int = DEFAULT_LIMIT) -> List[str]:
        """
        Split a message into chunks that fit within the character limit.
        Tries to split at newlines when possible to preserve formatting.

        Args:
            text: The message text to chunk
            max_length: Maximum characters per chunk (default: 240)

        Returns:
            List of message chunks
        """
        if len(text) <= max_length:
            return [text]

        chunks = []
        lines = text.split('\n')
        current_chunk = ""

        for line in lines:
            # If a single line is longer than max_length, we need to hard-split it
            if len(line) > max_length:
                # Save current chunk if it has content
                if current_chunk:
                    chunks.append(current_chunk.rstrip())
                    current_chunk = ""

                # Hard-split the long line
                while len(line) > max_length:
                    chunks.append(line[:max_length])
                    line = line[max_length:]

                # Add remainder to current chunk
                if line:
                    current_chunk = line + "\n"
            # If adding this line would exceed limit, save current chunk
            elif len(current_chunk) + len(line) + 1 > max_length:
                if current_chunk:
                    chunks.append(current_chunk.rstrip())
                current_chunk = line + "\n"
            else:
                current_chunk += line + "\n"

        # Add the last chunk
        if current_chunk:
            chunks.append(current_chunk.rstrip())

        return chunks if chunks else [text[:max_length]]

    @staticmethod
    async def send_chunked_chat(highrise_client, message: str, max_length: int = DEFAULT_LIMIT):
        """
        Automatically chunk and send a chat message.

        Args:
            highrise_client: The bot's highrise client
            message: The message to send
            max_length: Maximum characters per chunk
        """
        chunks = MessageChunker.chunk_message(message, max_length)

        for i, chunk in enumerate(chunks):
            try:
                await highrise_client.chat(chunk)
            except (ConnectionResetError, OSError, Exception) as chat_err:
                err_str = str(chat_err).lower()
                if "closing transport" in err_str or "connection" in err_str or "closed" in err_str:
                    print(f"⚠️ [Chat] Transport closed while sending message, skipped cleanly ({chat_err})")
                    return i
                raise
            # Add delay between chunks (except after the last one)
            if i < len(chunks) - 1:
                await asyncio.sleep(MessageChunker.DELAY_BETWEEN_CHUNKS)

        return len(chunks)

    @staticmethod
    async def send_chunked_whisper(highrise_client, user_id: str, message: str, max_length: int = DEFAULT_LIMIT):
        """
        Automatically chunk and send a whisper message.

        Args:
            highrise_client: The bot's highrise client
            user_id: The user ID to whisper to
            message: The message to send
            max_length: Maximum characters per chunk
        """
        chunks = MessageChunker.chunk_message(message, max_length)

        for i, chunk in enumerate(chunks):
            try:
                await highrise_client.send_whisper(user_id, chunk)
            except (ConnectionResetError, OSError, Exception) as whisper_err:
                err_str = str(whisper_err).lower()
                if "closing transport" in err_str or "connection" in err_str or "closed" in err_str:
                    print(f"⚠️ [Whisper] Transport closed while sending whisper, skipped cleanly ({whisper_err})")
                    return i
                raise
            # Add delay between chunks (except after the last one)
            if i < len(chunks) - 1:
                await asyncio.sleep(MessageChunker.DELAY_BETWEEN_CHUNKS)

        return len(chunks)


class AutoChunkingMessenger:
    """
    Wrapper class that provides auto-chunking versions of Highrise messaging methods.
    Use this to replace direct calls to bot.highrise.chat() and bot.highrise.send_whisper()
    """

    def __init__(self, highrise_client):
        """
        Initialize with a Highrise client.

        Args:
            highrise_client: The bot's highrise client instance
        """
        self.highrise = highrise_client
        self._original_chat = highrise_client.chat
        self._original_whisper = highrise_client.send_whisper

    async def chat(self, message: str, auto_chunk: bool = True, max_length: int = 240):
        """
        Send a chat message with automatic chunking.

        Args:
            message: The message to send
            auto_chunk: If True, automatically chunk long messages (default: True)
            max_length: Maximum characters per chunk (default: 240)
        """
        if auto_chunk and len(message) > max_length:
            return await MessageChunker.send_chunked_chat(self.highrise, message, max_length)
        else:
            return await self._original_chat(message)

    async def send_whisper(self, user_id: str, message: str, auto_chunk: bool = True, max_length: int = 240):
        """
        Send a whisper message with automatic chunking.

        Args:
            user_id: The user ID to whisper to
            message: The message to send
            auto_chunk: If True, automatically chunk long messages (default: True)
            max_length: Maximum characters per chunk (default: 240)
        """
        if auto_chunk and len(message) > max_length:
            return await MessageChunker.send_chunked_whisper(self.highrise, user_id, message, max_length)
        else:
            return await self._original_whisper(user_id, message)