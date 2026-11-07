import json
import os
from highrise.models import Item

class AvatarOutfitManager:
    """
    New outfit system based on avatar state management.
    Stores what the bot is currently wearing and allows easy item changes.
    """
    
    def __init__(self, inventory_manager=None):
        # Avatar state - what bot is currently wearing
        self.avatar = {
            "hair_front": None,
            "hair_back": None,
            "upper_face_hair": None,
            "lower_face_hair": None,
            "eyebrows": None,
            "eyes": None,
            "nose": None,
            "mouth": None,
            "shirt": None,
            "pants": None,
            "skirt": None,
            "shoes": None,
            "socks": None,
            "gloves": None,
            "glasses": None,
            "bag": None,
            "earrings": None,
            "necklace": None,
            "watch": None,
            "handbag": None,
            "freckles": None,
            "skin_color": 27  # Skin tone palette (0-86)
        }
        
        # Color palettes for each category (0-255)
        # Only hair and facial features can be colored
        self.colors = {
            "hair_front": 0,
            "hair_back": 0,
            "upper_face_hair": 0,
            "lower_face_hair": 0,
            "eyebrows": 0,
            "eyes": 0
        }
        
        # Reference to inventory manager for ownership checks
        self.inventory_manager = inventory_manager
        
        # Avatar state file for persistence
        self.state_file = "systems/outfits/data/avatar_state.json"
        
        # Load all items from clothes_present folder
        self.items = self.load_all_items()
        
        # Load outfit presets
        self.outfits = self.load_outfit_presets()
        
        # Load saved avatar state
        self.load_avatar_state()
    
    def load_all_items(self):
        """Load all clothing items from clothes_present folder"""
        items = {}
        clothes_dir = "clothes_present"
        
        # Define which JSON files to load
        files_to_load = [
            "shirts.json",
            "pants.json",
            "skirts.json",
            "shoes.json",
            "glasses.json",
            "bags.json",
            "earings.json",
            "neclace.json",
            "watches.json",
            "gloves.json",
            "handbags.json",
            "hair.json",
            "eyebrows.json",
            "eyes.json",
            "nose.json",
            "mouth.json",
            "face_hair.json",
            "freckles.json"
        ]
        
        for filename in files_to_load:
            filepath = os.path.join(clothes_dir, filename)
            try:
                with open(filepath, 'r') as f:
                    data = json.load(f)
                    # data is always a dict with category keys
                    # e.g., {"shirts": [...]} or {"hair_front": [...], "hair_back": [...]}
                    for category_key, item_list in data.items():
                        # Convert list of items to dict with id as key
                        items[category_key] = {item['id']: item for item in item_list}
            except FileNotFoundError:
                print(f"Warning: {filepath} not found")
            except Exception as e:
                print(f"Error loading {filepath}: {e}")
                import traceback
                traceback.print_exc()
        
        return items
    
    def load_outfit_presets(self):
        """Load outfit presets from JSON file"""
        try:
            with open("systems/outfits/outfit_presets.json", 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            return {}
        except Exception as e:
            print(f"Error loading outfit presets: {e}")
            return {}
    
    def load_avatar_state(self):
        """Load saved avatar state from file"""
        try:
            if os.path.exists(self.state_file):
                with open(self.state_file, 'r') as f:
                    saved_state = json.load(f)
                    
                    # Handle old format (direct avatar dict) and new format (avatar + colors)
                    if 'avatar' in saved_state:
                        # New format
                        for key in self.avatar:
                            if key in saved_state['avatar']:
                                self.avatar[key] = saved_state['avatar'][key]
                        if 'colors' in saved_state:
                            for key in self.colors:
                                if key in saved_state['colors']:
                                    self.colors[key] = saved_state['colors'][key]
                    else:
                        # Old format - migrate to new format
                        for key in self.avatar:
                            if key in saved_state:
                                self.avatar[key] = saved_state[key]
                        # Save in new format
                        self.save_avatar_state()
                        
                print(f"✅ Loaded avatar state from {self.state_file}")
                return True
        except Exception as e:
            print(f"⚠️ Error loading avatar state: {e}")
        return False
    
    def save_avatar_state(self):
        """Save current avatar state to file"""
        try:
            os.makedirs(os.path.dirname(self.state_file), exist_ok=True)
            state_data = {
                'avatar': self.avatar,
                'colors': self.colors
            }
            with open(self.state_file, 'w') as f:
                json.dump(state_data, f, indent=2)
            return True
        except Exception as e:
            print(f"Error saving avatar state: {e}")
            return False
    
    async def sync_from_highrise(self, highrise_client):
        """Sync avatar state from current Highrise outfit"""
        try:
            current_outfit = await highrise_client.get_my_outfit()
            if current_outfit and hasattr(current_outfit, 'outfit'):
                # Clear current state
                for key in self.avatar:
                    self.avatar[key] = None
                
                # Update state from current outfit
                for item in current_outfit.outfit:
                    item_id = item.id if hasattr(item, 'id') else str(item)
                    
                    # Determine category from item ID prefix
                    if '-' in item_id:
                        category_prefix = item_id.split('-')[0]
                        
                        # Map prefix to avatar state key - use full item ID
                        prefix_to_key = {
                            'shirt': 'shirt',
                            'pants': 'pants',
                            'shorts': 'pants',
                            'skirt': 'skirt',
                            'dress': 'skirt',
                            'shoes': 'shoes',
                            'sock': 'socks',
                            'socks': 'socks',
                            'gloves': 'gloves',
                            'glasses': 'glasses',
                            'bag': 'bag',
                            'handbag': 'handbag',
                            'watch': 'watch',
                            'necklace': 'necklace',
                            'earring': 'earrings',
                            'earrings': 'earrings',
                            'hair_front': 'hair_front',
                            'hair_back': 'hair_back',
                            'face_hair': 'upper_face_hair',  # Default face_hair to upper
                            'eyebrow': 'eyebrows',
                            'eyebrows': 'eyebrows',
                            'eye': 'eyes',
                            'eyes': 'eyes',
                            'nose': 'nose',
                            'mouth': 'mouth',
                            'freckle': 'freckles',
                            'freckles': 'freckles'
                        }
                        
                        # Determine if it's upper or lower face hair by ID
                        if category_prefix == 'face_hair':
                            if 'upper' in item_id.lower():
                                avatar_key = 'upper_face_hair'
                            elif 'lower' in item_id.lower():
                                avatar_key = 'lower_face_hair'
                            else:
                                avatar_key = prefix_to_key.get(category_prefix)
                        else:
                            avatar_key = prefix_to_key.get(category_prefix)
                        
                        avatar_key = prefix_to_key.get(category_prefix)
                        if avatar_key:
                            self.avatar[avatar_key] = item_id
                            print(f"  Synced: {avatar_key} = {item_id}")
                
                # Save the synced state
                self.save_avatar_state()
                print("✅ Synced avatar state from Highrise")
                return True
        except Exception as e:
            print(f"⚠️ Error syncing from Highrise: {e}")
            import traceback
            traceback.print_exc()
        return False
    
    def check_ownership(self, item_id):
        """Check if bot owns an item - DISABLED"""
        # Ownership check disabled - allow all items
        return True
    
    def wear(self, category, item_id):
        """Wear a specific item in a category"""
        if category not in self.avatar:
            return False, f"Invalid category: {category}"
        
        # Check ownership
        if not self.check_ownership(item_id):
            return False, f"Bot doesn't own item: {item_id}"
        
        self.avatar[category] = item_id
        self.save_avatar_state()
        return True, None
    
    def remove(self, category):
        """Remove item from a category"""
        if category not in self.avatar:
            return False
        
        self.avatar[category] = None
        self.save_avatar_state()
        return True
    
    def set_skin_color(self, palette_id):
        """Set skin color (palette 0-86)"""
        if not isinstance(palette_id, int) or palette_id < 0 or palette_id > 86:
            return False, "Skin color must be between 0 and 86"
        
        self.avatar['skin_color'] = palette_id
        self.save_avatar_state()
        return True, None
    
    def set_color(self, category, palette_id):
        """Set color palette for a category (0-86)"""
        if category not in self.colors:
            return False, f"Cannot set color for category: {category}"
        
        if not isinstance(palette_id, int) or palette_id < 0 or palette_id > 86:
            return False, "Color palette must be between 0 and 86"
        
        self.colors[category] = palette_id
        self.save_avatar_state()
        return True, None
    
    def wear_outfit(self, outfit_name):
        """Wear a complete outfit preset"""
        if outfit_name not in self.outfits:
            return False, f"Outfit '{outfit_name}' not found"
        
        outfit = self.outfits[outfit_name]
        
        # Check ownership of all items first
        missing_items = []
        for category, item_id in outfit.items():
            if not self.check_ownership(item_id):
                missing_items.append(item_id)
        
        if missing_items:
            return False, f"Missing items: {', '.join(missing_items[:3])}"
        
        # Apply the outfit
        for category, item_id in outfit.items():
            if category in self.avatar:
                self.avatar[category] = item_id
        
        self.save_avatar_state()
        return True, None
    
    def chunk_message(self, text, max_length=240):
        """Split a long message into chunks that fit within message limit"""
        if len(text) <= max_length:
            return [text]
        
        chunks = []
        lines = text.split('\n')
        current_chunk = ""
        
        for line in lines:
            # If the line itself is too long, split it by words
            if len(line) > max_length:
                words = line.split(' ')
                temp_line = ""
                for word in words:
                    if len(temp_line) + len(word) + 1 > max_length:
                        if temp_line:
                            if current_chunk:
                                chunks.append(current_chunk.rstrip())
                                current_chunk = ""
                            chunks.append(temp_line.rstrip())
                            temp_line = word + " "
                        else:
                            # Single word exceeds limit, truncate it
                            chunks.append(word[:max_length])
                    else:
                        temp_line += word + " "
                
                if temp_line:
                    line = temp_line.rstrip()
            
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
    
    def get_current_outfit(self):
        """Get current outfit as text display - returns list of message chunks"""
        text = "🔹 CURRENT OUTFIT 🔹\n\n"
        
        worn_items = []
        for category, item_id in self.avatar.items():
            if item_id:
                item_name = self.get_item_name(category, item_id)
                emoji = self.get_category_emoji(category)
                worn_items.append(f"{emoji} {category.replace('_', ' ').title()}: {item_name}")
        
        if not worn_items:
            text += "No items currently worn.\n"
        else:
            text += "\n".join(worn_items)
        
        return self.chunk_message(text)
    
    def get_item_name(self, category, item_id):
        """Get the display name of an item"""
        # Search through all item categories
        for cat_key, items_dict in self.items.items():
            if item_id in items_dict:
                return items_dict[item_id].get('item_name', item_id)
        return item_id
    
    def get_category_emoji(self, category):
        """Get emoji for category"""
        emoji_map = {
            "shirt": "👕",
            "pants": "👖",
            "skirt": "👗",
            "shoes": "👟",
            "glasses": "👓",
            "bag": "🎒",
            "handbag": "👜",
            "watch": "⌚",
            "necklace": "📿",
            "earrings": "💍",
            "gloves": "🧤",
            "hair_front": "💇",
            "hair_back": "💇",
            "upper_face_hair": "👨",
            "lower_face_hair": "🧔",
            "eyebrows": "👁️",
            "eyes": "👁️",
            "nose": "👃",
            "mouth": "👄",
            "freckles": "✨",
            "socks": "🧦"
        }
        return emoji_map.get(category, "👔")
    
    def find_item(self, category, query):
        """Find an item by name, number, or ID in a category"""
        # Map category aliases to actual category keys in self.items
        category_map = {
            "shirt": "shirts",
            "pants": "pants",
            "skirt": "skirts",
            "shoes": "shoes",
            "glasses": "glasses",
            "bag": "bags",
            "earrings": "earings",
            "necklace": "neclace",
            "watch": "watches",
            "gloves": "gloves",
            "handbag": "handbags",
            "hair_front": "hair_front",
            "hair_back": "hair_back",
            "eyebrows": "eyebrows",
            "eyes": "eyes",
            "nose": "noses",
            "mouth": "mouths",
            "face_hair": "face_hair",
            "upper_face_hair": "upper_face_hair",
            "lower_face_hair": "lower_face_hair",
            "freckles": "freckles"
        }
        
        # Get the actual category key to search
        search_key = category_map.get(category, category)
        
        if search_key not in self.items:
            return None, None
        
        items_dict = self.items[search_key]
        
        # Try number match first (e.g., "1", "2", "3")
        if query.isdigit():
            item_number = int(query)
            if 1 <= item_number <= len(items_dict):
                # Get item by index
                item_id = list(items_dict.keys())[item_number - 1]
                return item_id, items_dict[item_id]['item_name']
        
        # Try exact ID match
        if query in items_dict:
            return query, items_dict[query]['item_name']
        
        # Try partial name match
        query_lower = query.lower()
        for item_id, item_data in items_dict.items():
            item_name = item_data['item_name'].lower()
            if query_lower in item_name or query_lower in item_id.lower():
                return item_id, item_data['item_name']
        
        return None, None
    
    def list_all_categories(self):
        """List all available categories with item counts - returns list of message chunks"""
        text = "👔 AVAILABLE CATEGORIES:\n\n"
        
        # Define category display names and their internal keys
        categories_info = [
            ("Clothing", [
                ("shirt", "shirts", "Shirts"),
                ("pants", "pants", "Pants"),
                ("skirt", "skirts", "Skirts"),
                ("shoes", "shoes", "Shoes"),
                ("socks", "socks", "Socks"),
                ("gloves", "gloves", "Gloves"),
            ]),
            ("Accessories", [
                ("glasses", "glasses", "Glasses"),
                ("bag", "bags", "Bags"),
                ("handbag", "handbags", "Handbags"),
                ("earrings", "earings", "Earrings"),
                ("necklace", "neclace", "Necklaces"),
                ("watch", "watches", "Watches"),
            ]),
            ("Face & Hair", [
                ("skin", None, "Skin Tones (87)"),
                ("hair_front", "hair_front", "Front Hair"),
                ("hair_back", "hair_back", "Back Hair"),
                ("upper_face_hair", "upper_face_hair", "Mustaches"),
                ("lower_face_hair", "lower_face_hair", "Beards"),
                ("eyebrows", "eyebrows", "Eyebrows"),
                ("eyes", "eyes", "Eyes"),
                ("nose", "noses", "Noses"),
                ("mouth", "mouths", "Mouths"),
                ("freckles", "freckles", "Freckles"),
            ])
        ]
        
        for section_name, categories in categories_info:
            text += f"🎨 {section_name}:\n"
            for cmd_name, internal_key, display_name in categories:
                if internal_key is None:
                    text += f"  • {display_name}\n"
                elif internal_key in self.items:
                    count = len(self.items[internal_key])
                    text += f"  • {display_name}: {count} items\n"
            text += "\n"
        
        text += "💡 Use: !list <category>\n"
        text += "💡 Example: !list shirt"
        
        return self.chunk_message(text)
    
    def list_skin_tones(self):
        """List all available skin tones (0-86) with names - returns list of message chunks"""
        def get_skin_tone_name(palette_id):
            """Get descriptive name for skin tone"""
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
        
        text = "🎨 SKIN TONES (0-86):\n\n"
        
        current_skin = self.avatar.get('skin_color', 27)
        
        for tone_id in range(87):
            tone_name = get_skin_tone_name(tone_id)
            status = " ✅" if tone_id == current_skin else ""
            text += f"{tone_id}. {tone_name}{status}\n"
        
        text += f"\n📊 Total: 87 skin tones\n"
        text += "💡 Use: !skin <0-86>\n"
        text += "💡 Example: !skin 27"
        
        return self.chunk_message(text)
    
    def list_items(self, category):
        """List all items in a category - returns list of message chunks"""
        # Special handling for skin tones
        if category.lower() in ['skin', 'skincolor', 'skin_color']:
            return self.list_skin_tones()
        
        # Map category aliases (input category to actual key in self.items)
        category_map = {
            "shirt": "shirts",
            "pants": "pants",
            "skirt": "skirts",
            "shoes": "shoes",
            "glasses": "glasses",
            "bag": "bags",
            "earrings": "earings",
            "necklace": "neclace",
            "watch": "watches",
            "gloves": "gloves",
            "handbag": "handbags",
            "hair_front": "hair_front",
            "hair_back": "hair_back",
            "eyebrows": "eyebrows",
            "eyes": "eyes",
            "nose": "noses",
            "mouth": "mouths",
            "face_hair": "face_hair",
            "upper_face_hair": "upper_face_hair",
            "lower_face_hair": "lower_face_hair",
            "freckles": "freckles"
        }
        
        cat = category_map.get(category, category)
        
        if cat not in self.items:
            return [f"❌ Category '{category}' not found!"]
        
        items_dict = self.items[cat]
        text = f"👔 {category.upper()} ITEMS:\n\n"
        
        for idx, (item_id, item_data) in enumerate(items_dict.items(), 1):
            item_name = item_data['item_name']
            
            # Check ownership
            owned = self.check_ownership(item_id) if self.inventory_manager else False
            status = " ✅" if owned else ""
            
            text += f"{idx}. {item_name}{status}\n"
        
        text += f"\n📊 Total: {len(items_dict)} items\n"
        text += f"💡 Use: !wear {category} <number>\n"
        text += f"💡 Example: !wear {category} 1"
        
        return self.chunk_message(text)
    
    def get_outfit_list(self):
        """Get list of available outfit presets - returns list of message chunks"""
        if not self.outfits:
            return ["❌ No outfit presets available"]
        
        text = "👔 AVAILABLE OUTFITS:\n\n"
        for idx, outfit_name in enumerate(self.outfits.keys(), 1):
            text += f"{idx}. {outfit_name.replace('_', ' ').title()}\n"
        
        text += f"\n📊 Total: {len(self.outfits)} outfits\n"
        text += "💡 Use: !wear outfit <name>\n"
        if self.outfits:
            text += f"💡 Example: !wear outfit {list(self.outfits.keys())[0]}"
        
        return self.chunk_message(text)
    
    def build_highrise_outfit(self):
        """Convert current avatar state to Highrise outfit format"""
        outfit_items = []
        
        # REQUIRED: Add body item (mandatory for all outfits)
        skin_color = self.avatar.get('skin_color', 27)
        outfit_items.append(Item(
            type='clothing',
            amount=1,
            id='body-flesh',
            account_bound=False,
            active_palette=skin_color
        ))
        
        # Add all avatar items with their custom colors
        for category, item_id in self.avatar.items():
            if category == 'skin_color':
                continue  # Skip skin_color, already handled
            if item_id:
                # Get custom color for this category if available
                color_palette = self.colors.get(category, 0)
                outfit_items.append(Item(
                    type='clothing',
                    amount=1,
                    id=item_id,
                    account_bound=False,
                    active_palette=color_palette
                ))
        
        return outfit_items
    
    def clear_outfit(self):
        """Remove all items"""
        for category in self.avatar:
            self.avatar[category] = None
        self.save_avatar_state()
