from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import jwt
from contextlib import asynccontextmanager

from database import init_db
import auth
import store
import os

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    yield
    # Shutdown

app = FastAPI(lifespan=lifespan)

# Routes
app.include_router(auth.router, prefix="/api/auth")
app.include_router(store.router, prefix="/api/store")

# Static files and frontend routing
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
@app.get("/index.html")
async def index():
    return FileResponse("static/index.html")

@app.get("/register.html")
async def register():
    return FileResponse("static/register.html")

@app.get("/store.html")
async def store_page():
    return FileResponse("static/store.html")
