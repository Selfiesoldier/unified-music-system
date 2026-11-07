# Universal Message Chunking System

## Overview

The **Universal Message Chunking System** ensures that **EVERY** message sent through the Highrise bot is automatically chunked to respect the platform's strict character limits. This prevents message errors and ensures smooth communication.

## How It Works

### Chunking Proxy Architecture

When the bot starts (`on_start`), a `ChunkingHighriseProxy` wraps the Highrise client:

```python
self._core_highrise = self.highrise
self.highrise = ChunkingHighriseProxy(self._core_highrise)
```

This proxy **transparently intercepts** all calls to:
- `bot.highrise.chat()` - Public chat messages
- `bot.highrise.send_whisper()` - Whisper messages
- `bot.highrise.send_message()` - Direct messages (DMs)

All other Highrise SDK methods are forwarded to the real client unchanged.

### Character Limits

The system respects Highrise's character limits:
- **Chat**: 240 characters
- **Whisper**: 240 characters
- **DM**: 240 characters

### Smart Chunking

Messages are intelligently split:
1. **Preserves formatting**: Tries to split at newlines when possible
2. **Hard splits long lines**: If a single line exceeds the limit, it's split mid-sentence
3. **Automatic delays**: 1.5-second delay between chunks to prevent rate limiting

## Usage

### For Developers

**No code changes required!** Just use the normal Highrise methods:

```python
# These will ALL be automatically chunked:

# Public chat
await bot.highrise.chat("Your very long message here...")

# Whisper
await bot.highrise.send_whisper(user_id, "Your very long message here...")

# Direct message
await bot.highrise.send_message(conversation_id, "Your very long message here...")
```

### Example

```python
# Before: This would fail if message > 240 characters
long_message = "This is a very long message..." * 100
await bot.highrise.chat(long_message)

# After: Automatically chunked into multiple messages
# No code change needed - just works!
await bot.highrise.chat(long_message)
```

## Benefits

✅ **Zero code changes** - Works with existing code  
✅ **Prevents errors** - No more "message too long" errors  
✅ **Preserves formatting** - Smart splitting at newlines  
✅ **Automatic delays** - Prevents rate limiting  
✅ **Universal coverage** - Works for ALL message types  
✅ **Transparent** - Developers don't need to think about chunking  

## Technical Details

### Implementation

The `ChunkingHighriseProxy` class is a transparent proxy that:

1. Intercepts messaging methods (chat, send_whisper, send_message)
2. Routes them through the existing `MessageChunker` helpers
3. Forwards all other SDK methods/attributes to the real Highrise client
4. Preserves all SDK return values and behavior

### Benefits of Proxy Approach

- **No monkey-patching**: Clean lifecycle management
- **Reuses existing code**: Uses MessageChunker helpers (no duplication)
- **Preserves SDK behavior**: All return values and methods work normally
- **No reconnection issues**: Fresh proxy per connection

## Testing

The system is automatically tested on bot startup with the welcome message. Long messages in any command will be automatically chunked.

## Architecture

```
User Code
    ↓
bot.highrise.chat("long message")
    ↓
ChunkingHighriseProxy intercepts
    ↓
Routes to MessageChunker.send_chunked_chat()
    ↓
MessageChunker splits and sends chunks
    ↓
Real Highrise client methods
    ↓
Highrise Platform
```

## Compatibility

- Works with all existing commands
- Compatible with colored messages (Highrise color codes preserved)
- Works with context-aware messaging system
- No breaking changes to existing code

## Migration Guide

**No migration needed!** The system is automatically enabled when the bot starts. All existing code continues to work exactly as before, but now with automatic chunking protection.

---

**Status**: ✅ Enabled by default in MusicBot  
**Last Updated**: 2025  
**Maintainer**: Bot Development Team
