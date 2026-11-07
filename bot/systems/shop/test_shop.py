#!/usr/bin/env python3
"""
Quick test script for the shop system
Run this to test item search without starting the bot
"""

from item_search import ItemSearch

def test_search():
    print("🔍 Testing Item Search System\n")
    print("=" * 50)
    
    # Initialize search
    print("\n📦 Loading items...")
    searcher = ItemSearch()
    print(f"✅ Loaded {len(searcher.items_database)} items\n")
    
    # Test searches
    test_queries = [
        "tank white",
        "red jacket",
        "box braids",
        "pink freckles",
        "white dans",
        "puffer",
        "short fro",
        "denim jacket"
    ]
    
    for query in test_queries:
        print(f"\n🔍 Searching: '{query}'")
        print("-" * 50)
        results = searcher.search_items(query, limit=3)
        
        if not results:
            print("  ❌ No results found")
        else:
            for i, item in enumerate(results, 1):
                category_emoji = {
                    'shirt': '👕',
                    'bottoms': '👖',
                    'shoes': '👟',
                    'accessories': '⌚',
                    'facial': '💇',
                    'freckle': '✨'
                }.get(item['category'], '📦')
                
                print(f"  {i}. {category_emoji} {item['name']}")
                print(f"     ID: {item['id']}")
                print(f"     Score: {item['score']:.1f}")

if __name__ == "__main__":
    test_search()
