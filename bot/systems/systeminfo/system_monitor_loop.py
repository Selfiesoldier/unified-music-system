import asyncio
import psutil
import os
from datetime import datetime
from core.error_handler import safe_call
from core.logger import write_system_log


async def system_health_monitor_loop(bot):
    print("🏥 System health monitor started, waiting 30 seconds...")
    write_system_log("System health monitor started")
    await asyncio.sleep(30)
    print("✅ System health monitor active!")
    
    while True:
        await safe_call(lambda: _health_check_iteration(bot))
        await asyncio.sleep(300)


async def _health_check_iteration(bot):
    try:
        process = psutil.Process(os.getpid())
        
        cpu_percent = process.cpu_percent(interval=1)
        memory_info = process.memory_info()
        memory_mb = memory_info.rss / 1024 / 1024
        
        total_threads = process.num_threads()
        
        btm_status = bot.background_manager.get_all_status()
        running_tasks = sum(1 for task in btm_status.values() if task['running'])
        total_tasks = len(btm_status)
        
        health_data = {
            "timestamp": datetime.now().isoformat(),
            "cpu_percent": cpu_percent,
            "memory_mb": round(memory_mb, 2),
            "threads": total_threads,
            "background_tasks": f"{running_tasks}/{total_tasks}"
        }
        
        if cpu_percent > 80:
            print(f"⚠️ HIGH CPU USAGE: {cpu_percent}%")
            write_system_log(f"HIGH CPU USAGE: {cpu_percent}%")
        
        if memory_mb > 500:
            print(f"⚠️ HIGH MEMORY USAGE: {memory_mb:.2f} MB")
            write_system_log(f"HIGH MEMORY USAGE: {memory_mb:.2f} MB")
        
        stopped_tasks = [name for name, status in btm_status.items() if not status['running']]
        if stopped_tasks:
            print(f"⚠️ STOPPED TASKS DETECTED: {', '.join(stopped_tasks)}")
            write_system_log(f"STOPPED TASKS DETECTED: {', '.join(stopped_tasks)}")
            
            try:
                await bot.highrise.send_message(
                    bot.admin.get_owner_id(),
                    f"⚠️ System Health Alert\n\n"
                    f"Stopped tasks detected:\n" + "\n".join(f"- {task}" for task in stopped_tasks)
                )
            except:
                pass
        
        if cpu_percent <= 50 and memory_mb <= 300 and not stopped_tasks:
            print(f"✅ System health OK - CPU: {cpu_percent:.1f}%, Memory: {memory_mb:.1f}MB, Tasks: {running_tasks}/{total_tasks}")
        
        return health_data
    
    except Exception as e:
        print(f"⚠️ Health monitor error: {e}")
        write_system_log(f"Health monitor error: {e}")
        return None
