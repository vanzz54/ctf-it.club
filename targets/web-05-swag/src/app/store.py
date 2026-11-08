from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
import aiosqlite
import asyncio
from auth import get_current_user
from database import get_db_path

router = APIRouter()

class ActionRequest(BaseModel):
    item_id: int

@router.get("/profile")
async def get_profile(user_id: int = Depends(get_current_user)):
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT id, username, balance FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="User not found")
        user = dict(row)
        
        # Get inventory
        cursor = await db.execute("""
            SELECT items.id, items.name, items.price, items.image_url, COUNT(inventory.id) as quantity
            FROM inventory 
            JOIN items ON inventory.item_id = items.id 
            WHERE inventory.user_id = ?
            GROUP BY items.id
        """, (user_id,))
        inventory = [dict(row) for row in await cursor.fetchall()]
        
        user["inventory"] = inventory
        return {"success": True, "data": user}

@router.get("/items")
async def get_items():
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM items")
        items = [dict(row) for row in await cursor.fetchall()]
        return {"success": True, "data": items}

import time
import asyncio
from collections import defaultdict
from fastapi.responses import JSONResponse

# Simple in-memory rate limiter state
user_requests = defaultdict(list)

# Global lock to prevent SQLite disk I/O error on concurrent writes
db_write_lock = asyncio.Lock()

def is_rate_limited(user_id: int) -> bool:
    now = time.time()
    user_requests[user_id] = [t for t in user_requests[user_id] if now - t < 1.0]
    if len(user_requests[user_id]) >= 5:
        return True
    user_requests[user_id].append(now)
    return False

@router.post("/buy")
async def buy_item(req: ActionRequest, user_id: int = Depends(get_current_user)):
    if is_rate_limited(user_id):
        return JSONResponse(status_code=429, content={"success": False, "error": "Rate limit exceeded! Please slow down."})
        
    async with aiosqlite.connect(get_db_path()) as db:
        # Check item price
        cursor = await db.execute("SELECT price FROM items WHERE id = ?", (req.item_id,))
        item = await cursor.fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="Item not found")
        price = item[0]

        # Check balance
        cursor = await db.execute("SELECT balance FROM users WHERE id = ?", (user_id,))
        balance = (await cursor.fetchone())[0]

        if balance < price:
            return {"success": False, "error": "Insufficient balance"}

        # Buy item (Serialize write to prevent SQLite locking errors)
        async with db_write_lock:
            await db.execute("UPDATE users SET balance = balance - ? WHERE id = ?", (price, user_id))
            await db.execute("INSERT INTO inventory (user_id, item_id) VALUES (?, ?)", (user_id, req.item_id))
            await db.commit()
        
        if req.item_id == 11:
            return {"success": True, "message": "Purchase successful! FLAG: ITCLUB{r4c3_c0nd1t10n_m4k3s_y0u_r1ch_c7b3rnu5a}"}
            
        return {"success": True, "message": "Item purchased successfully"}

@router.post("/sell")
async def sell_item(req: ActionRequest, user_id: int = Depends(get_current_user)):
    """
    VULNERABLE ENDPOINT: Race Condition (Time-of-Check to Time-of-Use)
    """
    if is_rate_limited(user_id):
        return JSONResponse(status_code=429, content={"success": False, "error": "Rate limit exceeded! Please slow down."})

    async with aiosqlite.connect(get_db_path()) as db:
        # 1. TIME OF CHECK
        cursor = await db.execute("SELECT id FROM inventory WHERE user_id = ? AND item_id = ? LIMIT 1", (user_id, req.item_id))
        inv_record = await cursor.fetchone()
        
        if not inv_record:
            return {"success": False, "error": "You don't own this item"}
            
        inv_id = inv_record[0]

        # Get item price
        cursor = await db.execute("SELECT price FROM items WHERE id = ?", (req.item_id,))
        price = (await cursor.fetchone())[0]

        # 2. DELAY (Simulating database load or payment gateway API call)
        # This async delay allows other concurrent requests to pass the check above
        # before the item is actually removed from the database below.
        await asyncio.sleep(0.05) 

        # 3. TIME OF USE
        # Serialize write to prevent SQLite locking errors, but the RACE CONDITION still works 
        # because the time of check was done outside this lock!
        async with db_write_lock:
            # Add balance
            await db.execute("UPDATE users SET balance = balance + ? WHERE id = ?", (price, user_id))
            
            # Remove item from inventory
            await db.execute("DELETE FROM inventory WHERE id = ?", (inv_id,))
            
            await db.commit()
            
        return {"success": True, "message": f"Item sold for ${price}"}
