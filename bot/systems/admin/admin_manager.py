"""Admin system for Music Bot - manages owner, admins, and VIPs"""

import json
import asyncio
import os
from pathlib import Path

class AdminManager:
    """Manages admin permissions and VIP access"""
    
    # Default owners list
    DEFAULT_OWNERS = ["_paul_sanif_", "paul_sanif", "692dbdef5b2eb22b61d96993" , "sarvar_", "demon_king.18"]
    OWNER_USERNAME = ["_paul_sanif_", "sarvar_", "demon_king.18"]
    
    def __init__(self, admin_file="systems/admin/data/admins.json"):
        self.admin_file = admin_file
        self.owners = list(self.DEFAULT_OWNERS)
        self.admins = []  # List of admin usernames
        self.vips = []    # List of VIP usernames
        self.lock = asyncio.Lock()
        self.load_admins()
    
    def load_admins(self):
        """Load admins and VIPs from file"""
        try:
            if os.path.exists(self.admin_file):
                with open(self.admin_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                    owners_data = data.get('owners') or data.get('owner')
                    if isinstance(owners_data, list):
                        self.owners = list(set([str(o) for o in owners_data] + self.DEFAULT_OWNERS))
                    elif isinstance(owners_data, str):
                        self.owners = list(set([owners_data] + self.DEFAULT_OWNERS))
                    else:
                        self.owners = list(self.DEFAULT_OWNERS)

                    self.admins = data.get('admins', [])
                    self.vips = data.get('vips', [])
                try:
                    print(f"✅ Loaded {len(self.owners)} owners, {len(self.admins)} admins and {len(self.vips)} VIPs")
                except UnicodeEncodeError:
                    print(f"Loaded {len(self.owners)} owners, {len(self.admins)} admins and {len(self.vips)} VIPs")
            else:
                self.owners = list(self.DEFAULT_OWNERS)
                self.admins = []
                self.vips = []
                self.save_admins()
                try:
                    print("📝 Created new admin storage")
                except UnicodeEncodeError:
                    print("Created new admin storage")
        except Exception as e:
            try:
                print(f"⚠️ Error loading admins: {e}")
            except UnicodeEncodeError:
                print(f"Error loading admins: {e}")
            self.owners = list(self.DEFAULT_OWNERS)
            self.admins = []
            self.vips = []

    
    def save_admins(self):
        """Save admins and VIPs to file"""
        try:
            # Ensure directory exists
            Path(self.admin_file).parent.mkdir(parents=True, exist_ok=True)
            
            data = {
                'owners': self.owners,
                'admins': self.admins,
                'vips': self.vips
            }
            
            with open(self.admin_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            return True
        except Exception as e:
            print(f"❌ Error saving admins: {e}")
            return False
    
    def is_owner(self, user_or_name):
        """Check if user/username/ID is an owner"""
        if not user_or_name:
            return False
        if hasattr(user_or_name, 'username'):
            uname = (getattr(user_or_name, 'username', '') or '').lower()
            uid = (getattr(user_or_name, 'id', '') or '').lower()
            return any(o.lower() in (uname, uid) for o in self.owners)
        name = str(user_or_name).lower()
        return any(o.lower() == name for o in self.owners)
    
    def is_admin(self, user_or_name):
        """Check if user is an admin"""
        if not user_or_name:
            return False
        name = (user_or_name.username if hasattr(user_or_name, 'username') else str(user_or_name)).lower()
        return name in [admin.lower() for admin in self.admins]
    
    def is_vip(self, user_or_name):
        """Check if user is a VIP"""
        if not user_or_name:
            return False
        name = (user_or_name.username if hasattr(user_or_name, 'username') else str(user_or_name)).lower()
        return name in [vip.lower() for vip in self.vips]
    
    def has_admin_access(self, user_or_name):
        """Check if user has admin access (owner or admin)"""
        return self.is_owner(user_or_name) or self.is_admin(user_or_name)
    
    def has_vip_access(self, user_or_name):
        """Check if user has VIP access (owner, admin, or VIP)"""
        return self.is_owner(user_or_name) or self.is_admin(user_or_name) or self.is_vip(user_or_name)

    
    async def add_admin(self, username, added_by):
        """Add an admin (only owner can do this)"""
        async with self.lock:
            if not self.is_owner(added_by):
                return False, "Only the owner can add admins"
            
            if self.is_owner(username):
                return False, "Owner already has all permissions"
            
            if self.is_admin(username):
                return False, f"{username} is already an admin"
            
            self.admins.append(username)
            self.save_admins()
            print(f"👑 {added_by} added {username} as admin")
            return True, f"✅ {username} is now an admin!"
    
    async def remove_admin(self, username, removed_by):
        """Remove an admin (only owner can do this)"""
        async with self.lock:
            if not self.is_owner(removed_by):
                return False, "Only the owner can remove admins"
            
            if self.is_owner(username):
                return False, "Cannot remove the owner"
            
            if not self.is_admin(username):
                return False, f"{username} is not an admin"
            
            # Remove from admins list (case insensitive)
            self.admins = [admin for admin in self.admins if admin.lower() != username.lower()]
            self.save_admins()
            print(f"👑 {removed_by} removed {username} from admins")
            return True, f"✅ {username} removed from admins"
    
    async def add_vip(self, username, added_by):
        """Add a VIP (owner or admins can do this)"""
        async with self.lock:
            if not self.has_admin_access(added_by):
                return False, "Only owner and admins can add VIPs"
            
            if self.is_owner(username):
                return False, "Owner already has all permissions"
            
            if self.is_admin(username):
                return False, f"{username} is an admin, already has VIP access"
            
            if self.is_vip(username):
                return False, f"{username} is already a VIP"
            
            self.vips.append(username)
            self.save_admins()
            print(f"⭐ {added_by} added {username} as VIP")
            return True, f"✅ {username} is now a VIP!"
    
    async def remove_vip(self, username, removed_by):
        """Remove a VIP (owner or admins can do this)"""
        async with self.lock:
            if not self.has_admin_access(removed_by):
                return False, "Only owner and admins can remove VIPs"
            
            if not self.is_vip(username):
                return False, f"{username} is not a VIP"
            
            # Remove from VIPs list (case insensitive)
            self.vips = [vip for vip in self.vips if vip.lower() != username.lower()]
            self.save_admins()
            print(f"⭐ {removed_by} removed {username} from VIPs")
            return True, f"✅ {username} removed from VIPs"
    
    def get_admins_list(self):
        """Get formatted list of admins"""
        if not self.admins:
            return "No admins yet"
        return ", ".join(self.admins)
    
    def get_vips_list(self):
        """Get formatted list of VIPs"""
        if not self.vips:
            return "No VIPs yet"
        return ", ".join(self.vips)
