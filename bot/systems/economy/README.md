# Music Bot Economy System

## Overview
The economy system adds a paywall to specific music bot commands using "Music Points" as currency. Users purchase points by tipping the bot gold.

## Currency System
- **Music Points**: Virtual currency for using bot commands
- **Conversion**: 10 Gold = 50 Music Points (base rate)
- **Point Packs**: Special packages with bonus points

## Point Packages

| Package | Gold Cost | Points Received | Bonus |
|---------|-----------|-----------------|-------|
| Starter | 10 | 50 | Base rate |
| Basic | 50 | 300 | 20% bonus |
| Premium | 100 | 700 | 40% bonus |
| Mega | 200 | 1,500 | 50% bonus |
| VIP | 500 | 4,000 | 60% bonus |

## Command Costs

| Command | Cost | Description |
|---------|------|-------------|
| !play | 10 points | Play a song |
| !next | 10 points | Skip to next song |
| !stop | 5 points | Stop playback |
| !clear | 5 points per song | Clear queue |

## Economy Commands

### !balance / !points
Check your current Music Points balance

### !packs / !packages
View all available point packages

### !costs / !prices
View command costs

## How to Purchase Points

1. **Tip the bot gold** - Simply tip the bot gold in Highrise
2. **Exact package amount** - Tip the exact gold amount of a package to get bonus points
3. **Custom amount** - Tip any amount (minimum 10 gold) to get base conversion rate

### Examples:
- Tip 100 gold → Get 700 points (Premium Pack)
- Tip 75 gold → Get 350 points (custom: 75÷10×50)
- Tip 500 gold → Get 4,000 points (VIP Pack)

## File Structure

```
economy/
├── __init__.py           # Package initialization
├── economy_manager.py    # Core economy logic
├── point_packs.py        # Pack definitions
└── README.md            # This file

data/
└── user_balances.json   # Persistent user balances
```

## Technical Details

### EconomyManager
- Manages user balances in-memory with JSON persistence
- Thread-safe operations using async locks
- Automatic point deduction and refunds
- Transaction logging

### Point Packs
- Configurable pack definitions
- Automatic pack detection by gold amount
- Fallback to base conversion for custom amounts

### Integration
- Integrated with `on_tip` event handler
- Command guards for all paid commands
- Balance checks before command execution
- Clear error messages for insufficient funds
