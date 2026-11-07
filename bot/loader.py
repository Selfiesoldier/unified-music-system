"""
Command Loader - Automatically loads all commands from systems
"""
import importlib
import os

from systems.outfits.avatar_outfit_manager import AvatarOutfitManager
from systems.outfits.inventory_manager import InventoryManager
from systems.outfits.wardrobe_manager import WardrobeManager
from systems.shop.shop_manager import ShopManager


class CommandRegistry:
    """Registry for bot commands"""

    def __init__(self):
        self.commands = {}  # {command_name: handler}
        self.aliases = {}   # {alias: command_name}

    def command(self, *names):
        """Decorator to register a command with one or more names"""
        def decorator(func):
            # First name is the primary command
            primary = names[0]
            self.commands[primary] = func

            # Rest are aliases
            for alias in names[1:]:
                self.aliases[alias] = primary

            return func
        return decorator

    def get_handler(self, command_name):
        """Get handler for a command or its alias"""
        # Check if it's a direct command
        if command_name in self.commands:
            return self.commands[command_name]

        # Check if it's an alias
        if command_name in self.aliases:
            primary = self.aliases[command_name]
            return self.commands.get(primary)

        return None


def load_all_commands(bot):
    """Load all commands from systems directory"""
    systems_dir = "systems"
    loaded_count = 0

    # Create command registry
    bot.command_registry = CommandRegistry()
    bot.command = bot.command_registry.command

    # List of systems to load (in order)
    systems_to_load = [
        "music",
        "economy",
        "admin",
        "position",
        "modes",
        "outfits",
        "shop",
        "personalization",
        "systeminfo"
    ]

    for system_name in systems_to_load:
        system_path = os.path.join(systems_dir, system_name)
        commands_file = f"{system_name}_commands.py"
        commands_path = os.path.join(system_path, commands_file)

        if os.path.exists(commands_path):
            try:
                # Import the commands module
                module = importlib.import_module(f"systems.{system_name}.{system_name}_commands")

                # Call the register function
                if hasattr(module, "register"):
                    module.register(bot)
                    loaded_count += 1
                    print(f"✅ Loaded {system_name} commands")
                else:
                    print(f"⚠️ {system_name}_commands.py has no register() function")
            except Exception as e:
                print(f"❌ Error loading {system_name} commands: {e}")
                import traceback
                traceback.print_exc()
        else:
            print(f"ℹ️ No commands file for {system_name}")

    # Load additional command modules (BTM, etc.)
    additional_modules = [
        ("systems.admin.btm_commands", "BTM commands")
    ]

    for module_path, description in additional_modules:
        try:
            module = importlib.import_module(module_path)
            if hasattr(module, "register"):
                module.register(bot)
                loaded_count += 1
                print(f"✅ Loaded {description}")
            else:
                print(f"⚠️ {module_path} has no register() function")
        except Exception as e:
            print(f"⚠️ Could not load {description}: {e}")

    print(f"✅ Loaded {loaded_count} command modules")
    return loaded_count