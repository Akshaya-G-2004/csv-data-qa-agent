import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from routes import router

app = FastAPI(
    title="CSV/Excel Data Q&A AI Agent",
    description="Safe, AST-powered Natural Language Data Analysis Agent.",
    version="1.0.0"
)

# Configure CORS for local development and production origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register endpoints
app.include_router(router)

@app.get("/")
def read_root():
    return {
        "status": "online",
        "message": "CSV Data Q&A AI Agent is ready. Access /docs for API documentation."
    }

if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", 8000))
    
    # Ensure server binds to local loopback only for development safety
    uvicorn.run("main:app", host=host, port=port, reload=True)
