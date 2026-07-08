import pandas as pd
from typing import Any, Optional

def generate_chart_config(result: Any, recommended_type: Optional[str] = None) -> Optional[dict]:
    """
    Analyzes the execution result. If it's a pandas DataFrame or Series,
    determines if a bar, line, or pie chart is suitable and prepares the data format.
    If recommended_type is specified, respects it.
    """
    # If the result is a Series, convert it to a DataFrame
    if isinstance(result, pd.Series):
        result = result.reset_index()

    if not isinstance(result, pd.DataFrame):
        return None

    if result.empty:
        return None

    # Limit chart data size to avoid overloading frontend
    if len(result) > 50:
        result = result.head(50)

    cols = list(result.columns)
    
    # We need at least 2 columns to build a chart (X-axis/category and Y-value/numeric)
    if len(cols) < 2:
        return None

    # Identify numeric and non-numeric columns
    numeric_cols = []
    categorical_cols = []

    for col in cols:
        if pd.api.types.is_numeric_dtype(result[col]):
            numeric_cols.append(col)
        else:
            categorical_cols.append(col)

    if not numeric_cols:
        return None

    # If there are no categorical columns, create a dummy or use index
    if not categorical_cols:
        result = result.reset_index()
        cols = list(result.columns)
        categorical_cols = [cols[0]]

    # Pick the primary categorical column and numeric columns
    x_axis = categorical_cols[0]
    y_keys = numeric_cols[:3] 

    # Clean up data values for JSON serialization
    cleaned_df = result.copy()
    for col in cols:
        if pd.api.types.is_numeric_dtype(cleaned_df[col]):
            cleaned_df[col] = cleaned_df[col].fillna(0)
        else:
            cleaned_df[col] = cleaned_df[col].astype(str)

    chart_data = cleaned_df[[x_axis] + y_keys].to_dict(orient="records")

    # Respect LLM recommendation if provided and valid
    if recommended_type in ("bar", "line", "pie"):
        chart_type = recommended_type
    else:
        # Do not generate a chart unless explicitly asked by the user
        return None

    return {
        "type": chart_type,
        "data": chart_data,
        "xAxisKey": x_axis,
        "dataKeys": y_keys
    }
