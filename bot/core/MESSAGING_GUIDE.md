# Messaging Guide - Auto-Chunking Messages in Highrise Bot

## Overview
The bot now has built-in automatic message chunking to handle messages that exceed Highrise's 240-character limit.

## How to Use

### Method 1: Use bot.send_message() (Recommended)
This is the easiest way - automatically chunks both chat and whisper messages:

```python
# Send a chat message (auto-chunks if too long)
await bot.send_message("This is a very long message that might exceed 240 characters...")

# Send a whisper message (auto-chunks if too long)
await bot.send_message("This is a private message to the user...", user_id=user.id)

# Custom character limit (default is 240)
await bot.send_message("Long message here...", max_length=200)
```

### Method 2: Use MessageChunker Directly
For more control:

```python
from core.message_utils import MessageChunker

# Just chunk the message (returns list of strings)
chunks = MessageChunker.chunk_message(long_message, max_length=240)

# Chunk and send as chat
await MessageChunker.send_chunked_chat(bot.highrise, long_message, max_length=240)

# Chunk and send as whisper
await MessageChunker.send_chunked_whisper(bot.highrise, user_id, long_message, max_length=240)
```

### Method 3: Use MessageFormatter.split_message()
For existing code that already uses MessageFormatter:

```python
from core.color_formatter import MessageFormatter

# Split a message into chunks
chunks = MessageFormatter.split_message(long_message, limit=240)

# Send each chunk
for chunk in chunks:
    await bot.highrise.chat(chunk)
    await asyncio.sleep(0.3)
```

## Examples

### Example 1: Long Help Message
```python
@bot.command("longhelp")
async def longhelp_cmd(user, message):
    help_text = """
    This is a very long help message with lots of information.
    It might have many lines and exceed the 240 character limit.
    But don't worry - it will automatically be chunked!
    
    Commands:
    - !command1 - Does something
    - !command2 - Does something else
    - !command3 - Does another thing
    """
    # Automatically chunks if needed
    await bot.send_message(help_text)
```

### Example 2: Private Message to User
```python
@bot.command("profile")
async def profile_cmd(user, message):
    profile = f"""
    Your Profile:
    Username: {user.username}
    Points: 1000
    VIP Status: Yes
    Playlists: 5
    Songs Added: 120
    """
    # Sends as whisper, auto-chunks if needed
    await bot.send_message(profile, user_id=user.id)
```

### Example 3: Manual Chunking
```python
from core.message_utils import MessageChunker

@bot.command("playlist")
async def playlist_cmd(user, message):
    # Build a long playlist message
    playlist_msg = build_playlist_display()  # Returns very long string
    
    # Manually chunk it
    chunks = MessageChunker.chunk_message(playlist_msg, max_length=240)
    
    # Send each chunk
    for i, chunk in enumerate(chunks):
        await bot.highrise.send_whisper(user.id, chunk)
        if i < len(chunks) - 1:
            await asyncio.sleep(0.3)
```

## Character Limits
- **Highrise Safe Limit**: 240 characters (recommended)
- **Highrise Hard Limit**: ~256 characters (may cause errors)
- **Default in Tools**: 240 characters

## Best Practices

1. **Use bot.send_message() for new code** - It's the simplest and most maintainable

2. **Set appropriate delays** - The system automatically adds 0.3s delays between chunks

3. **Test long messages** - Always test commands that might generate long output

4. **Consider user experience** - Too many chunks can be spammy. Consider:
   - Sending whispers instead of public chat for long messages
   - Summarizing information when possible
   - Using pagination for very long lists

5. **Don't over-chunk** - Short messages don't need chunking

## Technical Details

The chunking system:
- Splits at newlines when possible to preserve formatting
- Hard-splits lines that are longer than the limit
- Adds 0.3 second delays between chunks to avoid rate limiting
- Returns the number of chunks sent

## Migration Guide

If you have existing code that might send long messages:

**Old Code:**
```python
await bot.highrise.chat(long_message)  # Might fail!
```

**New Code:**
```python
await bot.send_message(long_message)  # Auto-chunks ✅
```

**Old Whisper:**
```python
await bot.highrise.send_whisper(user.id, long_message)  # Might fail!
```

**New Whisper:**
```python
await bot.send_message(long_message, user_id=user.id)  # Auto-chunks ✅
```
