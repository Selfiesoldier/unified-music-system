from highrise.models import Item
import json

class WardrobeManager:
    """
    Simple wardrobe manager for easy item selection by category
    """
    
    def __init__(self):
        # Load item catalogs
        self.shirt_items = self.load_json('inventory/shirt_items.json')
        self.bottoms_items = self.load_json('inventory/bottoms_items.json')
        self.shoes_items = self.load_json('inventory/shoes_items.json')
        self.accessories_items = self.load_json('inventory/accessories_items.json')
        self.freckle_items = self.load_json('inventory/freckle_items.json')
        self.hair_items = self.load_json('inventory/hair_items.json')
        self.free_items_info = self.get_free_items_list()
        
    def load_json(self, filepath):
        """Load JSON catalog file"""
        try:
            with open(filepath, 'r') as f:
                return json.load(f)
        except:
            return {}
    
    def get_free_items_list(self):
        """Return list of free item IDs"""
        return [
            # Shoes
            'shoes-n_whitedans', 'shoes-n_starteritems2019flatswhite',
            'shoes-n_starteritems2019flatspink', 'shoes-n_starteritems2019flatsblack',
            'shoes-n_starteritems2018conversewhite',
            # Skirts
            'skirt-n_starteritems2018whiteskirt', 'skirt-n_starteritems2018blueskirt',
            'skirt-n_starteritems2018blackskirt', 'skirt-n_room22019skirtwithsocksplaid',
            'skirt-n_room12019pleatedskirtpink', 'skirt-n_room12019pleatedskirtgrey',
            'skirt-n_room12019pleatedskirtblack',
            # Socks
            'sock-n_starteritems2020whitethighhighs', 'sock-n_starteritems2020whitesocks',
            'sock-n_starteritems2020whitekneelength', 'sock-n_starteritems2020blackthighhighs',
            'sock-n_starteritems2020blacksocks', 'sock-n_starteritems2020blackkneelength',
            'sock-n_basic2021opaquetightswhite',
            # Watch
            'watch-n_room32019blackwatch'
        ]
    
    def get_category_items(self, category):
        """Get all items for a specific category"""
        category = category.lower()
        
        if category in ['shirt', 'shirts', 'top', 'tops']:
            return self.shirt_items
        elif category in ['pants', 'skirt', 'skirts', 'bottom', 'bottoms']:
            items = {}
            if 'pants' in self.bottoms_items:
                items.update(self.bottoms_items['pants'])
            if 'skirts' in self.bottoms_items:
                items.update(self.bottoms_items['skirts'])
            return items
        elif category in ['shoes', 'shoe']:
            if 'shoes' in self.shoes_items:
                return self.shoes_items['shoes']
            return self.shoes_items
        elif category in ['sock', 'socks']:
            if 'socks' in self.shoes_items:
                return self.shoes_items['socks']
            return {}
        elif category in ['glasses', 'glass']:
            if 'glasses' in self.accessories_items:
                return self.accessories_items['glasses']
            return {}
        elif category in ['bag', 'bags']:
            if 'bags' in self.accessories_items:
                return self.accessories_items['bags']
            return {}
        elif category in ['watch', 'watches']:
            if 'watches' in self.accessories_items:
                return self.accessories_items['watches']
            return {}
        elif category in ['earring', 'earrings']:
            if 'earrings' in self.accessories_items:
                return self.accessories_items['earrings']
            return {}
        elif category in ['necklace', 'necklaces']:
            if 'necklaces' in self.accessories_items:
                return self.accessories_items['necklaces']
            return {}
        elif category in ['freckle', 'freckles', 'makeup', 'face']:
            return self.freckle_items
        elif category in ['eye', 'eyes']:
            if 'eye' in self.hair_items:
                return self.hair_items['eye']
            return {}
        elif category in ['eyebrow', 'eyebrows']:
            if 'eyebrow' in self.hair_items:
                return self.hair_items['eyebrow']
            return {}
        elif category in ['mouth', 'mouths', 'lips']:
            if 'mouth' in self.hair_items:
                return self.hair_items['mouth']
            return {}
        elif category in ['hair']:
            items = {}
            if 'hair_front' in self.hair_items:
                items.update(self.hair_items['hair_front'])
            if 'hair_back' in self.hair_items:
                items.update(self.hair_items['hair_back'])
            return items
        elif category in ['hair_front', 'hairfront', 'front_hair']:
            if 'hair_front' in self.hair_items:
                return self.hair_items['hair_front']
            return {}
        elif category in ['hair_back', 'hairback', 'back_hair']:
            if 'hair_back' in self.hair_items:
                return self.hair_items['hair_back']
            return {}
        elif category in ['nose', 'noses']:
            if 'nose' in self.hair_items:
                return self.hair_items['nose']
            return {}
        elif category in ['face_hair', 'facehair', 'facial_hair', 'beard', 'mustache']:
            if 'face_hair' in self.hair_items:
                return self.hair_items['face_hair']
            return {}
        else:
            return {}
    
    def find_item_by_query(self, category, query):
        """Find item by number or name match"""
        items = self.get_category_items(category)
        
        if not items:
            return None, None
        
        items_list = list(items.items())
        
        # Try number first
        try:
            index = int(query) - 1
            if 0 <= index < len(items_list):
                item_id, item_data = items_list[index]
                return item_id, item_data['item_name']
        except ValueError:
            pass
        
        # Try name match (case insensitive, partial match)
        query_lower = query.lower()
        for item_id, item_data in items_list:
            item_name = item_data['item_name'].lower()
            if query_lower in item_name or query_lower in item_id.lower():
                return item_id, item_data['item_name']
        
        return None, None
    
    def get_category_list(self, category, owned_items=None, show_free=True):
        """Get formatted list of items in category"""
        items = self.get_category_items(category)
        
        if not items:
            return f"❌ Category '{category}' not found!"
        
        text = f"👔 {category.upper()} ITEMS:\n\n"
        
        for idx, (item_id, item_data) in enumerate(items.items(), 1):
            item_name = item_data['item_name']
            
            # Check if free
            is_free = item_id in self.free_items_info
            
            # Check if owned
            is_owned = False
            if owned_items:
                is_owned = any(item.get('id') == item_id for item in owned_items)
            
            status = ""
            if is_free:
                status = " 🆓"
            elif is_owned:
                status = " ✅"
            
            text += f"{idx}. {item_name}{status}\n"
            
            # Add short ID hint for easy reference
            if idx <= 10:  # Show ID for first 10 items
                short_id = item_id.split('-')[-1][:15]
                text += f"   ID: ...{short_id}\n"
        
        text += f"\n📊 Total: {len(items)} items"
        if show_free:
            free_count = sum(1 for item_id in items.keys() if item_id in self.free_items_info)
            if free_count > 0:
                text += f" ({free_count} free 🆓)"
        
        text += f"\n\n💡 Use: !wear {category} [number/name]"
        
        return text
    
    def create_item(self, item_id, active_palette=0):
        """Create Item object"""
        return Item(
            type='clothing',
            amount=1,
            id=item_id,
            active_palette=active_palette
        )
    
    def is_free_item(self, item_id):
        """Check if item is free"""
        return item_id in self.free_items_info
