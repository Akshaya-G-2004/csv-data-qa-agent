import os
import uuid
import logging
from pathlib import Path
from fastapi import HTTPException, UploadFile

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("csv-ai-agent")

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

def validate_and_save_file(file: UploadFile) -> tuple[str, str]:
    """
    Validates file extension, size, and saves it with a secure random UUID filename.
    Returns a tuple of (unique_file_key, original_filename).
    """
    original_name = file.filename or "uploaded_file"
    file_ext = Path(original_name).suffix.lower()

    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{file_ext}'. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Generate a secure unique filename
    unique_key = f"{uuid.uuid4().hex}{file_ext}"
    target_path = UPLOAD_DIR / unique_key

    # Save and check file size concurrently
    size = 0
    try:
        with open(target_path, "wb") as f:
            while chunk := file.file.read(8192):
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=400, 
                        detail=f"File exceeds maximum allowed size of {MAX_FILE_SIZE // (1024*1024)}MB."
                    )
                f.write(chunk)
    except Exception as e:
        if target_path.exists():
            target_path.unlink()
        if isinstance(e, HTTPException):
            raise e
        logger.error(f"Error saving file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save uploaded file.")

    return unique_key, original_name

def get_secure_file_path(file_key: str) -> Path:
    """
    Validates that the file exists and prevents directory traversal.
    """
    # Sanitize key to prevent path traversal
    safe_key = Path(file_key).name
    resolved_path = (UPLOAD_DIR / safe_key).resolve()
    
    # Enforce boundary check (prefix matches upload directory resolved path)
    resolved_upload_dir = UPLOAD_DIR.resolve()
    if not str(resolved_path).startswith(str(resolved_upload_dir) + os.sep) and resolved_path.parent != resolved_upload_dir:
        raise HTTPException(status_code=400, detail="Access denied: Invalid file path.")

    if not resolved_path.exists():
        raise HTTPException(status_code=404, detail="Requested file not found.")

    return resolved_path
