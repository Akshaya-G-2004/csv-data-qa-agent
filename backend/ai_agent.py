import os
import json
import logging
import pandas as pd
from typing import Any, Dict, List, Optional
from groq import Groq

from prompt import (
    SYSTEM_PANDAS_GENERATOR,
    SYSTEM_ANSWER_EXPLAINER,
    make_pandas_prompt,
    make_explanation_prompt
)
from dataframe_executor import execute_pandas_query
from chart_generator import generate_chart_config

logger = logging.getLogger("csv-ai-agent")

def get_groq_client() -> Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key or api_key == "your_groq_api_key_here":
        raise ValueError("GROQ_API_KEY is not configured in the environment variables (.env).")
    return Groq(api_key=api_key)

def extract_schema_metadata(df: pd.DataFrame) -> dict:
    """
    Extracts summary, column names, datatypes and sample rows for the LLM context.
    """
    columns = list(df.columns)
    dtypes = {col: str(dtype) for col, dtype in zip(df.columns, df.dtypes)}
    
    # Take a small safe sample (first 3 rows) and serialize
    sample_data = df.head(3).fillna("NaN").to_dict(orient="records")
    
    return {
        "columns": columns,
        "dtypes": dtypes,
        "sample": sample_data
    }

def format_history(history: List[Dict[str, str]]) -> str:
    """
    Formats the message list into a readable transcript for context.
    """
    formatted = []
    # Limit history to the last 6 messages to prevent token bloat
    for msg in history[-6:]:
        role = "User" if msg["role"] == "user" else "Assistant"
        formatted.append(f"{role}: {msg['content']}")
    return "\n".join(formatted)

def serialize_result(result: Any, recommended_type: Optional[str] = None) -> tuple[Any, Optional[dict]]:
    """
    Serializes a pandas result (DataFrame, Series, or scalar) into JSON-safe types
    and generates an optional chart layout.
    """
    chart_config = None

    if isinstance(result, pd.DataFrame):
        chart_config = generate_chart_config(result, recommended_type)
        # Format for React Table representation
        columns = list(result.columns)
        records = result.fillna("").to_dict(orient="records")
        data_preview = {
            "type": "dataframe",
            "columns": columns,
            "data": records
        }
        return data_preview, chart_config

    elif isinstance(result, pd.Series):
        chart_config = generate_chart_config(result, recommended_type)
        index_col = result.index.name or "index"
        val_col = result.name or "value"
        columns = [index_col, val_col]
        records = [{index_col: k, val_col: v} for k, v in result.fillna("").to_dict().items()]
        data_preview = {
            "type": "series",
            "columns": columns,
            "data": records
        }
        return data_preview, chart_config

    else:
        # Scalar output
        return {
            "type": "scalar",
            "value": str(result)
        }, None

def run_agent_workflow(file_paths: Dict[str, str], question: str, history: List[Dict[str, str]]) -> dict:
    """
    Main orchestrator for the agent. Runs the two-stage LLM workflow, supporting multi-table merging.
    """
    # 1. Load DataFrames
    dfs = {}
    datasets_info = []
    
    try:
        for var_name, path in file_paths.items():
            if not path:
                continue
            if path.endswith(".csv"):
                df = pd.read_csv(path)
            else:
                df = pd.read_excel(path)
            
            if df.empty:
                return {"error": f"The dataset '{var_name}' is empty."}
                
            dfs[var_name] = df
            schema = extract_schema_metadata(df)
            datasets_info.append({
                "variable_name": var_name,
                "filename": os.path.basename(path),
                "columns": schema["columns"],
                "dtypes": schema["dtypes"],
                "sample": schema["sample"]
            })
    except Exception as e:
        logger.error(f"Error loading datasets: {e}")
        return {"error": f"Failed to load dataset: {str(e)}"}

    if not dfs:
        return {"error": "No active datasets found."}

    # 2. Extract schema and history
    history_str = format_history(history)

    # 3. Stage 1: Generate pandas expression
    client = get_groq_client()
    pandas_prompt = make_pandas_prompt(datasets_info, question, history_str)

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PANDAS_GENERATOR},
                {"role": "user", "content": pandas_prompt}
            ],
            temperature=0.0,
            response_format={"type": "json_object"}
        )
        stage1_data = json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.error(f"Stage 1 LLM request failed: {e}")
        return {"error": f"LLM was unable to process the schema: {str(e)}"}

    if stage1_data.get("error"):
        return {
            "error": stage1_data["error"],
            "reasoning": stage1_data.get("reasoning")
        }

    pandas_code = stage1_data.get("code")
    reasoning = stage1_data.get("reasoning")

    if not pandas_code:
        return {"error": "No pandas computation code was generated by the model."}

    # 4. Execute safe pandas query
    try:
        execution_result, is_modified, modified_var = execute_pandas_query(dfs, pandas_code)
    except Exception as e:
        logger.error(f"Pandas execution failed: {e}")
        return {
            "error": f"Failed to compute answer securely: {str(e)}",
            "pandas_code": pandas_code,
            "reasoning": reasoning
        }

    # If the data was modified, overwrite the active file on disk
    if is_modified and modified_var:
        target_path = file_paths[modified_var]
        try:
            if target_path.endswith(".csv"):
                dfs[modified_var].to_csv(target_path, index=False)
            else:
                dfs[modified_var].to_excel(target_path, index=False)
        except Exception as e:
            logger.error(f"Failed to write modified dataset back to disk: {e}")
            return {
                "error": f"Transformation calculated successfully, but could not write back to file: {str(e)}",
                "pandas_code": pandas_code,
                "reasoning": reasoning
            }

    # Format result for context and response
    recommended_chart_type = stage1_data.get("chart_type")
    serialized_res, chart_config = serialize_result(execution_result, recommended_chart_type)
    result_context = str(execution_result)

    # 5. Stage 2: Generate natural language explanation
    explanation_prompt = make_explanation_prompt(question, pandas_code, result_context, history_str)
    try:
        explain_response = client.chat.completions.create(
            model="llama-3.1-8b-instant", # Faster model for writing explanation
            messages=[
                {"role": "system", "content": SYSTEM_ANSWER_EXPLAINER},
                {"role": "user", "content": explanation_prompt}
            ],
            temperature=0.2,
            response_format={"type": "json_object"}
        )
        stage2_data = json.loads(explain_response.choices[0].message.content)
    except Exception as e:
        logger.error(f"Stage 2 LLM request failed: {e}")
        stage2_data = {
            "answer": "Calculated the query successfully, but could not format explanation.",
            "supporting_details": str(e)
        }

    return {
        "success": True,
        "pandas_code": pandas_code,
        "reasoning": reasoning,
        "result_data": serialized_res,
        "chart": chart_config,
        "answer": stage2_data.get("answer"),
        "supporting_details": stage2_data.get("supporting_details"),
        "data_modified": is_modified
    }
