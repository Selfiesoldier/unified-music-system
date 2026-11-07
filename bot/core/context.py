
"""
Context Variables - Shared context for tracking message sources
"""
from contextvars import ContextVar
from typing import Optional

# Context variable for tracking message source (dm, chat, or None)
message_context: ContextVar[Optional[str]] = ContextVar('message_context', default=None)

# Context variable for tracking conversation_id when in DM context
conversation_context: ContextVar[Optional[str]] = ContextVar('conversation_context', default=None)
