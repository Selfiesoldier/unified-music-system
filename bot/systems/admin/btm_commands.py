from core.decorators import owner_only
from core.color_formatter import Colors


def register(bot):
    
    @bot.command("btm")
    @owner_only
    async def btm_command(bot, user, message):
        parts = message.split()
        
        if len(parts) == 1:
            status_msg = bot.background_manager.get_summary()
            await bot.send_message(status_msg, user.id)
            return
        
        subcommand = parts[1].lower()
        
        if subcommand == "list":
            all_status = bot.background_manager.get_all_status()
            
            if not all_status:
                await bot.send_message("📭 No background tasks registered", user.id)
                return
            
            msg_parts = [f"{Colors.CYAN}📋 Background Tasks Status", "━━━━━━━━━━━━━━━━━━━━━━"]
            
            for name, status in all_status.items():
                running_emoji = "🟢" if status['running'] else "🔴"
                
                task_info = f"{running_emoji} {name}"
                if status['running'] and 'uptime' in status:
                    task_info += f"\n   ⏱️ Uptime: {status['uptime']}"
                
                if status['restart_count'] > 0:
                    task_info += f"\n   🔄 Restarts: {status['restart_count']}"
                
                if status['crash_count'] > 0:
                    task_info += f"\n   💥 Crashes: {status['crash_count']}"
                
                msg_parts.append(task_info)
            
            await bot.send_message("\n".join(msg_parts), user.id)
        
        elif subcommand == "start":
            if len(parts) < 3:
                await bot.send_message(f"{Colors.RED}❌ Usage: /btm start <task_name>", user.id)
                return
            
            task_name = parts[2]
            
            if not bot.background_manager.task_exists(task_name):
                await bot.send_message(f"{Colors.RED}❌ Task '{task_name}' does not exist", user.id)
                return
            
            if bot.background_manager.is_running(task_name):
                await bot.send_message(f"{Colors.YELLOW}⚠️ Task '{task_name}' is already running", user.id)
                return
            
            success = await bot.background_manager.start_task(task_name)
            
            if success:
                await bot.send_message(f"{Colors.GREEN}✅ Started task: {task_name}", user.id)
            else:
                await bot.send_message(f"{Colors.RED}❌ Failed to start task: {task_name}", user.id)
        
        elif subcommand == "stop":
            if len(parts) < 3:
                await bot.send_message(f"{Colors.RED}❌ Usage: /btm stop <task_name>", user.id)
                return
            
            task_name = parts[2]
            
            if not bot.background_manager.is_running(task_name):
                await bot.send_message(f"{Colors.YELLOW}⚠️ Task '{task_name}' is not running", user.id)
                return
            
            success = await bot.background_manager.stop_task(task_name)
            
            if success:
                await bot.send_message(f"{Colors.GREEN}✅ Stopped task: {task_name}", user.id)
            else:
                await bot.send_message(f"{Colors.RED}❌ Failed to stop task: {task_name}", user.id)
        
        elif subcommand == "restart":
            if len(parts) < 3:
                await bot.send_message(f"{Colors.RED}❌ Usage: /btm restart <task_name>", user.id)
                return
            
            task_name = parts[2]
            
            if not bot.background_manager.task_exists(task_name):
                await bot.send_message(f"{Colors.RED}❌ Task '{task_name}' does not exist", user.id)
                return
            
            success = await bot.background_manager.restart_task(task_name)
            
            if success:
                await bot.send_message(f"{Colors.GREEN}✅ Restarted task: {task_name}", user.id)
            else:
                await bot.send_message(f"{Colors.RED}❌ Failed to restart task: {task_name}", user.id)
        
        elif subcommand == "status":
            if len(parts) < 3:
                await bot.send_message(f"{Colors.RED}❌ Usage: /btm status <task_name>", user.id)
                return
            
            task_name = parts[2]
            
            if not bot.background_manager.task_exists(task_name):
                await bot.send_message(f"{Colors.RED}❌ Task '{task_name}' does not exist", user.id)
                return
            
            status = bot.background_manager.get_task_status(task_name)
            
            running_emoji = "🟢 RUNNING" if status['running'] else "🔴 STOPPED"
            
            msg_parts = [
                f"{Colors.CYAN}📊 Task Status: {task_name}",
                "━━━━━━━━━━━━━━━━━━━━━━",
                f"Status: {running_emoji}",
                f"Registered: {'Yes' if status['registered'] else 'No'}",
                f"Restart Count: {status['restart_count']}",
                f"Crash Count: {status['crash_count']}"
            ]
            
            if status['running'] and 'uptime' in status:
                msg_parts.append(f"Uptime: {status['uptime']}")
                msg_parts.append(f"Started: {status['started_at']}")
            
            await bot.send_message("\n".join(msg_parts), user.id)
        
        elif subcommand == "help":
            help_msg = (
                f"{Colors.CYAN}🎛️ Background Task Manager Commands\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"{Colors.WHITE}/btm {Colors.GRAY}- Show summary\n"
                f"{Colors.WHITE}/btm list {Colors.GRAY}- List all tasks\n"
                f"{Colors.WHITE}/btm status <task> {Colors.GRAY}- Task details\n"
                f"{Colors.WHITE}/btm start <task> {Colors.GRAY}- Start a task\n"
                f"{Colors.WHITE}/btm stop <task> {Colors.GRAY}- Stop a task\n"
                f"{Colors.WHITE}/btm restart <task> {Colors.GRAY}- Restart a task"
            )
            await bot.send_message(help_msg, user.id)
        
        else:
            await bot.send_message(
                f"{Colors.RED}❌ Unknown subcommand: {subcommand}\n"
                f"{Colors.GRAY}Use /btm help for available commands",
                user.id
            )
