import asyncio
import json
import os
import sys
from typing import Optional, Union, Dict
from highrise import Position, AnchorPosition

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

PositionType = Union[Position, AnchorPosition]

class PositionManager:
    def __init__(self, config_file: str = "systems/position/default_position.json"):
        self.config_file = config_file
        self.locations: Dict[str, PositionType] = {}
        self.default_position: Optional[PositionType] = None
        self.load_position()

    def _parse_position(self, data: dict) -> Optional[PositionType]:
        """Parses a dictionary into either a Position or an AnchorPosition."""
        if not isinstance(data, dict):
            return None
        
        # Check if it's a furniture / room anchor point
        if data.get('type') == 'anchor' or ('entity_id' in data and 'anchor_ix' in data):
            try:
                return AnchorPosition(
                    entity_id=str(data['entity_id']),
                    anchor_ix=int(data.get('anchor_ix', 0))
                )
            except Exception as e:
                print(f"⚠️ Error parsing AnchorPosition: {e}")
                return None
        
        # Otherwise standard coordinate Position
        if 'x' in data and 'y' in data and 'z' in data:
            try:
                return Position(
                    x=float(data['x']),
                    y=float(data['y']),
                    z=float(data['z']),
                    facing=data.get('facing', 'FrontRight')
                )
            except Exception as e:
                print(f"⚠️ Error parsing Position: {e}")
                return None
        
        return None

    def _serialize_position(self, pos: PositionType) -> dict:
        """Serializes a Position or AnchorPosition into a JSON-serializable dict."""
        if isinstance(pos, AnchorPosition):
            return {
                'type': 'anchor',
                'entity_id': str(pos.entity_id),
                'anchor_ix': int(pos.anchor_ix)
            }
        elif isinstance(pos, Position):
            return {
                'x': float(pos.x),
                'y': float(pos.y),
                'z': float(pos.z),
                'facing': pos.facing or 'FrontRight'
            }
        elif isinstance(pos, dict):
            return pos
        return {}

    def load_position(self):
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                    # Backwards compatibility with old flat default_position
                    if 'x' in data and 'default' not in data:
                        self.default_position = self._parse_position(data)
                    else:
                        if 'default' in data and data['default']:
                            self.default_position = self._parse_position(data['default'])
                        if 'locations' in data and isinstance(data['locations'], dict):
                            for name, loc in data['locations'].items():
                                parsed = self._parse_position(loc)
                                if parsed:
                                    self.locations[name] = parsed
                    
                    anchor_count = sum(1 for loc in self.locations.values() if isinstance(loc, AnchorPosition))
                    if isinstance(self.default_position, AnchorPosition):
                        anchor_count += 1
                    print(f"✅ Loaded {len(self.locations)} locations (including {anchor_count} anchor points) and default position.")
            except Exception as e:
                print(f"⚠️ Error loading position config: {e}")
                self.default_position = None
        else:
            print("ℹ️ No default position configured yet. Use !setmusicbot to set one.")
            self.default_position = None

    def save_position(self, position: Optional[PositionType] = None, name: Optional[str] = None) -> bool:
        try:
            os.makedirs(os.path.dirname(self.config_file), exist_ok=True)
            
            if position and not name:
                self.default_position = position
            elif position and name:
                self.locations[name] = position
            
            data = {
                'locations': {}
            }
            
            if self.default_position:
                data['default'] = self._serialize_position(self.default_position)
                
            for loc_name, loc_pos in self.locations.items():
                data['locations'][loc_name] = self._serialize_position(loc_pos)
            
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            
            return True
        except Exception as e:
            print(f"❌ Error saving position: {e}")
            return False

    def get_position(self) -> Optional[PositionType]:
        return self.default_position

    def has_position(self) -> bool:
        return self.default_position is not None

    @staticmethod
    async def move_bot_to(bot, destination: PositionType, retries: int = 3) -> bool:
        """Move the bot to a Position or AnchorPosition safely with retry logic."""
        if not bot or not bot.bot_user_id or not destination:
            return False
        
        for attempt in range(retries):
            if isinstance(destination, AnchorPosition):
                try:
                    await bot.highrise.walk_to(destination)
                    return True
                except Exception as e:
                    if attempt < retries - 1:
                        await asyncio.sleep(1.0)
                        continue
                    print(f"⚠️ Failed to walk to anchor point: {e}")
                    return False
            elif isinstance(destination, Position):
                # 1. Walk to destination (Always permitted by Highrise engine for all bots)
                try:
                    await bot.highrise.walk_to(destination)
                except Exception as walk_e:
                    pass
                # 2. Also send instant teleport (Fast dock if bot has designer / mod permission)
                try:
                    await bot.highrise.teleport(bot.bot_user_id, destination)
                except Exception as e:
                    pass
                return True
        return False

    async def ensure_home_position(self, bot) -> bool:
        """Ensures the bot is at its saved default anchor/position."""
        pos = self.get_position()
        if not pos:
            return False
        return await self.move_bot_to(bot, pos)
