import aiosqlite
import asyncio

DB_FILE = "swag_store.db"

async def init_db():
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance INTEGER NOT NULL DEFAULT 1500
            )
        ''')
        
        await db.execute('''
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price INTEGER NOT NULL,
                description TEXT,
                image_url TEXT
            )
        ''')
        
        await db.execute('''
            CREATE TABLE IF NOT EXISTS inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                item_id INTEGER,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (item_id) REFERENCES items (id)
            )
        ''')
        
        # Populate Items if empty
        cursor = await db.execute("SELECT COUNT(*) FROM items")
        count = (await cursor.fetchone())[0]
        if count == 0:
            initial_items = [
                ("CyberNusa Sticker Pack", 10, "A cool pack of CyberNusa stickers.", "/static/img/sticker.png"),
                ("CyberNusa Lanyard", 25, "Premium lanyard for your ID card.", "/static/img/lanyard.png"),
                ("CyberNusa Coffee Mug", 50, "Keep your coffee warm while hacking.", "/static/img/mug.png"),
                ("CyberNusa Mousepad", 75, "Smooth surface for precise movements.", "/static/img/mousepad.png"),
                ("CyberNusa T-Shirt", 150, "Comfortable cotton t-shirt.", "/static/img/tshirt.png"),
                ("CyberNusa Hoodie", 250, "Stay warm during late-night coding.", "/static/img/hoodie.png"),
                ("CyberNusa Wireless Headphone", 300, "Noise-cancelling for deep focus.", "/static/img/headphone.png"),
                ("CyberNusa Mechanical Keyboard", 450, "Clicky switches for max WPM.", "/static/img/keyboard.png"),
                ("CyberNusa Pro Tablet", 800, "Perfect for reading docs on the go.", "/static/img/tablet.png"),
                ("CyberNusa Pro Laptop", 1200, "Powerful machine for compilation.", "/static/img/laptop.png"),
                ("Premium Flag", 100000, "The ultimate prize. Only the richest hackers can afford to see its true form.", "/static/img/flag.png")
            ]
            await db.executemany("INSERT INTO items (name, price, description, image_url) VALUES (?, ?, ?, ?)", initial_items)
            
        await db.commit()

def get_db_path():
    return DB_FILE
