"""
Position commands - Bot position management commands
"""
import asyncio
from highrise import Position, AnchorPosition
from core.color_formatter import Colors, MessageFormatter


def register(bot):
    """Register position commands with the bot"""
    
    @bot.command("setmusicbot", "setbot", "setbotme", "setmusicbotme")
    async def setmusicbot_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return
        
        parts = message.split()
        first_cmd = parts[0].lower().lstrip("/!")
        is_me = (len(parts) >= 2 and parts[1].lower() == "me") or first_cmd in ["setbotme", "setmusicbotme"]
        if is_me:
            try:
                response = await bot.highrise.get_room_users()
                user_position = None
                
                if hasattr(response, 'content'):
                    for room_user, position in response.content:
                        if room_user.id == user.id:
                            user_position = position
                            break
                
                if user_position and (isinstance(user_position, Position) or isinstance(user_position, AnchorPosition)):
                    save_success = bot.position_manager.save_position(user_position)
                    bot.position_manager._last_manual_move = __import__("time").time()
                    if save_success:
                        await bot.position_manager.move_bot_to(bot, user_position)
                        
                        if isinstance(user_position, AnchorPosition):
                            msg = (
                                f"{Colors.MINT}✅ Anchor position saved & bot seated!\n"
                                f"{Colors.CYAN}🪑 Furniture Anchor: {user_position.entity_id}\n"
                                f"{Colors.PURPLE}⚓ Seat Index: {user_position.anchor_ix}"
                            )
                        else:
                            msg = (
                                f"{Colors.MINT}✅ Position saved & bot moved!\n"
                                f"{Colors.CYAN}📍 X:{user_position.x:.1f} Y:{user_position.y:.1f} Z:{user_position.z:.1f}\n"
                                f"{Colors.PURPLE}🧭 {user_position.facing}"
                            )
                        await bot.highrise.chat(msg)
                    else:
                        await bot.send_message(MessageFormatter.error("Save failed"), user.id)
                else:
                    await bot.send_message(MessageFormatter.error("Could not find your position. Make sure you are in the room!"), user.id)
            except Exception as e:
                print(f"Error in setmusicbot me: {e}")
                import traceback
                traceback.print_exc()
                await bot.send_message("❌ Error setting position", user.id)
        
        elif len(parts) >= 4:
            try:
                clean_p1 = parts[1].replace(',', '').strip()
                clean_p2 = parts[2].replace(',', '').strip()
                clean_p3 = parts[3].replace(',', '').strip()
                x = float(clean_p1)
                y = float(clean_p2)
                z = float(clean_p3)
                facing_str = parts[4] if len(parts) > 4 else "FrontRight"
                
                if facing_str not in ["FrontRight", "FrontLeft", "BackRight", "BackLeft"]:
                    msg = f"{Colors.RED}❌ Invalid facing direction! {Colors.SKY_BLUE}Use: FrontRight, FrontLeft, BackRight, or BackLeft"
                    await bot.send_message(msg, user.id)
                    return
                
                new_position = Position(x, y, z, facing_str)
                save_success = bot.position_manager.save_position(new_position)
                bot.position_manager._last_manual_move = __import__("time").time()
                if save_success:
                    await bot.position_manager.move_bot_to(bot, new_position)
                    
                    msg = (
                        f"{Colors.MINT}✅ Position saved & bot moved!\n"
                        f"{Colors.CYAN}📍 X:{x:.1f} Y:{y:.1f} Z:{z:.1f}\n"
                        f"{Colors.PURPLE}🧭 {facing_str}"
                    )
                    await bot.highrise.chat(msg)
                else:
                    await bot.send_message(MessageFormatter.error("Save failed"), user.id)
            except ValueError:
                msg = f"{Colors.RED}❌ Invalid! Use numbers\n{Colors.CYAN}Ex: /setmusicbot 10 0 5"
                await bot.send_message(msg, user.id)
            except Exception as e:
                print(f"Error in setmusicbot: {e}")
                import traceback
                traceback.print_exc()
                await bot.send_message(MessageFormatter.error("Error setting position"), user.id)
        
        else:
            msg = (
                f"{Colors.CYAN}📍 Set Bot Position\n"
                f"{Colors.LAVENDER}/setmusicbot me {Colors.LIGHT_GRAY}- Use your spot (standing or chair)\n"
                f"{Colors.LAVENDER}/setmusicbot X Y Z [facing] {Colors.LIGHT_GRAY}- Use coords"
            )
            await bot.send_message(msg, user.id)
    
    @bot.command("pstcmd")
    async def pstcmd_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return
        
        msg1 = (
            f"{Colors.CYAN}📍 Position & Anchor Commands\n\n"
            f"{Colors.LAVENDER}/setmusicbot me {Colors.PURPLE}• Your spot (coords or furniture)\n"
            f"{Colors.LAVENDER}/setmusicbot X Y Z [dir] {Colors.PURPLE}• Coords\n"
            f"{Colors.LAVENDER}/savepos <name> {Colors.PURPLE}• Save named loc\n"
            f"{Colors.LAVENDER}/goto <name> {Colors.PURPLE}• TP to loc"
        )
        msg2 = (
            f"{Colors.PINK}🧭 Directions: {Colors.LIGHT_GRAY}FrontRight, FrontLeft, BackRight, BackLeft\n\n"
            f"{Colors.SKY_BLUE}🛡️ Anchor Guardian active: auto-snaps bot to home if pushed/drifted!"
        )
        await bot.send_message(msg1, user.id)
        await asyncio.sleep(0.3)
        await bot.send_message(msg2, user.id)

    @bot.command("savepos")
    async def savepos_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return
            
        parts = message.split()
        if len(parts) < 2:
            await bot.send_message(f"{Colors.RED}❌ Use: {Colors.LAVENDER}/savepos <name>", user.id)
            return
            
        name = parts[1].lower()
        
        try:
            response = await bot.highrise.get_room_users()
            user_position = None
            
            if hasattr(response, 'content'):
                for room_user, position in response.content:
                    if room_user.id == user.id:
                        user_position = position
                        break
            
            if user_position and (isinstance(user_position, Position) or isinstance(user_position, AnchorPosition)):
                save_success = bot.position_manager.save_position(position=user_position, name=name)
                if save_success:
                    if isinstance(user_position, AnchorPosition):
                        await bot.highrise.chat(f"{Colors.MINT}✅ Furniture anchor saved as: {Colors.CYAN}{name}")
                    else:
                        await bot.highrise.chat(f"{Colors.MINT}✅ Location saved as: {Colors.CYAN}{name}")
                else:
                    await bot.send_message(MessageFormatter.error("Save failed"), user.id)
            else:
                await bot.send_message(MessageFormatter.error("Could not find your position in the room."), user.id)
        except Exception as e:
            print(f"Error in /savepos: {e}")
            await bot.send_message("❌ Error saving location", user.id)

    @bot.command("goto")
    async def goto_cmd(bot, user, message):
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return
            
        parts = message.split()
        if len(parts) < 2:
            await bot.send_message(f"{Colors.RED}❌ Use: {Colors.LAVENDER}/goto <name>", user.id)
            return
            
        name = parts[1].lower()
        if name not in bot.position_manager.locations:
            await bot.send_message(f"{Colors.RED}❌ Location '{name}' not found.", user.id)
            return
            
        pos = bot.position_manager.locations[name]
        try:
            bot.position_manager.save_position(pos)
            success = await bot.position_manager.move_bot_to(bot, pos)
            if success:
                await bot.highrise.chat(f"{Colors.MINT}✅ Teleported to {Colors.CYAN}{name}")
            else:
                await bot.send_message("❌ Failed to move to location", user.id)
        except Exception as e:
            print(f"Error in /goto: {e}")
            await bot.send_message("❌ Teleport failed", user.id)
