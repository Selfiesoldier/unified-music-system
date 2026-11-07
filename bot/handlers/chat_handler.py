"""
Chat Handler - Handles incoming chat messages and commands
"""
from core.error_handler import safe_call
from core.cooldowns import check_cd
from core.logger import write_command_log
from core.context import message_context


async def handle_chat(bot, user, message):
    """Handle chat messages with centralized error handling"""
    # Ignore system messages and notifications (e.g., "you got a tip!")
    if not message or message.strip().lower() in ["you got a tip!", ""]:
        return

    await safe_call(_process_chat, bot, user, message)


async def _process_chat(bot, user, message):
    """Internal chat processing logic"""
    print(f"{user.username}: {message}")

    msg_lower = message.lower().strip()

    command_parts = msg_lower.split()
    if not command_parts:
        return

    first_word = command_parts[0]
    command_name = ""

    # Strictly check only / or // prefix
    if first_word.startswith("//"):
        command_name = first_word[2:]
    elif first_word.startswith("/"):
        command_name = first_word[1:]
    else:
        return  # Strictly ignore any other prefix like ! or plain text

    # Global anti-spam cooldown (1 second between any command)
    remaining = check_cd(user.id, "any_command", 1)
    if remaining > 0:
        return  # Silently ignore spam

    # Get handler from registry
    handler = bot.command_registry.get_handler(command_name)

    if handler:
        # Log the command execution
        args = " ".join(message.split()[1:]) if len(message.split()) > 1 else ""
        write_command_log(user.username, user.id, command_name, args)

        # Set message context for this async task (safe for concurrent commands)
        token = message_context.set("chat")
        try:
            # Execute command with centralized error handling
            await safe_call(handler, bot, user, message)
        finally:
            # Always reset context to prevent leakage
            message_context.reset(token)
    # If no handler found, silently ignore (command doesn't exist)