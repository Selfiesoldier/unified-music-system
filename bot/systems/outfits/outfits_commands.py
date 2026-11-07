"""
Outfits Commands - New outfit system based on avatar state
"""
import asyncio
import json
import re
import aiohttp
from highrise.models import Item
from .avatar_outfit_manager import AvatarOutfitManager
from core.error_handler import log_error_to_file
from core.cooldowns import check_cd
from core.color_formatter import Colors, MessageFormatter

def register(bot):
    """Register outfit commands"""

    # Note: outfit_manager will be initialized in bot.on_start() after inventory loads
    # Just register the commands here

    @bot.command('outfit', 'outfits')
    async def cmd_outfit(bot, user, message):
        """Show current outfit (Admin only)"""
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"))
            return

        if not bot.outfit_manager:
            await bot.send_message(MessageFormatter.error("Outfit manager not initialized yet"))
            return

        # get_current_outfit now returns a list of message chunks
        outfit_chunks = bot.outfit_manager.get_current_outfit()

        # Send each chunk as a whisper with a small delay
        for i, chunk in enumerate(outfit_chunks):
            await bot.send_message(chunk, user.id)
            if i < len(outfit_chunks) - 1:  # Don't delay after last message
                await asyncio.sleep(0.3)

    @bot.command('wear')
    async def cmd_wear(bot, user, message):
        """Wear an item or outfit (Admin only)

        Usage:
            !wear outfit <outfit_name> - Wear a preset outfit
            !wear <category> <item_name> - Wear a specific item

        Examples:
            !wear outfit casual_white
            !wear shirt white tank
            !wear pants black jeans
        """
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"))
            return

        remaining = check_cd(user.id, "wear", 3)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining))
            return

        if not bot.outfit_manager:
            await bot.send_message(MessageFormatter.error("Outfit manager not initialized yet"))
            return

        parts = message.split(maxsplit=2)

        if len(parts) < 2:
            msg = f"{Colors.SKY_BLUE}Use: {Colors.LAVENDER}!wear outfit <name> {Colors.LIGHT_GRAY}or {Colors.LAVENDER}!wear <category> <item>"
            await bot.send_message(msg, user.id)
            return

        # Check if it's an outfit preset
        if parts[1].lower() == 'outfit':
            if len(parts) < 3:
                # Show available outfits (now returns list of chunks)
                outfit_chunks = bot.outfit_manager.get_outfit_list()
                for i, chunk in enumerate(outfit_chunks):
                    await bot.send_message(chunk, user.id)
                    if i < len(outfit_chunks) - 1:
                        await asyncio.sleep(0.3)
                return

            outfit_name = parts[2].lower().replace(' ', '_')

            success, error = bot.outfit_manager.wear_outfit(outfit_name)
            if success:
                # Build the outfit and set it
                try:
                    outfit_items = bot.outfit_manager.build_highrise_outfit()
                    await bot.highrise.set_outfit(outfit_items)
                    msg = f"{Colors.MINT}✅ Wearing outfit: {Colors.PINK}{outfit_name.replace('_', ' ').title()}"
                    await bot.highrise.chat(msg)
                except Exception as e:
                    log_error_to_file("wear_outfit", e)
                    await bot.highrise.chat(MessageFormatter.error(f"Error setting outfit: {str(e)}"))
            else:
                await bot.highrise.chat(MessageFormatter.error(error))
        else:
            # Wear individual item
            if len(parts) < 3:
                msg = f"{Colors.SKY_BLUE}Use: {Colors.LAVENDER}!wear <category> <item>"
                await bot.highrise.chat(msg)
                return

            category = parts[1].lower()
            query = parts[2].lower()

            print(f"🔧 Wear command: category={category}, query={query}")

            # Special case: "0" means remove the item
            if query == "0":
                if bot.outfit_manager.remove(category):
                    # Update the outfit in Highrise
                    try:
                        outfit_items = bot.outfit_manager.build_highrise_outfit()
                        print(f"🔧 Built outfit with {len(outfit_items)} items for removal")
                        await bot.highrise.set_outfit(outfit_items)
                        print(f"✅ Successfully removed {category} from outfit")
                        msg = f"{Colors.MINT}✅ Removed {Colors.PURPLE}{category}"
                        await bot.highrise.chat(msg)
                    except Exception as e:
                        log_error_to_file("remove_item", e)
                        await bot.highrise.chat(MessageFormatter.error(f"Error updating outfit: {str(e)}"))
                else:
                    await bot.highrise.chat(MessageFormatter.error(f"Category '{category}' not found!"))
                return

            # Find the item
            item_id, item_name = bot.outfit_manager.find_item(category, query)

            print(f"🔧 Found item: id={item_id}, name={item_name}")

            if item_id:
                success, error = bot.outfit_manager.wear(category, item_id)

                print(f"🔧 Wear result: success={success}, error={error}")

                if success:
                    # Update the outfit in Highrise
                    try:
                        outfit_items = bot.outfit_manager.build_highrise_outfit()
                        print(f"🔧 Built outfit with {len(outfit_items)} items")
                        await bot.highrise.set_outfit(outfit_items)
                        print(f"✅ Successfully set outfit in Highrise")
                        msg = f"{Colors.MINT}✅ Wearing {Colors.PURPLE}{category}{Colors.MINT}: {Colors.PINK}{item_name}"
                        await bot.highrise.chat(msg)
                    except Exception as e:
                        log_error_to_file("wear_item", e)
                        await bot.highrise.chat(MessageFormatter.error(f"Error setting outfit: {str(e)}"))
                else:
                    await bot.highrise.chat(MessageFormatter.error(error))
            else:
                msg = f"{Colors.RED}❌ {Colors.PURPLE}{category} {Colors.RED}not found! {Colors.SKY_BLUE}!list {category}"
                await bot.highrise.chat(msg)

    @bot.command('remove')
    async def cmd_remove(bot, user, message):
        """Remove an item from a category (Admin only)

        Usage: !remove <category>
        Example: !remove shirt
        """
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"))
            return

        if not bot.outfit_manager:
            await bot.highrise.chat(MessageFormatter.error("Outfit manager not initialized yet"))
            return

        parts = message.split()

        if len(parts) < 2:
            msg = f"{Colors.SKY_BLUE}Usage: {Colors.LAVENDER}!remove <category>"
            await bot.highrise.chat(msg)
            return

        category = parts[1].lower()

        print(f"🔧 Remove command: category={category}")

        if bot.outfit_manager.remove(category):
            # Update the outfit in Highrise
            try:
                outfit_items = bot.outfit_manager.build_highrise_outfit()
                print(f"🔧 Built outfit with {len(outfit_items)} items for removal")
                await bot.highrise.set_outfit(outfit_items)
                print(f"✅ Successfully set outfit in Highrise after removal")
                msg = f"{Colors.MINT}✅ Removed {Colors.PURPLE}{category}"
                await bot.highrise.chat(msg)
            except Exception as e:
                log_error_to_file("remove_item", e)
                await bot.highrise.chat(MessageFormatter.error(f"Error updating outfit: {str(e)}"))
        else:
            await bot.highrise.chat(MessageFormatter.error(f"Category '{category}' not found!"))

    @bot.command('list')
    async def cmd_list(bot, user, message):
        """List items in a category or show all categories (Admin only)

        Usage: !list [category]
        Examples: !list (shows all categories), !list shirt, !list pants
        """
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return

        if not bot.outfit_manager:
            await bot.send_message(MessageFormatter.error("Outfit manager not initialized yet"), user.id)
            return

        parts = message.split()

        # If no category provided, show all categories
        if len(parts) < 2:
            category_chunks = bot.outfit_manager.list_all_categories()
            for i, chunk in enumerate(category_chunks):
                await bot.send_message(chunk, user.id)
                if i < len(category_chunks) - 1:
                    await asyncio.sleep(0.3)
            return

        # Show specific category items
        category = parts[1].lower()
        item_chunks = bot.outfit_manager.list_items(category)
        for i, chunk in enumerate(item_chunks):
            await bot.send_message(chunk, user.id)
            if i < len(item_chunks) - 1:
                await asyncio.sleep(0.3)

    @bot.command('outfitlist', 'outfitslist', 'presets')
    async def cmd_outfit_list(bot, user, message):
        """List all available outfit presets (Admin only)"""
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"))
            return

        if not bot.outfit_manager:
            await bot.send_message(MessageFormatter.error("Outfit manager not initialized yet"))
            return

        # get_outfit_list now returns a list of message chunks
        outfit_chunks = bot.outfit_manager.get_outfit_list()
        for i, chunk in enumerate(outfit_chunks):
            await bot.send_message(chunk, user.id)
            if i < len(outfit_chunks) - 1:
                await asyncio.sleep(0.3)

    @bot.command('clearoutfit')
    async def cmd_clear_outfit(bot, user, message):
        """Clear all outfit items (Admin only)"""
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"))
            return

        if not bot.outfit_manager:
            await bot.highrise.chat(MessageFormatter.error("Outfit manager not initialized yet"))
            return

        bot.outfit_manager.clear_outfit()

        try:
            outfit_items = bot.outfit_manager.build_highrise_outfit()
            await bot.highrise.set_outfit(outfit_items)
            await bot.highrise.chat(MessageFormatter.success("Outfit cleared!"))
        except Exception as e:
            log_error_to_file("clear_outfit", e)
            await bot.highrise.chat(MessageFormatter.error(f"Error clearing outfit: {str(e)}"))

    @bot.command('syncoutfit')
    async def cmd_sync_outfit(bot, user, message):
        """Re-sync outfit from Highrise (Admin only)"""
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"))
            return

        if not bot.outfit_manager:
            await bot.highrise.chat(MessageFormatter.error("Outfit manager not initialized yet"))
            return

        try:
            success = await bot.outfit_manager.sync_from_highrise(bot.highrise)
            if success:
                await bot.highrise.chat(MessageFormatter.success("Outfit synced from Highrise!"))
            else:
                await bot.highrise.chat(MessageFormatter.error("Failed to sync outfit"))
        except Exception as e:
            log_error_to_file("sync_outfit", e)
            await bot.highrise.chat(MessageFormatter.error(f"Error syncing outfit: {str(e)}"))

    def get_skin_tone_name(palette_id):
        """Get a descriptive name for skin tone palette ID"""
        if palette_id <= 10:
            return "Porcelain"
        elif palette_id <= 20:
            return "Fair"
        elif palette_id <= 30:
            return "Light"
        elif palette_id <= 50:
            return "Light Medium"
        elif palette_id <= 80:
            return "Medium"
        else:
            return "Medium Tan"

    @bot.command('skin', 'skincolor')
    async def cmd_skin(bot, user, message):
        """Change skin color (Admin only)

        Usage: !skin <0-86>
        Examples: !skin 0, !skin 27, !skin 50, !skin 86
        """
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"))
            return

        if not bot.outfit_manager:
            await bot.highrise.chat(MessageFormatter.error("Outfit manager not initialized yet"))
            return

        parts = message.split()

        if len(parts) < 2:
            current_color = bot.outfit_manager.avatar.get('skin_color', 27)
            tone_name = get_skin_tone_name(current_color)
            msg = (
                f"{Colors.SKY_BLUE}Current skin: {Colors.PINK}{current_color} {Colors.LAVENDER}({tone_name})\n"
                f"{Colors.MINT}Use: !skin <0-86>\n"
                f"{Colors.LIGHT_GRAY}0-10: Porcelain | 11-20: Fair\n"
                f"{Colors.LIGHT_GRAY}21-30: Light | 31-50: Light Medium\n"
                f"{Colors.LIGHT_GRAY}51-80: Medium | 81-86: Medium Tan"
            )
            await bot.highrise.chat(msg)
            return

        try:
            palette_id = int(parts[1])
            success, error = bot.outfit_manager.set_skin_color(palette_id)

            if success:
                # Update the outfit in Highrise
                try:
                    outfit_items = bot.outfit_manager.build_highrise_outfit()
                    await bot.highrise.set_outfit(outfit_items)
                    tone_name = get_skin_tone_name(palette_id)
                    msg = f"{Colors.MINT}✅ Skin: {Colors.PINK}{palette_id} {Colors.LAVENDER}({tone_name})"
                    await bot.highrise.chat(msg)
                except Exception as e:
                    log_error_to_file("set_skin", e)
                    await bot.highrise.chat(MessageFormatter.error(f"Error updating outfit: {str(e)}"))
            else:
                await bot.highrise.chat(MessageFormatter.error(error))
        except ValueError:
            await bot.highrise.chat(MessageFormatter.error("Skin color must be a number (0-86)"))

    @bot.command('color', 'colour', 'palette')
    async def cmd_color(bot, user, message):
        """Change color of hair, eyebrows, or face hair (Admin only)

        Usage: !color <category> <0-255>
        Examples: !color hair 50, !color eyebrows 120, !color facehair 200

        Categories: hair, eyebrows, facehair (upper/lower)
        """
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"))
            return

        if not bot.outfit_manager:
            await bot.highrise.chat(MessageFormatter.error("Outfit manager not initialized yet"))
            return

        parts = message.split()

        if len(parts) < 2:
            msg = (
                f"{Colors.SKY_BLUE}Set hair & face colors:\n"
                f"{Colors.MINT}Use: !color <category> <0-255>\n"
                f"{Colors.LAVENDER}Categories: {Colors.PINK}hair, eyebrows, facehair\n"
                f"{Colors.LIGHT_GRAY}Examples:\n"
                f"  !color hair 50\n"
                f"  !color eyebrows 120\n"
                f"  !color facehair 200"
            )
            await bot.highrise.chat(msg)
            return

        category = parts[1].lower()

        # Map common aliases
        if category == 'hair':
            # Set both hair_front and hair_back
            if len(parts) < 3:
                current_front = bot.outfit_manager.colors.get('hair_front', 0)
                current_back = bot.outfit_manager.colors.get('hair_back', 0)
                msg = f"{Colors.SKY_BLUE}Hair colors: Front={Colors.PINK}{current_front}{Colors.SKY_BLUE}, Back={Colors.PINK}{current_back}"
                await bot.highrise.chat(msg)
                return

            try:
                palette_id = int(parts[2])
                success1, error1 = bot.outfit_manager.set_color('hair_front', palette_id)
                success2, error2 = bot.outfit_manager.set_color('hair_back', palette_id)

                if success1 and success2:
                    outfit_items = bot.outfit_manager.build_highrise_outfit()
                    await bot.highrise.set_outfit(outfit_items)
                    msg = f"{Colors.MINT}✅ Hair color: {Colors.PINK}{palette_id}"
                    await bot.highrise.chat(msg)
                else:
                    await bot.highrise.chat(MessageFormatter.error(error1 or error2))
            except ValueError:
                await bot.highrise.chat(MessageFormatter.error("Color must be a number (0-86)"))
            return

        # Face hair alias - set both upper and lower face hair
        if category in ['facehair', 'face_hair', 'facial_hair', 'beard']:
            if len(parts) < 3:
                current_upper = bot.outfit_manager.colors.get('upper_face_hair', 0)
                current_lower = bot.outfit_manager.colors.get('lower_face_hair', 0)
                msg = f"{Colors.SKY_BLUE}Face hair colors: Upper={Colors.PINK}{current_upper}{Colors.SKY_BLUE}, Lower={Colors.PINK}{current_lower}"
                await bot.highrise.chat(msg)
                return

            try:
                palette_id = int(parts[2])
                success1, error1 = bot.outfit_manager.set_color('upper_face_hair', palette_id)
                success2, error2 = bot.outfit_manager.set_color('lower_face_hair', palette_id)

                if success1 and success2:
                    outfit_items = bot.outfit_manager.build_highrise_outfit()
                    await bot.highrise.set_outfit(outfit_items)
                    msg = f"{Colors.MINT}✅ Face hair color: {Colors.PINK}{palette_id}"
                    await bot.highrise.chat(msg)
                else:
                    await bot.highrise.chat(MessageFormatter.error(error1 or error2))
            except ValueError:
                await bot.highrise.chat(MessageFormatter.error("Color must be a number (0-86)"))
            return

        # Only allow hair and facial feature colors
        allowed_categories = ['hair_front', 'hair_back', 'eyebrows', 'upper_face_hair', 'lower_face_hair', 'eyes']

        if category not in allowed_categories:
            msg = f"{Colors.RED}❌ Invalid category! Use: {Colors.PINK}hair, eyebrows, facehair"
            await bot.highrise.chat(msg)
            return

        # Single category
        if len(parts) < 3:
            if category in bot.outfit_manager.colors:
                current = bot.outfit_manager.colors.get(category, 0)
                msg = f"{Colors.SKY_BLUE}{category.replace('_', ' ').title()} color: {Colors.PINK}{current}"
                await bot.highrise.chat(msg)
            else:
                await bot.highrise.chat(MessageFormatter.error(f"Category '{category}' not found!"))
            return

        try:
            palette_id = int(parts[2])
            success, error = bot.outfit_manager.set_color(category, palette_id)

            if success:
                outfit_items = bot.outfit_manager.build_highrise_outfit()
                await bot.highrise.set_outfit(outfit_items)
                msg = f"{Colors.MINT}✅ {category.replace('_', ' ').title()} color: {Colors.PINK}{palette_id}"
                await bot.highrise.chat(msg)
            else:
                await bot.highrise.chat(MessageFormatter.error(error))
        except ValueError:
            await bot.highrise.chat(MessageFormatter.error("Color must be a number (0-86)"))

    async def fetch_user_outfit_universal(clean_username: str):
        """Universal Outfit Fetching (In-room + Offline/Anywhere on Highrise)
        
        1. Check if user is in room via get_room_users(), if found call get_user_outfit(user_id)
        2. If not in room or get_user_outfit fails, fetch web profile from https://highrise.game/profile/{clean_username}
        """
        found_in_room = False
        target_user_id = None

        # 1. Try In-room user check
        try:
            room_users_resp = await bot.highrise.get_room_users()
            if hasattr(room_users_resp, 'content'):
                for r_user, _ in room_users_resp.content:
                    if r_user.username.lower() == clean_username.lower():
                        found_in_room = True
                        target_user_id = r_user.id
                        break
        except Exception as e:
            print(f"⚠️ Error checking room users for copy outfit: {e}")

        if found_in_room and target_user_id:
            try:
                outfit_resp = await bot.highrise.get_user_outfit(target_user_id)
                if hasattr(outfit_resp, 'outfit') and outfit_resp.outfit:
                    print(f"✅ Fetched outfit for {clean_username} from room ({len(outfit_resp.outfit)} items)")
                    return outfit_resp.outfit, None
            except Exception as e:
                print(f"⚠️ In-room get_user_outfit failed for {clean_username}, falling back to web profile: {e}")

        # 2. Fallback to Web Profile (Offline/Anywhere on Highrise)
        try:
            url = f"https://highrise.game/profile/{clean_username}"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        html = await resp.text()
                        match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
                        if match:
                            data = json.loads(match.group(1))
                            profile = data.get("props", {}).get("pageProps", {}).get("profile", {})
                            raw_outfit = profile.get("outfit", [])

                            if raw_outfit:
                                items = []
                                for raw_item in raw_outfit:
                                    if isinstance(raw_item, dict):
                                        item_id = raw_item.get("item_id") or raw_item.get("id")
                                        if item_id:
                                            account_bound = raw_item.get("account_bound", False)
                                            active_palette = raw_item.get("active_palette", 0)
                                            items.append(Item(
                                                type="clothing",
                                                amount=1,
                                                id=item_id,
                                                account_bound=account_bound if account_bound is not None else False,
                                                active_palette=active_palette
                                            ))
                                    elif hasattr(raw_item, "id"):
                                        items.append(raw_item)

                                if items:
                                    print(f"✅ Fetched outfit for {clean_username} from web profile ({len(items)} items)")
                                    return items, None
                                else:
                                    return None, f"No clothing items found in @{clean_username}'s outfit."
                            else:
                                return None, f"No outfit found on @{clean_username}'s profile."
                        else:
                            return None, f"Could not parse profile data for @{clean_username}."
                    elif resp.status == 404:
                        return None, f"User @{clean_username} not found on Highrise."
                    else:
                        return None, f"Highrise profile returned status {resp.status}."
        except asyncio.TimeoutError:
            return None, f"Request timed out while fetching @{clean_username}'s profile."
        except Exception as e:
            return None, f"Failed to fetch profile for @{clean_username}: {str(e)}"

    @bot.command('copy', 'copyoutfit', 'botcopy')
    async def cmd_copy(bot, user, message):
        """Universal outfit copy command (Admin only)
        
        Usage:
            !copy @username
            !copy username
            !copyoutfit @username
            !botcopy @username
        """
        if not bot.admin.has_admin_access(user.username):
            await bot.send_message(MessageFormatter.error("Admin access required!"), user.id)
            return

        remaining = check_cd(user.id, "copy_outfit", 3)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return

        parts = message.split(maxsplit=1)
        if len(parts) < 2:
            msg = f"{Colors.SKY_BLUE}Usage: {Colors.LAVENDER}!copy @username {Colors.LIGHT_GRAY}(or {Colors.LAVENDER}!copy username{Colors.LIGHT_GRAY})"
            await bot.send_message(msg, user.id)
            return

        target_username = parts[1].strip().lstrip('@')
        if not target_username:
            msg = f"{Colors.RED}❌ Please specify a valid username to copy!"
            await bot.send_message(msg, user.id)
            return

        # Notify chat that copying is in progress
        await bot.highrise.chat(f"{Colors.CYAN}🔍 Fetching outfit from {Colors.PINK}@{target_username}{Colors.CYAN}...")

        outfit_items, error = await fetch_user_outfit_universal(target_username)
        if error or not outfit_items:
            await bot.highrise.chat(MessageFormatter.error(error or "Failed to fetch user outfit."))
            return

        try:
            # Equip outfit on bot
            await bot.highrise.set_outfit(outfit_items)

            # Sync internal outfit manager state if initialized
            if bot.outfit_manager:
                try:
                    await bot.outfit_manager.sync_from_highrise(bot.highrise)
                except Exception as sync_err:
                    print(f"⚠️ Error syncing outfit manager after copy: {sync_err}")

            success_msg = f"{Colors.MINT}✨ Successfully copied and wearing {Colors.PINK}@{target_username}{Colors.MINT}'s outfit!"
            await bot.highrise.chat(success_msg)
        except Exception as e:
            log_error_to_file("copy_outfit", e)
            await bot.highrise.chat(MessageFormatter.error(f"Error equipping outfit: {str(e)}"))

    print("✅ Registered outfit commands: outfit, wear, remove, list, outfitlist, clearoutfit, syncoutfit, skin, color, copy, copyoutfit, botcopy")