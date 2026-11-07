# Admin System

## Overview
The admin system provides hierarchical permission management for the Music Bot with three levels: Owner, Admins, and VIPs.

## Permission Hierarchy

### 1. Owner (paul-sanif)
- **Highest Authority**: Ultimate control over the bot
- **Permissions**: 
  - Full access to ALL bot commands
  - Can add/remove Admins
  - Can add/remove VIPs
  - Bypasses all paywalls automatically
  - Cannot be removed or demoted

### 2. Admins
- **Second Level**: Trusted users with elevated permissions
- **Permissions**:
  - Full access to ALL bot commands
  - Can add/remove VIPs (but not other admins)
  - Bypasses all paywalls automatically
  - Can be added/removed only by Owner

### 3. VIPs
- **Third Level**: Special users with economic benefits
- **Permissions**:
  - Can use paid commands (!play, !next, !stop, !clear) for FREE
  - Normal access to all other commands
  - Can be added/removed by Owner or Admins

## Admin Commands

### For Owner Only:
- `!addadmin <username>` - Add a user as admin
- `!removeadmin <username>` - Remove admin status from a user

### For Owner & Admins:
- `!addvip <username>` - Add a user as VIP
- `!removevip <username>` - Remove VIP status from a user

### For Everyone:
- `!admins` - View current admins and owner
- `!vips` - View current VIP list

## Usage Examples

### Adding an Admin (Owner only)
```
!addadmin john_doe
```
Response: ✅ john_doe is now an admin!

### Adding a VIP (Owner or Admin)
```
!addvip jane_smith
```
Response: ✅ jane_smith is now a VIP!

### Viewing Admins
```
!admins
```
Response:
```
👑 Admin System:

Owner: paul-sanif
Admins: john_doe, alice_admin

💡 Admins have full access to all commands
```

### Viewing VIPs
```
!vips
```
Response:
```
⭐ VIP List:

VIPs: jane_smith, bob_vip, carol_user

💡 VIPs can use paid commands for free
```

## VIP Benefits in Action

When a VIP uses a paid command:
```
User: !play shape of you
Bot: 🔍 Searching for: shape of you
     ⭐ VIP Access - Free!
     
     ✅ Now Playing:
     🎵 Shape of You - Ed Sheeran
```

Regular users see:
```
User: !play shape of you
Bot: 🔍 Searching for: shape of you
     💸 Cost: 10 pts | Balance: 50 pts
```

## File Structure
```
admin/
├── __init__.py          # Package initialization
├── admin_manager.py     # Core admin logic
└── README.md           # This file

data/
└── admins.json         # Persistent admin/VIP storage
```

## Data Storage

The system stores admin and VIP data in `data/admins.json`:
```json
{
  "owner": "paul-sanif",
  "admins": ["admin1", "admin2"],
  "vips": ["vip1", "vip2", "vip3"]
}
```

## Permission Checks

The system performs automatic permission checks:
- **All paid commands** check VIP status before deducting points
- **Admin commands** verify user authority before execution
- **Case-insensitive** username matching for flexibility

## Error Messages

The system provides clear feedback:
- ❌ Only the owner can add admins
- ❌ Only owner and admins can add VIPs
- ❌ username is already an admin
- ❌ username is already a VIP
- ✅ username is now an admin!
- ✅ username removed from VIPs
