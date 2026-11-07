"""
Playlist Commands - VIP+ only playlist command handlers
"""
import asyncio
from core.cooldowns import check_cd
from core.color_formatter import Colors, MessageFormatter
from datetime import datetime


def _chunk_message(text, max_length=240):
    """Split a long message into chunks that fit within message limit"""
    if len(text) <= max_length:
        return [text]
    
    chunks = []
    lines = text.split('\n')
    current_chunk = ""
    
    for line in lines:
        # If adding this line would exceed limit, save current chunk and start new one
        if len(current_chunk) + len(line) + 1 > max_length:
            if current_chunk:
                chunks.append(current_chunk.rstrip())
            current_chunk = line + "\n"
        else:
            current_chunk += line + "\n"
    
    # Add the last chunk
    if current_chunk:
        chunks.append(current_chunk.rstrip())
    
    return chunks if chunks else [text[:max_length]]




def register(bot):
    """Register playlist commands with the bot"""
    
    @bot.command('myplaylist')
    async def cmd_myplaylist(bot, user, message):
        """List user's playlists - VIP+ only"""
        if not bot.admin.has_vip_access(user.username):
            await bot.send_message(f"{Colors.RED}❌ This feature is available to VIPs and above only", user.id)
            return

        remaining = check_cd(user.id, "playlist", 2)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return
        
        playlists = bot.playlist_manager.list_playlists(user.id)
        
        if not playlists:
            await bot.send_message(f"{Colors.LIGHT_GRAY}You don't have any playlists yet\n{Colors.LAVENDER}Create one with: {Colors.CYAN}/playlist create <name>", user.id)
            return
        
        msg = f"{Colors.CYAN}━━━ Your Playlists ({len(playlists)}) ━━━\n"
        for pl in playlists:
            status = f"{Colors.MINT}[ACTIVE]" if pl["is_active"] else ""
            date = datetime.fromtimestamp(pl["created_at"]).strftime("%b %d")
            msg += f"{Colors.PINK}{pl['name']} {status}\n{Colors.LIGHT_GRAY}  Songs: {pl['song_count']} | Created: {date}\n"
        
        # Split into chunks if message is too long
        chunks = _chunk_message(msg)
        for i, chunk in enumerate(chunks):
            await bot.send_message(chunk, user.id)
            if i < len(chunks) - 1:
                await asyncio.sleep(0.3)

    @bot.command('playlist')
    async def cmd_playlist(bot, user, message):
        """Main playlist command - VIP+ only"""
        if not bot.admin.has_vip_access(user.username):
            await bot.send_message(f"{Colors.RED}❌ This feature is available to VIPs and above only", user.id)
            return

        remaining = check_cd(user.id, "playlist", 2)
        if remaining > 0:
            await bot.send_message(MessageFormatter.cooldown(remaining), user.id)
            return
        
        parts = message.split(maxsplit=2)
        
        if len(parts) < 2:
            help_msg = (
                f"{Colors.CYAN}Playlist Commands:\n"
                f"{Colors.LAVENDER}create/delete/rename/show\n"
                f"add/remove/play/stop/active/info\n"
                f"{Colors.LIGHT_GRAY}Example: /playlist info\n"
                f"{Colors.LIGHT_GRAY}Use /myplaylist to see your playlists"
            )
            await bot.send_message(help_msg, user.id)
            return
        
        subcmd = parts[1].lower()
        
        if subcmd == "create":
            if len(parts) < 3:
                await bot.send_message(f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/playlist create <name>", user.id)
                return
            
            playlist_name = parts[2]
            
            current_count = bot.playlist_manager.get_user_playlist_count(user.id)
            
            if current_count >= bot.playlist_manager.MAX_PLAYLISTS_FREE:
                cost = bot.playlist_manager.PLAYLIST_CREATION_COST
                balance = await bot.economy.get_balance(user.id)
                
                if balance < cost:
                    await bot.send_message(f"{Colors.RED}❌ Creating more than {bot.playlist_manager.MAX_PLAYLISTS_FREE} playlists costs {cost} Music Points\n"
                        f"{Colors.LIGHT_GRAY}Your balance: {balance} pts (need {cost - balance} more, user.id)")
                    return
                
                success, new_balance = await bot.economy.deduct_points(user.id, cost, f"Extra playlist creation: {playlist_name}")
                if not success:
                    await bot.send_message(f"{Colors.RED}❌ Insufficient points", user.id)
                    return
                
                # Notify user about the deduction
                await bot.send_message(f"{Colors.GOLD}💰 Deducted {cost} pts for extra playlist\n"
                    f"{Colors.LIGHT_GRAY}New balance: {new_balance} pts", user.id)
            
            success, msg = await bot.playlist_manager.create_playlist(user.id, playlist_name)
            
            if success:
                if current_count >= bot.playlist_manager.MAX_PLAYLISTS_FREE:
                    await bot.send_message(f"{Colors.MINT}✅ {msg}\n{Colors.LAVENDER}Total playlists: {current_count + 1}", user.id)
                else:
                    await bot.send_message(f"{Colors.MINT}✅ {msg}\n{Colors.LIGHT_GRAY}Playlists: {current_count + 1}/{bot.playlist_manager.MAX_PLAYLISTS_FREE} free", user.id)
            else:
                await bot.send_message(f"{Colors.RED}❌ {msg}", user.id)
        
        elif subcmd == "delete":
            if len(parts) < 3:
                await bot.send_message(f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/playlist delete <name>", user.id)
                return
            
            playlist_name = parts[2]
            success, msg = await bot.playlist_manager.delete_playlist(user.id, playlist_name)
            
            if success:
                await bot.send_message(f"{Colors.MINT}✅ {msg}", user.id)
            else:
                await bot.send_message(f"{Colors.RED}❌ {msg}", user.id)
        
        elif subcmd == "rename":
            args = message.split(maxsplit=3)
            if len(args) < 4:
                await bot.send_message(f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/playlist rename <old_name> <new_name>", user.id)
                return
            
            old_name = args[2]
            new_name = args[3]
            
            success, msg = await bot.playlist_manager.rename_playlist(user.id, old_name, new_name)
            
            if success:
                await bot.send_message(f"{Colors.MINT}✅ {msg}", user.id)
            else:
                await bot.send_message(f"{Colors.RED}❌ {msg}", user.id)
        
        elif subcmd == "show":
            if len(parts) < 3:
                await bot.send_message(f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/playlist show <name>", user.id)
                return
            
            playlist_name = parts[2]
            playlist = bot.playlist_manager.get_playlist(user.id, playlist_name)
            
            if not playlist:
                await bot.send_message(f"{Colors.RED}❌ Playlist '{playlist_name}' not found", user.id)
                return
            
            if not playlist["songs"]:
                await bot.send_message(f"{Colors.LIGHT_GRAY}Playlist '{playlist['name']}' is empty", user.id)
                return
            
            msg = f"{Colors.CYAN}━━━ {playlist['name']} ({len(playlist['songs'])} songs) ━━━\n"
            
            for idx, song in enumerate(playlist["songs"][:10], 1):
                msg += f"{Colors.LAVENDER}{idx}. {Colors.LIGHT_GRAY}{song}\n"
            
            if len(playlist["songs"]) > 10:
                msg += f"{Colors.LIGHT_GRAY}... and {len(playlist['songs']) - 10} more"
            
            await bot.send_message(msg, user.id)
        
        elif subcmd == "add":
            args = message.split(maxsplit=3)
            if len(args) < 4:
                await bot.send_message(f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/playlist add <playlist_name> <song query>", user.id)
                return
            
            playlist_name = args[2]
            song_query = args[3]
            
            playlist = bot.playlist_manager.get_playlist(user.id, playlist_name)
            if not playlist:
                await bot.send_message(f"{Colors.RED}❌ Playlist '{playlist_name}' not found", user.id)
                return
            
            await bot.send_message(f"{Colors.CYAN}🔍 Searching for: {Colors.PINK}{song_query}", user.id)
            
            # Use search instead of play to avoid queuing the song
            result = await bot.music.search_song(song_query)
            
            if not result or result.get('status') != 'found':
                await bot.send_message(f"{Colors.RED}❌ Could not find song", user.id)
                return
            
            # Get title from search result
            song_title = result.get('title', song_query)
            # Don't save generic "Unknown Track" - use search query instead
            if not song_title or song_title == "Unknown Track":
                song_title = song_query
            
            success, msg, cost = await bot.playlist_manager.add_song(user.id, playlist_name, song_title, bot.economy)
            
            if not success:
                await bot.send_message(f"{Colors.RED}❌ {msg}", user.id)
                return
            
            if cost > 0:
                balance = await bot.economy.get_balance(user.id)
                await bot.send_message(f"{Colors.GOLD}💰 Deducted {cost} pts for extra song\n"
                    f"{Colors.LIGHT_GRAY}New balance: {balance} pts", user.id)
                await bot.send_message(f"{Colors.MINT}✅ {msg}", user.id)
            else:
                await bot.send_message(f"{Colors.MINT}✅ {msg}", user.id)
        
        elif subcmd == "remove":
            args = message.split(maxsplit=3)
            if len(args) < 4:
                await bot.send_message(f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/playlist remove <playlist_name> <song index or query>", user.id)
                return
            
            playlist_name = args[2]
            query_or_index = args[3]
            
            if query_or_index.isdigit():
                index = int(query_or_index)
                success, msg = await bot.playlist_manager.remove_song_by_index(user.id, playlist_name, index)
                
                if success:
                    await bot.send_message(f"{Colors.MINT}✅ {msg}", user.id)
                else:
                    await bot.send_message(f"{Colors.RED}❌ {msg}", user.id)
            else:
                matches = bot.playlist_manager.find_song_matches(user.id, playlist_name, query_or_index)
                
                if not matches:
                    await bot.send_message(f"{Colors.RED}❌ No songs found matching '{query_or_index}'", user.id)
                    return
                
                if len(matches) == 1:
                    success, msg = await bot.playlist_manager.remove_song_by_index(user.id, playlist_name, matches[0][0])
                    
                    if success:
                        await bot.send_message(f"{Colors.MINT}✅ {msg}", user.id)
                    else:
                        await bot.send_message(f"{Colors.RED}❌ {msg}", user.id)
                else:
                    bot.playlist_manager.store_pending_removal(user.id, playlist_name, matches)
                    
                    msg = f"{Colors.CYAN}Found {len(matches)} matches:\n"
                    for idx, (song_idx, song) in enumerate(matches[:5], 1):
                        msg += f"{Colors.LAVENDER}{idx}. {Colors.LIGHT_GRAY}{song}\n"
                    
                    msg += f"{Colors.CYAN}Use {Colors.LAVENDER}/confirmremove <number> {Colors.CYAN}within 30s"
                    await bot.send_message(msg, user.id)
        
        elif subcmd == "play":
            if len(parts) < 3:
                await bot.send_message(f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/playlist play <name>", user.id)
                return
            
            playlist_name = parts[2]
            
            success, msg = await bot.playlist_manager.activate_playlist(user.id, playlist_name, bot.music, user.username)
            
            if success:
                await bot.send_message(f"{Colors.MINT}✅ {msg}", user.id)
            else:
                await bot.send_message(f"{Colors.RED}❌ {msg}", user.id)
        
        elif subcmd == "stop":
            if len(parts) < 3:
                await bot.send_message(f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/playlist stop <name>", user.id)
                return
            
            playlist_name = parts[2]
            is_admin = bot.admin.is_admin(user.username) or bot.admin.is_owner(user.username)
            
            success, msg = await bot.playlist_manager.stop_playlist(user.id, playlist_name, is_admin)
            
            if success:
                await bot.send_message(f"{Colors.MINT}✅ {msg}", user.id)
            else:
                await bot.send_message(f"{Colors.RED}❌ {msg}", user.id)
        
        elif subcmd == "active":
            active_playlists = bot.playlist_manager.get_active_playlists_list()
            
            if not active_playlists:
                msg = f"{Colors.LIGHT_GRAY}No playlists are currently active"
                await bot.highrise.chat(msg)
                return
            
            msg = f"{Colors.CYAN}━━━ Active Playlists ({len(active_playlists)}/{bot.playlist_manager.MAX_ACTIVE_PLAYLISTS}) ━━━\n"
            
            for ap in active_playlists:
                username = ap.get("username", f"User_{ap['user_id']}")
                msg += f"{Colors.PINK}{ap['position']}. {ap['playlist_name']} {Colors.LIGHT_GRAY}— @{username}\n"
            
            await bot.highrise.chat(msg)
        
        elif subcmd == "info":
            # If no playlist name provided, show general info
            if len(parts) < 3:
                msg = (
                    f"{Colors.CYAN}━━━ Playlist Limits & Pricing ━━━\n"
                    f"{Colors.LAVENDER}Free Limits:\n"
                    f"{Colors.LIGHT_GRAY}• {bot.playlist_manager.MAX_PLAYLISTS_FREE} playlists\n"
                    f"{Colors.LIGHT_GRAY}• {bot.playlist_manager.MAX_SONGS_FREE} songs per playlist\n"
                    f"{Colors.LAVENDER}Expansion:\n"
                    f"{Colors.LIGHT_GRAY}• Extra playlist: {bot.playlist_manager.PLAYLIST_CREATION_COST} pts\n"
                    f"{Colors.LIGHT_GRAY}• Extra song: {bot.playlist_manager.EXTRA_SONG_COST} pts"
                )
                await bot.send_message(msg, user.id)
                return
            
            playlist_name = parts[2]
            playlist = bot.playlist_manager.get_playlist(user.id, playlist_name)
            
            if not playlist:
                await bot.send_message(f"{Colors.RED}❌ Playlist '{playlist_name}' not found", user.id)
                return
            
            is_active = bot.playlist_manager.is_playlist_active(user.id, playlist_name)
            created_date = datetime.fromtimestamp(playlist['created_at']).strftime("%B %d, %Y at %I:%M %p")
            
            msg = (
                f"{Colors.CYAN}━━━ Playlist Info ━━━\n"
                f"{Colors.LAVENDER}Name: {Colors.PINK}{playlist['name']}\n"
                f"{Colors.LAVENDER}Songs: {Colors.LIGHT_GRAY}{len(playlist['songs'])}\n"
                f"{Colors.LAVENDER}Created: {Colors.LIGHT_GRAY}{created_date}\n"
                f"{Colors.LAVENDER}Status: {Colors.MINT if is_active else Colors.LIGHT_GRAY}{'ACTIVE' if is_active else 'Inactive'}"
            )
            
            await bot.send_message(msg, user.id)
        
        else:
            await bot.send_message(f"{Colors.RED}❌ Unknown subcommand. Use {Colors.LAVENDER}/playlist {Colors.RED}for help", user.id)
    
    @bot.command('confirmremove')
    async def cmd_confirmremove(bot, user, message):
        """Confirm song removal from playlist"""
        if not bot.admin.has_vip_access(user.username):
            return
        
        parts = message.split()
        if len(parts) < 2 or not parts[1].isdigit():
            await bot.send_message(f"{Colors.RED}❌ Usage: {Colors.LAVENDER}/confirmremove <number>", user.id)
            return
        
        choice = int(parts[1])
        
        pending = bot.playlist_manager.get_pending_removal(user.id)
        if not pending:
            await bot.send_message(f"{Colors.RED}❌ No pending removal request or it expired", user.id)
            return
        
        matches = pending["matches"]
        if choice < 1 or choice > len(matches):
            await bot.send_message(f"{Colors.RED}❌ Invalid choice. Must be between 1 and {len(matches)}", user.id)
            return
        
        song_idx, song_title = matches[choice - 1]
        playlist_name = pending["playlist"]
        
        success, msg = await bot.playlist_manager.remove_song_by_index(user.id, playlist_name, song_idx)
        
        bot.playlist_manager.clear_pending_removal(user.id)
        
        if success:
            await bot.send_message(f"{Colors.MINT}✅ {msg}", user.id)
        else:
            await bot.send_message(f"{Colors.RED}❌ {msg}", user.id)
    
    @bot.command('shufflepl')
    async def cmd_shufflepl(bot, user, message):
        """Shuffle a playlist"""
        if not bot.admin.has_vip_access(user.username):
            await bot.send_message(f"{Colors.RED}❌ This feature is available to VIPs and above only", user.id)
            return
        
        parts = message.split(maxsplit=1)
        if len(parts) < 2:
            await bot.send_message(f"{Colors.RED}❌ Usage: {Colors.LAVENDER}!shufflepl <playlist_name>", user.id)
            return
        
        playlist_name = parts[1]
        
        success, msg = await bot.playlist_manager.shuffle_playlist(user.id, playlist_name)
        
        if success:
            await bot.send_message(f"{Colors.MINT}✅ {msg}", user.id)
        else:
            await bot.send_message(f"{Colors.RED}❌ {msg}", user.id)
