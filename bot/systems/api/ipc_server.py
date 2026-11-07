import os
import asyncio
from aiohttp import web
from core.bot_instance import get_bot_instance
import traceback
from datetime import datetime
from highrise.models import User

def log_action(action, user_id=None, details=""):
    try:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_line = f"[{timestamp}] ACTION: {action} | TARGET: {user_id or 'N/A'} | DETAILS: {details}\n"
        with open("dashboard_actions.log", "a", encoding="utf-8") as f:
            f.write(log_line)
    except Exception as e:
        print(f"Failed to log action: {e}")

async def handle_kick(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        expected_secret = os.environ.get("IPC_SECRET") or os.environ.get("MUSIC_API_SECRET") or os.environ.get("API_SECRET") or "highrise_music_secret_2026"
        if not secret or secret != expected_secret:
            return web.json_response({"error": "Unauthorized"}, status=401)
        
        data = await request.json()
        user_id = data.get("userId")
        
        bot = get_bot_instance()
        if not bot:
            return web.json_response({"error": "Bot not ready"}, status=503)
            
        # Example validation
        if not user_id:
            return web.json_response({"error": "userId required"}, status=400)
            
        await bot.highrise.moderate_room(user_id, "kick")
        log_action("KICK", user_id)
        return web.json_response({"status": "kicked", "userId": user_id})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_teleport(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        data = await request.json()
        user_id = data.get("userId")
        x = float(data.get("x", 0))
        y = float(data.get("y", 0))
        z = float(data.get("z", 0))
        
        bot = get_bot_instance()
        if not bot:
            return web.json_response({"error": "Bot not ready"}, status=503)
            
        from highrise.models import Position
        await bot.highrise.teleport(user_id, Position(x, y, z))
        log_action("TELEPORT", user_id, f"To: {x}, {y}, {z}")
        return web.json_response({"status": "teleported", "userId": user_id})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_say(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        data = await request.json()
        message = data.get("message")
        if not message:
            return web.json_response({"error": "message required"}, status=400)
            
        # Cap announcement length
        if len(message) > 250:
            message = message[:247] + "..."
        
        bot = get_bot_instance()
        if not bot:
            return web.json_response({"error": "Bot not ready"}, status=503)
            
        await bot.highrise.chat(message)
        log_action("ANNOUNCEMENT", details=message)
        return web.json_response({"status": "sent"})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_restart(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        bot = get_bot_instance()
        if bot and bot.connection_manager:
            bot.connection_manager.trigger_restart("Restart requested via IPC Dashboard")
        return web.json_response({"status": "restarting"})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_roster(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        bot = get_bot_instance()
        if not bot:
            return web.json_response({"error": "Bot not ready"}, status=503)
            
        response = await bot.highrise.get_room_users()
        users = []
        for user_tuple in response.content:
            user = user_tuple[0]
            users.append({"id": user.id, "username": user.username})
            
        return web.json_response({"users": users})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_terminal(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        data = await request.json()
        command = data.get("command")
        
        bot = get_bot_instance()
        if not bot:
            return web.json_response({"error": "Bot not ready"}, status=503)
            
        from highrise.models import User
        owner_username = bot.admin.OWNER_USERNAME
        mock_owner = User(id="dashboard_terminal", username=owner_username)
        
        # Inject the command into the bot's chat handler
        import asyncio
        asyncio.create_task(bot.on_chat(mock_owner, command))
        
        log_action("TERMINAL", owner_username, command)
        return web.json_response({"status": "executed"})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_access(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        data = await request.json()
        action = data.get("action")
        role = data.get("role")
        username = data.get("username", "").lower().strip()
        
        bot = get_bot_instance()
        if not bot:
            return web.json_response({"error": "Bot not ready"}, status=503)
            
        manager = bot.admin
        
        if action == "add":
            if role == "admin" and username not in manager.admins:
                manager.admins.append(username)
            elif role == "vip" and username not in manager.vips:
                manager.vips.append(username)
        elif action == "remove":
            if role == "admin" and username in manager.admins:
                manager.admins.remove(username)
            elif role == "vip" and username in manager.vips:
                manager.vips.remove(username)
                
        manager.save_admins()
        log_action("ACCESS_MODIFY", username, f"{action} {role}")
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_economy(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        bot = get_bot_instance()
        if not bot:
            return web.json_response({"error": "Bot not ready"}, status=503)
            
        manager = bot.economy
        
        if request.method == "GET":
            # Return all balances
            return web.json_response({"balances": manager.balances})
            
        elif request.method == "POST":
            data = await request.json()
            username = data.get("username", "").lower().strip()
            amount = data.get("amount")
            action = data.get("action")
            
            if action == "add":
                manager.add_points(username, amount)
            elif action == "set":
                manager.balances[username] = amount
                manager.save_balances()
            elif action == "reset":
                manager.balances[username] = 0
                manager.save_balances()
                
            log_action("ECONOMY_MODIFY", username, f"{action} {amount}")
            return web.json_response({"status": "success", "new_balance": manager.get_balance(username)})
            
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_mode(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        data = await request.json()
        mode = data.get("mode")
        
        bot = get_bot_instance()
        if not bot:
            return web.json_response({"error": "Bot not ready"}, status=503)
            
        if bot.music.set_autoplay_mode(mode):
            log_action("MODE_CHANGE", details=mode)
            return web.json_response({"status": "success", "mode": mode})
        else:
            return web.json_response({"error": "Invalid mode"}, status=400)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_stats(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        bot = get_bot_instance()
        if not bot:
            return web.json_response({"error": "Bot not ready"}, status=503)
            
        diagnostics = await bot.systeminfo.collect_diagnostics(bot)
        
        btm_tasks = []
        if hasattr(bot, 'background_manager'):
            for name, task in bot.background_manager.running_tasks.items():
                btm_tasks.append({
                    "name": name,
                    "status": "Running" if not task.done() else "Stopped",
                    "crashes": bot.background_manager.task_crash_counts.get(name, 0)
                })
                
        return web.json_response({
            "diagnostics": diagnostics,
            "btm": btm_tasks
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_playlists(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        bot = get_bot_instance()
        if not bot or not hasattr(bot, 'playlist_manager'):
            return web.json_response({"error": "Bot not ready or playlists disabled"}, status=503)
            
        # Format playlists
        playlists = []
        playlists_data = bot.playlist_manager._load_data()
        for name, data in playlists_data.items():
            playlists.append({
                "name": name,
                "owner": data.get("owner_id", "Unknown"),
                "songCount": len(data.get("songs", [])),
                "active": name in bot.playlist_manager.active_playlists
            })
            
        return web.json_response({"playlists": playlists})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_outfits(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        bot = get_bot_instance()
        if not bot or not hasattr(bot, 'outfit_manager'):
            return web.json_response({"error": "Bot not ready or outfits disabled"}, status=503)
            
        presets = []
        if bot.outfit_manager:
            preset_data = bot.outfit_manager.load_outfit_presets()
            for name in preset_data.keys():
                presets.append(name)
                
        return web.json_response({"presets": presets})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_locations(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        bot = get_bot_instance()
        if not bot or not hasattr(bot, 'position_manager'):
            return web.json_response({"error": "Bot not ready or positions disabled"}, status=503)
            
        locations = []
        if bot.position_manager:
            for name, pos in bot.position_manager.locations.items():
                locations.append({
                    "name": name,
                    "x": pos.x,
                    "y": pos.y,
                    "z": pos.z,
                    "facing": pos.facing
                })
                
        return web.json_response({"locations": locations})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_shop(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        bot = get_bot_instance()
        if not bot or not hasattr(bot, 'shop_manager'):
            return web.json_response({"error": "Bot not ready or shop disabled"}, status=503)
            
        query = request.query.get('q', '')
        if not query:
            return web.json_response({"results": []})
            
        # Ensure items are loaded
        if hasattr(bot.shop_manager, 'ensure_items_loaded') and hasattr(bot, 'webapi'):
            await bot.shop_manager.ensure_items_loaded(bot.webapi)
            
        results = bot.shop_manager.item_search.search_items(query, limit=20)
        return web.json_response({"results": results})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_history(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        bot = get_bot_instance()
        if not bot or not hasattr(bot, 'history'):
            return web.json_response({"error": "Bot not ready or history disabled"}, status=503)
            
        return web.json_response({"history": bot.history.get_all_history()})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_bot_command(request):
    try:
        secret = request.headers.get("X-IPC-Secret")
        if not secret or secret != os.environ.get("IPC_SECRET"):
            return web.json_response({"error": "Unauthorized"}, status=401)
            
        data = await request.json()
        command = data.get("command")
        if not command:
            return web.json_response({"error": "No command provided"}, status=400)
            
        bot = get_bot_instance()
        if not bot:
            return web.json_response({"error": "Bot not ready"}, status=503)
            
        # Create a mock user object representing the dashboard owner
        # Using a dummy ID or the owner ID if we have it
        owner_id = bot.owner_id if hasattr(bot, 'owner_id') else "dashboard_user"
        owner_username = os.environ.get("BOT_OWNER", "DashboardAdmin")
        mock_user = User(id=owner_id, username=owner_username)
        
        # Ensure it has the / prefix for process_command
        if not command.startswith("/"):
            command = f"/{command}"
            
        await bot.process_command(mock_user, command)
        log_action("BOT_COMMAND", owner_username, command)
        
        return web.json_response({"status": "dispatched", "command": command})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def start_ipc_server():
    app = web.Application()
    app.router.add_post('/api/kick', handle_kick)
    app.router.add_post('/api/teleport', handle_teleport)
    app.router.add_post('/api/say', handle_say)
    app.router.add_post('/api/restart', handle_restart)
    app.router.add_get('/api/roster', handle_roster)
    app.router.add_post('/api/terminal', handle_terminal)
    app.router.add_post('/api/access', handle_access)
    app.router.add_get('/api/economy', handle_economy)
    app.router.add_post('/api/economy', handle_economy)
    app.router.add_post('/api/mode', handle_mode)
    app.router.add_get('/api/stats', handle_stats)
    app.router.add_get('/api/playlists', handle_playlists)
    app.router.add_get('/api/outfits', handle_outfits)
    app.router.add_get('/api/locations', handle_locations)
    app.router.add_get('/api/shop', handle_shop)
    app.router.add_get('/api/history', handle_history)
    app.router.add_post('/api/bot-command', handle_bot_command)
    
    runner = web.AppRunner(app)
    await runner.setup()
    
    # BIND EXPLICITLY TO 127.0.0.1 ONLY FOR SECURITY WITH SO_REUSEADDR
    site = web.TCPSite(runner, '127.0.0.1', 5001, reuse_address=True)
    
    for attempt in range(5):
        try:
            await site.start()
            print("🔒 IPC Server started on 127.0.0.1:5001")
            break
        except OSError as e:
            if attempt < 4:
                await asyncio.sleep(2)
            else:
                print(f"⚠️ Warning: Could not bind IPC Server on 5001: {e}")
                return
    
    try:
        # Keep task alive
        while True:
            await asyncio.sleep(3600)
    finally:
        # Properly clean up socket when task is cancelled
        try:
            await runner.cleanup()
        except Exception:
            pass

