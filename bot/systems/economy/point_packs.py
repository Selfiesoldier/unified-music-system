"""Point pack definitions and configurations"""

class PointPacks:
    """Manages available point packs for purchase"""
    
    PACKS = {
        "starter": {
            "name": "Starter Pack",
            "gold": 10,
            "points": 50,
            "description": "Perfect for trying out!"
        },
        "basic": {
            "name": "Basic Pack",
            "gold": 50,
            "points": 300,
            "description": "Great value pack"
        },
        "premium": {
            "name": "Premium Pack",
            "gold": 100,
            "points": 700,
            "description": "Best deal - 40% bonus!"
        },
        "mega": {
            "name": "Mega Pack",
            "gold": 200,
            "points": 1500,
            "description": "Ultimate pack - 50% bonus!"
        },
        "vip": {
            "name": "VIP Pack",
            "gold": 500,
            "points": 4000,
            "description": "VIP special - 60% bonus!"
        }
    }
    
    @classmethod
    def get_pack(cls, pack_id):
        """Get pack details by ID"""
        return cls.PACKS.get(pack_id.lower())
    
    @classmethod
    def get_all_packs(cls):
        """Get all available packs"""
        return cls.PACKS
    
    @classmethod
    def get_pack_by_gold(cls, gold_amount):
        """Find a pack that matches the exact gold amount"""
        for pack_id, pack_data in cls.PACKS.items():
            if pack_data["gold"] == gold_amount:
                return pack_id, pack_data
        return None, None
    
    @classmethod
    def format_packs_list(cls):
        """Format packs into a display string"""
        lines = []
        for pack_id, pack in cls.PACKS.items():
            lines.append(f"💎 {pack['name']}")
            lines.append(f"   {pack['gold']} Gold → {pack['points']} Points")
            lines.append(f"   {pack['description']}")
        return "\n".join(lines)
