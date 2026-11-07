"""
Economy commands - All economy-related bot commands
"""
import asyncio
from .economy_manager import EconomyManager
from .point_packs import PointPacks
from core.error_handler import log_error_to_file
from core.cooldowns import check_cd
from core.color_formatter import Colors, MessageFormatter, BeautifulMessages


def register(bot):
    """Register economy commands with the bot"""
    
    @bot.command("balance", "points")
    async def balance_cmd(bot, user, message):
        remaining = check_cd(user.id, "balance", 2)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return
        
        balance = await bot.economy.get_balance(user.id)
        await bot.send_message(MessageFormatter.balance(balance), user.id)
    
    @bot.command("packs", "packages")
    async def packs_cmd(bot, user, message):
        remaining = check_cd(user.id, "packs", 5)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return
        
        packs = PointPacks.get_all_packs()
        
        pack_msg1 = (
            f"{Colors.PINK}💎 Point Packages\n\n"
            f"{MessageFormatter.pack_display(packs['starter']['name'], packs['starter']['gold'], packs['starter']['points'], packs['starter']['description'], Colors.LIGHT_YELLOW)}\n\n"
            f"{MessageFormatter.pack_display(packs['basic']['name'], packs['basic']['gold'], packs['basic']['points'], packs['basic']['description'], Colors.GOLD)}"
        )
        pack_msg2 = (
            f"{Colors.PURPLE}🌟 Premium Packs\n\n"
            f"{MessageFormatter.pack_display(packs['premium']['name'], packs['premium']['gold'], packs['premium']['points'], packs['premium']['description'], Colors.VIOLET)}\n\n"
            f"{MessageFormatter.pack_display(packs['mega']['name'], packs['mega']['gold'], packs['mega']['points'], packs['mega']['description'], Colors.MAGENTA)}"
        )
        pack_msg3 = (
            f"{MessageFormatter.pack_display(packs['vip']['name'], packs['vip']['gold'], packs['vip']['points'], packs['vip']['description'], Colors.RAINBOW_1)}\n\n"
            f"{Colors.SKY_BLUE}💡 Tip exact amount or any (10G=50pts)"
        )
        
        await bot.send_message(pack_msg1, user.id)
        await asyncio.sleep(0.5)
        await bot.send_message(pack_msg2, user.id)
        await asyncio.sleep(0.5)
        await bot.send_message(pack_msg3, user.id)
    

    @bot.command("daily", "claim")
    async def daily_cmd(bot, user, message):
        remaining_cd = check_cd(user.id, "daily_cmd", 3)
        if remaining_cd > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining_cd), user.id)
            return
        
        success, tickets, balance, remaining_sec = await bot.economy.claim_daily(user.id, user.username)
        
        if not success:
            hours = int(remaining_sec // 3600)
            mins = int((remaining_sec % 3600) // 60)
            msg = (
                f"{Colors.ORANGE}⏳ Daily already claimed!\n"
                f"{Colors.LIGHT_GRAY}Next reward in: {Colors.GOLD}{hours}h {mins}m\n"
                f"{Colors.SKY_BLUE}🎟️ Balance: {Colors.GOLD}{balance} pts"
            )
            await bot.send_message(msg, user.id)
        else:
            msg = (
                f"{Colors.GOLD}🎁 {Colors.PINK}@{user.username} {Colors.MINT}claimed their daily reward!\n"
                f"{Colors.YELLOW}🎟️ +{tickets} tickets {Colors.LIGHT_GRAY}• {Colors.GOLD}{balance} total pts\n"
                f"{Colors.SKY_BLUE}💡 Use /daily once every 24 hours!"
            )
            await bot.highrise.chat(msg)

    @bot.command("costs", "prices")
    async def costs_cmd(bot, user, message):
        remaining = check_cd(user.id, "costs", 3)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return

        cost_msg = (
            f"{Colors.PINK}💰 Command Costs\n\n"
            f"{Colors.LAVENDER}/play <song> {Colors.YELLOW}10pts\n"
            f"{Colors.LAVENDER}/dedicate @user <song> {Colors.YELLOW}10pts\n"
            f"{Colors.LAVENDER}/clear {Colors.YELLOW}20pts per song {Colors.RED}(4x cost!)\n\n"
            f"{Colors.CYAN}💡 VIP Benefits:\n"
            f"{Colors.MINT}• /play & /dedicate: {Colors.GREEN}FREE\n"
            f"{Colors.MINT}• /clear: {Colors.GOLD}FREE (1x per hour)\n\n"
            f"{Colors.PURPLE}👑 Admin/Owner:\n"
            f"{Colors.PINK}• All commands {Colors.GREEN}FREE & UNRESTRICTED"
        )
        await bot.send_message(cost_msg, user.id)
    
    @bot.command("give")
    async def give_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return
        
        try:
            parts = message.split(maxsplit=2)
            if len(parts) < 3:
                msg = f"{Colors.RED}❌ Use: {Colors.LAVENDER}/give <@user/all> <pts>"
                await bot.send_message(msg, user.id)
                return
            
            arg1 = parts[1].strip()
            arg2 = parts[2].strip()

            # Parse arguments: standard is /give @user 100, but support /give 100 @user as fallback
            if arg2.isdigit():
                targets = arg1
                points = int(arg2)
            elif arg1.isdigit():
                points = int(arg1)
                targets = arg2
            else:
                await bot.send_message(MessageFormatter.error("Points must be a valid number!"), user.id)
                return
            
            if points <= 0:
                await bot.send_message(MessageFormatter.error("Points must be > 0"), user.id)
                return
            
            if targets.lower() == "all":
                response = await bot.highrise.get_room_users()
                count = 0
                
                if hasattr(response, 'content'):
                    users = response.content
                    for room_user, _ in users:
                        if room_user.id != bot.bot_user_id:
                            await bot.economy.add_points(room_user.id, points, f"Gift from admin {user.username}")
                            count += 1
                    
                    msg = f"{Colors.GOLD}💎 Gave {Colors.YELLOW}{points}pts {Colors.GOLD}to {Colors.PINK}{count} users!"
                    await bot.highrise.chat(msg)
                else:
                    await bot.send_message(MessageFormatter.error("Can't get users"), user.id)
            else:
                usernames = [u.strip().lstrip('@') for u in targets.split('/')]
                response = await bot.highrise.get_room_users()
                count = 0
                
                if hasattr(response, 'content'):
                    users = response.content
                    user_map = {room_user.username.lower(): room_user.id for room_user, _ in users}
                    
                    for target_username in usernames:
                        if target_username.lower() in user_map:
                            target_id = user_map[target_username.lower()]
                            await bot.economy.add_points(target_id, points, f"Gift from admin {user.username}")
                            count += 1
                    
                    if count > 0:
                        msg = f"{Colors.GOLD}💎 Gave {Colors.YELLOW}{points}pts {Colors.GOLD}to {Colors.PINK}{count} user(s)!"
                        await bot.highrise.chat(msg)
                    else:
                        await bot.send_message(MessageFormatter.error(f"User '{targets}' not found in room!"), user.id)
                else:
                    await bot.send_message(MessageFormatter.error("Can't get users"), user.id)
        except ValueError:
            await bot.send_message(MessageFormatter.error("Invalid! Must be number"), user.id)
        except Exception as e:
            log_error_to_file("givepoints_cmd", e)
            await bot.send_message(MessageFormatter.error(f"Error: {str(e)[:30]}"), user.id)
