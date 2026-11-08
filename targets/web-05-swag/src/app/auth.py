import jwt
from datetime import datetime, timedelta
import os
import secrets
from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel
import aiosqlite
import hashlib
from database import get_db_path

router = APIRouter()

# Generate a random secret key on startup
SECRET_KEY = os.getenv("JWT_SECRET", secrets.token_hex(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24 hours

class UserLogin(BaseModel):
    username: str
    password: str

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(request: Request):
    token = request.cookies.get("swag_session")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return user_id
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

@router.post("/register")
async def register(user: UserLogin):
    if not user.username or not user.password:
        raise HTTPException(status_code=400, detail="Username and password required")
        
    pwd_hash = hashlib.md5(user.password.encode()).hexdigest()
    
    async with aiosqlite.connect(get_db_path()) as db:
        try:
            await db.execute("INSERT INTO users (username, password, balance) VALUES (?, ?, 1500)", (user.username, pwd_hash))
            await db.commit()
            return {"success": True, "message": "User registered successfully"}
        except aiosqlite.IntegrityError:
            raise HTTPException(status_code=400, detail="Username already exists")

@router.post("/login")
async def login(user: UserLogin):
    pwd_hash = hashlib.md5(user.password.encode()).hexdigest()
    
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute("SELECT id FROM users WHERE username = ? AND password = ?", (user.username, pwd_hash))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Invalid credentials")
            
        access_token = create_access_token(data={"sub": row[0]})
        return {"success": True, "access_token": access_token, "token_type": "bearer"}

@router.post("/logout")
async def logout():
    return {"success": True, "message": "Logged out"}
