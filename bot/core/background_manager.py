import asyncio
from typing import Dict, Callable, Optional, Coroutine, Any
from datetime import datetime
from core.logger import write_system_log


class BackgroundManager:
    def __init__(self, bot):
        self.bot = bot
        self.running_tasks: Dict[str, asyncio.Task] = {}
        self.task_registry: Dict[str, Callable] = {}
        self.task_start_times: Dict[str, datetime] = {}
        self.task_restart_counts: Dict[str, int] = {}
        self.task_crash_counts: Dict[str, int] = {}
        self.monitor_task: Optional[asyncio.Task] = None
        self.is_shutting_down = False
        
        print("🎛️ Background Task Manager initialized")
        write_system_log("Background Task Manager initialized")
    
    def register_task(self, name: str, coroutine_func: Callable):
        self.task_registry[name] = coroutine_func
        self.task_restart_counts[name] = 0
        self.task_crash_counts[name] = 0
        print(f"📝 Registered task: {name}")
    
    async def start_task(self, name: str, restart_on_crash: bool = True, restart_delay: int = 5) -> bool:
        if self.is_shutting_down:
            print(f"⚠️ Cannot start task '{name}' - BTM is shutting down")
            return False
        
        if name in self.running_tasks:
            task = self.running_tasks[name]
            if not task.done():
                print(f"⚠️ Task '{name}' is already running")
                return False
            else:
                del self.running_tasks[name]
        
        if name not in self.task_registry:
            print(f"❌ Task '{name}' not registered")
            return False
        
        coroutine_func = self.task_registry[name]
        
        async def safe_wrapper():
            try:
                print(f"🚀 Starting task: {name}")
                write_system_log(f"Background task started: {name}")
                self.task_start_times[name] = datetime.now()
                
                await coroutine_func()
                
            except asyncio.CancelledError:
                print(f"⏹️ Task '{name}' was cancelled")
                write_system_log(f"Background task cancelled: {name}")
                raise
            
            except Exception as e:
                self.task_crash_counts[name] = self.task_crash_counts.get(name, 0) + 1
                crash_count = self.task_crash_counts[name]
                
                print(f"💥 Task '{name}' crashed! (crash #{crash_count})")
                print(f"Error: {e}")
                write_system_log(f"Background task crashed: {name} - {e} (crash #{crash_count})")
                
                try:
                    await self.bot.highrise.send_message(
                        self.bot.admin.get_owner_id(),
                        f"⚠️ Background task '{name}' crashed!\n\n"
                        f"Error: {e}\n"
                        f"Crash count: {crash_count}\n"
                        f"Auto-restart: {'Yes' if restart_on_crash else 'No'}"
                    )
                except:
                    pass
                
                if restart_on_crash and not self.is_shutting_down:
                    print(f"🔄 Auto-restarting '{name}' in {restart_delay} seconds...")
                    await asyncio.sleep(restart_delay)
                    
                    if not self.is_shutting_down:
                        self.task_restart_counts[name] = self.task_restart_counts.get(name, 0) + 1
                        await self.start_task(name, restart_on_crash, restart_delay)
        
        self.running_tasks[name] = asyncio.create_task(safe_wrapper())
        return True
    
    async def stop_task(self, name: str) -> bool:
        if name not in self.running_tasks:
            print(f"⚠️ Task '{name}' is not running")
            return False
        
        task = self.running_tasks[name]
        
        if task.done():
            del self.running_tasks[name]
            print(f"✅ Task '{name}' was already stopped")
            return True
        
        task.cancel()
        
        try:
            await task
        except asyncio.CancelledError:
            pass
        
        del self.running_tasks[name]
        
        if name in self.task_start_times:
            start_time = self.task_start_times[name]
            uptime = datetime.now() - start_time
            print(f"⏹️ Stopped task '{name}' (uptime: {uptime})")
            write_system_log(f"Background task stopped: {name} (uptime: {uptime})")
        else:
            print(f"⏹️ Stopped task '{name}'")
            write_system_log(f"Background task stopped: {name}")
        
        return True
    
    async def restart_task(self, name: str) -> bool:
        print(f"🔄 Restarting task: {name}")
        
        if name in self.running_tasks:
            await self.stop_task(name)
        
        self.task_restart_counts[name] = self.task_restart_counts.get(name, 0) + 1
        restart_count = self.task_restart_counts[name]
        
        print(f"🔄 Task '{name}' restart #{restart_count}")
        write_system_log(f"Background task restarted: {name} (restart #{restart_count})")
        
        return await self.start_task(name)
    
    def task_exists(self, name: str) -> bool:
        return name in self.task_registry
    
    def is_running(self, name: str) -> bool:
        if name not in self.running_tasks:
            return False
        
        task = self.running_tasks[name]
        return not task.done()
    
    def get_task_status(self, name: str) -> Dict[str, Any]:
        is_running = self.is_running(name)
        
        status = {
            "name": name,
            "registered": name in self.task_registry,
            "running": is_running,
            "restart_count": self.task_restart_counts.get(name, 0),
            "crash_count": self.task_crash_counts.get(name, 0),
        }
        
        if is_running and name in self.task_start_times:
            start_time = self.task_start_times[name]
            uptime = datetime.now() - start_time
            status["uptime"] = str(uptime).split('.')[0]
            status["started_at"] = start_time.strftime("%Y-%m-%d %H:%M:%S")
        
        return status
    
    def get_all_status(self) -> Dict[str, Dict[str, Any]]:
        return {name: self.get_task_status(name) for name in self.task_registry}
    
    async def monitor_all_tasks(self):
        print("👁️ Background Task Monitor started")
        write_system_log("Background Task Monitor started")
        
        await asyncio.sleep(30)
        
        while not self.is_shutting_down:
            try:
                for name in list(self.task_registry.keys()):
                    if name in self.running_tasks:
                        task = self.running_tasks[name]
                        
                        if task.done():
                            exception = task.exception() if not task.cancelled() else None
                            
                            if exception:
                                print(f"⚠️ Monitor detected crashed task: {name}")
                                write_system_log(f"Monitor detected crashed task: {name} - {exception}")
                            else:
                                print(f"⚠️ Monitor detected stopped task: {name}")
                                write_system_log(f"Monitor detected stopped task: {name}")
                            
                            del self.running_tasks[name]
                
                await asyncio.sleep(60)
            
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"⚠️ Monitor error: {e}")
                write_system_log(f"Background Task Monitor error: {e}")
                await asyncio.sleep(60)
        
        print("👁️ Background Task Monitor stopped")
        write_system_log("Background Task Monitor stopped")
    
    async def start_monitor(self):
        if self.monitor_task and not self.monitor_task.done():
            print("⚠️ Monitor is already running")
            return
        
        self.monitor_task = asyncio.create_task(self.monitor_all_tasks())
    
    async def stop_all_tasks(self):
        self.is_shutting_down = True
        
        print("🛑 Stopping all background tasks...")
        write_system_log("Stopping all background tasks")
        
        if self.monitor_task and not self.monitor_task.done():
            self.monitor_task.cancel()
            try:
                await self.monitor_task
            except asyncio.CancelledError:
                pass
        
        tasks_to_stop = list(self.running_tasks.keys())
        
        for name in tasks_to_stop:
            await self.stop_task(name)
        
        print("✅ All background tasks stopped")
        write_system_log("All background tasks stopped")
    
    def get_summary(self) -> str:
        total_tasks = len(self.task_registry)
        running_tasks = sum(1 for name in self.task_registry if self.is_running(name))
        total_restarts = sum(self.task_restart_counts.values())
        total_crashes = sum(self.task_crash_counts.values())
        
        summary = (
            f"📊 Background Task Manager Status\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"Total Tasks: {total_tasks}\n"
            f"Running: {running_tasks}\n"
            f"Stopped: {total_tasks - running_tasks}\n"
            f"Total Restarts: {total_restarts}\n"
            f"Total Crashes: {total_crashes}"
        )
        
        return summary
