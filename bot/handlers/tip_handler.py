"""
Tip Handler - Handles tip events for economy system
"""
from core.error_handler import safe_call
from core.logger import write_tip_log
from core.color_formatter import Colors, MessageFormatter


async def _process_tip(bot, sender, receiver, tip):
    """Internal function to process tip"""
    # Only process if bot is the receiver
    if receiver.id != bot.bot_user_id:
        return
    
    # Get tip amount (tip object has an amount attribute)
    gold_amount = tip.amount if hasattr(tip, 'amount') else tip
    
    # Convert gold to points
    result = await bot.economy.process_tip(sender.id, gold_amount)
    
    # Handle different return formats
    if isinstance(result, tuple):
        success, points_earned, pack_name = result
    else:
        points_earned = result
        pack_name = ""
    
    # Log ALL tips, even if they give 0 points (for audit trail)
    write_tip_log(sender.username, sender.id, gold_amount, points_earned, pack_name or "Below minimum" if points_earned == 0 else pack_name or "")
    
    if points_earned > 0:
        balance = await bot.economy.get_balance(sender.id)
        
        await bot.highrise.chat(
            f"{Colors.GOLD}💰 Thank you so much for the tip!\n"
            f"{Colors.PINK}🎵 Your support helps keep the music playing!\n"
            f"{Colors.MINT}✨ {points_earned} points added to your account\n"
            f"{Colors.GOLD}💎 Your balance: {balance} pts\n"
            f"{Colors.LAVENDER}🎶 Use /balance or /play to enjoy!"
        )
    else:
        # Tip was too small - inform user about minimum
        await bot.highrise.chat(
            f"{Colors.GOLD}💰 Thank you for the tip {Colors.PINK}{sender.username}{Colors.GOLD}!\n"
            f"{Colors.SKY_BLUE}ℹ️ Minimum tip for points: 10 gold = 50 pts\n"
            f"{Colors.CYAN}💡 Tip 10g or more to earn Music Points!"
        )


async def handle_tip(bot, sender, receiver, tip):
    """Handle tip events with centralized error handling"""
    await safe_call(_process_tip, bot, sender, receiver, tip)
