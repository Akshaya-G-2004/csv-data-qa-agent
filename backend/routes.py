import os
import pandas as pd
from typing import List, Dict, Optional, Any
from fastapi import APIRouter, UploadFile, File, Form, Query, HTTPException
from pydantic import BaseModel

from utils import validate_and_save_file, get_secure_file_path
from ai_agent import run_agent_workflow

router = APIRouter()

# In-memory history store indexed by file_key
HISTORY_STORE: Dict[str, List[Dict[str, Any]]] = {}

class AskRequest(BaseModel):
    file_key: Optional[str] = None
    file_keys: Optional[Dict[str, str]] = None
    question: str
    history: Optional[List[Dict[str, Any]]] = []

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """
    Upload CSV/Excel endpoint. Returns file key, original filename, columns and preview.
    """
    file_key, original_name = validate_and_save_file(file)
    
    # Pre-warm history
    HISTORY_STORE[file_key] = []
    
    # Read schema info for direct feedback
    file_path = get_secure_file_path(file_key)
    try:
        if str(file_path).endswith(".csv"):
            df = pd.read_csv(file_path)
        else:
            df = pd.read_excel(file_path)
    except Exception as e:
        # Cleanup
        if os.path.exists(file_path):
            os.unlink(file_path)
        raise HTTPException(status_code=400, detail=f"Failed to read file layout: {str(e)}")

    if df.empty:
        if os.path.exists(file_path):
            os.unlink(file_path)
        raise HTTPException(status_code=400, detail="The uploaded dataset is empty.")

    row_count, col_count = df.shape
    columns = list(df.columns)
    dtypes = {col: str(dtype) for col, dtype in zip(df.columns, df.dtypes)}

    return {
        "file_key": file_key,
        "filename": original_name,
        "rows": row_count,
        "columns_count": col_count,
        "columns": columns,
        "dtypes": dtypes
    }

@router.get("/preview")
async def preview_dataset(file_key: str = Query(..., description="The unique file key")):
    """
    Returns column details and first 10 rows for visual inspection on frontend.
    """
    file_path = get_secure_file_path(file_key)
    
    try:
        if str(file_path).endswith(".csv"):
            df = pd.read_csv(file_path)
        else:
            df = pd.read_excel(file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parsing dataset: {str(e)}")

    row_count, col_count = df.shape
    sample_records = df.head(10).fillna("").to_dict(orient="records")
    columns = list(df.columns)
    dtypes = {col: str(dtype) for col, dtype in zip(df.columns, df.dtypes)}

    return {
        "filename": file_path.name,
        "rows": row_count,
        "columns_count": col_count,
        "columns": columns,
        "dtypes": dtypes,
        "sample": sample_records
    }

@router.post("/ask")
async def ask_question(request: AskRequest):
    """
    Process plain English query, evaluate code safely, return response and charts.
    """
    file_paths = {}
    history_key = None
    
    if request.file_keys:
        for var_name, key in request.file_keys.items():
            if key:
                file_paths[var_name] = str(get_secure_file_path(key))
                if not history_key:
                    history_key = key
    elif request.file_key:
        file_paths["df1"] = str(get_secure_file_path(request.file_key))
        history_key = request.file_key
    else:
        raise HTTPException(status_code=400, detail="Either file_key or file_keys must be provided.")

    if not history_key:
        history_key = "default_session"

    # Synchronize history from request
    history = request.history or []
    
    result = run_agent_workflow(file_paths, request.question, history)
    
    if "error" in result:
        return {
            "success": False,
            "error": result["error"],
            "pandas_code": result.get("pandas_code"),
            "reasoning": result.get("reasoning")
        }

    # Save to history store
    if history_key not in HISTORY_STORE:
        HISTORY_STORE[history_key] = []
        
    HISTORY_STORE[history_key].append({
        "role": "user",
        "content": request.question
    })
    HISTORY_STORE[history_key].append({
        "role": "assistant",
        "content": result["answer"],
        "pandas_code": result["pandas_code"],
        "result_data": result["result_data"],
        "chart": result["chart"]
    })

    return result

@router.get("/history")
async def get_history(file_key: str = Query(..., description="The unique file key")):
    """
    Returns saved conversation history for a given dataset context.
    """
    if file_key not in HISTORY_STORE:
        return {"history": []}
    return {"history": HISTORY_STORE[file_key]}

@router.get("/download")
async def download_file(file_key: str = Query(..., description="The unique file key")):
    """
    Reads the active dataset from disk (with all in-place cleanings applied)
    and streams it back as a formatted Excel spreadsheet (.xlsx).
    """
    import io
    from fastapi.responses import StreamingResponse
    
    file_path = get_secure_file_path(file_key)
    
    try:
        if str(file_path).endswith(".csv"):
            df = pd.read_csv(file_path)
        else:
            df = pd.read_excel(file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read dataset: {str(e)}")

    # Convert to Excel workbook in memory
    output = io.BytesIO()
    try:
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Cleaned Data")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate Excel worksheet: {str(e)}")
        
    output.seek(0)
    
    filename = f"cleaned_{file_path.name.replace('.csv', '')}.xlsx"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-Content-Type-Options": "nosniff"
    }
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers
    )
