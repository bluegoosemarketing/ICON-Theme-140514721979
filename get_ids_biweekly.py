import requests
import json
import time

STORE_DOMAIN = "icon-meals-dev.myshopify.com"

# SCANNING ALL ITEMS (Twins + Standard)
HANDLES = [
    # Twins (Hidden)
    "steak-oz-1", "ground-turkey-oz-1", "salmon-oz-1",
    "red-potatoes-oz-1", "sweet-potato-mash-oz-1", "sweet-potatoes-oz-1",
    # Standard
    "shrimp-oz", "brisket-oz", "turkey-breast-oz", "cod-oz-1",
    "ground-bison-oz", "chicken-oz", "ground-beef-oz",
    "broccoli-oz-1", "cauliflower-oz", "kyoto-blend-veggies-oz",
    "sauteed-carrots-oz", "asparagus-oz-1", "brown-rice-oz-1",
    "green-beans-oz-1", "jasmine-saffron-rice-oz", "quinoa-oz-1",
    "white-rice-oz-1"
]

def main():
    print("--- 🚜 HARVESTING BI-WEEKLY IDs ---")
    js_output = []
    
    for h in HANDLES:
        url = f"https://{STORE_DOMAIN}/products/{h}.js"
        try:
            data = requests.get(url).json()
            pid = data['id']
            title = data['title']
            wid = None
            
            # Smart Scan: Find "2 Weeks" or "Bi-Weekly"
            for g in data.get("selling_plan_groups", []):
                for p in g['selling_plans']:
                    name = p['name'].lower()
                    if "2 weeks" in name or "bi-weekly" in name:
                        wid = str(p['id'])
                        break 
            
            if wid:
                print(f"✅ {title}: {wid}")
                js_output.append(f'  "{pid}": "{wid}", // {title}')
            else:
                print(f"❌ {title}: NO BI-WEEKLY PLAN FOUND")
                
        except:
            print(f"❌ Error scanning {h}")
        time.sleep(0.1)

    print("\n\n--- COPY THIS BLOCK ---")
    print("const CHILD_PLAN_MAP_BIWEEKLY = {")
    print("\n".join(js_output))
    print("};")

if __name__ == "__main__":
    main()
