
"""
Shop commands - Item search and purchase commands
"""
from core.error_handler import log_error_to_file


def register(bot):
    """Register shop commands with the bot"""
    
    @bot.command("buy")
    async def buy_cmd(bot, user, message):
        """Search and buy items from the shop"""
        try:
            parts = message.split(maxsplit=1)
            query = parts[1].strip() if len(parts) > 1 else ""
            
            # Ensure items are loaded from API
            await bot.shop.ensure_items_loaded(bot.webapi)
            
            # Check if user is selecting from search results (e.g., "!buy 1")
            if query.isdigit():
                await bot.shop.handle_select(
                    user.id,
                    query,
                    bot.highrise,
                    bot.inventory_manager,
                    lambda msg: bot.send_message(msg, user.id)
                )
            else:
                # Search for item by name
                await bot.shop.handle_buy_command(
                    user.id,
                    query,
                    bot.highrise,
                    bot.webapi,
                    bot.inventory_manager,
                    lambda msg: bot.send_message(msg, user.id)
                )
        except Exception as e:
            log_error_to_file("buy_cmd", e)
            await bot.send_message(f"❌ Error: {str(e)[:50]}", user.id)
    
    @bot.command("confirm")
    async def confirm_cmd(bot, user, message):
        """Confirm pending purchase"""
        try:
            await bot.shop.handle_confirm(
                user.id,
                bot.highrise,
                bot.inventory_manager,
                lambda msg: bot.send_message(msg, user.id)
            )
        except Exception as e:
            log_error_to_file("confirm_cmd", e)
            await bot.send_message(f"❌ Error: {str(e)[:50]}", user.id)
    
    @bot.command("cancel")
    async def cancel_cmd(bot, user, message):
        """Cancel pending purchase"""
        try:
            await bot.shop.handle_cancel(
                user.id,
                lambda msg: bot.send_message(msg, user.id)
            )
        except Exception as e:
            log_error_to_file("cancel_cmd", e)
            await bot.send_message(f"❌ Error: {str(e)[:50]}", user.id)
