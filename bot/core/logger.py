"""
Centralized Logging System - Universal logger for all bot events
"""
from datetime import datetime
import os


def write_log(file, text):
    """
    Write a log entry to a specific log file with timestamp.
    
    Args:
        file: Name of the log file (e.g., "commands.log", "errors.log")
        text: The message to log
    
    Example:
        write_log("commands.log", f"{username} used !play")
        write_log("tips.log", f"User {user_id} tipped 100 gold")
        write_log("system.log", "Bot started successfully")
    """
    # Create logs directory if it doesn't exist
    os.makedirs("logs", exist_ok=True)
    
    # Format timestamp
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Write to log file
    try:
        with open(f"logs/{file}", "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {text}\n")
    except Exception as e:
        print(f"⚠️ Failed to write to {file}: {e}")


def write_command_log(username, user_id, command, args=""):
    """
    Log a command execution.
    
    Args:
        username: Username who executed the command
        user_id: User ID
        command: Command name (e.g., "play", "next", "stop")
        args: Command arguments/parameters
    """
    args_str = f" {args}" if args else ""
    write_log("commands.log", f"{username} (ID: {user_id}) used !{command}{args_str}")


def write_tip_log(username, user_id, gold_amount, points_earned, pack_name=""):
    """
    Log a tip transaction.
    
    Args:
        username: Username who tipped
        user_id: User ID
        gold_amount: Amount of gold tipped
        points_earned: Points earned from the tip
        pack_name: Name of the pack purchased (if applicable)
    """
    pack_info = f" ({pack_name})" if pack_name else ""
    write_log("tips.log", f"{username} (ID: {user_id}) tipped {gold_amount} gold → {points_earned} points{pack_info}")


def write_economy_log(user_id, action, amount, balance, reason=""):
    """
    Log an economy transaction.
    
    Args:
        user_id: User ID
        action: Type of action ("add" or "deduct")
        amount: Amount of points added/deducted
        balance: New balance after transaction
        reason: Reason for the transaction
    """
    reason_str = f" | Reason: {reason}" if reason else ""
    write_log("economy.log", f"User {user_id} | {action.upper()} {amount} pts → Balance: {balance} pts{reason_str}")


def write_system_log(event):
    """
    Log a system event.
    
    Args:
        event: Description of the system event
    """
    write_log("system.log", event)
