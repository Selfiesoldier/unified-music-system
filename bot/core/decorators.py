"""
Decorators for bot commands
"""
from functools import wraps
from typing import Callable


def admin_only(func: Callable) -> Callable:
    """Decorator to restrict command to admins only"""
    @wraps(func)
    async def wrapper(bot, user, message, *args, **kwargs):
        if not bot.admin.has_admin_access(user.username):
            await bot.highrise.chat("⛔ This command is for admins only!")
            return
        return await func(bot, user, message, *args, **kwargs)
    return wrapper


def owner_only(func: Callable) -> Callable:
    """Decorator to restrict command to bot owner only"""
    @wraps(func)
    async def wrapper(bot, user, message, *args, **kwargs):
        if not bot.admin.is_owner(user.username):
            await bot.highrise.chat("⛔ This command is for the bot owner only!")
            return
        return await func(bot, user, message, *args, **kwargs)
    return wrapper


def vip_only(func: Callable) -> Callable:
    """Decorator to restrict command to VIP users only"""
    @wraps(func)
    async def wrapper(bot, user, message, *args, **kwargs):
        if not bot.admin.has_vip_access(user.username):
            await bot.highrise.chat("⛔ This command is for VIP users only!")
            return
        return await func(bot, user, message, *args, **kwargs)
    return wrapper
