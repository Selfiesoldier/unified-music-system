"""
Centralized Error Handler - Catches all errors globally to prevent bot crashes
"""
import traceback
import os
from datetime import datetime
from core.logger import write_log


# Import RestartRequestedException to allow it to propagate
from core.connection_manager import RestartRequestedException


async def safe_call(func, *args, **kwargs):
    """
    Safely execute an async function, catching and logging any errors.
    
    This prevents the bot from crashing when errors occur in:
    - Command handlers
    - Event handlers (chat, tip, join, emote)
    - Background tasks (autoplay, keepalive)
    - Manager methods
    
    IMPORTANT: RestartRequestedException is NOT caught by this function,
    as it's a control flow exception used to trigger bot reconnection.
    
    Args:
        func: The async function to execute
        *args: Positional arguments for the function
        **kwargs: Keyword arguments for the function
    
    Returns:
        The result of the function if successful, None if an error occurred
    """
    try:
        return await func(*args, **kwargs)
    except RestartRequestedException:
        # Re-raise restart exceptions - they're control flow, not errors
        raise
    except Exception as e:
        # Print error to console
        print("=" * 50)
        print("🚨 ERROR CAUGHT BY CENTRALIZED HANDLER")
        print("=" * 50)
        print(f"Function: {func.__name__}")
        print(f"Error Type: {type(e).__name__}")
        print(f"Error Message: {str(e)}")
        print("-" * 50)
        traceback.print_exc()
        print("=" * 50)
        
        # Log error to file
        try:
            log_error_to_file(func.__name__, e)
        except Exception as log_err:
            print(f"⚠️ Failed to log error to file: {log_err}")
        
        # Return None to indicate failure
        return None


def log_error_to_file(func_name, error):
    """
    Log errors to a file for permanent record and debugging.
    
    Args:
        func_name: Name of the function that raised the error
        error: The exception object
    """
    # Format error details
    error_details = f"""{'='*60}
Function: {func_name}
Error Type: {type(error).__name__}
Error Message: {str(error)}
{'-'*60}
Traceback:
{traceback.format_exc()}
{'='*60}"""
    
    # Use centralized logger
    write_log("errors.log", error_details)


def safe_call_sync(func, *args, **kwargs):
    """
    Safely execute a synchronous function, catching and logging any errors.
    
    Use this for non-async functions that need error protection.
    
    Args:
        func: The sync function to execute
        *args: Positional arguments for the function
        **kwargs: Keyword arguments for the function
    
    Returns:
        The result of the function if successful, None if an error occurred
    """
    try:
        return func(*args, **kwargs)
    except Exception as e:
        # Print error to console
        print("=" * 50)
        print("🚨 ERROR CAUGHT BY CENTRALIZED HANDLER (SYNC)")
        print("=" * 50)
        print(f"Function: {func.__name__}")
        print(f"Error Type: {type(e).__name__}")
        print(f"Error Message: {str(e)}")
        print("-" * 50)
        traceback.print_exc()
        print("=" * 50)
        
        # Log error to file
        try:
            log_error_to_file(func.__name__, e)
        except Exception as log_err:
            print(f"⚠️ Failed to log error to file: {log_err}")
        
        # Return None to indicate failure
        return None
